import { v4 as uuidv4 } from 'uuid';
import { TmuxManager } from '../tmux/TmuxManager.js';
import { SessionStore, WindowRecord } from '../session/SessionStore.js';
import { config } from '../config.js';
import type { IPty } from 'node-pty';

export interface WindowLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowInfo {
  id: string;
  sessionId: string;
  name?: string;
  autoName?: string;
  layout: WindowLayout;
  zIndex: number;
  isMain: boolean;
  createdAt: Date;
  pty?: IPty;
}

export class WindowManager {
  private tmux: TmuxManager;
  private store: SessionStore;
  private activePtys: Map<string, IPty> = new Map();

  constructor(tmux: TmuxManager, store: SessionStore) {
    this.tmux = tmux;
    this.store = store;
  }

  /**
   * Extract project name from a working directory path.
   * Returns the directory name for paths under /home/hercules/, null otherwise.
   *
   * Examples:
   *   /home/hercules/herakles-terminal → "herakles-terminal"
   *   /home/hercules/project/subdir → "project"
   *   /home/hercules → null
   *   ~ → null
   *   /tmp → null
   */
  private extractProjectName(cwd: string | null): string | null {
    if (!cwd) return null;

    // Normalize home directory shorthand
    const normalizedPath = cwd.replace(/^~/, '/home/hercules');

    // Only extract project name from paths under /home/hercules/
    if (!normalizedPath.startsWith('/home/hercules/')) {
      return null;
    }

    // Remove /home/hercules/ prefix
    const relativePath = normalizedPath.substring('/home/hercules/'.length);

    // Extract the first directory component (project name)
    const parts = relativePath.split('/').filter(Boolean);
    return parts.length > 0 ? parts[0] : null;
  }

  async createWindow(
    sessionId: string,
    userEmail: string,
    isMainOrName: boolean | string = false,
    cols = 80,
    rows = 24
  ): Promise<WindowInfo> {
    // [FIX-1] Validate session exists before any state changes
    const session = this.store.getSession(sessionId, userEmail);
    if (!session) {
      throw new Error('Session not found or access denied');
    }

    // [FIX-1] Validate window limit before creating tmux session
    const existingWindows = this.store.getWindows(sessionId, userEmail);
    if (existingWindows.length >= config.session.maxWindowsPerSession) {
      throw new Error(`Maximum ${config.session.maxWindowsPerSession} windows per session`);
    }

    const isMain = typeof isMainOrName === 'boolean' ? isMainOrName : false;
    const customName = typeof isMainOrName === 'string' ? isMainOrName : null;
    const windowId = uuidv4();
    const layout = this.calculateNewWindowLayout(existingWindows);
    const zIndex = existingWindows.length;

    // [FIX-2] Create tmux session with error handling
    let tmuxCreated = false;
    try {
      console.log(`[WindowManager] Creating tmux session ${windowId} (${cols}x${rows})`);
      await this.tmux.createSession(windowId, cols, rows);
      tmuxCreated = true;
      console.log(`[WindowManager] Tmux session created successfully`);
    } catch (tmuxError) {
      // [FIX-2] If tmux creation fails, throw immediately - don't create database record
      console.error(`[WindowManager] Tmux creation failed for ${windowId}:`, tmuxError);
      throw new Error(`Failed to create tmux session: ${(tmuxError as Error).message}`);
    }

    // [FIX-2] Get working directory AFTER tmux creation succeeds
    let cwd: string | null = null;
    let projectName: string | null = null;
    try {
      cwd = await this.tmux.getCurrentWorkingDirectory(windowId);
      projectName = this.extractProjectName(cwd);
      console.log(`[WindowManager] CWD: ${cwd}, Project: ${projectName}`);
    } catch (cwdError) {
      // Not fatal - continue with null projectName
      console.warn(`[WindowManager] Failed to get CWD for ${windowId}:`, cwdError);
    }

    // [FIX-3] Create database record ONLY after tmux is fully ready
    // [FIX-3] Wrap in try-catch to ensure we can roll back if DB write fails
    let windowRecord;
    try {
      console.log(`[WindowManager] Creating window record in database`);
      windowRecord = this.store.createWindow({
        id: windowId,
        session_id: sessionId,
        name: customName || (isMain ? 'Main' : `Window ${existingWindows.length + 1}`),
        auto_name: projectName,
        position_x: layout.x,
        position_y: layout.y,
        width: layout.width,
        height: layout.height,
        z_index: zIndex,
        is_main: isMain ? 1 : 0,
      });
      console.log(`[WindowManager] Window record created: ${windowId}`);
    } catch (dbError) {
      // [FIX-3] If database write fails, kill tmux session to rollback
      console.error(`[WindowManager] Database write failed for ${windowId}, rolling back tmux:`, dbError);
      try {
        if (tmuxCreated) {
          await this.tmux.killSession(windowId);
          console.log(`[WindowManager] Rolled back tmux session ${windowId}`);
        }
      } catch (rollbackError) {
        console.error(`[WindowManager] Rollback failed:`, rollbackError);
      }
      throw new Error(`Failed to create window record: ${(dbError as Error).message}`);
    }

    const windowInfo = this.recordToInfo(windowRecord);
    console.log(`[WindowManager] Window creation complete: ${windowId}`);
    return windowInfo;
  }

  async getWindow(windowId: string, userEmail: string): Promise<WindowInfo | null> {
    const windows = await this.findWindowsByUser(userEmail);
    const window = windows.find(w => w.id === windowId);
    return window || null;
  }

