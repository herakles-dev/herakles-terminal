/**
 * ContextFileWatcher - Watch Claude Code session JSONL files for context usage
 *
 * Monitors ~/.claude/projects/ for JSONL session files and extracts token usage
 * data to calculate context window utilization.
 *
 * v3: Every JSONL file is a first-class session. Each Zeus window owns its own
 * JSONL — there is no "main vs subagent file" relationship (true subagents
 * live inside the parent JSONL as `isSidechain: true` entries). We emit a
 * `contextUpdate` event for every file that yields usage, keyed by sessionId,
 * so multi-window routing in ContextManager can dispatch correctly.
 */

import { EventEmitter } from 'events';
import { watch, existsSync, FSWatcher, readdirSync, statSync } from 'fs';
import { readFile, open as openFile } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import {
  ContextUsage,
  calculateContextUsage,
  getModelContextLimit,
  AgentUsageMetrics,
} from '../../shared/contextProtocol.js';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const DEBOUNCE_MS = 500;
const MAX_LINES_TO_READ = 100; // Read last N lines for usage data (initial scan only)
const RECENCY_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ContextByProject {
  [projectPath: string]: {
    usage: ContextUsage;
    sessionFile: string;
  };
}

export interface ContextUpdateEvent {
  projectPath: string;
  usage: ContextUsage;
}

/**
 * @deprecated Reserved for future sidechain-based subagent detection; emissions
 * are currently disabled because separate JSONL files are NOT subagents — each
 * file represents its own window-owned primary session.
 */
export interface AgentSessionDetectedEvent {
  projectKey: string;
  sessionId: string;
  firstEntry: Record<string, unknown>;
}

/**
 * @deprecated See `AgentSessionDetectedEvent`.
 */
export interface AgentUsageUpdateEvent {
  projectKey: string;
  sessionId: string;
  model: string;
  usage: AgentUsageMetrics;
  status: 'active' | 'completed' | 'unknown';
}

// Per-file tracking state for tail-read
interface FileState {
  sessionId: string;
  lastOffset: number;
  lastMtime: number;
  firstSeen: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  turnCount: number;
}

