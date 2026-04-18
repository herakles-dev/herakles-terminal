import { spawn, IPty } from 'node-pty';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { filterThinkingOutput } from '../../shared/terminalFilters.js';

const execAsync = promisify(exec);

export class TmuxError extends Error {
  constructor(
    message: string,
    public code: 'SESSION_EXISTS' | 'SESSION_NOT_FOUND' | 'SOCKET_ERROR' | 'SPAWN_ERROR' | 'INVALID_UUID'
  ) {
    super(message);
    this.name = 'TmuxError';
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TmuxManager {
  private baseSocketDir: string;
  private configPath: string;

  constructor(
    baseSocketDir = '/tmp/zeus-tmux',
    configPath = '/home/hercules/herakles-terminal/config/tmux.conf'
  ) {
    this.baseSocketDir = baseSocketDir;
    this.configPath = configPath;
    this.ensureBaseDir();
  }

  private ensureBaseDir(): void {
    if (!fs.existsSync(this.baseSocketDir)) {
      fs.mkdirSync(this.baseSocketDir, { recursive: true, mode: 0o700 });
    }
  }

  private validateUUID(sessionId: string): void {
    if (!UUID_REGEX.test(sessionId)) {
      throw new TmuxError(`Invalid session UUID: ${sessionId}`, 'INVALID_UUID');
    }
  }

  private getSocketPath(sessionId: string): string {
    return path.join(this.baseSocketDir, sessionId);
  }

  private getSessionName(sessionId: string): string {
    return `zeus-${sessionId}`;
  }

  getShellEnvironment(): Record<string, string> {
    return {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    };
  }

  async createSession(sessionId: string, cols: number, rows: number): Promise<void> {
    this.validateUUID(sessionId);

    const socketPath = this.getSocketPath(sessionId);
    const sessionName = this.getSessionName(sessionId);

    const socketDir = path.dirname(socketPath);
    if (!fs.existsSync(socketDir)) {
      fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
    }

    if (await this.sessionExists(sessionId)) {
      throw new TmuxError(`Session ${sessionId} already exists`, 'SESSION_EXISTS');
    }

    try {
      const configFlag = fs.existsSync(this.configPath) ? `-f ${this.configPath}` : '';
      const cmd = `tmux -S ${socketPath} ${configFlag} new-session -d -s ${sessionName} -x ${cols} -y ${rows}`;
      
      await execAsync(cmd);
      fs.chmodSync(socketPath, 0o700);
    } catch (error) {
      throw new TmuxError(
        `Failed to create tmux session: ${(error as Error).message}`,
        'SPAWN_ERROR'
      );
    }
  }

  async attachSession(sessionId: string): Promise<IPty> {
    this.validateUUID(sessionId);

    const socketPath = this.getSocketPath(sessionId);
    const sessionName = this.getSessionName(sessionId);

    if (!(await this.sessionExists(sessionId))) {
      throw new TmuxError(`Session ${sessionId} not found`, 'SESSION_NOT_FOUND');
    }

    try {
      const pty = spawn('tmux', ['-S', socketPath, 'attach-session', '-t', sessionName], {
        name: 'xterm-256color',
        env: { ...process.env, ...this.getShellEnvironment() },
      });
      return pty;
    } catch (error) {
      throw new TmuxError(
        `Failed to attach to session: ${(error as Error).message}`,
        'SOCKET_ERROR'
      );
    }
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    this.validateUUID(sessionId);

    const socketPath = this.getSocketPath(sessionId);
    const sessionName = this.getSessionName(sessionId);

    if (!fs.existsSync(socketPath)) {
      return false;
    }

    try {
      await execAsync(`tmux -S ${socketPath} has-session -t ${sessionName} 2>/dev/null`);
      return true;
    } catch {
      return false;
    }
  }

  async killSession(sessionId: string): Promise<void> {
    this.validateUUID(sessionId);

    const socketPath = this.getSocketPath(sessionId);
    const sessionName = this.getSessionName(sessionId);

    try {
      await execAsync(`tmux -S ${socketPath} kill-session -t ${sessionName} 2>/dev/null`);
    } catch {
    }

    try {
      if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
      }
    } catch {
    }
  }

  async resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
    this.validateUUID(sessionId);

    const socketPath = this.getSocketPath(sessionId);
    const sessionName = this.getSessionName(sessionId);

    // Skip the sessionExists() pre-check — it spawns a subprocess (10-50ms)
    // that eats into the resize drain window. The tmux command itself will
    // fail if the session doesn't exist, and the error is caught below.

    // Atomic resize: resize both window and pane in a single tmux command sequence
    try {
      await execAsync(
        `tmux -S ${socketPath} resize-window -t ${sessionName} -x ${cols} -y ${rows} \\; ` +
        `resize-pane -t ${sessionName} -x ${cols} -y ${rows}`
      );
    } catch (error) {
      // Fallback: try pane resize alone (window resize fails on single-pane sessions)
      try {
        await execAsync(`tmux -S ${socketPath} resize-pane -t ${sessionName} -x ${cols} -y ${rows}`);
      } catch (fallbackError) {
        throw new TmuxError(
          `Failed to resize: ${(fallbackError as Error).message}`,
          'SOCKET_ERROR'
        );
      }
    }
  }

