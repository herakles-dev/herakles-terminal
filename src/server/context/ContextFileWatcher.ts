/**
 * ContextFileWatcher - Watch Claude Code session JSONL files for context usage
 *
 * Monitors ~/.claude/projects/ for JSONL session files and extracts token usage
 * data to calculate context window utilization.
 */

import { EventEmitter } from 'events';
import { watch, existsSync, FSWatcher, readdirSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import {
  ContextUsage,
  calculateContextUsage,
  MODEL_CONTEXT_LIMITS,
} from '../../shared/contextProtocol.js';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const DEBOUNCE_MS = 500;
const MAX_LINES_TO_READ = 100; // Read last N lines for usage data
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

export class ContextFileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private projectWatchers: Map<string, FSWatcher> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private contextLogger = logger.child({ component: 'context-watcher' });
  private hasSubscribers: boolean = false;
  private cachedContext: ContextByProject = {};

  constructor() {
    super();
  }

  /**
   * Start watching the Claude projects directory
   */
  startWatch(): void {
    if (this.watcher) {
      this.contextLogger.warn('Context watcher already running');
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
   * Mark that we have subscribers interested in updates
   */
  subscribe(): void {
    this.hasSubscribers = true;
    this.contextLogger.debug('Subscriber registered for context updates');
  }

  /**
   * Get current cached context (for new subscribers)
   */
  getCurrentContext(): ContextByProject {
    return this.cachedContext;
  }

  /**
   * Get context for a specific project path
   */
  getContextForProject(projectPath: string): ContextUsage | null {
    return this.cachedContext[projectPath]?.usage || null;
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

    this.hasSubscribers = false;
    this.cachedContext = {};
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
   * Process a project directory to find the most recent session
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
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

      if (files.length > 0) {
        await this.processProjectFile(projectDir, files[0].name);
      }
    } catch (err) {
      this.contextLogger.warn(`Failed to process project directory: ${projectDir}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Process a specific JSONL file and extract usage data
   */
  private async processProjectFile(projectDir: string, filename: string): Promise<void> {
    const filePath = join(projectDir, filename);

    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);

      // Read last N lines for most recent usage
      const recentLines = lines.slice(-MAX_LINES_TO_READ);

      let latestUsage: ContextUsage | null = null;

      for (const line of recentLines.reverse()) {
        try {
          const entry = JSON.parse(line);

          // Look for assistant messages with usage data
          if (entry.message?.usage) {
            const usage = entry.message.usage;
            const inputTokens = usage.input_tokens || 0;
            const cacheCreation = usage.cache_creation_input_tokens || 0;
            const cacheRead = usage.cache_read_input_tokens || 0;
            const outputTokens = usage.output_tokens || 0;

            // Extract model from the entry
            const model = entry.model || entry.message?.model || 'default';
            const maxTokens = MODEL_CONTEXT_LIMITS[model] || MODEL_CONTEXT_LIMITS['default'];

            const { usedTokens, percentage } = calculateContextUsage(
              inputTokens,
              cacheCreation,
              cacheRead,
              outputTokens,
              maxTokens
            );

            latestUsage = {
              percentage,
              usedTokens,
              maxTokens,
              model,
              sessionId: basename(filename, '.jsonl'),
              lastUpdated: Date.now(),
            };

            break; // Found latest usage, stop searching
          }
        } catch {
          // Skip malformed lines
        }
      }

      if (latestUsage) {
        // Use Claude's encoded directory name as the key (e.g., "-home-hercules-herakles-terminal")
        // This avoids ambiguity in path decoding (dashes that are separators vs dashes in names)
        const projectKey = basename(projectDir);

        this.contextLogger.debug(`Cached context for ${projectKey}: ${latestUsage.percentage.toFixed(1)}% (${latestUsage.usedTokens}/${latestUsage.maxTokens})`);

        this.cachedContext[projectKey] = {
          usage: latestUsage,
          sessionFile: filename,
        };

        this.emitUpdate(projectKey, latestUsage);
      }
    } catch (err) {
      this.contextLogger.warn(`Failed to process JSONL file: ${filePath}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Emit update event if we have subscribers
   */
  private emitUpdate(projectPath: string, usage: ContextUsage): void {
    if (this.hasSubscribers) {
      this.emit('contextUpdate', { projectPath, usage } as ContextUpdateEvent);
    }
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
