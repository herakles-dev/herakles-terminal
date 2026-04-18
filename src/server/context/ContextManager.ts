/**
 * ContextManager - Central context state management
 *
 * Manages Claude Code context window usage synchronization between server and clients.
 * Stores context by project path and broadcasts to subscribed WebSockets.
 */

import { EventEmitter } from 'events';
import type { WebSocket } from 'ws';
import type Database from 'better-sqlite3';
import type {
  ContextUsage,
  ContextSyncMessage,
  ContextUpdateMessage,
  ContextWarningMessage,
  ContextWarningLevel,
} from '../../shared/contextProtocol.js';
import { CONTEXT_WARNING_THRESHOLDS } from '../../shared/contextProtocol.js';
import { logger } from '../utils/logger.js';
import { contextFileWatcher, ContextUpdateEvent, ContextByProject } from './ContextFileWatcher.js';
import type { TmuxManager } from '../tmux/TmuxManager.js';

interface WindowSubscription {
  windowId: string;
  projectPath: string | null;
  ws: WebSocket;
}

/**
 * Central manager for context state synchronization.
 *
 * Listens to ContextFileWatcher for file changes and broadcasts
 * context updates to subscribed clients.
 */
export class ContextManager extends EventEmitter {
  /** Subscriptions by windowId */
  private subscriptions: Map<string, WindowSubscription> = new Map();

  /** Cached context by project path */
  private cachedContext: ContextByProject = {};

  /** Per-window usage tracking (windowId → ContextUsage) */
  private perWindowUsage: Map<string, ContextUsage> = new Map();

  /** Last warning threshold emitted per window (prevents duplicate warnings) */
  private lastWarningThreshold: Map<string, number> = new Map();

  /**
   * Close handlers attached per-WebSocket. One handler per ws unsubscribes
   * every window belonging to that ws — prevents EventEmitter listener leak
   * when a single ws hosts N windows.
   */
  private wsCloseHandlers: WeakMap<WebSocket, () => void> = new WeakMap();

  /** Database reference for window lookups */
  private db: Database.Database | null = null;

  /** TmuxManager reference for querying current directory */
  private tmux: TmuxManager | null = null;

  constructor() {
    super();
    logger.info('ContextManager initialized');
    this.setupWatcherListener();
  }

  /**
   * Set the database reference for window lookups
   */
  setDatabase(db: Database.Database): void {
    this.db = db;
  }

  /**
   * Set the TmuxManager reference for dynamic directory lookups
   */
  setTmuxManager(tmux: TmuxManager): void {
    this.tmux = tmux;
  }

