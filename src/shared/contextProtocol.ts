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

// Union types for message handling
export type ContextClientMessage = ContextSubscribeMessage | ContextUnsubscribeMessage;
export type ContextServerMessage = ContextUpdateMessage | ContextSyncMessage;

// Default context limits by model
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-5-20251101': 200000,
  'claude-sonnet-4-20250514': 200000,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-opus-20240229': 200000,
  'claude-3-sonnet-20240229': 200000,
  'claude-3-haiku-20240307': 200000,
  'default': 200000,
};

/**
 * Calculate context usage percentage from token counts
 */
export function calculateContextUsage(
  inputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
  outputTokens: number,
  maxTokens: number = 200000
): { usedTokens: number; percentage: number } {
  const usedTokens = inputTokens + cacheCreationTokens + cacheReadTokens + outputTokens;
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
