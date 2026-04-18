import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OutputPipelineManager, filterOutputPreservingSpinners } from '../OutputPipelineManager';

describe('OutputPipelineManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Flush pending setTimeout(0) timers — pipeline uses setTimeout for all scheduling. */
  const flushTimers = () => {
    vi.advanceTimersByTime(1);
  };

  it('enqueue buffers data correctly', () => {
    const onFlush = vi.fn();
    const pipeline = new OutputPipelineManager(onFlush);

    pipeline.enqueue('window-1', 'hello');
    pipeline.enqueue('window-1', ' world');

    expect(onFlush).not.toHaveBeenCalled();

    flushTimers();

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith('window-1', 'hello world');
  });

  it('flush returns and clears buffer', () => {
    const onFlush = vi.fn();
    const pipeline = new OutputPipelineManager(onFlush);

    pipeline.enqueue('window-1', 'test data');
    const flushed = pipeline.flush('window-1');

    expect(flushed).toBe('test data');

    flushTimers();
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('resize pending routes to separate buffer', () => {
    const onFlush = vi.fn();
    const pipeline = new OutputPipelineManager(onFlush);

    pipeline.setResizePending('window-1', true);
    pipeline.enqueue('window-1', 'during resize');

    flushTimers();
    expect(onFlush).not.toHaveBeenCalled();

    expect(pipeline.isResizePending('window-1')).toBe(true);
  });

  it('setResizePending(false) merges buffers', () => {
    const onFlush = vi.fn();
    const pipeline = new OutputPipelineManager(onFlush);

    pipeline.enqueue('window-1', 'before');
    flushTimers();
    expect(onFlush).toHaveBeenCalledWith('window-1', 'before');
    onFlush.mockClear();

    pipeline.setResizePending('window-1', true);
    pipeline.enqueue('window-1', 'during');

    pipeline.setResizePending('window-1', false);

    flushTimers();
    expect(onFlush).toHaveBeenCalledWith('window-1', 'during');
  });

  it('timer scheduling coalesces rapid enqueues', () => {
    const onFlush = vi.fn();
    const pipeline = new OutputPipelineManager(onFlush);

    pipeline.enqueue('window-1', 'a');
    pipeline.enqueue('window-1', 'b');
    pipeline.enqueue('window-1', 'c');
    pipeline.enqueue('window-1', 'd');

    // With coalesced scheduling, the timer is scheduled once and subsequent
    // enqueues just add to the buffer without canceling/rescheduling.

    flushTimers();

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith('window-1', 'abcd');
  });

  it('handles multiple windows independently', () => {
    const onFlush = vi.fn();
    const pipeline = new OutputPipelineManager(onFlush);

    pipeline.enqueue('window-1', 'first');
    pipeline.enqueue('window-2', 'second');

    flushTimers();

    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenCalledWith('window-1', 'first');
    expect(onFlush).toHaveBeenCalledWith('window-2', 'second');
  });

  it('clear removes window state', () => {
    const onFlush = vi.fn();
    const pipeline = new OutputPipelineManager(onFlush);

    pipeline.enqueue('window-1', 'data');
    pipeline.clear('window-1');

    flushTimers();
    expect(onFlush).not.toHaveBeenCalled();

    const stats = pipeline.getStats();
    expect(stats.windowCount).toBe(0);
  });

  it('clearAll removes all window states', () => {
    const onFlush = vi.fn();
    const pipeline = new OutputPipelineManager(onFlush);

    pipeline.enqueue('window-1', 'data1');
    pipeline.enqueue('window-2', 'data2');
    pipeline.clearAll();

    flushTimers();
    expect(onFlush).not.toHaveBeenCalled();

    const stats = pipeline.getStats();
    expect(stats.windowCount).toBe(0);
  });

  it('getStats returns correct counts', () => {
    const onFlush = vi.fn();
    const pipeline = new OutputPipelineManager(onFlush);

    pipeline.enqueue('window-1', '12345');
    pipeline.enqueue('window-2', '123');
    pipeline.setResizePending('window-3', true);
    pipeline.enqueue('window-3', '12');

    const stats = pipeline.getStats();
    expect(stats.windowCount).toBe(3);
    expect(stats.totalBuffered).toBe(10);
  });

  it('flush returns empty string for unknown window', () => {
    const onFlush = vi.fn();
    const pipeline = new OutputPipelineManager(onFlush);

    const result = pipeline.flush('unknown');
    expect(result).toBe('');
  });

  it('isResizePending returns false for unknown window', () => {
    const onFlush = vi.fn();
    const pipeline = new OutputPipelineManager(onFlush);

    expect(pipeline.isResizePending('unknown')).toBe(false);
  });

  describe('restore mode', () => {
    it('setRestoreInProgress(true) clears all buffers', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.enqueue('window-1', 'main buffer data');
      pipeline.setResizePending('window-1', true);
      pipeline.enqueue('window-1', 'resize buffer data');

      const statsBefore = pipeline.getStats();
      expect(statsBefore.totalBuffered).toBeGreaterThan(0);

      pipeline.setRestoreInProgress('window-1', true);

      const statsAfter = pipeline.getStats();
      expect(statsAfter.totalBuffered).toBe(0);
    });

    it('setRestoreInProgress(true) cancels pending flush', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.enqueue('window-1', 'data');
      pipeline.setRestoreInProgress('window-1', true);

      flushTimers();
      expect(onFlush).not.toHaveBeenCalled();
    });

    it('enqueue discards data during restore mode', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.setRestoreInProgress('window-1', true);
      pipeline.enqueue('window-1', 'should be discarded');

      pipeline.setRestoreInProgress('window-1', false);

      flushTimers();
      expect(onFlush).not.toHaveBeenCalled();

      const stats = pipeline.getStats();
      expect(stats.totalBuffered).toBe(0);
    });

    it('isRestoreInProgress returns correct state', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      expect(pipeline.isRestoreInProgress('window-1')).toBe(false);

      pipeline.setRestoreInProgress('window-1', true);
      expect(pipeline.isRestoreInProgress('window-1')).toBe(true);

      pipeline.setRestoreInProgress('window-1', false);
      expect(pipeline.isRestoreInProgress('window-1')).toBe(false);
    });

    it('isRestoreInProgress returns false for unknown window', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      expect(pipeline.isRestoreInProgress('unknown')).toBe(false);
    });

    it('normal operation resumes after exiting restore mode', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.setRestoreInProgress('window-1', true);
      pipeline.enqueue('window-1', 'discarded');

      pipeline.setRestoreInProgress('window-1', false);

      pipeline.enqueue('window-1', 'normal data');

      flushTimers();
      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(onFlush).toHaveBeenCalledWith('window-1', 'normal data');
    });

    it('restore mode is independent per window', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.setRestoreInProgress('window-1', true);
      pipeline.enqueue('window-1', 'discarded for window-1');
      pipeline.enqueue('window-2', 'kept for window-2');

      flushTimers();
      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(onFlush).toHaveBeenCalledWith('window-2', 'kept for window-2');
    });

    it('entering restore mode during resize clears resize buffer too', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.setResizePending('window-1', true);
      pipeline.enqueue('window-1', 'resize data');

      pipeline.setRestoreInProgress('window-1', true);

      pipeline.setResizePending('window-1', false);

      flushTimers();
      expect(onFlush).not.toHaveBeenCalled();
    });
  });

  describe('forced throttle mode', () => {
    it('should apply forced throttle mode when set', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.setForcedThrottleMode('critical');
      pipeline.enqueue('window-1', 'data');

      expect(onFlush).not.toHaveBeenCalled();

      vi.advanceTimersByTime(200);
      expect(onFlush).toHaveBeenCalledWith('window-1', 'data');
    });

    it('should use most conservative mode between forced and calculated', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.setForcedThrottleMode('light');
      pipeline.enqueue('window-1', 'small data');

      expect(onFlush).not.toHaveBeenCalled();

      vi.advanceTimersByTime(32);
      expect(onFlush).toHaveBeenCalledTimes(1);
    });

    it('should prefer calculated mode if more conservative than forced', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.setForcedThrottleMode('light');

      const largeData = 'x'.repeat(600_000);
      pipeline.enqueue('window-1', largeData);

      expect(onFlush).not.toHaveBeenCalled();

      vi.advanceTimersByTime(32);
      expect(onFlush).not.toHaveBeenCalled();

      vi.advanceTimersByTime(168); // Total 200ms
      expect(onFlush).toHaveBeenCalledTimes(1);
    });

    it('should clear forced mode when set to undefined', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.setForcedThrottleMode('heavy');
      pipeline.enqueue('window-1', 'data1');

      vi.advanceTimersByTime(100);
      expect(onFlush).toHaveBeenCalledWith('window-1', 'data1');

      onFlush.mockClear();

      pipeline.setForcedThrottleMode(undefined);
      pipeline.enqueue('window-1', 'data2');

      // Normal mode = setTimeout(0)
      flushTimers();

      expect(onFlush).toHaveBeenCalledWith('window-1', 'data2');
    });

    it('should handle mode transitions correctly', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.setForcedThrottleMode('light');
      pipeline.enqueue('window-1', 'data1');

      vi.advanceTimersByTime(32);
      expect(onFlush).toHaveBeenCalledWith('window-1', 'data1');

      onFlush.mockClear();

      pipeline.setForcedThrottleMode('critical');
      pipeline.enqueue('window-1', 'data2');

      vi.advanceTimersByTime(100);
      expect(onFlush).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100); // Total 200ms
      expect(onFlush).toHaveBeenCalledWith('window-1', 'data2');
    });
  });

  describe('lowered throttle thresholds', () => {
    it('should activate light throttle at 25KB/s', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // Seed the throttle window: enqueue small data, advance 1s to reset
      pipeline.enqueue('window-1', 'seed');
      vi.advanceTimersByTime(1100);
      onFlush.mockClear();

      // Now enqueue 25KB — with fresh window, rate = 25KB/s → light throttle
      const data = 'x'.repeat(25_000);
      pipeline.enqueue('window-1', data);

      // Light mode uses 24ms setTimeout
      expect(onFlush).not.toHaveBeenCalled();

      vi.advanceTimersByTime(24);
      expect(onFlush).toHaveBeenCalledTimes(1);
    });

    it('should use normal mode (setTimeout 0) at 15KB/s', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // Seed the throttle window
      pipeline.enqueue('window-1', 'seed');
      vi.advanceTimersByTime(1100);
      onFlush.mockClear();

      // 15KB — below 20KB/s threshold → normal mode (setTimeout 0)
      const data = 'x'.repeat(15_000);
      pipeline.enqueue('window-1', data);

      // Normal mode flushes on next tick
      flushTimers();
      expect(onFlush).toHaveBeenCalledTimes(1);
    });
  });

  describe('Ink redraw coalescing — I-03 extended sequences', () => {
    // POSITIVE: must trigger buffer replacement (coalescing)
    it('I-03: enter-alt-buffer (\\x1b[?1049h) triggers coalescing', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.enqueue('window-1', 'prior output');
      pipeline.enqueue('window-1', '\x1b[?1049h\x1b[HFrame A');

      vi.advanceTimersByTime(25);
      const flushed = onFlush.mock.calls.map(c => c[1]).join('');
      // Buffer must be replaced — prior output discarded
      expect(flushed).toContain('Frame A');
      expect(flushed).not.toContain('prior output');
    });

    it('I-03: erase-saved-lines (\\x1b[3J) triggers coalescing', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.enqueue('window-1', 'prior output');
      pipeline.enqueue('window-1', '\x1b[3J\x1b[HFrame B');

      vi.advanceTimersByTime(25);
      const flushed = onFlush.mock.calls.map(c => c[1]).join('');
      expect(flushed).toContain('Frame B');
      expect(flushed).not.toContain('prior output');
    });

    it('I-03: RIS (\\x1bc) triggers coalescing', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.enqueue('window-1', 'prior output');
      pipeline.enqueue('window-1', '\x1bcFrame C');

      vi.advanceTimersByTime(25);
      const flushed = onFlush.mock.calls.map(c => c[1]).join('');
      expect(flushed).toContain('Frame C');
      expect(flushed).not.toContain('prior output');
    });

    it('I-03: multiple \\x1b[?1049h frames — only latest buffer survives', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.enqueue('window-1', '\x1b[?1049hFrame X');
      pipeline.enqueue('window-1', '\x1b[?1049hFrame Y');
      pipeline.enqueue('window-1', '\x1b[?1049hFrame Z');

      flushTimers();
      const flushed = onFlush.mock.calls.map(c => c[1]).join('');
      expect(flushed).toContain('Frame Z');
      expect(flushed).not.toContain('Frame X');
      expect(flushed).not.toContain('Frame Y');
    });

    // NEGATIVE: exit-alt-buffer MUST NOT trigger coalescing (MC-1)
    it('MC-1: exit-alt-buffer (\\x1b[?1049l) does NOT replace buffer', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // Simulate primary-buffer content buffered before the exit
      pipeline.enqueue('window-1', 'shell prompt $');
      pipeline.enqueue('window-1', '\x1b[?1049lcontent after alt-buffer exit');

      vi.advanceTimersByTime(25);
      const flushed = onFlush.mock.calls.map(c => c[1]).join('');
      // Both must be present — no replacement
      expect(flushed).toContain('shell prompt $');
      expect(flushed).toContain('content after alt-buffer exit');
    });
  });

  describe('Ink redraw coalescing', () => {
    it('detectInkRedraw matches erase+home sequence', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // Ink redraw: \x1b[2J (erase display) + \x1b[H (cursor home)
      const inkRedraw = '\x1b[2J\x1b[Hsome content here';
      pipeline.enqueue('window-1', inkRedraw);

      // First data on fresh window may trigger light throttle (24ms)
      vi.advanceTimersByTime(25);
      expect(onFlush).toHaveBeenCalledTimes(1);
    });

    it('does NOT treat cursor-hide+home (without full clear) as Ink redraw', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // vim/less/htop use ?25l + cursor home without \x1b[2J — must NOT replace buffer
      pipeline.enqueue('window-1', 'prior output');
      const tuiFrame = '\x1b[?25l\x1b[H statusline content \x1b[?25h';
      pipeline.enqueue('window-1', tuiFrame);

      vi.advanceTimersByTime(25);
      const flushed = onFlush.mock.calls.map(c => c[1]).join('');
      // Prior output must be preserved (not replaced)
      expect(flushed).toContain('prior output');
      expect(flushed).toContain('statusline content');
    });

    it('always replaces buffer for Ink redraws (prevents stale frame coalescing)', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // Three Ink redraws arrive before flush fires — each replaces the previous
      pipeline.enqueue('window-1', '\x1b[2J\x1b[HFrame 1');
      pipeline.enqueue('window-1', '\x1b[2J\x1b[HFrame 2');
      pipeline.enqueue('window-1', '\x1b[2J\x1b[HFrame 3');

      flushTimers();

      const flushedData = onFlush.mock.calls.map(c => c[1]).join('');
      expect(flushedData).toContain('Frame 3');
      expect(flushedData).not.toContain('Frame 1');
      expect(flushedData).not.toContain('Frame 2');
    });

    it('replaces buffer even for redraws >50ms apart', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // First redraw — unflushed (simulating throttle delay)
      pipeline.enqueue('window-1', '\x1b[2J\x1b[HFrame 1');

      // Advance time but DON'T flush (simulating heavy throttle pending)
      // Enqueue second redraw — should REPLACE, not append
      vi.advanceTimersByTime(80);

      // Manually clear the flush that fired at 1ms and enqueue again
      onFlush.mockClear();
      pipeline.enqueue('window-1', '\x1b[2J\x1b[HFrame 2');

      flushTimers();
      const flushedData = onFlush.mock.calls.map(c => c[1]).join('');
      expect(flushedData).toContain('Frame 2');
      expect(flushedData).not.toContain('Frame 1');
    });
  });

  describe('carriage return overwrite', () => {
    it('replaces buffer tail when data starts with \\r', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // First frame (no \r — initial spinner line)
      pipeline.enqueue('window-1', '\u2819 Thinking...');

      // Second frame starts with \r — overwrites the current line
      pipeline.enqueue('window-1', '\r\u2839 Thinking...');

      flushTimers();
      const flushed = onFlush.mock.calls.map(c => c[1]).join('');
      // Should contain only the latest frame (second overwrites first)
      expect(flushed).toContain('\u2839 Thinking...');
      expect(flushed).not.toContain('\u2819');
    });

    it('preserves newline-terminated output before \\r overwrite', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // First: some normal output with newline
      pipeline.enqueue('window-1', 'Build complete\n\u2819 Thinking...');

      // Second: \r overwrite updates spinner on last line
      pipeline.enqueue('window-1', '\r\u2839 Thinking...');

      vi.advanceTimersByTime(25);
      const flushed = onFlush.mock.calls.map(c => c[1]).join('');
      expect(flushed).toContain('Build complete\n');
      expect(flushed).toContain('\u2839 Thinking...');
      expect(flushed).not.toContain('\u2819');
    });

    it('does not replace for \\r\\n (newline, not overwrite)', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.enqueue('window-1', 'line 1');
      pipeline.enqueue('window-1', '\r\nline 2');

      flushTimers();
      expect(onFlush).toHaveBeenCalledWith('window-1', 'line 1\r\nline 2');
    });
  });

  describe('filterOutputPreservingSpinners', () => {
    it('preserves braille spinner characters', () => {
      const input = '\u2819 Thinking...';
      expect(filterOutputPreservingSpinners(input)).toBe(input);
    });

    it('preserves braille with ANSI codes', () => {
      const input = '\x1b[36m\u2819 Thinking...\x1b[0m';
      expect(filterOutputPreservingSpinners(input)).toBe(input);
    });

    it('filters pure dot lines', () => {
      const result = filterOutputPreservingSpinners('...\n....\nreal output');
      expect(result).not.toContain('...');
      expect(result).toContain('real output');
    });

    it('filters dot artifacts but keeps braille in mixed content', () => {
      const input = '....\n\u2819 Thinking...\nmore dots: ....';
      const result = filterOutputPreservingSpinners(input);
      expect(result).toContain('\u2819 Thinking...');
    });

    it('filters dots positioned via cursor sequences (Ink multiline)', () => {
      // Ink renders: cursor-home + spinner line + cursor-position + dot line
      const input = '\x1b[H\u2819 Thinking...\x1b[2;1H....\x1b[3;1Hreal content';
      const result = filterOutputPreservingSpinners(input);
      expect(result).toContain('\u2819 Thinking...');
      expect(result).toContain('real content');
      // Dots between cursor positions should be filtered (replaced with erase-to-EOL)
      expect(result).not.toMatch(/\.\.\.\./);
    });

    it('handles empty input', () => {
      expect(filterOutputPreservingSpinners('')).toBe('');
    });
  });

  describe('throttle thresholds', () => {
    it('should use same thresholds on mobile and desktop (DOM renderer)', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush, { isMobile: true });

      // Seed
      pipeline.enqueue('window-1', 'seed');
      vi.advanceTimersByTime(1100);
      onFlush.mockClear();

      // 15KB/s — below light threshold (20KB/s) → normal mode even on mobile
      const data = 'x'.repeat(15_000);
      pipeline.enqueue('window-1', data);

      // Normal mode flushes on next tick
      flushTimers();
      expect(onFlush).toHaveBeenCalledTimes(1);
    });

    it('should activate light throttle above 20KB/s', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // Seed
      pipeline.enqueue('window-1', 'seed');
      vi.advanceTimersByTime(1100);
      onFlush.mockClear();

      // 25KB/s → light throttle (24ms)
      const data = 'x'.repeat(25_000);
      pipeline.enqueue('window-1', data);

      expect(onFlush).not.toHaveBeenCalled();

      vi.advanceTimersByTime(24);
      expect(onFlush).toHaveBeenCalledTimes(1);
    });
  });

  describe('backpressure callback', () => {
    it('should fire backpressure callback when buffer exceeds 80%', () => {
      const onFlush = vi.fn();
      const onBackpressure = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);
      pipeline.setBackpressureCallback(onBackpressure);

      const largeData = 'x'.repeat(420_000); // ~82% of 512KB
      pipeline.enqueue('window-1', largeData);

      expect(onBackpressure).toHaveBeenCalledWith('window-1', true);
    });

    it('should release backpressure after flush', () => {
      const onFlush = vi.fn();
      const onBackpressure = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);
      pipeline.setBackpressureCallback(onBackpressure);

      const largeData = 'x'.repeat(420_000);
      pipeline.enqueue('window-1', largeData);

      expect(onBackpressure).toHaveBeenCalledWith('window-1', true);
      onBackpressure.mockClear();

      // Flush via critical throttle (200ms delay for large data)
      vi.advanceTimersByTime(200);

      expect(onBackpressure).toHaveBeenCalledWith('window-1', false);
    });
  });

  describe('Sequence tracking during restore/recovery (I-05 / Fb-3)', () => {
    it('Test 1 — restore path: seq does NOT advance for discarded messages', () => {
      const onFlush = vi.fn();
      const onReplayRequest = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);
      pipeline.setReplayRequestCallback(onReplayRequest);

      // Establish a baseline seq
      pipeline.enqueue('window-1', 'normal data', 99);
      flushTimers();
      expect(pipeline.getLastProcessedSeq('window-1')).toBe(99);

      // Enter restore mode — subsequent enqueues are discarded
      pipeline.setRestoreInProgress('window-1', true);
      pipeline.enqueue('window-1', 'foo', 100);
      pipeline.enqueue('window-1', 'bar', 101);
      pipeline.enqueue('window-1', 'baz', 102);

      // Seq must NOT have advanced for discarded messages
      expect(pipeline.getLastProcessedSeq('window-1')).toBe(99);

      // Exiting restore triggers replay request with the last-actually-processed seq
      pipeline.setRestoreInProgress('window-1', false);
      expect(onReplayRequest).toHaveBeenCalledWith('window-1', 99);
    });

    it('Test 2 — recovery path: seq does NOT advance for discarded messages', () => {
      const onFlush = vi.fn();
      const onReplayRequest = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);
      pipeline.setReplayRequestCallback(onReplayRequest);

      // Establish a baseline seq
      pipeline.enqueue('window-1', 'normal data', 50);
      flushTimers();
      expect(pipeline.getLastProcessedSeq('window-1')).toBe(50);

      // Enter recovery mode
      pipeline.setRecoveryInProgress('window-1', true);
      pipeline.enqueue('window-1', 'discarded-a', 51);
      pipeline.enqueue('window-1', 'discarded-b', 52);
      pipeline.enqueue('window-1', 'discarded-c', 53);

      // Seq must NOT have advanced
      expect(pipeline.getLastProcessedSeq('window-1')).toBe(50);

      // Exiting recovery triggers replay with last-actually-processed seq
      pipeline.setRecoveryInProgress('window-1', false);
      expect(onReplayRequest).toHaveBeenCalledWith('window-1', 50);
    });

    it('Test 3 — normal path unaffected: seq advances correctly when no guards active', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.enqueue('window-1', 'data', 50);
      flushTimers();
      expect(pipeline.getLastProcessedSeq('window-1')).toBe(50);

      pipeline.enqueue('window-1', 'data', 51);
      flushTimers();
      expect(pipeline.getLastProcessedSeq('window-1')).toBe(51);

      // Lower seq does not downgrade lastProcessedSeq
      pipeline.enqueue('window-1', 'data', 49);
      flushTimers();
      expect(pipeline.getLastProcessedSeq('window-1')).toBe(51);
    });

    it('Test 4 — mixed: normal → restore → normal tracks seq correctly end-to-end', () => {
      const onFlush = vi.fn();
      const onReplayRequest = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);
      pipeline.setReplayRequestCallback(onReplayRequest);

      // Normal messages advance seq
      pipeline.enqueue('window-1', 'a', 10);
      pipeline.enqueue('window-1', 'b', 11);
      pipeline.enqueue('window-1', 'c', 12);
      flushTimers();
      expect(pipeline.getLastProcessedSeq('window-1')).toBe(12);

      // Restore: discarded messages must NOT advance seq
      pipeline.setRestoreInProgress('window-1', true);
      pipeline.enqueue('window-1', 'discarded', 13);
      pipeline.enqueue('window-1', 'discarded', 14);
      expect(pipeline.getLastProcessedSeq('window-1')).toBe(12);

      // Exiting restore requests replay from seq 12
      pipeline.setRestoreInProgress('window-1', false);
      expect(onReplayRequest).toHaveBeenCalledWith('window-1', 12);

      // Normal messages after restore advance seq again
      pipeline.enqueue('window-1', 'post-restore', 15);
      flushTimers();
      expect(pipeline.getLastProcessedSeq('window-1')).toBe(15);
    });

    it('Test 5 — advanceLastProcessedSeq (replay-response path): advances forward, no rewind', () => {
      // Regression: window:replay-response writes directly to terminal and never
      // goes through enqueue(), so seq tracking must be advanced out-of-band or
      // a subsequent restore/recovery will re-request the same data.
      const onFlush = vi.fn();
      const onReplayRequest = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);
      pipeline.setReplayRequestCallback(onReplayRequest);

      // Baseline: client processed up to seq 50.
      pipeline.enqueue('window-1', 'live', 50);
      flushTimers();
      expect(pipeline.getLastProcessedSeq('window-1')).toBe(50);

      // Restore → replay covers seq 51..55. advanceLastProcessedSeq(toSeq=55)
      // reflects the out-of-band catchup.
      pipeline.advanceLastProcessedSeq('window-1', 55);
      expect(pipeline.getLastProcessedSeq('window-1')).toBe(55);

      // A stale advance below current must not rewind.
      pipeline.advanceLastProcessedSeq('window-1', 42);
      expect(pipeline.getLastProcessedSeq('window-1')).toBe(55);

      // toSeq=0 (server had nothing to replay) is a no-op.
      pipeline.advanceLastProcessedSeq('window-1', 0);
      expect(pipeline.getLastProcessedSeq('window-1')).toBe(55);

      // Subsequent setRestoreInProgress(false) replay requests now start from the
      // post-replay seq, not the stale seq 50.
      pipeline.setRestoreInProgress('window-1', true);
      pipeline.setRestoreInProgress('window-1', false);
      expect(onReplayRequest).toHaveBeenLastCalledWith('window-1', 55);
    });

    it('Test 6 — advanceLastProcessedSeq creates state for previously-unseen windows', () => {
      // Edge case: replay-response may arrive before any live enqueue (e.g. client
      // reconnects after a long idle period). The advance call must not throw.
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      expect(pipeline.getLastProcessedSeq('fresh-window')).toBe(0);
      pipeline.advanceLastProcessedSeq('fresh-window', 42);
      expect(pipeline.getLastProcessedSeq('fresh-window')).toBe(42);
    });
  });

  describe('I-09: throttle window reset ordering (Fb-2 stale-mode latch)', () => {
    // Regression tests for the bug where bytesInWindow was measured over a stale
    // (expired) window, producing an inflated or deflated rate that locked throttle
    // mode incorrectly on the first flush after an idle gap.

    it('first flush after 2s idle resets to normal mode (stale-window latch regression)', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // Build up 80 KB — with a fresh pipeline window (elapsed≈0ms), bytesInWindow=80000
      // and effectiveElapsed=1ms → critical mode (200ms timer).
      const burst = 'x'.repeat(80_000);
      pipeline.enqueue('window-1', burst);

      // Let the critical-mode timer fire, then clear. Now bytesInWindow=80000,
      // windowStartTime is at the original t=0 position.
      vi.advanceTimersByTime(200); // critical timer fires
      onFlush.mockClear();

      // Idle for 2 s — far past the 1 s THROTTLE_WINDOW_MS boundary.
      vi.advanceTimersByTime(2_000);

      // Enqueue a tiny 512-byte message. Old code: bytesPerSec = 80000/2200*1000 ≈ 36 KB/s
      // → light mode (24 ms delay). Fix: windowJustReset=true → bytesPerSec=0 → normal (0 ms).
      const small = 'y'.repeat(512);
      pipeline.enqueue('window-1', small);

      // Normal mode fires on the next tick (≤1 ms), NOT after a throttle delay.
      vi.advanceTimersByTime(1);
      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(onFlush).toHaveBeenCalledWith('window-1', small);
    });

    it('active burst within window still throttles correctly after fix', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // 600 KB in the current window — must still hit critical mode.
      const bigBurst = 'x'.repeat(600_000);
      pipeline.enqueue('window-1', bigBurst);

      // Critical delay is 200 ms — should NOT flush immediately.
      vi.advanceTimersByTime(1);
      expect(onFlush).not.toHaveBeenCalled();

      vi.advanceTimersByTime(199); // Total 200 ms
      expect(onFlush).toHaveBeenCalledTimes(1);
    });

    it('window resets cleanly: first message of new burst flushes at normal, subsequent burst escalates', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // First burst — enqueue 80 KB. Critical mode → 200 ms timer.
      pipeline.enqueue('window-1', 'x'.repeat(80_000));
      vi.advanceTimersByTime(200); // let critical timer fire
      onFlush.mockClear();

      // Idle past window boundary (THROTTLE_WINDOW_MS = 1000 ms).
      vi.advanceTimersByTime(1_500);

      // First message of fresh window: windowJustReset=true → bytesPerSec=0 → normal.
      // Flushes on next tick (setTimeout 0 ≈ 1 ms).
      pipeline.enqueue('window-1', 'x'.repeat(300_000));
      vi.advanceTimersByTime(1);
      expect(onFlush).toHaveBeenCalledTimes(1); // flushed immediately — no throttle delay
      onFlush.mockClear();

      // Second message in the fresh window: scheduleFlush now sees the prior 300 KB
      // accumulated in bytesInWindow (still within the reset window). That rate exceeds
      // BYTES_PER_SEC_CRITICAL → critical mode (200 ms delay).
      pipeline.enqueue('window-1', 'x'.repeat(100));
      vi.advanceTimersByTime(1);
      expect(onFlush).not.toHaveBeenCalled(); // critical delay (200 ms) not yet elapsed
      vi.advanceTimersByTime(199);
      expect(onFlush).toHaveBeenCalledTimes(1);
    });

    it('R-3: bytes preserved across window reset — second burst message throttles correctly', () => {
      // Regression: after a >1s idle, bytesInWindow was zeroed including the current
      // message's bytes. The next message in the same fresh window saw no accumulated
      // bytes and incorrectly stayed in normal mode despite heavy output.
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // Build initial burst — critical mode (200 ms timer)
      pipeline.enqueue('window-1', 'x'.repeat(80_000));
      vi.advanceTimersByTime(200);
      onFlush.mockClear();

      // Idle past the throttle window boundary (1000 ms)
      vi.advanceTimersByTime(1_500);

      // First message of fresh window: 200 KB. windowJustReset=true → normal mode (immediate).
      pipeline.enqueue('window-1', 'x'.repeat(200_000));
      vi.advanceTimersByTime(1);
      expect(onFlush).toHaveBeenCalledTimes(1); // flushed in normal mode
      onFlush.mockClear();

      // R-3 correctness check: bytesInWindow must reflect the 200 KB carried forward.
      // Second message in the fresh window — scheduleFlush sees prior 200 KB accumulated
      // → rate exceeds BYTES_PER_SEC_CRITICAL → critical mode (200 ms delay).
      // Without the fix, bytesInWindow=0 after reset → rate=0 → normal → flushes immediately.
      pipeline.enqueue('window-1', 'x'.repeat(100));
      vi.advanceTimersByTime(1);
      expect(onFlush).not.toHaveBeenCalled(); // must be throttled (critical delay not elapsed)
      vi.advanceTimersByTime(199);
      expect(onFlush).toHaveBeenCalledTimes(1);
    });
  });

  describe('TC-1: seq=0 edge case — first message with seq=0 is processed correctly', () => {
    // Documents invariant: seq=0 data flows through (not discarded). lastProcessedSeq
    // stays 0 after seq=0 because `0 > 0` is false, but the DATA itself is processed.
    // If the server ever sends seq=0 as the first real message, no data is lost.
    it('TC-1: seq=0 message is processed (data flows), lastProcessedSeq stays 0', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // Fresh pipeline — lastProcessedSeq starts at 0
      expect(pipeline.getLastProcessedSeq('window-1')).toBe(0);

      // Enqueue with seq=0 — guard is `seq > lastProcessedSeq` (0 > 0 = false), so
      // lastProcessedSeq does NOT advance, but data is NOT discarded (guard only tracks seq).
      pipeline.enqueue('window-1', 'hello', 0);
      flushTimers();

      // Data must flow through
      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(onFlush).toHaveBeenCalledWith('window-1', 'hello');

      // lastProcessedSeq stays 0 (seq=0 does not satisfy `0 > 0`)
      expect(pipeline.getLastProcessedSeq('window-1')).toBe(0);

      // Next message seq=1 advances the tracker
      pipeline.enqueue('window-1', 'world', 1);
      flushTimers();
      expect(pipeline.getLastProcessedSeq('window-1')).toBe(1);
    });

    it('TC-1: seq=0 is not discarded even while restore is NOT in progress', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // No guards active — seq=0 data must pass through normally
      pipeline.enqueue('window-1', 'first-data', 0);
      flushTimers();
      expect(onFlush).toHaveBeenCalledWith('window-1', 'first-data');
    });
  });

  describe('TC-3: combined 1049h+1049l in same chunk — enter+exit alt-buffer', () => {
    // Documents behaviour when enter-alt-buffer and exit-alt-buffer arrive in the SAME
    // WebSocket chunk (e.g. less/man closing quickly in high-bandwidth tmux pane).
    // detectInkRedraw matches ?1049h first → coalescing triggered → buffer replaced.
    // The exit bytes (?1049l + shell prompt) are included in the replaced buffer and
    // will be written to the terminal — so the shell prompt is NOT lost.
    it('TC-3: chunk with both \\x1b[?1049h and \\x1b[?1049l coalesces (prior output dropped, new chunk kept)', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // Prior output already buffered
      pipeline.enqueue('window-1', 'prior output');

      // Single chunk containing both enter and exit alt-buffer + shell prompt
      const combined = '\x1b[?1049hframe content\x1b[?1049lshell prompt $';
      pipeline.enqueue('window-1', combined);

      vi.advanceTimersByTime(25);
      const flushed = onFlush.mock.calls.map(c => c[1]).join('');

      // detectInkRedraw matches ?1049h → buffer replaced → prior output gone
      expect(flushed).not.toContain('prior output');
      // The combined chunk (including exit + prompt) is what replaces the buffer
      expect(flushed).toContain('shell prompt $');
      expect(flushed).toContain('frame content');
    });

    it('TC-3: two separate chunks — 1049h then 1049l+prompt — prompt is NOT coalesced away', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // Chunk 1: enter alt-buffer (triggers coalescing — prior content replaced)
      pipeline.enqueue('window-1', 'prior output');
      pipeline.enqueue('window-1', '\x1b[?1049hframe content');

      vi.advanceTimersByTime(25);
      onFlush.mockClear();

      // Chunk 2: exit alt-buffer + shell prompt arrives as a NEW message
      // detectInkRedraw must NOT match ?1049l — so no buffer replacement
      pipeline.enqueue('window-1', 'buffered before exit');
      pipeline.enqueue('window-1', '\x1b[?1049lshell prompt $');

      vi.advanceTimersByTime(25);
      const flushed2 = onFlush.mock.calls.map(c => c[1]).join('');

      // Neither message triggers coalescing — both must be present
      expect(flushed2).toContain('shell prompt $');
      expect(flushed2).toContain('buffered before exit');
    });
  });
});
