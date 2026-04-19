import { describe, it, expect, beforeEach } from 'vitest';
import { CliUsageParser } from '../CliUsageParser.js';

describe('CliUsageParser', () => {
  let parser: CliUsageParser;

  beforeEach(() => {
    parser = new CliUsageParser();
  });

  // ── ANSI stripping ───────────────────────────────────────────────────────────

  it('strips ANSI codes before matching patterns', () => {
    // Embed agent spawn text inside ANSI escape sequences
    const ansiWrapped = '\x1b[32mSpawning agent\x1b[0m in background';
    const result = parser.scan(ansiWrapped, 'w1');
    expect(result).not.toBeNull();
    expect(result?.agentSpawnDetected).toBe(true);
  });

  it('strips CSI color codes that would break token number matching', () => {
    const ansiWrapped = '\x1b[33mContext: 45,000 tokens\x1b[0m';
    const result = parser.scan(ansiWrapped, 'w1');
    expect(result).not.toBeNull();
    expect(result?.tokenCount).toBe(45000);
  });

  it('strips carriage returns before matching', () => {
    const withCR = 'Context: 10,000 tokens\r\n';
    const result = parser.scan(withCR, 'w1');
    expect(result).not.toBeNull();
    expect(result?.tokenCount).toBe(10000);
  });

  // ── Null on no match ─────────────────────────────────────────────────────────

  it('returns null for empty input', () => {
    expect(parser.scan('', 'w1')).toBeNull();
  });

  it('returns null for whitespace-only input', () => {
    expect(parser.scan('   \n\t  ', 'w1')).toBeNull();
  });

  it('returns null when no patterns match', () => {
    expect(parser.scan('Just a normal terminal line with nothing special.', 'w1')).toBeNull();
  });

  it('never throws for random input', () => {
    const inputs = [
      null as unknown as string,
      undefined as unknown as string,
      ''.padStart(10000, '\x1b[0m'),
      '{{{{invalid json}}}',
      '\x00\xFF\xFE binary',
    ];
    for (const input of inputs) {
      expect(() => parser.scan(input, 'w1')).not.toThrow();
    }
  });

  // ── Agent spawn detection ────────────────────────────────────────────────────

  it('detects "Spawning agent" marker', () => {
    const result = parser.scan('Spawning agent in the background...', 'w1');
    expect(result?.agentSpawnDetected).toBe(true);
    expect(result?.agentSpawnDescription).toBeTruthy();
  });

  it('detects "Launching subagent" marker', () => {
    const result = parser.scan('Launching subagent for parallel task', 'w1');
    expect(result?.agentSpawnDetected).toBe(true);
  });

  it('detects "Running agent" marker', () => {
    const result = parser.scan('Running agent: code-review', 'w1');
    expect(result?.agentSpawnDetected).toBe(true);
  });

  it('detects "Starting subagent" marker', () => {
    const result = parser.scan('Starting subagent...', 'w1');
    expect(result?.agentSpawnDetected).toBe(true);
  });

  it('is case-insensitive for agent spawn', () => {
    const result = parser.scan('SPAWNING AGENT NOW', 'w1');
    expect(result?.agentSpawnDetected).toBe(true);
  });

  it('does NOT flag non-spawn lines as agent spawn', () => {
    const result = parser.scan('Context: 50,000 tokens', 'w1');
    expect(result?.agentSpawnDetected).toBeUndefined();
  });

  it('includes windowId in result', () => {
    const result = parser.scan('Spawning agent', 'window-42');
    expect(result?.windowId).toBe('window-42');
  });

  // ── Token count detection ────────────────────────────────────────────────────

  it('detects "Context: N tokens" pattern', () => {
    const result = parser.scan('Context: 45,123 tokens', 'w1');
    expect(result?.tokenCount).toBe(45123);
  });

  it('detects "Tokens: N tokens" full pattern', () => {
    const result = parser.scan('Tokens: 12,345 tokens used', 'w1');
    expect(result?.tokenCount).toBe(12345);
  });

  it('detects "N tokens used" pattern', () => {
    const result = parser.scan('45123 tokens used', 'w1');
    expect(result?.tokenCount).toBe(45123);
  });

  it('detects a number before "tokens" via bare fallback pattern', () => {
    // TOKEN_BARE_RE matches the standalone number before "tok"
    const result = parser.scan('200,000 tokens remaining', 'w1');
    expect(result?.tokenCount).toBe(200000);
  });

  it('detects bare token count fallback (TOKEN_BARE_RE)', () => {
    const result = parser.scan('Used 55,000 tok today', 'w1');
    expect(result?.tokenCount).toBe(55000);
  });

  it('strips commas from token numbers', () => {
    const result = parser.scan('Context: 100,000 tokens', 'w1');
    expect(result?.tokenCount).toBe(100000);
  });

  // ── Model hint detection ─────────────────────────────────────────────────────

  it('detects "Using model claude-..." pattern', () => {
    const result = parser.scan('Using model claude-sonnet-4-6 for this session', 'w1');
    expect(result?.model).toBe('claude-sonnet-4-6');
  });

  it('detects "Model: claude-..." pattern', () => {
    const result = parser.scan('Model: claude-opus-4-7', 'w1');
    expect(result?.model).toBe('claude-opus-4-7');
  });

  it('lowercases model string', () => {
    const result = parser.scan('Using model Claude-Opus-4-7', 'w1');
    expect(result?.model).toBe(result?.model?.toLowerCase());
  });

  // ── Multi-pattern lines ──────────────────────────────────────────────────────

  it('can detect both agent spawn and model hint in the same line', () => {
    const result = parser.scan('Spawning agent using model claude-opus-4-7', 'w1');
    expect(result?.agentSpawnDetected).toBe(true);
    expect(result?.model).toBe('claude-opus-4-7');
  });

  // ── Malformed input ──────────────────────────────────────────────────────────

  it('handles extremely long input without throwing', () => {
    const longInput = 'a'.repeat(100000) + 'Context: 1,000 tokens';
    const result = parser.scan(longInput, 'w1');
    expect(result?.tokenCount).toBe(1000);
  });

  it('returns null for input with only ANSI codes and no matching text', () => {
    const onlyAnsi = '\x1b[0m\x1b[32m\x1b[1m\x1b[K\x1b[?25l';
    const result = parser.scan(onlyAnsi, 'w1');
    expect(result).toBeNull();
  });
});
