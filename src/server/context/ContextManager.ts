/**
 * ContextManager - Central context state management
 *
 * Manages Claude Code context window usage synchronization between server and clients.
 * Stores context by project path and broadcasts to subscribed WebSockets.
 *
 * v2: Agent session aggregation — tracks subagent sessions per window and
 * broadcasts WindowMetrics (metrics:sync / metrics:update) to subscribers.
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
  AgentSession,
  WindowMetrics,
  MetricsSyncMessage,
  MetricsUpdateMessage,
} from '../../shared/contextProtocol.js';
import { logger } from '../utils/logger.js';
import { resolveWindowSession } from './sessionResolver.js';
import {
  contextFileWatcher,
  ContextUpdateEvent,
  ContextByProject,
} from './ContextFileWatcher.js';
import type { TmuxManager } from '../tmux/TmuxManager.js';

interface WindowSubscription {
  windowId: string;
  projectPath: string | null;
  /**
   * The Claude Code JSONL session ID (filename without .jsonl) that this
   * window's claude process is writing to. When set, context updates are
   * routed by session rather than by project, so sibling windows in the
   * same project don't see each other's data.
   */
  sessionId: string | null;
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

  // ── Agent session state ──────────────────────────────────────────────────

  /**
   * windowId → (sessionId → AgentSession). Reserved for true in-file sidechain
   * subagent detection; currently always empty because separate JSONL files are
   * independent window-owned sessions, NOT subagents.
   */
  private agentSessions: Map<string, Map<string, AgentSession>> = new Map();

  /** Computed WindowMetrics per windowId */
  private windowMetrics: Map<string, WindowMetrics> = new Map();

  /** Metrics subscriptions — windowId → WebSocket */
  private metricsSubscriptions: Map<string, WebSocket> = new Map();

  private sessionRetryTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    logger.info('ContextManager initialized');
    this.setupWatcherListener();
    // Retry sessionId resolution every 8s so windows that start claude
    // AFTER subscribing still pick up their own JSONL.
    this.sessionRetryTimer = setInterval(() => {
      this.retryUnresolvedSessionIds().catch(() => { /* ignore */ });
    }, 8000);
    // Don't keep the event loop alive for this timer
    if (this.sessionRetryTimer.unref) this.sessionRetryTimer.unref();
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
   * Handle context updates from file watcher.
   *
   * Routing is strictly by sessionId. A window only receives updates for its
   * OWN JSONL file (resolved via `/proc` inspection in `sessionResolver`).
   * Windows whose sessionId hasn't been resolved yet get NO updates — the
   * periodic retry ticker (`retryUnresolvedSessionIds`) fills them in once
   * claude starts and is visible in /proc. This avoids the "all tabs paint
   * the same color" symptom where unresolved subscriptions used to accept
   * every session's update for their project.
   */
  private handleContextUpdate(projectPath: string, usage: ContextUsage): void {
    // Keep project-level cache for subscribe-time snapshots of unresolved shells
    this.cachedContext[projectPath] = { usage, sessionFile: '' };

    for (const subscription of this.subscriptions.values()) {
      if (subscription.projectPath !== projectPath) continue;
      if (subscription.sessionId !== usage.sessionId) continue;

      this.perWindowUsage.set(subscription.windowId, usage);
      this.sendContextUpdate(subscription.ws, subscription.windowId, usage);
      this.checkWarningThresholds(subscription, usage);
      this.refreshWindowMetrics(subscription.windowId, usage);
      this.broadcastMetricsUpdate(subscription.windowId);
    }
  }

  /**
   * Collect sessionIds already claimed by other windows so the resolver's
   * cwd-fallback path doesn't map two windows to the same JSONL when multiple
   * claudes run in the same project.
   */
  private collectReservedSessionIds(excludeWindowId: string): Set<string> {
    const reserved = new Set<string>();
    for (const [id, sub] of this.subscriptions.entries()) {
      if (id === excludeWindowId) continue;
      if (sub.sessionId) reserved.add(sub.sessionId);
    }
    return reserved;
  }

  /**
   * Best-effort: re-resolve sessionIds for subscriptions that don't have one
   * yet. Called on a periodic tick so windows that launch `claude` after
   * subscribe pick up their session without requiring a manual re-subscribe.
   */
  private async retryUnresolvedSessionIds(): Promise<void> {
    if (!this.tmux) return;
    for (const subscription of this.subscriptions.values()) {
      if (subscription.sessionId) continue;
      try {
        const reserved = this.collectReservedSessionIds(subscription.windowId);
        const sid = await resolveWindowSession(subscription.windowId, this.tmux, reserved);
        if (sid) {
          subscription.sessionId = sid;
          logger.info(`ContextManager: Late-resolved sessionId for window ${subscription.windowId}`, { sessionId: sid });
          // Try to flush cached state for this session now.
          if (subscription.projectPath) {
            const cached = contextFileWatcher.getContextForSession(subscription.projectPath, sid);
            if (cached) {
              this.perWindowUsage.set(subscription.windowId, cached);
              this.sendContextSync(subscription.ws, subscription.windowId, cached);
              this.refreshWindowMetrics(subscription.windowId, cached);
              this.broadcastMetricsUpdate(subscription.windowId);
            }
          }
        }
      } catch {
        // ignore
      }
    }
  }


  /**
   * Compute aggregated metrics across all agent sessions for a window
   */
  private computeAggregates(windowId: string): WindowMetrics['aggregated'] {
    const agents = this.agentSessions.get(windowId);
    if (!agents || agents.size === 0) {
      return {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheCreationTokens: 0,
        totalCacheReadTokens: 0,
        aggregateCacheHitRate: 0,
        agentCount: 0,
        activeAgents: 0,
      };
    }

    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheCreation = 0;
    let totalCacheRead = 0;
    let activeCount = 0;

    for (const agent of agents.values()) {
      totalInput += agent.usage.inputTokens;
      totalOutput += agent.usage.outputTokens;
      totalCacheCreation += agent.usage.cacheCreationTokens;
      totalCacheRead += agent.usage.cacheReadTokens;
      if (agent.status === 'active') activeCount++;
    }

    const denom = totalInput + totalCacheCreation + totalCacheRead;

    return {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheCreationTokens: totalCacheCreation,
      totalCacheReadTokens: totalCacheRead,
      aggregateCacheHitRate: denom > 0 ? totalCacheRead / denom : 0,
      agentCount: agents.size,
      activeAgents: activeCount,
    };
  }

  /**
   * Rebuild and cache WindowMetrics for a window
   */
  private refreshWindowMetrics(windowId: string, mainSession: ContextUsage | null): void {
    const agents = this.agentSessions.get(windowId);
    const agentSessions: AgentSession[] = agents ? Array.from(agents.values()) : [];

    const metrics: WindowMetrics = {
      windowId,
      mainSession: mainSession || null,
      agentSessions,
      aggregated: this.computeAggregates(windowId),
      lastUpdated: Date.now(),
    };

    this.windowMetrics.set(windowId, metrics);
  }

  /**
   * Get the current WindowMetrics for a window
   */
  getMetricsForWindow(windowId: string): WindowMetrics {
    if (!this.windowMetrics.has(windowId)) {
      this.refreshWindowMetrics(windowId, this.perWindowUsage.get(windowId) || null);
    }
    return this.windowMetrics.get(windowId)!;
  }

  /**
   * Lightweight signal from CLI parser that agent work is active for a window.
   * Called from ConnectionManager when CliUsageParser detects a spawn marker.
   * Does NOT override JSONL data — only triggers a metrics broadcast if there
   * is already a metrics subscriber for this window.
   */
  notifyCliAgentSignal(windowId: string): void {
    // Only act if someone is subscribed to metrics for this window
    if (!this.metricsSubscriptions.has(windowId)) return;
    // Re-broadcast current metrics so the UI reflects "agent active" state
    // without waiting for the JSONL debounce to fire.
    this.broadcastMetricsUpdate(windowId);
    logger.debug(`ContextManager: CLI agent signal received for window ${windowId} — metrics re-broadcast`);
  }

  /**
   * Subscribe a WebSocket to detailed metrics for a window
   */
  async subscribeMetrics(windowId: string, ws: WebSocket): Promise<void> {
    this.metricsSubscriptions.set(windowId, ws);
    logger.info(`ContextManager: Metrics subscribed for window ${windowId}`);

    // Ensure we have a WindowMetrics to send. If context:subscribe hasn't
    // fired for this window yet, bootstrap from cached project context.
    if (!this.windowMetrics.has(windowId)) {
      let cachedUsage = this.perWindowUsage.get(windowId) || null;
      if (!cachedUsage) {
        // Try to resolve the project path and pull from the file watcher cache
        const projectPath = await this.getWindowProjectPath(windowId);
        if (projectPath) {
          cachedUsage = contextFileWatcher.getContextForProject(projectPath);
          if (cachedUsage) {
            this.perWindowUsage.set(windowId, cachedUsage);
          }
        }
      }
      this.refreshWindowMetrics(windowId, cachedUsage);
    }

    // Send initial state so the panel exits its "loading..." state.
    this.sendMetricsSync(ws, windowId);
  }

  /**
   * Unsubscribe from metrics for a window
   */
  unsubscribeMetrics(windowId: string): void {
    this.metricsSubscriptions.delete(windowId);
    logger.debug(`ContextManager: Metrics unsubscribed for window ${windowId}`);
  }

  /**
   * Broadcast metrics:update to the subscriber for this window (if any)
   */
  broadcastMetricsUpdate(windowId: string): void {
    const ws = this.metricsSubscriptions.get(windowId);
    if (!ws) return;

    const metrics = this.getMetricsForWindow(windowId);
    const message: MetricsUpdateMessage = {
      type: 'metrics:update',
      windowId,
      metrics,
    };

    this.sendToWebSocket(ws, JSON.stringify(message));
  }

  /**
   * Send metrics:sync to a WebSocket (full state at subscribe time)
   */
  private sendMetricsSync(ws: WebSocket, windowId: string): void {
    const metrics = this.windowMetrics.get(windowId) || null;
    const message: MetricsSyncMessage = {
      type: 'metrics:sync',
      windowId,
      metrics,
    };
    this.sendToWebSocket(ws, JSON.stringify(message));
  }

  /**
   * Check if usage has crossed a token-count warning threshold and emit a
   * warning. Uses absolute token counts (200K / 300K / 350K) rather than
   * percentages so 1M-context models warn at the same practical fill level
   * as 200K-context models.
   *
   * The `threshold` field on the outgoing warning message is retained as a
   * percentage-style number (90/95/98) for back-compat with the existing
   * ContextWarningLevel type — we map token bands onto these buckets.
   */
  private checkWarningThresholds(subscription: WindowSubscription, usage: ContextUsage): void {
    const lastThreshold = this.lastWarningThreshold.get(subscription.windowId) || 0;
    const used = usage.usedTokens;

    // Map token bands → legacy 90/95/98 percentage buckets
    let band: ContextWarningLevel | 0 = 0;
    if (used >= 350000) band = 98;
    else if (used >= 300000) band = 95;
    else if (used >= 200000) band = 90;

    // If usage dropped out of the current band, reset tracking so user can
    // be re-warned if they cross it again later (rare, but possible).
    if (band === 0 || band < lastThreshold) {
      if (band < lastThreshold) this.lastWarningThreshold.set(subscription.windowId, band || 0);
      return;
    }

    if (band > lastThreshold) {
      this.lastWarningThreshold.set(subscription.windowId, band);
      this.sendContextWarning(subscription.ws, subscription.windowId, usage, band);
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

    // Resolve the window's own JSONL session via /proc inspection +
    // cwd-fallback. Returns null for non-claude shells or when inspection fails.
    let resolvedSessionId: string | null = null;
    if (this.tmux) {
      try {
        const reserved = this.collectReservedSessionIds(windowId);
        resolvedSessionId = await resolveWindowSession(windowId, this.tmux, reserved);
      } catch {
        resolvedSessionId = null;
      }
    }

    logger.info(`ContextManager: Subscribe request for window ${windowId}`, {
      providedPath: projectPath,
      resolvedPath: resolvedProjectPath,
      sessionId: resolvedSessionId,
    });

    const subscription: WindowSubscription = {
      windowId,
      projectPath: resolvedProjectPath,
      sessionId: resolvedSessionId,
      ws,
    };

    this.subscriptions.set(windowId, subscription);

    // Register with file watcher
    contextFileWatcher.subscribe();

    // Send current cached state — STRICTLY session-specific. If we don't know
    // this window's own sessionId yet (resolver will retry), send null so the
    // UI stays blank rather than inheriting a sibling session's data.
    if (resolvedProjectPath) {
      const cachedUsage = resolvedSessionId
        ? contextFileWatcher.getContextForSession(resolvedProjectPath, resolvedSessionId)
        : null;
      logger.info(`ContextManager: Sending cached context for ${windowId}`, {
        projectPath: resolvedProjectPath,
        sessionId: resolvedSessionId,
        hasUsage: !!cachedUsage,
        percentage: cachedUsage?.percentage,
      });

      if (cachedUsage) {
        this.perWindowUsage.set(windowId, cachedUsage);
      }

      this.sendContextSync(ws, windowId, cachedUsage);

      // Build initial WindowMetrics and send metrics:sync
      this.refreshWindowMetrics(windowId, cachedUsage || null);
      this.sendMetricsSync(ws, windowId);
    } else {
      logger.warn(`ContextManager: No project path for window ${windowId}, sending null usage`);
      this.sendContextSync(ws, windowId, null);

      // Still send metrics:sync (null metrics)
      const metricsSyncMsg: MetricsSyncMessage = {
        type: 'metrics:sync',
        windowId,
        metrics: null,
      };
      this.sendToWebSocket(ws, JSON.stringify(metricsSyncMsg));
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
      this.agentSessions.delete(windowId);
      this.windowMetrics.delete(windowId);
      this.metricsSubscriptions.delete(windowId);
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
        this.agentSessions.delete(windowId);
        this.windowMetrics.delete(windowId);
        this.metricsSubscriptions.delete(windowId);
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
    const usedK = Math.round(usage.usedTokens / 1000);
    // `threshold` values are legacy 90/95/98 buckets that map to token bands:
    //   90 → crossed 200K (handoff zone begins)
    //   95 → crossed 300K (handoff now)
    //   98 → crossed 350K (critical)
    const messages: Record<number, string> = {
      90: `Context at ${usedK}K — entering handoff zone (${usedK}K ≥ 200K). Consider /handoff soon.`,
      95: `Context at ${usedK}K — hand off now (${usedK}K ≥ 300K). Quality will degrade.`,
      98: `Context at ${usedK}K — critical (${usedK}K ≥ 350K). Start a fresh session immediately.`,
    };

    const message: ContextWarningMessage = {
      type: 'context:warning',
      windowId,
      usage,
      threshold,
      message: messages[threshold] || `Context at ${usedK}K tokens`,
    };

    logger.warn(
      `ContextManager: Warning for window ${windowId}: ${usedK}K tokens crossed band ${threshold} (${usage.percentage.toFixed(1)}% of hard limit)`,
    );
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
