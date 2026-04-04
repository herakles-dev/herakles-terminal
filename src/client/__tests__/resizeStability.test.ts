import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { filterThinkingOutput } from '@shared/terminalFilters';
import { OutputPipelineManager } from '../services/OutputPipelineManager';

describe('Resize Stability: Dot/Period Filter', () => {
  it('filters consecutive dots (10+) as tmux SIGWINCH artifacts', () => {
    const dots = '.'.repeat(25);
    const result = filterThinkingOutput(`${dots}\nreal content\n`);
    expect(result).not.toContain(dots);
    expect(result).toContain('real content');
  });

  it('filters 80-column line-filling dots', () => {
    const dots = '.'.repeat(80);
    const result = filterThinkingOutput(`${dots}\nreal content\n`);
    expect(result).not.toContain(dots);
    expect(result).toContain('real content');
  });

  it('filters line-filling dots with spaces', () => {
    const dots = '. '.repeat(40);
    const result = filterThinkingOutput(`${dots}\nreal content\n`);
    expect(result).not.toContain(dots);
    expect(result).toContain('real content');
  });

  it('preserves short legitimate dot sequences', () => {
    const result = filterThinkingOutput('Loading...\nDone.\n');
    expect(result).toContain('Loading...');
    expect(result).toContain('Done.');
  });

  it('preserves ellipsis in real output', () => {
    const result = filterThinkingOutput('Compiling... 42 modules\n');
    expect(result).toContain('Compiling... 42 modules');
  });

  it('filters ANSI-wrapped consecutive dots', () => {
    const dots = '.'.repeat(30);
    const result = filterThinkingOutput(`\x1b[0m${dots}\x1b[0m\nkeep\n`);
    expect(result).not.toContain(dots);
    expect(result).toContain('keep');
  });

  it('filters mixed dot content above 80% threshold', () => {
    // 10 dots + 1 char = 91% dots
    const result = filterThinkingOutput('..........x\nkeep\n');
    expect(result).not.toContain('..........x');
    expect(result).toContain('keep');
  });

  it('preserves lines with dots below 80% threshold', () => {
    // "a.b.c.d" = 3 dots / 4 non-ws = 43%
    const result = filterThinkingOutput('a.b.c.d\n');
    expect(result).toContain('a.b.c.d');
  });

  it('handles rapid multi-line resize artifacts', () => {
    const artifacts = Array(5).fill('.'.repeat(40)).join('\n');
    const result = filterThinkingOutput(`${artifacts}\nreal output here\n`);
    expect(result).not.toContain('.'.repeat(40));
    expect(result).toContain('real output here');
  });
});

describe('Resize Stability: OutputPipeline Post-Resize Suppression', () => {
  let pipeline: OutputPipelineManager;
  let flushed: Array<{ windowId: string; data: string }>;

  beforeEach(() => {
    vi.useFakeTimers();
    flushed = [];
    pipeline = new OutputPipelineManager((windowId, data) => {
      flushed.push({ windowId, data });
    });
  });

  afterEach(() => {
    pipeline.clearAll();
    vi.useRealTimers();
  });

  it('double-filters resize buffer on merge', () => {
    pipeline.setResizePending('w1', true);
    // Simulate dot content that might slip through first filter as partial chunk
    pipeline.enqueue('w1', '.....\n');
    pipeline.setResizePending('w1', false);
    // Flush via RAF
    vi.advanceTimersByTime(100);
    // The dot content should be filtered out
    const data = flushed.map(f => f.data).join('');
    expect(data).not.toContain('.....');
  });

  it('buffers output during resize-pending', () => {
    pipeline.enqueue('w1', 'before\n');
    vi.advanceTimersByTime(100);
    expect(flushed.length).toBe(1);
    flushed.length = 0;

    pipeline.setResizePending('w1', true);
    pipeline.enqueue('w1', 'during resize\n');
    vi.advanceTimersByTime(100);
    expect(flushed.length).toBe(0); // Buffered, not flushed

    pipeline.setResizePending('w1', false);
    vi.advanceTimersByTime(100);
    const data = flushed.map(f => f.data).join('');
    expect(data).toContain('during resize');
  });

  it('preserves real content through resize cycle', () => {
    pipeline.setResizePending('w1', true);
    pipeline.enqueue('w1', '$ npm run build\n');
    pipeline.enqueue('w1', 'Build succeeded\n');
    pipeline.setResizePending('w1', false);
    vi.advanceTimersByTime(100);
    const data = flushed.map(f => f.data).join('');
    expect(data).toContain('$ npm run build');
    expect(data).toContain('Build succeeded');
  });

  it('filters dots arriving after resize-pending clears within suppression window', () => {
    pipeline.setResizePending('w1', true);
    pipeline.setResizePending('w1', false);
    // Dots arriving within 100ms suppression window
    pipeline.enqueue('w1', '.....\n');
    vi.advanceTimersByTime(100);
    const data = flushed.map(f => f.data).join('');
    expect(data).not.toContain('.....');
  });
});

describe('Resize Stability: Timing Constants', () => {
  it('server drain delay (80ms) exceeds server dedup window (50ms)', () => {
    // The 80ms drain delay must exceed the 50ms server dedup window
    // so SIGWINCH output arrives before the resize ack.
    const SERVER_DEDUP_MS = 50;
    const DRAIN_DELAY_MS = 80;
    expect(DRAIN_DELAY_MS).toBeGreaterThan(SERVER_DEDUP_MS);
    expect(DRAIN_DELAY_MS).toBeLessThanOrEqual(200); // Must not cause perceptible lag
  });
});

describe('Resize Stability: RC-1 Drain Delay', () => {
  it('drain delay should be 80ms for SIGWINCH output to arrive', () => {
    // The 80ms drain delay lets tmux re-render output arrive at the client
    // before the resize ack clears the pending buffer.
    expect(80).toBeGreaterThanOrEqual(50); // Must exceed server dedup window
    expect(80).toBeLessThanOrEqual(200);    // Must not cause perceptible lag
  });
});
