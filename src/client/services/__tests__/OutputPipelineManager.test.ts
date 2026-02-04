import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OutputPipelineManager } from '../OutputPipelineManager';

describe('OutputPipelineManager', () => {
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let rafId: number;
  let originalRAF: typeof requestAnimationFrame;
  let originalCAF: typeof cancelAnimationFrame;

  beforeEach(() => {
    rafCallbacks = new Map();
    rafId = 0;
    originalRAF = globalThis.requestAnimationFrame;
    originalCAF = globalThis.cancelAnimationFrame;

    globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = ++rafId;
      rafCallbacks.set(id, callback);
      return id;
    });

    globalThis.cancelAnimationFrame = vi.fn((id: number) => {
      rafCallbacks.delete(id);
    });
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCAF;
  });

  const flushRAF = () => {
    rafCallbacks.forEach((callback, id) => {
      callback(performance.now());
      rafCallbacks.delete(id);
    });
  };

  it('enqueue buffers data correctly', () => {
    const onFlush = vi.fn();
    const pipeline = new OutputPipelineManager(onFlush);

    pipeline.enqueue('window-1', 'hello');
    pipeline.enqueue('window-1', ' world');

    expect(onFlush).not.toHaveBeenCalled();

    flushRAF();

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith('window-1', 'hello world');
  });

  it('flush returns and clears buffer', () => {
    const onFlush = vi.fn();
    const pipeline = new OutputPipelineManager(onFlush);

    pipeline.enqueue('window-1', 'test data');
    const flushed = pipeline.flush('window-1');

    expect(flushed).toBe('test data');
    expect(cancelAnimationFrame).toHaveBeenCalled();

    flushRAF();
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('resize pending routes to separate buffer', () => {
    const onFlush = vi.fn();
    const pipeline = new OutputPipelineManager(onFlush);

    pipeline.setResizePending('window-1', true);
    pipeline.enqueue('window-1', 'during resize');

    flushRAF();
    expect(onFlush).not.toHaveBeenCalled();

    expect(pipeline.isResizePending('window-1')).toBe(true);
  });

  it('setResizePending(false) merges buffers', () => {
    const onFlush = vi.fn();
    const pipeline = new OutputPipelineManager(onFlush);

    pipeline.enqueue('window-1', 'before');
    flushRAF();
    expect(onFlush).toHaveBeenCalledWith('window-1', 'before');
    onFlush.mockClear();

    pipeline.setResizePending('window-1', true);
    pipeline.enqueue('window-1', 'during');

    pipeline.setResizePending('window-1', false);

    flushRAF();
    expect(onFlush).toHaveBeenCalledWith('window-1', 'during');
  });

  it('RAF scheduling coalesces rapid enqueues', () => {
    const onFlush = vi.fn();
    const pipeline = new OutputPipelineManager(onFlush);

    pipeline.enqueue('window-1', 'a');
    pipeline.enqueue('window-1', 'b');
    pipeline.enqueue('window-1', 'c');
    pipeline.enqueue('window-1', 'd');

    // With coalesced scheduling, RAF is scheduled once and subsequent
    // enqueues just add to the buffer without canceling/rescheduling.
    // This prevents frame drops during high-volume output.
    expect(cancelAnimationFrame).not.toHaveBeenCalled();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    flushRAF();

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith('window-1', 'abcd');
  });

  it('handles multiple windows independently', () => {
    const onFlush = vi.fn();
    const pipeline = new OutputPipelineManager(onFlush);

    pipeline.enqueue('window-1', 'first');
    pipeline.enqueue('window-2', 'second');

    flushRAF();

    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenCalledWith('window-1', 'first');
    expect(onFlush).toHaveBeenCalledWith('window-2', 'second');
  });

  it('clear removes window state', () => {
    const onFlush = vi.fn();
    const pipeline = new OutputPipelineManager(onFlush);

    pipeline.enqueue('window-1', 'data');
    pipeline.clear('window-1');

    flushRAF();
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

    flushRAF();
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

      // Add data to main buffer
      pipeline.enqueue('window-1', 'main buffer data');
      // Add data to resize buffer
      pipeline.setResizePending('window-1', true);
      pipeline.enqueue('window-1', 'resize buffer data');

      const statsBefore = pipeline.getStats();
      expect(statsBefore.totalBuffered).toBeGreaterThan(0);

      // Enter restore mode - should clear all buffers
      pipeline.setRestoreInProgress('window-1', true);

      const statsAfter = pipeline.getStats();
      expect(statsAfter.totalBuffered).toBe(0);
    });

    it('setRestoreInProgress(true) cancels pending flush', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.enqueue('window-1', 'data');
      // Flush is scheduled via RAF

      pipeline.setRestoreInProgress('window-1', true);

      flushRAF();
      // Flush should have been cancelled
      expect(onFlush).not.toHaveBeenCalled();
    });

    it('enqueue discards data during restore mode', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.setRestoreInProgress('window-1', true);
      pipeline.enqueue('window-1', 'should be discarded');

      // Exit restore mode
      pipeline.setRestoreInProgress('window-1', false);

      flushRAF();
      // Nothing should have been flushed
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

      // Enter restore mode
      pipeline.setRestoreInProgress('window-1', true);
      pipeline.enqueue('window-1', 'discarded');

      // Exit restore mode
      pipeline.setRestoreInProgress('window-1', false);

      // Now enqueue should work normally
      pipeline.enqueue('window-1', 'normal data');

      flushRAF();
      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(onFlush).toHaveBeenCalledWith('window-1', 'normal data');
    });

    it('restore mode is independent per window', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      pipeline.setRestoreInProgress('window-1', true);
      pipeline.enqueue('window-1', 'discarded for window-1');
      pipeline.enqueue('window-2', 'kept for window-2');

      flushRAF();
      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(onFlush).toHaveBeenCalledWith('window-2', 'kept for window-2');
    });

    it('entering restore mode during resize clears resize buffer too', () => {
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // Set up resize pending
      pipeline.setResizePending('window-1', true);
      pipeline.enqueue('window-1', 'resize data');

      // Enter restore mode
      pipeline.setRestoreInProgress('window-1', true);

      // Exit resize mode
      pipeline.setResizePending('window-1', false);

      flushRAF();
      // Nothing should flush because restore mode cleared the resize buffer
      expect(onFlush).not.toHaveBeenCalled();
    });
  });

  describe('forced throttle mode', () => {
    it('should apply forced throttle mode when set', () => {
      vi.useFakeTimers();
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // Set forced throttle mode to 'critical'
      pipeline.setForcedThrottleMode('critical');

      pipeline.enqueue('window-1', 'data');

      // Critical mode uses 200ms setTimeout
      expect(onFlush).not.toHaveBeenCalled();

      vi.advanceTimersByTime(200);
      expect(onFlush).toHaveBeenCalledWith('window-1', 'data');

      vi.useRealTimers();
    });

    it('should use most conservative mode between forced and calculated', () => {
      vi.useFakeTimers();
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // Set forced mode to 'light' (32ms delay)
      pipeline.setForcedThrottleMode('light');

      // Enqueue small data (would normally be 'normal' mode = 0ms)
      pipeline.enqueue('window-1', 'small data');

      // Should use 'light' mode (32ms) since it's more conservative than 'normal'
      expect(onFlush).not.toHaveBeenCalled();

      vi.advanceTimersByTime(32);
      expect(onFlush).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('should prefer calculated mode if more conservative than forced', () => {
      vi.useFakeTimers();
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // Set forced mode to 'light' (32ms delay)
      pipeline.setForcedThrottleMode('light');

      // Generate enough data to trigger 'critical' calculated mode (>500KB/s)
      const largeData = 'x'.repeat(600_000);
      pipeline.enqueue('window-1', largeData);

      // Should use 'critical' mode (200ms) since it's more conservative than 'light'
      expect(onFlush).not.toHaveBeenCalled();

      vi.advanceTimersByTime(32);
      expect(onFlush).not.toHaveBeenCalled(); // Not yet

      vi.advanceTimersByTime(168); // Total 200ms
      expect(onFlush).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('should clear forced mode when set to undefined', () => {
      vi.useFakeTimers();

      // Re-setup RAF mock after fake timers to ensure it's captured
      const localRafCallbacks = new Map<number, FrameRequestCallback>();
      let localRafId = 0;
      globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
        const id = ++localRafId;
        localRafCallbacks.set(id, callback);
        return id;
      });
      globalThis.cancelAnimationFrame = vi.fn((id: number) => {
        localRafCallbacks.delete(id);
      });

      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // Set forced mode
      pipeline.setForcedThrottleMode('heavy');
      pipeline.enqueue('window-1', 'data1');

      vi.advanceTimersByTime(100);
      expect(onFlush).toHaveBeenCalledWith('window-1', 'data1');

      onFlush.mockClear();

      // Clear forced mode
      pipeline.setForcedThrottleMode(undefined);
      pipeline.enqueue('window-1', 'data2');

      // Should use normal mode (RAF, effectively immediate)
      localRafCallbacks.forEach((callback) => {
        callback(performance.now());
      });
      localRafCallbacks.clear();

      expect(onFlush).toHaveBeenCalledWith('window-1', 'data2');

      vi.useRealTimers();
    });

    it('should handle mode transitions correctly', () => {
      vi.useFakeTimers();
      const onFlush = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);

      // Start with 'light' mode
      pipeline.setForcedThrottleMode('light');
      pipeline.enqueue('window-1', 'data1');

      vi.advanceTimersByTime(32);
      expect(onFlush).toHaveBeenCalledWith('window-1', 'data1');

      onFlush.mockClear();

      // Transition to 'critical' mode
      pipeline.setForcedThrottleMode('critical');
      pipeline.enqueue('window-1', 'data2');

      vi.advanceTimersByTime(100);
      expect(onFlush).not.toHaveBeenCalled(); // Not yet (needs 200ms)

      vi.advanceTimersByTime(100); // Total 200ms
      expect(onFlush).toHaveBeenCalledWith('window-1', 'data2');

      vi.useRealTimers();
    });
  });
});
