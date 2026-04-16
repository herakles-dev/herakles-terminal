import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { IncomingMessage } from 'http';
import { SessionStore } from '../session/SessionStore.js';
import { WindowManager } from '../window/WindowManager.js';
import { MultiDeviceManager } from '../device/MultiDeviceManager.js';
import { AutomationEngine } from '../automation/AutomationEngine.js';
import { AuditLogger } from '../audit/AuditLogger.js';
import { extractAuthFromUpgrade, AutheliaUser } from '../middleware/autheliaAuth.js';
import { WebSocketRateLimiter } from '../middleware/rateLimit.js';
import { config } from '../config.js';
import { validateClientMessage, ValidatedClientMessage } from './messageSchema.js';
import type { ServerMessage } from '../../shared/types.js';
import { MAX_MESSAGE_SIZE, RESIZE_CONSTANTS } from '../../shared/constants.js';
import { todoManager } from '../todo/TodoManager.js';
import { teamManager } from '../team/TeamManager.js';
import { stopProtocolManager } from '../stop/StopProtocolManager.js';
import { todoFileWatcher } from '../todo/TodoFileWatcher.js';
import { contextManager } from '../context/ContextManager.js';
import { OutputRingBuffer } from '../window/OutputRingBuffer.js';
import type { MusicManager } from '../music/MusicManager.js';
import type { MusicDockState } from '../../shared/musicProtocol.js';
import type { ArtifactManager } from '../canvas/ArtifactManager.js';

interface Connection {
  id: string;
  ws: WebSocket;
  user: AutheliaUser;
  deviceId: string;
  sessionId: string | null;
  windowSubscriptions: Set<string>;
  clientIp: string;
  userAgent: string;
  authenticated: boolean;
  lastPing: number;
  healthScore?: number;  // WebGL health score (0-100) for adaptive capture
}

interface WindowListenerState {
  registered: boolean;
  listenerCount: number;
  /** R-1: Set to true before pty.kill so any post-kill onData events are discarded. */
  disposed: boolean;
}

interface ConnectionMeta {
  clientIp: string;
  userAgent: string;
  req: IncomingMessage;
}

export class ConnectionManager {
  private connections: Map<string, Connection> = new Map();
  private store: SessionStore;
  private windowManager: WindowManager;
  private deviceManager: MultiDeviceManager;
  private automationEngine: AutomationEngine;
  private auditLogger: AuditLogger;
  private rateLimiter: WebSocketRateLimiter;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private windowListenerStates: Map<string, WindowListenerState> = new Map();
  private commandBuffers: Map<string, string> = new Map();
  private windowSubscribeTimers: Map<string, NodeJS.Timeout> = new Map();
  private cronsInitializedForUsers: Set<string> = new Set();
  private outputRingBuffers: Map<string, OutputRingBuffer> = new Map();
  private outputCoalesceState: Map<string, { buffer: string; timer: NodeJS.Timeout | null; seq: number }> = new Map();
  private musicManager: MusicManager | null = null;
  private artifactManager: ArtifactManager | null = null;

  constructor(
    store: SessionStore,
    windowManager: WindowManager,
    deviceManager: MultiDeviceManager,
    automationEngine: AutomationEngine,
    auditLogger: AuditLogger
  ) {
    this.store = store;
    this.windowManager = windowManager;
    this.deviceManager = deviceManager;
    this.automationEngine = automationEngine;
    this.auditLogger = auditLogger;
    this.rateLimiter = new WebSocketRateLimiter(store.getDatabase());
    
    this.setupDeviceCallbacks();
    this.setupAutomationCallbacks();
    this.startHeartbeat();
  }

  /**
   * Set the MusicManager for dock state WebSocket routing.
   * Called during server initialization.
   */
  setMusicManager(manager: MusicManager): void {
    this.musicManager = manager;
  }

  /**
   * Set the ArtifactManager for artifact history WebSocket routing.
   * Called during server initialization.
   */
  setArtifactManager(manager: ArtifactManager): void {
    this.artifactManager = manager;
  }

  private setupAutomationCallbacks(): void {
    this.automationEngine.onWindowCreated(async (sessionId, windowId, userEmail) => {
      try {
        console.log(`[ConnectionManager] onWindowCreated callback: windowId=${windowId}, sessionId=${sessionId}`);

        // [FIX-4] Verify window exists in database before setting up subscriptions
        const window = await this.windowManager.getWindow(windowId, userEmail);
        if (!window) {
          console.error(`[ConnectionManager] Window not found after creation: ${windowId}`);
          return;
        }

        console.log(`[ConnectionManager] Window found: ${window.id}, setting up subscriptions`);

        // [FIX-4] Set up subscriptions for all connected clients in this session
        let subscriptionCount = 0;
        for (const connection of this.connections.values()) {
          if (connection.sessionId === sessionId) {
            try {
              connection.windowSubscriptions.add(windowId);
              // This captures window content and sets up PTY listening
              await this.setupWindowOutput(connection, windowId);
              subscriptionCount++;
              console.log(`[ConnectionManager] Setup output for connection ${connection.id}`);
            } catch (setupError) {
              console.error(`[ConnectionManager] Failed to setup output for connection ${connection.id}:`, setupError);
              // Continue with other connections - don't fail the entire callback
            }
          }
        }

        console.log(`[ConnectionManager] Broadcast window:created to session ${sessionId} (${subscriptionCount} connections)`);

        // [FIX-4] Broadcast window creation to all clients in session
        this.broadcastToSession(sessionId, {
          type: 'window:created',
          window: {
            id: window.id,
            sessionId: window.sessionId,
            type: window.type || 'terminal',
            name: window.name,
            autoName: window.autoName,
            positionX: window.layout.x,
            positionY: window.layout.y,
            width: window.layout.width,
            height: window.layout.height,
            zIndex: window.zIndex,
            isMain: window.isMain,
            createdAt: window.createdAt,
          },
        });

        console.log(`[ConnectionManager] Window creation callback completed for ${windowId}`);
      } catch (error) {
        console.error(`[ConnectionManager] Unexpected error in onWindowCreated callback:`, error);
        // Swallow error - don't throw from callbacks as this could crash automation
      }
    });
  }