  async listWindows(sessionId: string, userEmail: string): Promise<WindowInfo[]> {
    const records = this.store.getWindows(sessionId, userEmail);
    return records.map(r => this.recordToInfo(r));
  }

  async updateLayout(windowId: string, layout: WindowLayout, userEmail: string): Promise<void> {
    this.store.updateWindowLayout(
      windowId,
      {
        position_x: layout.x,
        position_y: layout.y,
        width: layout.width,
        height: layout.height,
      },
      userEmail
    );
  }

  async closeWindow(windowId: string, userEmail: string): Promise<void> {
    const window = await this.getWindow(windowId, userEmail);
    if (!window) {
      throw new Error('Window not found or access denied');
    }

    const pty = this.activePtys.get(windowId);
    if (pty) {
      pty.kill();
      this.activePtys.delete(windowId);
    }

    try {
      await this.tmux.killSession(windowId);
    } catch (e) {
    }

    this.store.deleteWindow(windowId, userEmail);
  }

  async attachToWindow(windowId: string, userEmail: string): Promise<IPty> {
    const window = await this.getWindow(windowId, userEmail);
    if (!window) {
      throw new Error('Window not found or access denied');
    }

    let pty = this.activePtys.get(windowId);
    if (pty) {
      return pty;
    }

    if (!(await this.tmux.sessionExists(windowId))) {
      await this.tmux.createSession(windowId, 80, 24);
    }

    pty = await this.tmux.attachSession(windowId);
    this.activePtys.set(windowId, pty);

    return pty;
  }

  async sendToWindow(windowId: string, content: string, userEmail: string): Promise<void> {
    // Reduced logging verbosity - only log errors
    const pty = this.activePtys.get(windowId);
    if (!pty) {
      const window = await this.getWindow(windowId, userEmail);
      if (!window) {
        throw new Error('Window not found or access denied');
      }
      const newPty = await this.attachToWindow(windowId, userEmail);
      newPty.write(content);
    } else {
      pty.write(content);
    }
  }

  async resizeWindow(windowId: string, cols: number, rows: number, userEmail: string): Promise<{ cols: number; rows: number }> {
    const window = await this.getWindow(windowId, userEmail);
    if (!window) {
      throw new Error('Window not found or access denied');
    }

    const pty = this.activePtys.get(windowId);
    
    try {
      await this.tmux.resizeSession(windowId, cols, rows);
    } catch (error) {
      console.warn(`[WindowManager] tmux resize failed for ${windowId}:`, error);
    }
    
    if (pty) {
      try {
        pty.resize(cols, rows);
      } catch (error) {
        console.warn(`[WindowManager] PTY resize failed for ${windowId}:`, error);
      }
    }

    return { cols, rows };
  }

  async getMainWindow(sessionId: string, userEmail: string): Promise<WindowInfo | null> {
    const windows = await this.listWindows(sessionId, userEmail);
    return windows.find(w => w.isMain) || null;
  }

  private calculateNewWindowLayout(existingWindows: WindowRecord[]): WindowLayout {
    const quadrants: WindowLayout[] = [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ];

    if (existingWindows.length === 0) {
      return { x: 0, y: 0, width: 1, height: 1 };
    }

    for (const quadrant of quadrants) {
      const occupied = existingWindows.some(
        w =>
          Math.abs(w.position_x - quadrant.x) < 0.1 &&
          Math.abs(w.position_y - quadrant.y) < 0.1
      );
      if (!occupied) {
        return quadrant;
      }
    }

    return quadrants[existingWindows.length % 4];
  }

  private recordToInfo(record: WindowRecord): WindowInfo {
    return {
      id: record.id,
      sessionId: record.session_id,
      name: record.name || undefined,
      autoName: record.auto_name || undefined,
      layout: {
        x: record.position_x,
        y: record.position_y,
        width: record.width,
        height: record.height,
      },
      zIndex: record.z_index,
      isMain: record.is_main === 1,
      createdAt: new Date(record.created_at),
    };
  }

  private async findWindowsByUser(userEmail: string): Promise<WindowInfo[]> {
    const sessions = this.store.getSessionsByUser(userEmail);
    const allWindows: WindowInfo[] = [];
    
    for (const session of sessions) {
      const windows = this.store.getWindows(session.id, userEmail);
      allWindows.push(...windows.map(w => this.recordToInfo(w)));
    }
    
    return allWindows;
  }

  detachPty(windowId: string): void {
    const pty = this.activePtys.get(windowId);
    if (pty) {
      this.activePtys.delete(windowId);
    }
  }

  getActivePtyCount(): number {
    return this.activePtys.size;
  }

  /**
   * Capture screen content with optional health-aware adaptive scrollback.
   *
   * @param windowId - Window UUID
   * @param userEmail - User email for authorization
   * @param cols - Optional columns for pre-capture resize
   * @param rows - Optional rows for pre-capture resize
   * @param healthScore - Optional WebGL health score (0-100) for adaptive scrollback
   */
  async captureScreen(
    windowId: string,
    userEmail: string,
    cols?: number,
    rows?: number,
    healthScore?: number
  ): Promise<string> {
    const window = await this.getWindow(windowId, userEmail);
    if (!window) {
      return '';
    }

    if (cols && rows && cols > 0 && rows > 0) {
      try {
        await this.tmux.resizeSession(windowId, cols, rows);
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        console.warn(`[WindowManager] Pre-capture resize failed for ${windowId}:`, error);
      }
    }

    return this.tmux.capturePane(windowId, { visibleOnly: false, healthScore });
  }
}
