import { describe, it, expect } from 'vitest';
import {
  calculateContextUsage,
  getModelContextLimit,
  MODEL_CONTEXT_LIMITS,
} from '../contextProtocol';

describe('calculateContextUsage', () => {
  it('includes input, cache-creation, and cache-read tokens in used count', () => {
    const { usedTokens } = calculateContextUsage(10000, 5000, 3000, 999, 200000);
    expect(usedTokens).toBe(18000);
  });

  it('does NOT include output tokens in used tokens — regression guard', () => {
    const { usedTokens: withOutput } = calculateContextUsage(10000, 0, 0, 50000, 200000);
    const { usedTokens: withoutOutput } = calculateContextUsage(10000, 0, 0, 0, 200000);
    expect(withOutput).toBe(withoutOutput);
    expect(withOutput).toBe(10000);
  });

  it('calculates percentage correctly', () => {
    const { percentage } = calculateContextUsage(100000, 0, 0, 0, 200000);
    expect(percentage).toBeCloseTo(50, 1);
  });

  it('caps percentage at 100 even if tokens exceed maxTokens', () => {
    const { percentage } = calculateContextUsage(300000, 0, 0, 0, 200000);
    expect(percentage).toBe(100);
  });

  it('returns zero percentage for zero tokens', () => {
    const { usedTokens, percentage } = calculateContextUsage(0, 0, 0, 0, 200000);
    expect(usedTokens).toBe(0);
    expect(percentage).toBe(0);
  });

  it('uses default maxTokens of 200000 when not provided', () => {
    const { percentage } = calculateContextUsage(200000, 0, 0, 0);
    expect(percentage).toBe(100);
  });

  it('sums all three input-side components correctly', () => {
    const { usedTokens, percentage } = calculateContextUsage(40000, 60000, 100000, 0, 200000);
    expect(usedTokens).toBe(200000);
    expect(percentage).toBe(100);
  });
});

describe('getModelContextLimit', () => {
  it('returns correct limit for exact model string match', () => {
    // Opus 4.7 has a 1M context window; Sonnet/Haiku stay at 200K
    expect(getModelContextLimit('claude-opus-4-7')).toBe(1000000);
    expect(getModelContextLimit('claude-sonnet-4-6')).toBe(200000);
    expect(getModelContextLimit('claude-haiku-4-5')).toBe(200000);
  });

  it('returns limit via regex fallback for unknown model with "opus"', () => {
    const limit = getModelContextLimit('claude-opus-99-future');
    expect(limit).toBe(200000);
  });

  it('returns limit via regex fallback for unknown model with "sonnet"', () => {
    const limit = getModelContextLimit('claude-sonnet-99-future');
    expect(limit).toBe(200000);
  });

  it('returns limit via regex fallback for unknown model with "haiku"', () => {
    const limit = getModelContextLimit('claude-haiku-99-future');
    expect(limit).toBe(200000);
  });

  it('returns default limit for completely unknown model', () => {
    const limit = getModelContextLimit('gpt-4-turbo-unknown');
    expect(limit).toBe(MODEL_CONTEXT_LIMITS['default']);
  });

  it('is case-insensitive for regex fallback', () => {
    expect(getModelContextLimit('CLAUDE-OPUS-SOMETHING')).toBe(200000);
  });
});
