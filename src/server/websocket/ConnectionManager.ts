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
  private windowOutputListeners: Set<string> = new Set();
  private commandBuffers: Map<string, string> = new Map();

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

  private setupAutomationCallbacks(): void {
    this.automationEngine.onWindowCreated(async (sessionId, windowId, userEmail) => {
      const window = await this.windowManager.getWindow(windowId, userEmail);
      if (window) {
        for (const connection of this.connections.values()) {
          if (connection.sessionId === sessionId) {
            connection.windowSubscriptions.add(windowId);
            await this.setupWindowOutput(connection, windowId);
          }
        }
        
        this.broadcastToSession(sessionId, {
          type: 'window:created',
          window: {
            id: window.id,
            sessionId: window.sessionId,
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
        if (messageSize > 100000) {
          this.send(ws, {
            type: 'error',
            code: 'MESSAGE_TOO_LARGE',
            message: 'Message exceeds 100KB limit',
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
        
        this.handleMessage(connectionId, validation.data);
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

  private handleMessage(connectionId: string, message: ValidatedClientMessage): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.lastPing = Date.now();

    switch (message.type) {
      case 'session:resume':
        this.handleSessionResume(connection, message.sessionId);
        break;

      case 'session:create':
        this.handleSessionCreate(connection, (message as any).name);
        break;

      case 'window:create':
        this.handleWindowCreate(connection, (message as any).sessionId);
        break;

      case 'window:close':
        this.handleWindowClose(connection, (message as any).windowId);
        break;

      case 'window:focus':
        this.handleWindowFocus(connection, (message as any).windowId);
        break;

      case 'window:send':
        this.handleWindowSend(connection, (message as any).windowId, (message as any).data);
        break;

      case 'window:resize':
        this.handleWindowResize(connection, (message as any).windowId, (message as any).cols, (message as any).rows, (message as any).seq);
        break;

      case 'window:layout':
        this.handleWindowLayout(connection, message as any);
        break;

      case 'window:subscribe':
        this.handleWindowSubscribe(
          connection,
          (message as any).windowId,
          (message as any).cols,
          (message as any).rows
        );
        break;

      case 'window:rename':
        this.handleWindowRename(connection, (message as any).windowId, (message as any).name);
        break;

      case 'input':
        this.handleInput(connection, (message as any).windowId, (message as any).data);
        break;

      case 'ping':
        connection.lastPing = Date.now();
        this.send(connection.ws, { type: 'pong' });
        break;

      case 'pong':
        connection.lastPing = Date.now();
        break;
    }
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
      working_directory: '/home/hercules',
    });

    connection.sessionId = sessionId;

    const mainWindow = await this.windowManager.createWindow(
      sessionId,
      connection.user.email,
      true
    );

    connection.windowSubscriptions.add(mainWindow.id);
    await this.setupWindowOutput(connection, mainWindow.id);

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
    });

    this.send(connection.ws, {
      type: 'window:created',
      window: {
        id: mainWindow.id,
        sessionId: mainWindow.sessionId,
        name: mainWindow.name,
        autoName: mainWindow.autoName,
        positionX: mainWindow.layout.x,
        positionY: mainWindow.layout.y,
        width: mainWindow.layout.width,
        height: mainWindow.layout.height,
        zIndex: mainWindow.zIndex,
        isMain: mainWindow.isMain,
        createdAt: mainWindow.createdAt,
      },
    });
  }

  private async handleWindowCreate(connection: Connection, sessionId: string): Promise<void> {
    try {
      const window = await this.windowManager.createWindow(
        sessionId,
        connection.user.email,
        false
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
      const window = await this.windowManager.getWindow(windowId, connection.user.email);
      if (!window) return;

      await this.windowManager.closeWindow(windowId, connection.user.email);
      connection.windowSubscriptions.delete(windowId);

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

  private async handleWindowResize(connection: Connection, windowId: string, cols: number, rows: number, seq?: number): Promise<void> {
    try {
      const result = await this.windowManager.resizeWindow(windowId, cols, rows, connection.user.email);
      this.send(connection.ws, {
        type: 'window:resized',
        windowId,
        cols: result.cols,
        rows: result.rows,
        seq,
      });
    } catch (error) {
      console.error(`Resize error for window ${windowId}:`, error);
    }
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

  private async handleWindowSubscribe(
    connection: Connection,
    windowId: string,
    cols?: number,
    rows?: number
  ): Promise<void> {
    if (!windowId) return;
    connection.windowSubscriptions.add(windowId);
    await this.setupWindowOutput(connection, windowId, cols, rows);
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

  private async handleInput(connection: Connection, windowId: string, data: string): Promise<void> {
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
    cols?: number,
    rows?: number
  ): Promise<void> {
    try {
      const pty = await this.windowManager.attachToWindow(windowId, connection.user.email);
      
      if (!this.windowOutputListeners.has(windowId)) {
        this.windowOutputListeners.add(windowId);
        
        pty.onData((data) => {
          this.broadcastToWindow(windowId, {
            type: 'window:output',
            windowId,
            data,
          });

          if (connection.sessionId) {
            this.automationEngine.checkOutput(connection.sessionId, connection.user.email, data);
          }
        });
      }

      const screenContent = await this.windowManager.captureScreen(windowId, connection.user.email, cols, rows);
      if (screenContent) {
        this.send(connection.ws, {
          type: 'window:restore',
          windowId,
          data: screenContent,
        });
      }
    } catch (error) {
      console.error(`Failed to setup output for window ${windowId}:`, error);
    }
  }

  private handleDisconnect(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    if (connection.sessionId) {
      this.deviceManager.unregisterDevice(connection.sessionId, connection.deviceId);
      
      const remainingDevices = this.deviceManager.getActiveDeviceCount(connection.sessionId);
      if (remainingDevices === 0) {
        this.store.updateState(connection.sessionId, 'dormant');
        this.automationEngine.onDisconnect(connection.sessionId, connection.user.email);
      }
    }

    for (const windowId of connection.windowSubscriptions) {
      this.windowManager.detachPty(windowId);
    }

    this.connections.delete(connectionId);
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    } else {
      const msgType = (message as any).type || 'unknown';
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

    this.connections.forEach((connection) => {
      connection.ws.close();
    });

    this.connections.clear();
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
