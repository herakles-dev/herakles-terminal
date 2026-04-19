/**
 * Claude Code Context Window Usage Protocol
 * Shared types for real-time context usage synchronization between server and client
 */

export interface ContextUsage {
  percentage: number;
  usedTokens: number;
  maxTokens: number;  // 200000 for Opus 4.5
  model: string;
  sessionId: string;
  lastUpdated: number;
  // Token breakdown for the latest API call (optional for back-compat).
  // Used by the Metrics panel to show input/cache/output split for the main session.
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cacheHitRate?: number;  // 0-1, cacheRead / (input + cacheCreation + cacheRead)
  turnCount?: number;
}

export interface ContextState {
  windowId: string;
  usage: ContextUsage | null;
}

// Client → Server messages
export interface ContextSubscribeMessage {
  type: 'context:subscribe';
  windowId: string;
}

export interface ContextUnsubscribeMessage {
  type: 'context:unsubscribe';
  windowId: string;
}

// Server → Client messages
export interface ContextUpdateMessage {
  type: 'context:update';
  windowId: string;
  usage: ContextUsage;
}

export interface ContextSyncMessage {
  type: 'context:sync';
  windowId: string;
  usage: ContextUsage | null;
}

// Warning thresholds for toast notifications (percentage)
export const CONTEXT_WARNING_THRESHOLDS = [90, 95, 98] as const;
export type ContextWarningLevel = (typeof CONTEXT_WARNING_THRESHOLDS)[number];

export interface ContextWarningMessage {
  type: 'context:warning';
  windowId: string;
  usage: ContextUsage;
  threshold: ContextWarningLevel;
  message: string;
}

// Union types for message handling
export type ContextClientMessage = ContextSubscribeMessage | ContextUnsubscribeMessage;
export type ContextServerMessage = ContextUpdateMessage | ContextSyncMessage | ContextWarningMessage;

/**
 * Model hard context limits. These are the true API ceilings — percentages
 * and progress bars fill against these values.
 *
 *   - Opus 4.7:   1,000,000 tokens (1M context)
 *   - Opus 4.6:     200,000 tokens
 *   - Sonnet 4.6:   200,000 tokens
 *   - Haiku 4.5:    200,000 tokens
 *
 * Color bands and handoff signalling are driven by absolute token counts
 * (see HANDOFF_THRESHOLDS below), so a 1M-capable model still turns yellow
 * at 200K and red at 300K even though its percentage is only 20-30%.
 */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-7': 1000000,
  'claude-opus-4-6': 200000,
  'claude-sonnet-4-6': 200000,
  'claude-sonnet-4-5': 200000,
  'claude-haiku-4-5': 200000,
  'claude-haiku-4-5-20251001': 200000,
  'default': 200000,
};

// Back-compat alias — some older call sites reference this name.
export const MODEL_HARD_LIMITS = MODEL_CONTEXT_LIMITS;

/**
 * Absolute token thresholds that drive UI color bands and handoff warnings.
 * These are INDEPENDENT of model hard limit — 200K is the handoff target on
 * every model, even ones that can technically hold more.
 */
export const HANDOFF_THRESHOLDS = {
  yellow: 200000,    // entering yellow zone — start thinking about handoff
  red: 300000,       // entering red zone — handoff now
  critical: 350000,  // hard advisory — conversation quality falls off cliff
} as const;

/**
 * Get the hard context limit for a model, with regex fallback for unknown
 * model strings. This is the denominator for the progress bar percentage.
 */
export function getModelContextLimit(model: string): number {
  if (MODEL_CONTEXT_LIMITS[model]) return MODEL_CONTEXT_LIMITS[model];
  if (/opus-4-7/i.test(model)) return 1000000;
  if (/opus/i.test(model)) return 200000;
  if (/sonnet/i.test(model)) return 200000;
  if (/haiku/i.test(model)) return 200000;
  return MODEL_CONTEXT_LIMITS['default'];
}

// Back-compat alias (same implementation as getModelContextLimit).
export const getModelHardLimit = getModelContextLimit;

/**
 * Pick the color band for a token count based on absolute thresholds.
 * Returns 'green' | 'yellow' | 'red'.
 */
export function tokenColorBand(usedTokens: number): 'green' | 'yellow' | 'red' {
  if (usedTokens < HANDOFF_THRESHOLDS.yellow) return 'green';
  if (usedTokens < HANDOFF_THRESHOLDS.red) return 'yellow';
  return 'red';
}

/**
 * Calculate context usage percentage from token counts.
 * Context window fill = input-side tokens of the latest API call only.
 * output_tokens is a cost metric, not a context-fill metric.
 */
export function calculateContextUsage(
  inputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
  _outputTokens: number,  // kept for back-compat but not added to context fill
  maxTokens: number = 200000
): { usedTokens: number; percentage: number } {
  const usedTokens = inputTokens + cacheCreationTokens + cacheReadTokens;
  const percentage = Math.min(100, (usedTokens / maxTokens) * 100);
  return { usedTokens, percentage };
}

/**
 * Convert project path to Claude's project directory format
 * Example: /home/hercules/foo → -home-hercules-foo
 */
export function pathToProjectDir(projectPath: string): string {
  return projectPath.replace(/\//g, '-').replace(/^-/, '');
}

/**
 * Convert Claude's project directory format back to path
 * Example: -home-hercules-foo → /home/hercules/foo
 */
export function projectDirToPath(projectDir: string): string {
  return '/' + projectDir.replace(/^-/, '').replace(/-/g, '/');
}

// ─── Agent / subagent metrics types ───────────────────────────────────────────

export interface AgentUsageMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** 0–1: cacheRead / (input + cacheCreation + cacheRead) */
  cacheHitRate: number;
  turnCount: number;
  totalCost?: number;  // optional estimated $
}

export interface AgentSession {
  sessionId: string;
  model: string;
  parentWindowId: string | null;   // may be null if unknown
  parentSessionId: string | null;  // parent JSONL session
  agentType?: string;
  spawnedAt: number;
  lastUpdated: number;
  usage: AgentUsageMetrics;
  status: 'active' | 'completed' | 'unknown';
}

export interface WindowMetrics {
  windowId: string;
  mainSession: ContextUsage | null;
  agentSessions: AgentSession[];
  aggregated: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheCreationTokens: number;
    totalCacheReadTokens: number;
    aggregateCacheHitRate: number;
    agentCount: number;
    activeAgents: number;
  };
  lastUpdated: number;
}

// Metrics WebSocket messages (Client → Server)
export interface MetricsSubscribeMessage {
  type: 'metrics:subscribe';
  windowId: string;
}

export interface MetricsUnsubscribeMessage {
  type: 'metrics:unsubscribe';
  windowId: string;
}

// Metrics WebSocket messages (Server → Client)
export interface MetricsSyncMessage {
  type: 'metrics:sync';
  windowId: string;
  metrics: WindowMetrics | null;
}

export interface MetricsUpdateMessage {
  type: 'metrics:update';
  windowId: string;
  metrics: WindowMetrics;
}

export type MetricsClientMessage = MetricsSubscribeMessage | MetricsUnsubscribeMessage;
export type MetricsServerMessage = MetricsSyncMessage | MetricsUpdateMessage;
