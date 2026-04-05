import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OutputPipelineManager } from '../OutputPipelineManager';

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

  describe('Ink redraw coalescing', () => {
    it('detectInkRedraw matches erase+home sequence', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // Seed
      pipeline.enqueue('window-1', 'seed');
      vi.advanceTimersByTime(1100);
      onFlush.mockClear();

      // Ink redraw: \x1b[2J (erase display) + \x1b[H (cursor home)
      const inkRedraw = '\x1b[2J\x1b[Hsome content here';
      pipeline.enqueue('window-1', inkRedraw);

      vi.advanceTimersByTime(24);

      expect(onFlush).toHaveBeenCalledTimes(1);
    });

    it('replaces buffer during rapid Ink redraws', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // All three redraws arrive before the flush timer fires (within same tick).
      // The Ink coalescing detects rapid erase+home and replaces the buffer.
      const redraw1 = '\x1b[2J\x1b[HFrame 1';
      pipeline.enqueue('window-1', redraw1);

      // Simulate rapid redraws within <50ms (no timer advance between enqueues)
      const redraw2 = '\x1b[2J\x1b[HFrame 2';
      pipeline.enqueue('window-1', redraw2);

      const redraw3 = '\x1b[2J\x1b[HFrame 3';
      pipeline.enqueue('window-1', redraw3);

      // Flush — should only see the LAST frame (Frame 3)
      flushTimers();

      const flushedData = onFlush.mock.calls.map(c => c[1]).join('');
      expect(flushedData).toContain('Frame 3');
      expect(flushedData).not.toContain('Frame 1');
    });

    it('does not coalesce redraws >50ms apart', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // First Ink redraw
      const redraw1 = '\x1b[2J\x1b[HFrame 1';
      pipeline.enqueue('window-1', redraw1);

      // Flush first frame
      flushTimers();
      expect(onFlush).toHaveBeenCalledTimes(1);
      onFlush.mockClear();

      // Second redraw >50ms later — should NOT replace
      vi.advanceTimersByTime(100);
      const redraw2 = '\x1b[2J\x1b[HFrame 2';
      pipeline.enqueue('window-1', redraw2);

      flushTimers();
      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(onFlush).toHaveBeenCalledWith('window-1', redraw2);
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
});