  async detectZombieSessions(knownSessionIds: string[]): Promise<string[]> {
    const zombies: string[] = [];

    for (const sessionId of knownSessionIds) {
      try {
        this.validateUUID(sessionId);
        if (!(await this.sessionExists(sessionId))) {
          zombies.push(sessionId);
        }
      } catch {
        zombies.push(sessionId);
      }
    }

    return zombies;
  }

  async repairSession(sessionId: string, cols: number, rows: number): Promise<void> {
    this.validateUUID(sessionId);

    if (await this.sessionExists(sessionId)) {
      return;
    }

    await this.createSession(sessionId, cols, rows);
  }

  async healthCheck(): Promise<{ healthy: boolean; activeSessions: number; details?: string }> {
    try {
      const { stdout } = await execAsync(`tmux -S ${this.baseSocketDir}/* list-sessions 2>/dev/null || true`);
      const sessionCount = stdout.trim().split('\n').filter(Boolean).length;

      return {
        healthy: true,
        activeSessions: sessionCount,
      };
    } catch (error) {
      return {
        healthy: false,
        activeSessions: 0,
        details: (error as Error).message,
      };
    }
  }

  /**
   * Get the current working directory of a tmux session.
   * Returns null if unable to determine the cwd.
   */
  async getCurrentWorkingDirectory(sessionId: string): Promise<string | null> {
    this.validateUUID(sessionId);

    const socketPath = this.getSocketPath(sessionId);
    const sessionName = this.getSessionName(sessionId);

    if (!(await this.sessionExists(sessionId))) {
      return null;
    }

    try {
      const { stdout } = await execAsync(
        `tmux -S ${socketPath} display-message -p -t ${sessionName} "#{pane_current_path}"`
      );
      return stdout.trim() || null;
    } catch (error) {
      console.warn(`[TmuxManager] Failed to get cwd for ${sessionId}:`, (error as Error).message);
      return null;
    }
  }

