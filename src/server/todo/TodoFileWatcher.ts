/**
 * TodoFileWatcher - Watch Claude Code's ~/.claude/todos/ directory
 *
 * Monitors the global Claude Code todos directory for changes and emits
 * ALL sessions' todos grouped by Claude session ID.
 */

import { EventEmitter } from 'events';
import { watch, existsSync, FSWatcher, readdirSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import { TodoItem, parseTodosFromFile } from '../../shared/todoProtocol.js';

const CLAUDE_TODOS_DIR = join(homedir(), '.claude', 'todos');
const CLAUDE_TASKS_DIR = join(homedir(), '.claude', 'tasks');
const DEBOUNCE_MS = 150;

export interface TodosBySession {
  [sessionId: string]: {
    todos: TodoItem[];
    lastModified: number;
  };
}

export interface AllTodosEvent {
  todosBySession: TodosBySession;
}

export class TodoFileWatcher extends EventEmitter {
  private globalWatcher: FSWatcher | null = null;
  private tasksWatcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private todoLogger = logger.child({ component: 'todo-watcher' });
  private hasSubscribers: boolean = false;
  private cachedTodos: TodosBySession = {};

  constructor() {
    super();
  }

  /**
   * Start watching the global Claude todos directory
   */
  startGlobalWatch(): void {
    if (this.globalWatcher) {
      // Idempotent: startGlobalWatch() runs on every subscribe by design.
      this.todoLogger.debug('Global watcher already running — no-op');
      return;
    }

    if (!existsSync(CLAUDE_TODOS_DIR)) {
      this.todoLogger.warn(`Claude todos directory does not exist: ${CLAUDE_TODOS_DIR}`);
      return;
    }

    try {
      this.globalWatcher = watch(CLAUDE_TODOS_DIR, { persistent: false }, (_eventType, filename) => {
        if (filename && filename.endsWith('.json')) {
          this.handleFileChange();
        }
      });

      this.globalWatcher.on('error', (err) => {
        this.todoLogger.error('Global watcher error:', { error: err.message });
        this.restartGlobalWatch();
      });

      this.todoLogger.info(`Started watching Claude todos directory: ${CLAUDE_TODOS_DIR}`);

      // Also watch the new tasks directory (Claude Code 2.1.16+)
      this.startTasksWatch();

      // Process initial state
      this.processAllFiles();
    } catch (err) {
      this.todoLogger.error('Failed to start global watcher:', {
        error: err instanceof Error ? err.message : String(err),
        directory: CLAUDE_TODOS_DIR,
      });
    }
  }

  /**
   * Start watching the new tasks directory (Claude Code 2.1.16+)
   */
  private startTasksWatch(): void {
    if (!existsSync(CLAUDE_TASKS_DIR)) {
      this.todoLogger.warn(`Claude tasks directory does not exist: ${CLAUDE_TASKS_DIR}`);
      return;
    }

    try {
      this.tasksWatcher = watch(CLAUDE_TASKS_DIR, { persistent: false, recursive: true }, (_eventType, filename) => {
        if (filename && filename.endsWith('.json') && !filename.endsWith('.lock')) {
          this.handleFileChange();
        }
      });

      this.tasksWatcher.on('error', (err) => {
        this.todoLogger.error('Tasks watcher error:', { error: err.message });
        this.restartTasksWatch();
      });

      this.todoLogger.info(`Started watching Claude tasks directory: ${CLAUDE_TASKS_DIR}`);
    } catch (err) {
      this.todoLogger.error('Failed to start tasks watcher:', {
        error: err instanceof Error ? err.message : String(err),
        directory: CLAUDE_TASKS_DIR,
      });
    }
  }

  /**
   * Mark that we have subscribers interested in updates
   */
  subscribe(): void {
    this.hasSubscribers = true;
    this.todoLogger.debug('Subscriber registered for todo updates');
  }

  /**
   * Get current cached todos (for new subscribers)
   */
  getCurrentTodos(): TodosBySession {
    return this.cachedTodos;
  }

  /**
   * Force refresh and emit current state
   */
  refresh(): void {
    this.processAllFiles();
  }

  /**
   * Stop the global watcher
   */
  stopAll(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.globalWatcher) {
      this.globalWatcher.close();
      this.globalWatcher = null;
    }

    if (this.tasksWatcher) {
      this.tasksWatcher.close();
      this.tasksWatcher = null;
    }

    this.hasSubscribers = false;
    this.cachedTodos = {};
    this.todoLogger.info('Todo watcher stopped');
  }

  /**
   * Handle file change event with debouncing
   */
  private handleFileChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.processAllFiles();
    }, DEBOUNCE_MS);
  }

  /**
   * Process ALL todo files and emit combined state
   */
  private async processAllFiles(): Promise<void> {
    try {
      const todosBySession: TodosBySession = {};

      // Process legacy todos directory
      if (existsSync(CLAUDE_TODOS_DIR)) {
        const RECENCY_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours
        const now = Date.now();

        const files = readdirSync(CLAUDE_TODOS_DIR)
          .filter(f => f.endsWith('.json'))
          .map(f => {
            const path = join(CLAUDE_TODOS_DIR, f);
            try {
              const stats = statSync(path);
              return {
                name: f,
                path,
                sessionId: basename(f, '.json'),
                mtimeMs: stats.mtimeMs,
              };
            } catch {
              return null;
            }
          })
          .filter((f): f is NonNullable<typeof f> => f !== null)
          .filter(f => (now - f.mtimeMs) < RECENCY_THRESHOLD_MS)
          .sort((a, b) => b.mtimeMs - a.mtimeMs)
          .slice(0, 20);

        for (const file of files) {
          try {
            const content = await readFile(file.path, 'utf-8');
            const todos = parseTodosFromFile(content);

            if (todos && todos.length > 0) {
              todosBySession[file.sessionId] = {
                todos,
                lastModified: file.mtimeMs,
              };
            }
          } catch (err) {
            this.todoLogger.warn(`Failed to read todo file: ${file.name}`, {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      // Process new tasks directory (Claude Code 2.1.16+)
      if (existsSync(CLAUDE_TASKS_DIR)) {
        const taskData = await this.processTasksDirectory();

        // Merge task data with legacy todos (tasks take precedence)
        for (const [sessionId, data] of Object.entries(taskData)) {
          if (!todosBySession[sessionId] || data.lastModified > todosBySession[sessionId].lastModified) {
            todosBySession[sessionId] = data;
          }
        }
      }

      // Sort by most recently modified and limit to 10 active sessions
      const sortedSessions = Object.entries(todosBySession)
        .sort(([, a], [, b]) => b.lastModified - a.lastModified)
        .slice(0, 10);

      this.cachedTodos = Object.fromEntries(sortedSessions);

      const totalTodos = sortedSessions.reduce((sum, [, s]) => sum + s.todos.length, 0);
      this.todoLogger.info(`Processed ${sortedSessions.length} sessions with ${totalTodos} total todos`);

      this.emitUpdate();
    } catch (err) {
      this.todoLogger.error('Error processing todo files:', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Process the new tasks directory structure (Claude Code 2.1.16+)
   * Structure: ~/.claude/tasks/{session-id}/{task-id}.json
   */
  private async processTasksDirectory(): Promise<TodosBySession> {
    const todosBySession: TodosBySession = {};
    const RECENCY_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours
    const now = Date.now();

    try {
      const sessionDirs = readdirSync(CLAUDE_TASKS_DIR)
        .map(sessionId => {
          const sessionPath = join(CLAUDE_TASKS_DIR, sessionId);
          try {
            const stats = statSync(sessionPath);
            if (stats.isDirectory()) {
              return { sessionId, sessionPath, mtimeMs: stats.mtimeMs };
            }
          } catch {
            return null;
          }
          return null;
        })
        .filter((d): d is NonNullable<typeof d> => d !== null)
        .filter(d => (now - d.mtimeMs) < RECENCY_THRESHOLD_MS)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, 20);

      for (const { sessionId, sessionPath } of sessionDirs) {
        try {
          const taskFiles = readdirSync(sessionPath)
            .filter(f => f.endsWith('.json') && !f.endsWith('.lock'));

          const todos: TodoItem[] = [];
          let latestMtime = 0;

          for (const taskFile of taskFiles) {
            const taskPath = join(sessionPath, taskFile);
            try {
              const stats = statSync(taskPath);
              latestMtime = Math.max(latestMtime, stats.mtimeMs);

              const content = await readFile(taskPath, 'utf-8');
              const parsed = parseTodosFromFile(content);

              if (parsed && parsed.length > 0) {
                todos.push(...parsed);
              }
            } catch (err) {
              this.todoLogger.warn(`Failed to read task file: ${sessionId}/${taskFile}`, {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          if (todos.length > 0) {
            todosBySession[sessionId] = {
              todos,
              lastModified: latestMtime,
            };
          }
        } catch (err) {
          this.todoLogger.warn(`Failed to process session directory: ${sessionId}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      this.todoLogger.error('Error processing tasks directory:', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return todosBySession;
  }

  /**
   * Emit update event if we have subscribers
   */
  private emitUpdate(): void {
    if (this.hasSubscribers) {
      this.emit('allTodos', { todosBySession: this.cachedTodos } as AllTodosEvent);
    }
  }

  /**
   * Attempt to restart the global watcher after a failure
   */
  private restartGlobalWatch(): void {
    if (this.globalWatcher) {
      this.globalWatcher.close();
      this.globalWatcher = null;
    }

    setTimeout(() => {
      if (!this.globalWatcher) {
        this.startGlobalWatch();
      }
    }, 1000);
  }

  /**
   * Attempt to restart the tasks watcher after a failure
   */
  private restartTasksWatch(): void {
    if (this.tasksWatcher) {
      this.tasksWatcher.close();
      this.tasksWatcher = null;
    }

    setTimeout(() => {
      if (!this.tasksWatcher) {
        this.startTasksWatch();
      }
    }, 1000);
  }

  // Legacy compatibility methods
  subscribeWindow(_windowId: string): void {
    this.subscribe();
  }

  unsubscribeWindow(_windowId: string): void {
    // Keep subscribed - other windows may still need updates
  }
}

// Singleton instance for shared use
export const todoFileWatcher = new TodoFileWatcher();