export class ContextFileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private projectWatchers: Map<string, FSWatcher> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private contextLogger = logger.child({ component: 'context-watcher' });
  private cachedContext: ContextByProject = {};

  // projectKey → (sessionId → FileState)
  private fileStates: Map<string, Map<string, FileState>> = new Map();

  constructor() {
    super();
  }

  /**
   * Start watching the Claude projects directory
   */
  startWatch(): void {
    if (this.watcher) {
      // Idempotent: startWatch() runs on every subscribe by design.
      this.contextLogger.debug('Context watcher already running — no-op');
      return;
    }

    if (!existsSync(CLAUDE_PROJECTS_DIR)) {
      this.contextLogger.warn(`Claude projects directory does not exist: ${CLAUDE_PROJECTS_DIR}`);
      return;
    }

    try {
      // Watch the projects directory for new project folders
      this.watcher = watch(CLAUDE_PROJECTS_DIR, { persistent: false }, (_eventType, filename) => {
        if (filename && !filename.startsWith('.')) {
          this.handleProjectDirChange(filename);
        }
      });

      this.watcher.on('error', (err) => {
        this.contextLogger.error('Context watcher error:', { error: err.message });
        this.restartWatch();
      });

      this.contextLogger.info(`Started watching Claude projects directory: ${CLAUDE_PROJECTS_DIR}`);

      // Set up watchers for existing project directories
      this.setupProjectWatchers();

      // Process initial state
      this.processAllProjects();
    } catch (err) {
      this.contextLogger.error('Failed to start context watcher:', {
        error: err instanceof Error ? err.message : String(err),
        directory: CLAUDE_PROJECTS_DIR,
      });
    }
  }

  /**
   * Set up watchers for individual project directories
   */
  private setupProjectWatchers(): void {
    try {
      const projectDirs = readdirSync(CLAUDE_PROJECTS_DIR)
        .filter(name => !name.startsWith('.'))
        .map(name => join(CLAUDE_PROJECTS_DIR, name))
        .filter(path => {
          try {
            return statSync(path).isDirectory();
          } catch {
            return false;
          }
        });

      for (const projectDir of projectDirs) {
        this.watchProjectDir(projectDir);
      }
    } catch (err) {
      this.contextLogger.error('Failed to setup project watchers:', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Watch a specific project directory for JSONL changes
   */
  private watchProjectDir(projectDir: string): void {
    if (this.projectWatchers.has(projectDir)) {
      return;
    }

    try {
      const watcher = watch(projectDir, { persistent: false }, (_eventType, filename) => {
        if (filename && filename.endsWith('.jsonl')) {
          this.handleFileChange(projectDir, filename);
        }
      });

      watcher.on('error', (err) => {
        this.contextLogger.warn(`Project watcher error for ${projectDir}:`, { error: err.message });
        this.projectWatchers.delete(projectDir);
      });

      this.projectWatchers.set(projectDir, watcher);
    } catch (err) {
      this.contextLogger.warn(`Failed to watch project directory: ${projectDir}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Handle changes to the projects directory
   */
  private handleProjectDirChange(dirname: string): void {
    const projectDir = join(CLAUDE_PROJECTS_DIR, dirname);

    if (existsSync(projectDir)) {
      try {
        if (statSync(projectDir).isDirectory()) {
          this.watchProjectDir(projectDir);
        }
      } catch {
        // Directory may have been deleted
      }
    }
  }

  /**
   * Handle file change event with debouncing
   */
  private handleFileChange(projectDir: string, filename: string): void {
    const key = `${projectDir}:${filename}`;

    if (this.debounceTimers.has(key)) {
      clearTimeout(this.debounceTimers.get(key));
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      this.processProjectFile(projectDir, filename);
    }, DEBOUNCE_MS);

    this.debounceTimers.set(key, timer);
  }

  /**
   * Called by ContextManager when a window subscribes. Historically gated event
   * emission; retained as a no-op for compatibility — watcher now always emits
   * so initial-scan data is cached before the first client connects.
   */
  subscribe(): void {
    this.contextLogger.debug('Subscriber registered for context updates');
  }

  /**
   * Get current cached context (for new subscribers)
   */
  getCurrentContext(): ContextByProject {
    return this.cachedContext;
  }

  /**
   * Get context for a specific project path (returns the project's newest
   * session — used as a fallback when a window's own sessionId is unknown).
   */
  getContextForProject(projectPath: string): ContextUsage | null {
    return this.cachedContext[projectPath]?.usage || null;
  }

  /**
   * Get context for a specific (projectKey, sessionId) pair — i.e. a single
   * JSONL file. Used for per-window resolution so sibling windows in the same
   * project don't see each other's data.
   */
  getContextForSession(projectKey: string, sessionId: string): ContextUsage | null {
    const projectStates = this.fileStates.get(projectKey);
    if (!projectStates) return null;
    const fs = projectStates.get(sessionId);
    if (!fs) return null;

    const maxTokens = getModelContextLimit(fs.model);
    const { usedTokens, percentage } = calculateContextUsage(
      fs.inputTokens,
      fs.cacheCreationTokens,
      fs.cacheReadTokens,
      fs.outputTokens,
      maxTokens,
    );
    const denom = fs.inputTokens + fs.cacheCreationTokens + fs.cacheReadTokens;
    const cacheHitRate = denom > 0 ? fs.cacheReadTokens / denom : 0;

    return {
      percentage,
      usedTokens,
      maxTokens,
      model: fs.model,
      sessionId,
      lastUpdated: fs.lastMtime,
      inputTokens: fs.inputTokens,
      outputTokens: fs.outputTokens,
      cacheCreationTokens: fs.cacheCreationTokens,
      cacheReadTokens: fs.cacheReadTokens,
      cacheHitRate,
      turnCount: fs.turnCount,
    };
  }

  /**
   * Force refresh and emit current state
   */
  refresh(): void {
    this.processAllProjects();
  }

  /**
   * Stop the watcher
   */
  stopAll(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    for (const watcher of this.projectWatchers.values()) {
      watcher.close();
    }
    this.projectWatchers.clear();

    this.cachedContext = {};
    this.fileStates.clear();
    this.contextLogger.info('Context watcher stopped');
  }

  /**
   * Process all project directories
   */
  private async processAllProjects(): Promise<void> {
    try {
      if (!existsSync(CLAUDE_PROJECTS_DIR)) {
        return;
      }

      const projectDirs = readdirSync(CLAUDE_PROJECTS_DIR)
        .filter(name => !name.startsWith('.'))
        .map(name => ({
          name,
          path: join(CLAUDE_PROJECTS_DIR, name),
        }))
        .filter(item => {
          try {
            return statSync(item.path).isDirectory();
          } catch {
            return false;
          }
        });

      for (const { path: projectDir } of projectDirs) {
        await this.processProjectDir(projectDir);
      }

      this.contextLogger.info(`Processed ${projectDirs.length} project directories`);
    } catch (err) {
      this.contextLogger.error('Error processing all projects:', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Process a project directory: scan ALL recent JSONL files. Every file is a
   * first-class session; there is no "main vs subagent" split at the file level.
   */
  private async processProjectDir(projectDir: string): Promise<void> {
    try {
      const now = Date.now();
      const files = readdirSync(projectDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => {
          const filePath = join(projectDir, f);
          try {
            const stats = statSync(filePath);
            return {
              name: f,
              path: filePath,
              mtimeMs: stats.mtimeMs,
            };
          } catch {
            return null;
          }
        })
        .filter((f): f is NonNullable<typeof f> => f !== null)
        .filter(f => (now - f.mtimeMs) < RECENCY_THRESHOLD_MS)
        .sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first (cosmetic — scan order is irrelevant now)

      if (files.length === 0) return;

      const projectKey = basename(projectDir);

      // Ensure project state map exists
      if (!this.fileStates.has(projectKey)) {
        this.fileStates.set(projectKey, new Map());
      }

      for (const file of files) {
        await this.processProjectFile(projectDir, file.name);
      }
    } catch (err) {
      this.contextLogger.warn(`Failed to process project directory: ${projectDir}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Read only new content from a file since the last known offset (tail-read).
   * Returns new lines as strings.
   */
  private async tailRead(filePath: string, fromOffset: number): Promise<{ lines: string[]; newOffset: number }> {
    let fd: Awaited<ReturnType<typeof openFile>> | null = null;
    try {
      const stats = statSync(filePath);
      const fileSize = stats.size;

      if (fileSize <= fromOffset) {
        return { lines: [], newOffset: fromOffset };
      }

      fd = await openFile(filePath, 'r');
      const bytesToRead = fileSize - fromOffset;
      const buffer = Buffer.allocUnsafe(bytesToRead);
      await fd.read(buffer, 0, bytesToRead, fromOffset);
      const text = buffer.toString('utf-8');
      const lines = text.split('\n').filter(Boolean);
      return { lines, newOffset: fileSize };
    } catch (err) {
      this.contextLogger.warn(`tailRead error for ${filePath}:`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return { lines: [], newOffset: fromOffset };
    } finally {
      if (fd) {
        try { await fd.close(); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Process a specific JSONL file and extract usage data. Every file is treated
   * as a first-class, window-owned session — we emit `contextUpdate` for every
   * file, keyed by its own sessionId. Routing to a specific Zeus window happens
   * downstream in ContextManager via `resolveWindowSession`.
   */
  private async processProjectFile(
    projectDir: string,
    filename: string,
  ): Promise<void> {
    const filePath = join(projectDir, filename);
    const sessionId = basename(filename, '.jsonl');
    const projectKey = basename(projectDir);

    // Ensure project state map
    if (!this.fileStates.has(projectKey)) {
      this.fileStates.set(projectKey, new Map());
    }
    const projectStates = this.fileStates.get(projectKey)!;

    let fileState = projectStates.get(sessionId);

    if (!existsSync(filePath)) {
      return;
    }

    let stats;
    try {
      stats = statSync(filePath);
    } catch {
      return;
    }

    // Bootstrap new state
    if (!fileState) {
      fileState = {
        sessionId,
        lastOffset: 0,
        lastMtime: 0,
        firstSeen: Date.now(),
        model: 'default',
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        turnCount: 0,
      };
      projectStates.set(sessionId, fileState);
    }

    // Skip if file hasn't changed
    if (stats.mtimeMs === fileState.lastMtime && fileState.lastOffset > 0) {
      return;
    }

    // Decide read strategy:
    // - First read (offset=0): read last MAX_LINES_TO_READ lines for initial state
    // - Subsequent reads: tail from last known offset
    let lines: string[];
    if (fileState.lastOffset === 0) {
      // Initial read — read the whole file, take last N lines
      try {
        const content = await readFile(filePath, 'utf-8');
        const allLines = content.split('\n').filter(Boolean);
        lines = allLines.slice(-MAX_LINES_TO_READ);
        fileState.lastOffset = stats.size;
      } catch (err) {
        this.contextLogger.warn(`Failed to read JSONL file: ${filePath}`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
    } else {
      const { lines: newLines, newOffset } = await this.tailRead(filePath, fileState.lastOffset);
      lines = newLines;
      fileState.lastOffset = newOffset;
    }

    fileState.lastMtime = stats.mtimeMs;

    // Parse lines and accumulate usage
    let latestUsage: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      model: string;
    } | null = null;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;

        if (entry.message && typeof entry.message === 'object' && entry.message !== null) {
          const msg = entry.message as Record<string, unknown>;
          if (msg.usage && typeof msg.usage === 'object' && msg.usage !== null) {
            const usage = msg.usage as Record<string, unknown>;
            const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
            const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;

            // Cache metrics: support both flat and nested formats
            let cacheCreation = 0;
            let cacheRead = 0;
            if (typeof usage.cache_creation_input_tokens === 'number') {
              cacheCreation = usage.cache_creation_input_tokens;
            } else if (usage.cache_creation && typeof usage.cache_creation === 'object') {
              const cc = usage.cache_creation as Record<string, unknown>;
              cacheCreation =
                (typeof cc.ephemeral_5m_input_tokens === 'number' ? cc.ephemeral_5m_input_tokens : 0) +
                (typeof cc.ephemeral_1h_input_tokens === 'number' ? cc.ephemeral_1h_input_tokens : 0);
            }
            if (typeof usage.cache_read_input_tokens === 'number') {
              cacheRead = usage.cache_read_input_tokens;
            }

            const model = (typeof entry.model === 'string' && entry.model)
              || (typeof msg.model === 'string' && msg.model)
              || 'default';

            latestUsage = { inputTokens, outputTokens, cacheCreationTokens: cacheCreation, cacheReadTokens: cacheRead, model };
            fileState.turnCount += 1;
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    if (!latestUsage) {
      return;
    }

    // Update accumulated state (use latest call's values, not cumulative)
    fileState.model = latestUsage.model;
    fileState.inputTokens = latestUsage.inputTokens;
    fileState.outputTokens = latestUsage.outputTokens;
    fileState.cacheCreationTokens = latestUsage.cacheCreationTokens;
    fileState.cacheReadTokens = latestUsage.cacheReadTokens;

    const maxTokens = getModelContextLimit(latestUsage.model);
    const { usedTokens, percentage } = calculateContextUsage(
      latestUsage.inputTokens,
      latestUsage.cacheCreationTokens,
      latestUsage.cacheReadTokens,
      latestUsage.outputTokens,
      maxTokens,
    );
    const denom =
      latestUsage.inputTokens + latestUsage.cacheCreationTokens + latestUsage.cacheReadTokens;
    const cacheHitRate = denom > 0 ? latestUsage.cacheReadTokens / denom : 0;

    const contextUsage: ContextUsage = {
      percentage,
      usedTokens,
      maxTokens,
      model: latestUsage.model,
      sessionId,
      lastUpdated: Date.now(),
      inputTokens: latestUsage.inputTokens,
      outputTokens: latestUsage.outputTokens,
      cacheCreationTokens: latestUsage.cacheCreationTokens,
      cacheReadTokens: latestUsage.cacheReadTokens,
      cacheHitRate,
      turnCount: fileState.turnCount,
    };

    // Cache newest-session-per-project for fallback when sessionResolver fails.
    // The per-session cache (via getContextForSession) is the primary source of truth.
    const existing = this.cachedContext[projectKey];
    if (!existing || stats.mtimeMs >= existing.usage.lastUpdated) {
      this.cachedContext[projectKey] = {
        usage: contextUsage,
        sessionFile: filename,
      };
    }

    this.contextLogger.debug(
      `Cached context for ${projectKey}/${sessionId}: ${percentage.toFixed(1)}% (${usedTokens}/${maxTokens})`,
    );

    this.emitUpdate(projectKey, contextUsage);
  }

  /**
   * Emit contextUpdate event. Always emits — ContextManager is always listening
   * and needs initial-scan data cached for windows that subscribe later.
   */
  private emitUpdate(projectPath: string, usage: ContextUsage): void {
    this.emit('contextUpdate', { projectPath, usage } as ContextUpdateEvent);
  }

  /**
   * Attempt to restart the watcher after a failure
   */
  private restartWatch(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    setTimeout(() => {
      if (!this.watcher) {
        this.startWatch();
      }
    }, 1000);
  }
}

// Singleton instance for shared use
export const contextFileWatcher = new ContextFileWatcher();