  /**
   * Capture pane content with adaptive scrollback based on health score.
   *
   * @param sessionId - UUID of the tmux session
   * @param options - Capture options
   * @param options.visibleOnly - If true, only capture visible content (default: true)
   * @param options.healthScore - WebGL health score (0-100). Lower scores reduce scrollback to prevent memory spikes.
   *   - 80-100: 5000 lines (normal)
   *   - 60-79:  2500 lines (50% reduction)
   *   - 40-59:  1000 lines (80% reduction)
   *   - 0-39:   500 lines (90% reduction)
   */
  async capturePane(
    sessionId: string,
    options: { visibleOnly?: boolean; healthScore?: number } = {}
  ): Promise<string> {
    const { visibleOnly = true, healthScore = 100 } = options;

    this.validateUUID(sessionId);

    const socketPath = this.getSocketPath(sessionId);
    const sessionName = this.getSessionName(sessionId);

    if (!(await this.sessionExists(sessionId))) {
      return '';
    }

    try {
      // Calculate adaptive scrollback based on health score
      let scrollbackLines = 5000;  // Default for healthy state
      if (!visibleOnly) {
        if (healthScore < 40) {
          scrollbackLines = 500;   // 90% reduction (critical)
        } else if (healthScore < 60) {
          scrollbackLines = 1000;  // 80% reduction (moderate)
        } else if (healthScore < 80) {
          scrollbackLines = 2500;  // 50% reduction (light)
        }
        // healthScore >= 80: use default 5000 lines
      }

      const scrollbackFlag = visibleOnly ? '' : `-S -${scrollbackLines}`;
      const { stdout } = await execAsync(
        `tmux -S ${socketPath} capture-pane -t ${sessionName} -p -e -J ${scrollbackFlag} 2>/dev/null || true`,
        { maxBuffer: 10 * 1024 * 1024, timeout: 5000 }
      );

      // Filter Claude thinking dots/spinner lines from scrollback
      // Uses shared filter for consistency with client-side filtering
      const cleaned = filterThinkingOutput(stdout);

      // Normalize line endings: convert bare LF to CRLF for xterm.js compatibility
      // Only convert LF not preceded by CR to avoid double-converting existing CRLF
      return cleaned.replace(/(?<!\r)\n/g, '\r\n');
    } catch {
      return '';
    }
  }

  /**
   * Clear the pane's scrollback history.
   * Useful after WebGL recovery to prevent stale content from being re-captured.
   */
  async clearPaneHistory(sessionId: string): Promise<void> {
    this.validateUUID(sessionId);

    const socketPath = this.getSocketPath(sessionId);
    const sessionName = this.getSessionName(sessionId);

    if (!(await this.sessionExists(sessionId))) {
      return;
    }

    try {
      await execAsync(
        `tmux -S ${socketPath} clear-history -t ${sessionName} 2>/dev/null || true`
      );
    } catch {
      // Silently ignore - clearing history is best-effort
    }
  }

  async capturePaneChunked(
    sessionId: string,
    startLine: number,
    lineCount: number
  ): Promise<{ data: string; totalLines: number; hasMore: boolean }> {
    this.validateUUID(sessionId);

    const socketPath = this.getSocketPath(sessionId);
    const sessionName = this.getSessionName(sessionId);

    if (!(await this.sessionExists(sessionId))) {
      return { data: '', totalLines: 0, hasMore: false };
    }

    try {
      const endLine = startLine + lineCount;
      const { stdout } = await execAsync(
        `tmux -S ${socketPath} capture-pane -t ${sessionName} -p -e -S -${startLine} -E -${Math.max(0, startLine - lineCount + 1)} 2>/dev/null || true`,
        { maxBuffer: 10 * 1024 * 1024 }
      );

      const { stdout: historyInfo } = await execAsync(
        `tmux -S ${socketPath} display -t ${sessionName} -p '#{history_size}' 2>/dev/null || echo 0`,
      );
      const totalLines = parseInt(historyInfo.trim(), 10) || 0;

      return {
        data: stdout,
        totalLines,
        hasMore: endLine < totalLines,
      };
    } catch {
      return { data: '', totalLines: 0, hasMore: false };
    }
  }

  async listSessions(): Promise<string[]> {
    try {
      const entries = fs.readdirSync(this.baseSocketDir);
      const sessions: string[] = [];

      for (const entry of entries) {
        if (UUID_REGEX.test(entry)) {
          if (await this.sessionExists(entry)) {
            sessions.push(entry);
          }
        }
      }

      return sessions;
    } catch {
      return [];
    }
  }
}

export const tmuxManager = new TmuxManager();
