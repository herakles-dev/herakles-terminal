/**
 * CliUsageParser - Lightweight PTY output scanner for Claude Code activity signals
 *
 * Scans raw pty data (with ANSI escape codes) for Claude Code activity markers.
 * This is BEST-EFFORT supplementary data — JSONL remains the source of truth.
 * Parser never throws; returns null on no match.
 *
 * Detected patterns:
 *   - Agent spawn markers (subagent launched)
 *   - Token count status lines (fast UI update before JSONL debounce)
 *   - Model identification hints
 */

import { logger } from '../utils/logger.js';

// Strip ANSI escape codes (CSI sequences, OSC, and standalone ESC sequences)
const ANSI_RE = /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07]*(?:\x07|\x1b\\)|[^\[\\])|[\r]/g;

/**
 * Result of a successful CLI parse.
 * All fields are optional — only what was detected will be populated.
 */
export interface ParsedUsage {
  windowId: string;
  /** True when an agent spawn marker was detected in this chunk */
  agentSpawnDetected?: boolean;
  /** Raw description of detected spawn (e.g., "Spawning subagent") */
  agentSpawnDescription?: string;
  /** Token count detected in a status line */
  tokenCount?: number;
  /** Model string hint from CLI output */
  model?: string;
}

// ── Patterns ────────────────────────────────────────────────────────────────

/**
 * Agent spawn markers — Claude Code announces subagent work with lines like:
 *   "Spawning agent..."
 *   "Launching subagent"
 *   "Running agent: ..."
 *   "Agent started"
 *   "Starting subagent"
 */
const AGENT_SPAWN_RE = /(?:spawning|launching|running|starting)\s+(?:sub)?agent/i;

/**
 * Token count line — Claude Code status bars may show:
 *   "Context: 45,123 tokens"
 *   "Tokens: 12,345"
 *   "45123 tokens used"
 *   "45,123 / 200,000 tokens"
 */
const TOKEN_COUNT_RE = /(?:context|tokens?)[:\s]+([0-9][0-9,]*)\s*(?:\/\s*[0-9][0-9,]*\s*)?tokens?/i;

/**
 * Simpler fallback: standalone number before "tokens" or "tok"
 *   "45,123 tokens"
 */
const TOKEN_BARE_RE = /([0-9][0-9,]{2,})\s+tok/i;

/**
 * Model hint — lines like "Using model claude-sonnet-4-6" or "Model: claude-opus-4-7"
 */
const MODEL_RE = /(?:using\s+model|model[:\s]+)\s*(claude-[a-z0-9-]+)/i;

// ── Class ────────────────────────────────────────────────────────────────────

export class CliUsageParser {
  /**
   * Scan a chunk of raw pty data for Claude Code activity signals.
   *
   * @param data    Raw pty output (may contain ANSI escape codes)
   * @param windowId  The terminal window this data belongs to
   * @returns ParsedUsage if any pattern matched, null otherwise
   */
  scan(data: string, windowId: string): ParsedUsage | null {
    try {
      // Strip ANSI codes for clean text matching
      const text = data.replace(ANSI_RE, '');

      if (!text.trim()) return null;

      let matched = false;
      const result: ParsedUsage = { windowId };

      // 1. Agent spawn detection
      if (AGENT_SPAWN_RE.test(text)) {
        const spawnMatch = text.match(AGENT_SPAWN_RE);
        result.agentSpawnDetected = true;
        result.agentSpawnDescription = spawnMatch ? spawnMatch[0].trim() : 'agent spawn';
        matched = true;
        logger.debug('CliUsageParser: agent spawn signal detected', {
          windowId,
          description: result.agentSpawnDescription,
        });
      }

      // 2. Token count detection (try primary pattern, then fallback)
      const tokenMatch = text.match(TOKEN_COUNT_RE) || text.match(TOKEN_BARE_RE);
      if (tokenMatch) {
        const rawCount = tokenMatch[1].replace(/,/g, '');
        const count = parseInt(rawCount, 10);
        if (!isNaN(count) && count > 0) {
          result.tokenCount = count;
          matched = true;
          logger.debug('CliUsageParser: token count detected', { windowId, tokenCount: count });
        }
      }

      // 3. Model hint detection
      const modelMatch = text.match(MODEL_RE);
      if (modelMatch) {
        result.model = modelMatch[1].toLowerCase();
        matched = true;
        logger.debug('CliUsageParser: model hint detected', { windowId, model: result.model });
      }

      return matched ? result : null;
    } catch {
      // Parser is best-effort — swallow all errors silently
      return null;
    }
  }
}

/**
 * Singleton instance — one parser shared across all window PTY listeners.
 */
export const cliUsageParser = new CliUsageParser();