  private setupDeviceCallbacks(): void {
    this.deviceManager.onLockAcquired((windowId, deviceId, expiresAt) => {
      this.broadcastToWindow(windowId, {
        type: 'device:lock-acquired',
        windowId,
        deviceId,
        expiresAt,
      });
    });

    this.deviceManager.onLockReleased((windowId) => {
      this.broadcastToWindow(windowId, {
        type: 'device:lock-released',
        windowId,
      });
    });

    this.deviceManager.onDeviceJoined((sessionId, deviceId, deviceName) => {
      this.broadcastToSession(sessionId, {
        type: 'device:connected',
        deviceId,
        deviceName: deviceName || 'Unknown Device',
      });
    });

    this.deviceManager.onDeviceLeft((sessionId, deviceId) => {
      this.broadcastToSession(sessionId, {
        type: 'device:disconnected',
        deviceId,
      });
    });
  }

  private getOrCreateRingBuffer(windowId: string): OutputRingBuffer {
    let buffer = this.outputRingBuffers.get(windowId);
    if (!buffer) {
      buffer = new OutputRingBuffer();
      this.outputRingBuffers.set(windowId, buffer);
    }
    return buffer;
  }

  handleConnection(ws: WebSocket, meta: ConnectionMeta): void {
    const user = extractAuthFromUpgrade(meta.req);
    
    if (!user) {
      ws.close(4001, 'Authentication required');
      return;
    }

    const connectionId = uuidv4();
    const deviceId = uuidv4();
    
    const connection: Connection = {
      id: connectionId,
      ws,
      user,
      deviceId,
      sessionId: null,
      windowSubscriptions: new Set(),
      clientIp: meta.clientIp,
      userAgent: meta.userAgent,
      authenticated: true,
      lastPing: Date.now(),
    };

    this.connections.set(connectionId, connection);

    this.auditLogger.logAuthSuccess({
      userEmail: user.email,
      deviceId,
      ip: meta.clientIp,
      userAgent: meta.userAgent,
    });

    const sessions = this.store.getSessionsByUser(user.email);
    
    this.automationEngine.initializeCronJobs(user.email);
    
    this.send(ws, {
      type: 'auth-success',
      sessionId: '',
      token: '',
      username: user.username,
      groups: user.groups,
      sessions: sessions.map(s => ({
        id: s.id,
        name: s.name,
        userEmail: s.user_email,
        tmuxSession: `zeus-${s.id}`,
        createdAt: new Date(s.created_at),
        lastActiveAt: new Date(s.last_active_at),
        state: s.state as 'active' | 'dormant' | 'terminated',
        timeoutHours: s.timeout_hours,
        workingDirectory: s.working_directory,
        activeConnections: this.deviceManager.getActiveDeviceCount(s.id),
        env: {},
      })),
    });

    ws.on('message', (data) => {
      try {
        const messageSize = Buffer.isBuffer(data) ? data.length : data.toString().length;
        if (messageSize > MAX_MESSAGE_SIZE) {
          this.send(ws, {
            type: 'error',
            code: 'MESSAGE_TOO_LARGE',
            message: `Message exceeds ${Math.round(MAX_MESSAGE_SIZE / 1000)}KB limit`,
          });
          return;
        }

        const rateCheck = this.rateLimiter.check(user.email);
        if (!rateCheck.allowed) {
          this.send(ws, {
            type: 'error',
            code: 'RATE_LIMITED',
            message: 'Too many messages, please slow down',
          });
          return;
        }

        const parsed = JSON.parse(data.toString());
        const validation = validateClientMessage(parsed);
        
        if (!validation.success) {
          this.send(ws, {
            type: 'error',
            code: 'INVALID_MESSAGE',
            message: `Invalid message format: ${validation.error}`,
          });
          return;
        }
        
        this.handleMessage(connectionId, validation.data).catch(error => {
          console.error(`[ConnectionManager] Async message handler error:`, error);
          const conn = this.connections.get(connectionId);
          if (conn) {
            this.send(conn.ws, {
              type: 'error',
              code: 'INTERNAL_ERROR',
              message: 'Server error processing request',
            });
          }
        });
      } catch (error) {
        console.error(`Invalid message from ${connectionId}:`, error);
        this.send(ws, {
          type: 'error',
          code: 'PARSE_ERROR',
          message: 'Failed to parse message',
        });
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(connectionId);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for ${connectionId}:`, error);
      this.handleDisconnect(connectionId);
    });
  }

  private async handleMessage(connectionId: string, message: ValidatedClientMessage): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.lastPing = Date.now();

    switch (message.type) {
      case 'session:resume':
        this.handleSessionResume(connection, message.sessionId);
        break;

      case 'session:create':
        this.handleSessionCreate(connection, message.name);
        break;

      case 'window:create':
        this.handleWindowCreate(connection, message.sessionId, message.windowType);
        break;

      case 'window:close':
        this.handleWindowClose(connection, message.windowId);
        break;

      case 'window:focus':
        this.handleWindowFocus(connection, message.windowId);
        break;

      case 'window:send':
        this.handleWindowSend(connection, message.windowId, message.data);
        break;

      case 'window:resize':
        this.handleWindowResize(connection, message.windowId, message.cols, message.rows, message.seq);
        break;

      case 'window:layout':
        this.handleWindowLayout(connection, message);
        break;

      case 'window:subscribe':
        this.handleWindowSubscribe(
          connection,
          message.windowId
        );
        break;

      case 'window:rename':
        this.handleWindowRename(connection, message.windowId, message.name);
        break;

      case 'input':
        this.handleInput(connection, message.windowId, message.data);
        break;

      case 'ping':
        connection.lastPing = Date.now();
        this.send(connection.ws, { type: 'pong' });
        break;

      case 'pong':
        connection.lastPing = Date.now();
        break;

      case 'todo:subscribe':
        this.handleTodoSubscribe(connection, message.windowId);
        break;

      case 'todo:unsubscribe':
        this.handleTodoUnsubscribe(connection, message.windowId);
        break;

      case 'window:replay':
        this.handleWindowReplay(connection, message.windowId, message.afterSeq);
        break;

      case 'window:backpressure':
        if (connection.windowSubscriptions.has(message.windowId)) {
          this.handleWindowBackpressure(message.windowId, message.throttle);
        }
        break;

      case 'context:subscribe':
        await this.handleContextSubscribe(connection, message.windowId, message.projectPath);
        break;

      case 'context:unsubscribe':
        this.handleContextUnsubscribe(connection, message.windowId);
        break;

      case 'music:subscribe':
        this.handleMusicSubscribe(connection);
        break;

      case 'music:unsubscribe':
        this.handleMusicUnsubscribe(connection);
        break;

      case 'music:dock:update':
        this.handleMusicDockUpdate(connection, message.state);
        break;

      case 'music:sync':
      case 'music:load':
        // These are handled via REST API currently; no-op for WebSocket
        break;

      case 'artifact:subscribe':
        this.handleArtifactSubscribe(connection);
        break;

      case 'artifact:unsubscribe':
        this.handleArtifactUnsubscribe(connection);
        break;

      case 'team:subscribe':
        teamManager.subscribe(connection.ws);
        break;

      case 'team:unsubscribe':
        teamManager.unsubscribe(connection.ws);
        break;

      case 'stop:subscribe':
        stopProtocolManager.subscribe(connection.ws);
        break;

      case 'stop:unsubscribe':
        stopProtocolManager.unsubscribe(connection.ws);
        break;

      case 'stop:activate': {
        const result = stopProtocolManager.activate(
          connection.user.username,
          message.youtubeUrl,
          message.message,
        );
        if (!result.ok) {
          this.send(connection.ws, {
            type: 'error',
            code: 'STOP_PROTOCOL_ERROR',
            message: result.reason || 'Activation failed',
          });
        } else {
          this.send(connection.ws, {
            type: 'stop:ack',
            phase: stopProtocolManager.getPhase(),
          });
        }
        break;
      }
    }
  }

  private handleTodoSubscribe(connection: Connection, windowId: string): void {
    if (!windowId) return;
    todoManager.subscribe(windowId, connection.ws);
    todoFileWatcher.subscribeWindow(windowId);
  }

  private handleTodoUnsubscribe(connection: Connection, windowId: string): void {
    if (!windowId) return;
    todoManager.unsubscribe(connection.ws);
    todoFileWatcher.unsubscribeWindow(windowId);
  }

  private async handleContextSubscribe(connection: Connection, windowId: string, projectPath?: string): Promise<void> {
    if (!windowId) return;
    console.log(`[ConnectionManager] Context subscribe for window ${windowId}`, {
      providedPath: projectPath,
      user: connection.user.email,
    });
    await contextManager.subscribe(windowId, projectPath || null, connection.ws);
  }

  private handleContextUnsubscribe(_connection: Connection, windowId: string): void {
    if (!windowId) return;
    contextManager.unsubscribe(windowId);
  }

  private handleMusicSubscribe(connection: Connection): void {
    if (!this.musicManager) return;
    this.musicManager.subscribe(connection.ws, connection.user.email);
  }

  private handleMusicUnsubscribe(connection: Connection): void {
    if (!this.musicManager) return;
    this.musicManager.unsubscribe(connection.ws);
  }

  private handleMusicDockUpdate(connection: Connection, state: MusicDockState): void {
    if (!this.musicManager) return;
    this.musicManager.handleDockUpdate(connection.ws, connection.user.email, state);
  }

  private handleArtifactSubscribe(connection: Connection): void {
    if (!this.artifactManager) return;
    this.artifactManager.subscribe(connection.ws, connection.user.email);
  }

  private handleArtifactUnsubscribe(connection: Connection): void {
    if (!this.artifactManager) return;
    this.artifactManager.unsubscribe(connection.ws);
  }

  private async handleSessionResume(connection: Connection, sessionId: string): Promise<void> {
    const session = this.store.getSession(sessionId, connection.user.email);

    if (!session) {
      this.send(connection.ws, {
        type: 'error',
        code: 'SESSION_NOT_FOUND',
        message: 'Session not found or access denied',
      });
      return;
    }

    connection.sessionId = sessionId;

    if (session.state === 'dormant') {
      this.store.updateState(sessionId, 'active');
      await this.automationEngine.onResume(sessionId, connection.user.email);
    }

    // Initialize cron jobs only once per user (not once per connection resume)
    if (!this.cronsInitializedForUsers.has(connection.user.email)) {
      this.automationEngine.initializeCronJobs(connection.user.email);
      this.cronsInitializedForUsers.add(connection.user.email);
    }

    this.store.updateActivity(sessionId);
    
    this.deviceManager.registerDevice(sessionId, {
      id: connection.deviceId,
      userEmail: connection.user.email,
      name: this.parseDeviceName(connection.userAgent),
      userAgent: connection.userAgent,
    });

    let windows = await this.windowManager.listWindows(sessionId, connection.user.email);
    
    for (const window of windows) {
      connection.windowSubscriptions.add(window.id);
    }

    this.auditLogger.logSessionResume({
      sessionId,
      userEmail: connection.user.email,
      deviceId: connection.deviceId,
      ip: connection.clientIp,
      userAgent: connection.userAgent,
    });

    this.send(connection.ws, {
      type: 'session:resumed',
      session: {
        id: session.id,
        name: session.name,
        userEmail: session.user_email,
        tmuxSession: `zeus-${session.id}`,
        createdAt: new Date(session.created_at),
        lastActiveAt: new Date(session.last_active_at),
        state: session.state as 'active' | 'dormant' | 'terminated',
        timeoutHours: session.timeout_hours,
        workingDirectory: session.working_directory,
        activeConnections: this.deviceManager.getActiveDeviceCount(sessionId),
        env: {},
      },
      windows: windows.map(w => ({
        id: w.id,
        sessionId: w.sessionId,
        type: w.type || 'terminal',
        name: w.name,
        autoName: w.autoName,
        positionX: w.layout.x,
        positionY: w.layout.y,
        width: w.layout.width,
        height: w.layout.height,
        zIndex: w.zIndex,
        isMain: w.isMain,
        createdAt: w.createdAt,
      })),
    });

    await this.automationEngine.onConnect(sessionId, connection.user.email);
  }

  private async handleSessionCreate(connection: Connection, name?: string): Promise<void> {
    const existingSessions = this.store.getSessionsByUser(connection.user.email);
    
    if (existingSessions.length >= config.session.maxSessions) {
      this.send(connection.ws, {
        type: 'error',
        code: 'MAX_SESSIONS',
        message: `Maximum ${config.session.maxSessions} sessions reached`,
      });
      return;
    }

    const sessionId = uuidv4();
    const session = this.store.createSession({
      id: sessionId,
      name: name || `Session ${existingSessions.length + 1}`,
      user_email: connection.user.email,
      auto_name: null,
      timeout_hours: config.session.defaultTimeout,
      working_directory: process.env.HOME || '/home/hercules',
    });

    connection.sessionId = sessionId;

    // Create initial windows (default: 4 in 2x2 grid)
    const initialCount = Math.min(config.session.initialWindows, config.session.maxWindowsPerSession);
    const windows = [];
    for (let i = 0; i < initialCount; i++) {
      const win = await this.windowManager.createWindow(
        sessionId,
        connection.user.email,
        i === 0, // first window is main
      );
      connection.windowSubscriptions.add(win.id);
      await this.setupWindowOutput(connection, win.id);
      windows.push(win);
    }

    this.deviceManager.registerDevice(sessionId, {
      id: connection.deviceId,
      userEmail: connection.user.email,
      name: this.parseDeviceName(connection.userAgent),
      userAgent: connection.userAgent,
    });

    this.auditLogger.logSessionCreate({
      sessionId,
      sessionName: session.name,
      userEmail: connection.user.email,
      deviceId: connection.deviceId,
      ip: connection.clientIp,
      userAgent: connection.userAgent,
    });

    this.send(connection.ws, {
      type: 'session:created',
      session: {
        id: session.id,
        name: session.name,
        userEmail: session.user_email,
        tmuxSession: `zeus-${session.id}`,
        createdAt: new Date(session.created_at),
        lastActiveAt: new Date(session.last_active_at),
        state: session.state as 'active' | 'dormant' | 'terminated',
        timeoutHours: session.timeout_hours,
        workingDirectory: session.working_directory,
        activeConnections: 1,
        env: {},
      },
      windows: windows.map(w => ({
        id: w.id,
        sessionId: w.sessionId,
        type: w.type || 'terminal',
        name: w.name,
        autoName: w.autoName,
        positionX: w.layout.x,
        positionY: w.layout.y,
        width: w.layout.width,
        height: w.layout.height,
        zIndex: w.zIndex,
        isMain: w.isMain,
        createdAt: w.createdAt,
      })),
    });
  }

  private async handleWindowCreate(connection: Connection, sessionId: string, windowType?: 'terminal' | 'media' | 'agent'): Promise<void> {
    try {
      const window = await this.windowManager.createWindow(
        sessionId,
        connection.user.email,
        false,
        80,
        24,
        windowType || 'terminal'
      );

      connection.windowSubscriptions.add(window.id);
      await this.setupWindowOutput(connection, window.id);

      this.auditLogger.logWindowCreate({
        windowId: window.id,
        sessionId,
        userEmail: connection.user.email,
        deviceId: connection.deviceId,
        ip: connection.clientIp,
        userAgent: connection.userAgent,
      });

      this.broadcastToSession(sessionId, {
        type: 'window:created',
        window: {
          id: window.id,
          sessionId: window.sessionId,
          type: window.type || 'terminal',
          name: window.name,
          autoName: window.autoName,
          positionX: window.layout.x,
          positionY: window.layout.y,
          width: window.layout.width,
          height: window.layout.height,
          zIndex: window.zIndex,
          isMain: window.isMain,
          createdAt: window.createdAt,
        },
      });
    } catch (error) {
      this.send(connection.ws, {
        type: 'error',
        code: 'MAX_WINDOWS',
        message: (error as Error).message,
      });
    }
  }

  private async handleWindowClose(connection: Connection, windowId: string): Promise<void> {
    try {
      // Cancel any pending resize timer for this window (prevents leaked timer)
      const pendingResize = this.pendingResizes.get(windowId);
      if (pendingResize) {
        clearTimeout(pendingResize.timer);
        this.pendingResizes.delete(windowId);
      }

      const window = await this.windowManager.getWindow(windowId, connection.user.email);
      if (!window) return;

      await this.windowManager.closeWindow(windowId, connection.user.email);
      connection.windowSubscriptions.delete(windowId);

      // Clean up listener state, ring buffer, and coalesce timer when window closes
      this.windowListenerStates.delete(windowId);
      const coalesce = this.outputCoalesceState.get(windowId);
      if (coalesce) {
        if (coalesce.timer) clearTimeout(coalesce.timer);
        this.outputCoalesceState.delete(windowId);
      }
      const ringBuffer = this.outputRingBuffers.get(windowId);
      if (ringBuffer) {
        ringBuffer.clear();
        this.outputRingBuffers.delete(windowId);
      }

      this.auditLogger.logWindowClose({
        windowId,
        sessionId: window.sessionId,
        userEmail: connection.user.email,
        deviceId: connection.deviceId,
        ip: connection.clientIp,
        userAgent: connection.userAgent,
      });

      this.broadcastToSession(window.sessionId, {
        type: 'window:closed',
        windowId,
      });
    } catch (error) {
      this.send(connection.ws, {
        type: 'error',
        code: 'TMUX_ERROR',
        message: (error as Error).message,
      });
    }
  }

  private handleWindowFocus(connection: Connection, windowId: string): void {
    connection.windowSubscriptions.add(windowId);
  }

  private async handleWindowSend(connection: Connection, windowId: string, data: string): Promise<void> {
    try {
      await this.windowManager.sendToWindow(windowId, data, connection.user.email);
    } catch (error) {
      this.send(connection.ws, {
        type: 'error',
        code: 'TMUX_ERROR',
        message: (error as Error).message,
      });
    }
  }

  // Server-side resize deduplication: coalesce rapid resize events.
  // 50ms window is appropriate for both v1 (debounce-based) and v2 (ResizeObserver-based).
  // v2 sends fewer messages due to RAF batching, so 50ms rarely triggers coalescing —
  // but it provides safety against rapid grid handle drags that produce multiple
  // ResizeObserver entries within a single animation frame.
  private pendingResizes = new Map<string, { cols: number; rows: number; seq?: number; timer: ReturnType<typeof setTimeout>; connection: Connection }>();

  private async handleWindowResize(connection: Connection, windowId: string, cols: number, rows: number, seq?: number): Promise<void> {
    const existing = this.pendingResizes.get(windowId);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(async () => {
      this.pendingResizes.delete(windowId);
      try {
        const result = await this.windowManager.resizeWindow(windowId, cols, rows, connection.user.email);
        // RC-1: Short drain after tmux resize — lets SIGWINCH re-render output
        // arrive at ALL clients BEFORE the ack clears the pending buffer.
        setTimeout(() => {
          // H8: Broadcast to all subscribers, not just the triggering connection.
          // Multi-device sessions (phone + desktop) both need the ack to release
          // their resize gates. The tmux pane was resized for everyone.
          this.broadcastToWindow(windowId, {
            type: 'window:resized',
            windowId,
            cols: result.cols,
            rows: result.rows,
            seq,
          });
        }, 80);
      } catch (error) {
        console.error(`Resize error for window ${windowId}:`, error);
        // M17: Send error ack so client's resize gate and resizePending clear
        // instead of relying on the 200ms safety timer.
        // Uses broadcastToWindow for multi-device consistency (H8).
        this.broadcastToWindow(windowId, {
          type: 'window:resized',
          windowId,
          cols,
          rows,
          seq,
        });
      }
    }, RESIZE_CONSTANTS.serverDedupMs);

    this.pendingResizes.set(windowId, { cols, rows, seq, timer, connection });
  }

  private async handleWindowLayout(connection: Connection, message: { windowId: string; x: number; y: number; width: number; height: number }): Promise<void> {
    try {
      await this.windowManager.updateLayout(
        message.windowId,
        { x: message.x, y: message.y, width: message.width, height: message.height },
        connection.user.email
      );
    } catch (error) {
      console.error(`Layout update error:`, error);
    }
  }

  /**
   * Handle window subscription with debouncing to prevent redundant captures during rapid resizes.
   *
   * Uses a 300ms debounce window to batch rapid resize events (e.g., window drag)
   * into a single capture operation, reducing memory spikes.
   */
  private async handleWindowSubscribe(
    connection: Connection,
    windowId: string,
  ): Promise<void> {
    if (!windowId) return;
    // Debounce key combines connection ID and window ID
    const timerKey = `${connection.id}:${windowId}`;
    const existingTimer = this.windowSubscribeTimers.get(timerKey);

    // Clear any pending subscription for this connection+window
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Wait 300ms for rapid resize events to settle
    const timer = setTimeout(async () => {
      this.windowSubscribeTimers.delete(timerKey);

      // IMPORTANT: Setup output BEFORE adding to subscriptions
      // This ensures window:restore is sent before any window:output messages
      // can arrive from other connections' PTY listeners
      await this.setupWindowOutput(connection, windowId);
      connection.windowSubscriptions.add(windowId);
    }, 300);

    this.windowSubscribeTimers.set(timerKey, timer);
  }

  private handleWindowReplay(connection: Connection, windowId: string, afterSeq: number): void {
    if (!windowId) return;

    const ringBuffer = this.outputRingBuffers.get(windowId);
    if (!ringBuffer) {
      // No buffer exists - nothing to replay
      this.send(connection.ws, {
        type: 'window:replay-response',
        windowId,
        data: '',
        fromSeq: afterSeq,
        toSeq: afterSeq,
      });
      return;
    }

    const result = ringBuffer.getAfter(afterSeq);
    if (result === null) {
      // Data was evicted from buffer - client needs a full restore
      // Send empty replay-response; the client will have already received a restore
      console.warn(`[ConnectionManager] Replay gap for window ${windowId}: requested seq ${afterSeq}, oldest available ${ringBuffer.getStats().oldestSeq}`);
      this.send(connection.ws, {
        type: 'window:replay-response',
        windowId,
        data: '',
        fromSeq: afterSeq,
        toSeq: afterSeq,
      });
      return;
    }

    if (result.data) {
      console.info(`[ConnectionManager] Replaying ${result.data.length} bytes for window ${windowId} (seq ${result.fromSeq}-${result.toSeq})`);
    }

    this.send(connection.ws, {
      type: 'window:replay-response',
      windowId,
      data: result.data,
      fromSeq: result.fromSeq,
      toSeq: result.toSeq,
    });
  }

  private handleWindowBackpressure(windowId: string, throttle: boolean): void {
    if (!windowId) return;

    const coalesce = this.outputCoalesceState.get(windowId);
    if (!coalesce) return;

    if (throttle) {
      // Client is saturated — pause the coalescing timer so output
      // accumulates in the ring buffer until backpressure is released
      if (coalesce.timer) {
        clearTimeout(coalesce.timer);
        coalesce.timer = null;
      }
    } else {
      // Backpressure released — flush any accumulated output immediately
      if (coalesce.buffer) {
        this.broadcastToWindow(windowId, {
          type: 'window:output',
          windowId,
          data: coalesce.buffer,
          seq: coalesce.seq,
        });
        coalesce.buffer = '';
      }
    }
  }

  private handleWindowRename(connection: Connection, windowId: string, name: string): void {
    if (!windowId || !name || !connection.sessionId) return;

    const db = this.store.getDatabase();
    db.prepare('UPDATE windows SET name = ? WHERE id = ? AND session_id = ?')
      .run(name, windowId, connection.sessionId);

    this.broadcastToSession(connection.sessionId, {
      type: 'window:renamed',
      windowId,
      name,
    });
  }

  /**
   * Auto-rename window based on directory changes (cd command detection).
   * Extracts the first directory after /home/hercules/ as the window name.
   * Also updates context subscription to track the new project's usage.
   */
  private handleWindowAutoRename(sessionId: string, windowId: string, path: string): void {
    const projectName = this.extractProjectName(path);
    if (!projectName) return;

    const db = this.store.getDatabase();
    db.prepare('UPDATE windows SET auto_name = ? WHERE id = ? AND session_id = ?')
      .run(projectName, windowId, sessionId);

    this.broadcastToSession(sessionId, {
      type: 'window:renamed',
      windowId,
      name: '',
      autoName: projectName,
    });

    // Update context subscription to track the new project's usage
    // This ensures the token counter follows cd across projects
    if (projectName !== '~') {
      const fullPath = `/home/hercules/${projectName}`;
      const encodedPath = '-' + fullPath.replace(/^\//, '').replace(/\//g, '-');
      contextManager.updateProjectPath(windowId, encodedPath);
    } else {
      contextManager.updateProjectPath(windowId, null);
    }
  }

  /**
   * Extract project name from a path.
   * Returns the first directory after /home/hercules/.
   * Examples:
   *   /home/hercules/my-project/src → "my-project"
   *   ~/my-project → "my-project"
   *   /home/hercules → "~" (home)
   *   /tmp/something → null (outside hercules home)
   */
  private extractProjectName(rawPath: string): string | null {
    // Normalize path: expand ~ to /home/hercules
    let path = rawPath.trim().replace(/^~/, '/home/hercules');

    // Remove quotes if present
    path = path.replace(/^["']|["']$/g, '');

    // Must be under /home/hercules/
    if (!path.startsWith('/home/hercules')) {
      return null;
    }

    // Remove the base path
    const relativePath = path.slice('/home/hercules'.length);

    // Home directory itself
    if (!relativePath || relativePath === '/') {
      return '~';
    }

    // Extract first directory component
    const parts = relativePath.split('/').filter(Boolean);
    if (parts.length === 0) {
      return '~';
    }

    return parts[0];
  }

  /**
   * Detect cd command and extract target path.
   * Returns the path if it's a cd command, null otherwise.
   */
  private detectCdCommand(command: string): string | null {
    // Match: cd <path> with optional trailing commands
    // Handles: cd /path, cd ~/path, cd "path with spaces", cd 'path'
    const match = command.match(/^\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|#]+)/);
    if (!match) return null;

    let path = match[1];
    // Remove surrounding quotes
    path = path.replace(/^["']|["']$/g, '');

    return path || null;
  }

  private async handleInput(connection: Connection, windowId: string | undefined, data: string): Promise<void> {
    if (!windowId || !connection.sessionId) return;

    const canInput = this.deviceManager.trackInput(windowId, connection.deviceId);
    if (!canInput) {
      return;
    }

    try {
      const bufferKey = `${connection.sessionId}:${windowId}`;
      let currentBuffer = this.commandBuffers.get(bufferKey) || '';
      let inEscapeSequence = false;
      
      for (let i = 0; i < data.length; i++) {
        const char = data[i];
        const code = char.charCodeAt(0);
        
        if (char === '\x1b') {
          inEscapeSequence = true;
          continue;
        }
        
        if (inEscapeSequence) {
          if ((code >= 64 && code <= 126) && char !== '[' && char !== 'O') {
            inEscapeSequence = false;
          }
          continue;
        }
        
        if (char === '\r' || char === '\n') {
          const command = currentBuffer.trim();
          if (command.length > 0 && command.length < 1000 && /^[\x20-\x7e]+$/.test(command)) {
            this.store.addCommandHistory({
              user_email: connection.user.email,
              session_id: connection.sessionId,
              window_id: windowId,
              command,
            });

            // Auto-rename window on cd command
            const cdPath = this.detectCdCommand(command);
            if (cdPath && connection.sessionId) {
              this.handleWindowAutoRename(connection.sessionId, windowId, cdPath);
            }
          }
          currentBuffer = '';
        } else if (char === '\x7f' || char === '\b') {
          currentBuffer = currentBuffer.slice(0, -1);
        } else if (code >= 32 && code < 127) {
          currentBuffer += char;
        }
      }
      
      this.commandBuffers.set(bufferKey, currentBuffer);

      await this.windowManager.sendToWindow(windowId, data, connection.user.email);
      this.store.updateActivity(connection.sessionId);
      this.automationEngine.updateActivity(connection.sessionId);
    } catch (error) {
      console.error(`Input error for window ${windowId}:`, error);
    }
  }

  private async setupWindowOutput(
    connection: Connection,
    windowId: string,
  ): Promise<void> {
    try {
      // REORDERED to prevent race condition:
      // 1. Capture screen FIRST (before attaching PTY listener)
      // 2. Send restore IMMEDIATELY
      // 3. THEN attach PTY and register output listener ONLY ONCE per window
      //
      // This prevents live output from racing with restore content.
      // The client enters "restore mode" which discards incoming window:output
      // messages until restore completes.

      // Step 1: Capture current screen content FIRST (with health-aware scrollback)
      const healthScore = connection.healthScore ?? 100;
      const screenContent = await this.windowManager.captureScreen(
        windowId,
        connection.user.email,
        healthScore
      );

      // Step 2: Send restore IMMEDIATELY (before any live output can arrive)
      if (screenContent) {
        this.send(connection.ws, {
          type: 'window:restore',
          windowId,
          data: screenContent,
        });
      }

      // Step 3: NOW attach PTY and register listener for live output
      const pty = await this.windowManager.attachToWindow(windowId, connection.user.email);

      // CRITICAL FIX: Only register ONE listener per window (not per connection/subscription)
      // Multiple subscriptions to the same window should NOT create duplicate listeners
      let state = this.windowListenerStates.get(windowId);
      if (!state) {
        state = { registered: false, listenerCount: 0, disposed: false };
        this.windowListenerStates.set(windowId, state);
      }

      if (!state.registered) {
        state.registered = true;

        pty.onData((data) => {
          // R-1: Guard against post-cleanup re-entry. node-pty can emit a final
          // data event AFTER pty.kill() is called (OS event-loop delivery). If
          // handleDisconnect already set disposed=true (or deleted the state),
          // discard the data without touching outputRingBuffers — avoids re-creating
          // the ring buffer that was just cleaned up.
          const listenerState = this.windowListenerStates.get(windowId);
          if (!listenerState || listenerState.disposed) return;

          // Buffer data in ring buffer and get sequence number
          const ringBuffer = this.getOrCreateRingBuffer(windowId);
          const seq = ringBuffer.append(data);

          // Coalesce PTY chunks within 8ms window before sending
          // Single keystrokes deliver in ≤8ms; during Claude Code bursts,
          // 3-8 PTY chunks coalesce into one WebSocket message
          let coalesce = this.outputCoalesceState.get(windowId);
          if (!coalesce) {
            coalesce = { buffer: '', timer: null, seq: 0 };
            this.outputCoalesceState.set(windowId, coalesce);
          }
          coalesce.buffer += data;
          coalesce.seq = seq; // Always use latest seq

          if (coalesce.timer === null) {
            coalesce.timer = setTimeout(() => {
              const state = this.outputCoalesceState.get(windowId);
              if (state && state.buffer) {
                this.broadcastToWindow(windowId, {
                  type: 'window:output',
                  windowId,
                  data: state.buffer,
                  seq: state.seq,
                });
                state.buffer = '';
              }
              if (state) {
                state.timer = null;
              }
            }, 8);
          }

          // Get any active connection for this window to check automation
          const firstConnection = Array.from(this.connections.values()).find(
            (conn) => conn.windowSubscriptions.has(windowId)
          );
          if (firstConnection?.sessionId) {
            this.automationEngine.checkOutput(
              firstConnection.sessionId,
              firstConnection.user.email,
              data
            );
          }
        });
      }

      state.listenerCount++;
    } catch (error) {
      console.error(`Failed to setup output for window ${windowId}:`, error);
    }
  }

  private handleDisconnect(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    // CRITICAL: Clear any pending window subscribe timers BEFORE other cleanup
    // This prevents orphaned setupWindowOutput() calls from firing after connection is gone
    const timerKeysToDelete: string[] = [];
    for (const [timerKey, timer] of this.windowSubscribeTimers.entries()) {
      if (timerKey.startsWith(`${connectionId}:`)) {
        clearTimeout(timer);
        timerKeysToDelete.push(timerKey);
      }
    }
    for (const timerKey of timerKeysToDelete) {
      this.windowSubscribeTimers.delete(timerKey);
    }

    if (connection.sessionId) {
      this.deviceManager.unregisterDevice(connection.sessionId, connection.deviceId);

      const remainingDevices = this.deviceManager.getActiveDeviceCount(connection.sessionId);
      if (remainingDevices === 0) {
        this.store.updateState(connection.sessionId, 'dormant');
        this.automationEngine.onDisconnect(connection.sessionId, connection.user.email);
      }
    }

    // Remove this connection from the map BEFORE the subscriber check below so
    // that the "remaining subscribers" count is accurate.
    this.connections.delete(connectionId);

    for (const windowId of connection.windowSubscriptions) {
      // Clean up command buffer for this session:window pair (I-08)
      if (connection.sessionId) {
        this.commandBuffers.delete(`${connection.sessionId}:${windowId}`);
      }

      // Check whether any OTHER connection is still subscribed to this window.
      const hasRemainingSubscribers = Array.from(this.connections.values()).some(
        (conn) => conn.windowSubscriptions.has(windowId)
      );

      if (hasRemainingSubscribers) {
        // Another connection is still using this window — leave the PTY, coalesce
        // timer, and listener state alone.  Only cancel a pending resize if it was
        // initiated by THIS (now-gone) connection; if it came from a different
        // connection we must not discard it.
        const pendingResize = this.pendingResizes.get(windowId);
        if (pendingResize && pendingResize.connection === connection) {
          clearTimeout(pendingResize.timer);
          this.pendingResizes.delete(windowId);
        }
      } else {
        // This was the last subscriber — kill the PTY so its onData callback and
        // coalesce timer stop firing with no audience.

        // R-1: Mark the listener state as disposed BEFORE pty.kill so that any
        // post-kill onData events (delivered by node-pty after kill()) see the flag
        // and return early without re-creating the ring buffer.
        const listenerStateToDispose = this.windowListenerStates.get(windowId);
        if (listenerStateToDispose) {
          listenerStateToDispose.disposed = true;
        }

        this.windowManager.detachPty(windowId, /* killPty */ true);

        // Clean up the listener-state entry so the next attach re-registers.
        this.windowListenerStates.delete(windowId);

        // Cancel any pending resize timer (no one left to receive the ack).
        const pendingResize = this.pendingResizes.get(windowId);
        if (pendingResize) {
          clearTimeout(pendingResize.timer);
          this.pendingResizes.delete(windowId);
        }

        // Cancel the coalesce timer and drop buffered output (no subscribers).
        const coalesce = this.outputCoalesceState.get(windowId);
        if (coalesce) {
          if (coalesce.timer) clearTimeout(coalesce.timer);
          this.outputCoalesceState.delete(windowId);
        }

        // Clean up ring buffer — no remaining subscribers means nobody to replay to (F2 / I-08b)
        const ringBuffer = this.outputRingBuffers.get(windowId);
        if (ringBuffer) {
          ringBuffer.clear?.();  // if RingBuffer has a clear method; otherwise just delete
          this.outputRingBuffers.delete(windowId);
        }
      }
    }
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    } else {
      const msgType = 'type' in message ? (message as { type: string }).type : 'unknown';
      if (msgType === 'canvas:artifact') {
        console.warn(`[Artifact] Message dropped - WebSocket state: ${ws.readyState} (0=CONNECTING, 2=CLOSING, 3=CLOSED)`);
      }
    }
  }

  broadcastToSession(sessionId: string, message: ServerMessage): void {
    for (const connection of this.connections.values()) {
      if (connection.sessionId === sessionId) {
        this.send(connection.ws, message);
      }
    }
  }

  private broadcastToWindow(windowId: string, message: ServerMessage): void {
    for (const connection of this.connections.values()) {
      if (connection.windowSubscriptions.has(windowId)) {
        this.send(connection.ws, message);
      }
    }
  }

  private parseDeviceName(userAgent: string): string {
    if (userAgent.includes('iPhone')) return 'iPhone';
    if (userAgent.includes('iPad')) return 'iPad';
    if (userAgent.includes('Android')) return 'Android';
    if (userAgent.includes('Mac')) return 'Mac';
    if (userAgent.includes('Windows')) return 'Windows';
    if (userAgent.includes('Linux')) return 'Linux';
    return 'Unknown Device';
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = config.websocket.heartbeatTimeout;

      this.connections.forEach((connection, id) => {
        if (now - connection.lastPing > timeout) {
          console.log(`Connection ${id} timed out (no activity for ${Math.round((now - connection.lastPing) / 1000)}s)`);
          connection.ws.close();
          this.handleDisconnect(id);
        } else if (connection.ws.readyState === WebSocket.OPEN) {
          this.send(connection.ws, { type: 'ping' });
        }
      });
    }, config.websocket.heartbeatInterval);
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  closeAll(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Clear all pending subscribe timers
    for (const timer of this.windowSubscribeTimers.values()) {
      clearTimeout(timer);
    }
    this.windowSubscribeTimers.clear();

    this.connections.forEach((connection) => {
      connection.ws.close();
    });

    this.connections.clear();
    this.windowListenerStates.clear();
    this.cronsInitializedForUsers.clear();
    this.outputRingBuffers.forEach(buf => buf.clear());
    this.outputRingBuffers.clear();
  }

  broadcastToAll(message: ServerMessage): void {
    const msgType = (message as any).type || 'unknown';
    let sentCount = 0;
    let droppedCount = 0;
    
    for (const connection of this.connections.values()) {
      if (connection.ws.readyState === WebSocket.OPEN) {
        sentCount++;
      } else {
        droppedCount++;
      }
      this.send(connection.ws, message);
    }
    
    if (msgType === 'canvas:artifact') {
      console.log(`[Artifact] Broadcast to ${sentCount} connection(s), ${droppedCount} dropped (total connections: ${this.connections.size})`);
    }
  }

  getConnectedUserEmails(): string[] {
    const emails = new Set<string>();
    for (const connection of this.connections.values()) {
      emails.add(connection.user.email);
    }
    return Array.from(emails);
  }

  broadcastToUser(userEmail: string, message: ServerMessage): void {
    for (const connection of this.connections.values()) {
      if (connection.user.email === userEmail) {
        this.send(connection.ws, message);
      }
    }
  }
}