  /**
   * Convert a project path to Claude's encoded directory name format
   * e.g., "/home/hercules/herakles-terminal" -> "-home-hercules-herakles-terminal"
   */
  private encodeProjectPath(projectPath: string): string {
    // Remove leading slash and replace all remaining slashes with dashes
    return '-' + projectPath.replace(/^\//, '').replace(/\//g, '-');
  }

  /**
   * Extract project name from a working directory path.
   * Returns the directory name for paths under $HOME, null otherwise.
   */
  private extractProjectName(cwd: string | null): string | null {
    if (!cwd) return null;

    const userHome = process.env.HOME || '/home/hercules';
    // Normalize home directory shorthand
    const normalizedPath = cwd.replace(/^~/, userHome);

    // Only extract project name from paths under $HOME/
    if (!normalizedPath.startsWith(userHome + '/')) {
      return null;
    }

    // Remove $HOME/ prefix
    const relativePath = normalizedPath.substring(userHome.length + 1);

    // Extract the first directory component (project name)
    const parts = relativePath.split('/').filter(Boolean);
    return parts.length > 0 ? parts[0] : null;
  }

  /**
   * Look up the project path for a window dynamically by querying tmux
   * Returns the encoded Claude directory name format based on CURRENT working directory
   */
  private async getWindowProjectPath(windowId: string): Promise<string | null> {
    if (!this.tmux) {
      logger.warn(`ContextManager: No TmuxManager available for window ${windowId} lookup`);
      // Fallback to database auto_name if tmux not available
      return this.getWindowProjectPathFromDB(windowId);
    }

    try {
      // Query the CURRENT working directory from tmux (dynamic!)
      const cwd = await this.tmux.getCurrentWorkingDirectory(windowId);
      const projectName = this.extractProjectName(cwd);

      logger.debug(`ContextManager: Window ${windowId} dynamic cwd lookup`, {
        cwd,
        projectName,
      });

      if (projectName && projectName !== '~') {
        // Convert to Claude's encoded format
        // e.g., "herakles-terminal" -> "-home-hercules-herakles-terminal"
        const fullPath = `/home/hercules/${projectName}`;
        const encoded = this.encodeProjectPath(fullPath);

        logger.debug(`ContextManager: Encoded project path for ${windowId}`, {
          projectName,
          fullPath,
          encoded,
        });

        return encoded;
      }
    } catch (err) {
      logger.warn(`Failed to lookup window project path for ${windowId}:`, err);
    }

    return null;
  }

  /**
   * Fallback: Look up project path from database auto_name (static, set at creation)
   */
  private getWindowProjectPathFromDB(windowId: string): string | null {
    if (!this.db) {
      logger.warn(`ContextManager: No database available for window ${windowId} lookup`);
      return null;
    }

    try {
      const row = this.db.prepare('SELECT auto_name FROM windows WHERE id = ?').get(windowId) as { auto_name: string | null } | undefined;

      logger.debug(`ContextManager: Window ${windowId} auto_name lookup (fallback)`, {
        found: !!row,
        autoName: row?.auto_name,
      });

      if (row?.auto_name && row.auto_name !== '~') {
        const fullPath = `/home/hercules/${row.auto_name}`;
        return this.encodeProjectPath(fullPath);
      }
    } catch (err) {
      logger.warn(`Failed to lookup window project path from DB for ${windowId}:`, err);
    }

    return null;
  }

  /**
   * Set up listener for ContextFileWatcher events
   */
  private setupWatcherListener(): void {
    contextFileWatcher.on('contextUpdate', (event: ContextUpdateEvent) => {
      this.handleContextUpdate(event.projectPath, event.usage);
    });
  }

  /**
   * Handle context updates from file watcher
   */
  private handleContextUpdate(projectPath: string, usage: ContextUsage): void {
    // Update cache
    this.cachedContext[projectPath] = { usage, sessionFile: '' };

    // Broadcast to all subscribed windows watching this project
    for (const subscription of this.subscriptions.values()) {
      if (subscription.projectPath === projectPath) {
        // Update per-window usage cache
        this.perWindowUsage.set(subscription.windowId, usage);

        this.sendContextUpdate(subscription.ws, subscription.windowId, usage);

        // Check warning thresholds and emit toast notifications
        this.checkWarningThresholds(subscription, usage);
      }
    }
  }

  /**
   * Check if usage has crossed a warning threshold and emit a warning message.
   * Only emits once per threshold per window (resets when usage drops below threshold).
   */
  private checkWarningThresholds(subscription: WindowSubscription, usage: ContextUsage): void {
    const lastThreshold = this.lastWarningThreshold.get(subscription.windowId) || 0;

    // If usage dropped below last warning threshold, reset tracking
    if (usage.percentage < lastThreshold) {
      this.lastWarningThreshold.set(subscription.windowId, 0);
      return;
    }

    // Check thresholds in descending order to emit the highest crossed threshold
    for (let i = CONTEXT_WARNING_THRESHOLDS.length - 1; i >= 0; i--) {
      const threshold = CONTEXT_WARNING_THRESHOLDS[i];
      if (usage.percentage >= threshold && lastThreshold < threshold) {
        this.lastWarningThreshold.set(subscription.windowId, threshold);
        this.sendContextWarning(subscription.ws, subscription.windowId, usage, threshold);
        break; // Only send the highest new threshold
      }
    }
  }

  /**
   * Subscribe a window to context updates for a project.
   */
  async subscribe(windowId: string, projectPath: string | null, ws: WebSocket): Promise<void> {
    // Remove existing subscription for this window
    this.unsubscribe(windowId);

    // If no project path provided, try to look it up dynamically from tmux cwd
    const resolvedProjectPath = projectPath || await this.getWindowProjectPath(windowId);

    logger.info(`ContextManager: Subscribe request for window ${windowId}`, {
      providedPath: projectPath,
      resolvedPath: resolvedProjectPath,
    });

    const subscription: WindowSubscription = {
      windowId,
      projectPath: resolvedProjectPath,
      ws,
    };

    this.subscriptions.set(windowId, subscription);

    // Register with file watcher
    contextFileWatcher.subscribe();

    // Send current cached state
    if (resolvedProjectPath) {
      const cachedUsage = contextFileWatcher.getContextForProject(resolvedProjectPath);
      logger.info(`ContextManager: Sending cached context for ${windowId}`, {
        projectPath: resolvedProjectPath,
        hasUsage: !!cachedUsage,
        percentage: cachedUsage?.percentage,
      });

      // Initialize per-window usage from cache
      if (cachedUsage) {
        this.perWindowUsage.set(windowId, cachedUsage);
      }

      this.sendContextSync(ws, windowId, cachedUsage);
    } else {
      logger.warn(`ContextManager: No project path for window ${windowId}, sending null usage`);
      this.sendContextSync(ws, windowId, null);
    }

    // Attach exactly one close handler per ws. The handler unsubscribes every
    // window owned by this ws — so N windows on one socket => 1 listener, not N.
    if (!this.wsCloseHandlers.has(ws)) {
      const handleClose = (): void => {
        this.unsubscribeAll(ws);
        this.wsCloseHandlers.delete(ws);
        ws.removeListener('close', handleClose);
      };
      this.wsCloseHandlers.set(ws, handleClose);
      ws.on('close', handleClose);
    }
  }

  /**
   * Update the project path for an existing subscription
   */
  updateProjectPath(windowId: string, projectPath: string | null): void {
    const subscription = this.subscriptions.get(windowId);
    if (!subscription) {
      return;
    }

    subscription.projectPath = projectPath;

    // Send current context for new project path
    if (projectPath) {
      const cachedUsage = contextFileWatcher.getContextForProject(projectPath);
      this.sendContextSync(subscription.ws, windowId, cachedUsage);
    } else {
      this.sendContextSync(subscription.ws, windowId, null);
    }
  }

  /**
   * Unsubscribe a window from context updates.
   */
  unsubscribe(windowId: string): void {
    const wasSubscribed = this.subscriptions.delete(windowId);
    if (wasSubscribed) {
      this.perWindowUsage.delete(windowId);
      this.lastWarningThreshold.delete(windowId);
      logger.debug(`ContextManager: Unsubscribed window ${windowId}`);
    }
  }

  /**
   * Unsubscribe a WebSocket from all windows.
   */
  unsubscribeAll(ws: WebSocket): void {
    for (const [windowId, subscription] of this.subscriptions.entries()) {
      if (subscription.ws === ws) {
        this.subscriptions.delete(windowId);
      }
    }
  }

  /**
   * Send context sync message to a WebSocket
   */
  private sendContextSync(ws: WebSocket, windowId: string, usage: ContextUsage | null): void {
    const message: ContextSyncMessage = {
      type: 'context:sync',
      windowId,
      usage,
    };

    logger.debug(`ContextManager: Sending context:sync for window ${windowId}: ${usage ? `${usage.percentage.toFixed(1)}%` : 'null'}`);
    this.sendToWebSocket(ws, JSON.stringify(message));
  }

  /**
   * Send context update message to a WebSocket
   */
  private sendContextUpdate(ws: WebSocket, windowId: string, usage: ContextUsage): void {
    const message: ContextUpdateMessage = {
      type: 'context:update',
      windowId,
      usage,
    };

    this.sendToWebSocket(ws, JSON.stringify(message));
  }

  /**
   * Send context warning message to a WebSocket (toast notification trigger)
   */
  private sendContextWarning(ws: WebSocket, windowId: string, usage: ContextUsage, threshold: ContextWarningLevel): void {
    const messages: Record<number, string> = {
      90: `Context window at ${usage.percentage.toFixed(0)}% — consider starting a new session soon`,
      95: `Context window at ${usage.percentage.toFixed(0)}% — running low on context`,
      98: `Context window at ${usage.percentage.toFixed(0)}% — nearly full, start a new session`,
    };

    const message: ContextWarningMessage = {
      type: 'context:warning',
      windowId,
      usage,
      threshold,
      message: messages[threshold] || `Context usage at ${threshold}%`,
    };

    logger.warn(`ContextManager: Warning for window ${windowId}: ${threshold}% threshold crossed (${usage.percentage.toFixed(1)}%)`);
    this.sendToWebSocket(ws, JSON.stringify(message));
  }

  /**
   * Get the current usage for a specific window
   */
  getUsageForWindow(windowId: string): ContextUsage | null {
    return this.perWindowUsage.get(windowId) || null;
  }

  /**
   * Send a message to a WebSocket connection.
   */
  private sendToWebSocket(ws: WebSocket, message: string): void {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(message);
      }
    } catch (err) {
      logger.error('ContextManager: Error sending message to WebSocket:', err);
    }
  }

  /**
   * Get statistics about the ContextManager state.
   */
  getStats(): {
    subscriptionCount: number;
    projectsTracked: number;
    windowsTracked: number;
  } {
    return {
      subscriptionCount: this.subscriptions.size,
      projectsTracked: Object.keys(this.cachedContext).length,
      windowsTracked: this.perWindowUsage.size,
    };
  }
}

/**
 * Singleton instance of ContextManager.
 */
let _contextManager: ContextManager | null = null;

export function getContextManager(): ContextManager {
  if (!_contextManager) {
    _contextManager = new ContextManager();
  }
  return _contextManager;
}

export const contextManager = getContextManager();
