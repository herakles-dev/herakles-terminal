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

  describe('lowered throttle thresholds', () => {
    it('should activate light throttle at 25KB/s', () => {
      vi.useFakeTimers();

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

      // Seed the throttle window: enqueue small data, advance 1s to reset
      pipeline.enqueue('window-1', 'seed');
      vi.advanceTimersByTime(1100); // Ensure window resets
      localRafCallbacks.forEach((cb) => cb(performance.now()));
      localRafCallbacks.clear();
      onFlush.mockClear();

      // Now enqueue 25KB — with fresh window, rate = 25KB/s → light throttle
      const data = 'x'.repeat(25_000);
      pipeline.enqueue('window-1', data);

      // Light mode uses 24ms setTimeout
      expect(onFlush).not.toHaveBeenCalled();

      vi.advanceTimersByTime(24);
      expect(onFlush).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('should use RAF (normal mode) at 15KB/s', () => {
      vi.useFakeTimers();

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

      // Seed the throttle window: enqueue small data, advance 1s to reset
      pipeline.enqueue('window-1', 'seed');
      vi.advanceTimersByTime(1100);
      localRafCallbacks.forEach((cb) => cb(performance.now()));
      localRafCallbacks.clear();
      onFlush.mockClear();

      // 15KB — below 20KB/s threshold → normal mode (RAF)
      const data = 'x'.repeat(15_000);
      pipeline.enqueue('window-1', data);

      expect(globalThis.requestAnimationFrame).toHaveBeenCalled();

      localRafCallbacks.forEach((cb) => cb(performance.now()));
      expect(onFlush).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe('Ink redraw coalescing', () => {
    it('detectInkRedraw matches erase+home sequence', () => {
      vi.useFakeTimers();

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

      // Seed the throttle window to avoid burst spike
      pipeline.enqueue('window-1', 'seed');
      vi.advanceTimersByTime(1100);
      localRafCallbacks.forEach((cb) => cb(performance.now()));
      localRafCallbacks.clear();
      onFlush.mockClear();

      // Ink redraw: \x1b[2J (erase display) + \x1b[H (cursor home)
      const inkRedraw = '\x1b[2J\x1b[Hsome content here';
      pipeline.enqueue('window-1', inkRedraw);

      // Small data may use RAF or light throttle depending on rate
      vi.advanceTimersByTime(24);
      localRafCallbacks.forEach((cb) => cb(performance.now()));

      expect(onFlush).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('replaces buffer during rapid Ink redraws', () => {
      vi.useFakeTimers();

      // Re-setup RAF mock
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

      // First Ink redraw — sets lastEraseHomeTime
      const redraw1 = '\x1b[2J\x1b[HFrame 1';
      pipeline.enqueue('window-1', redraw1);

      // Second Ink redraw within 50ms — should REPLACE buffer
      vi.advanceTimersByTime(10);
      const redraw2 = '\x1b[2J\x1b[HFrame 2';
      pipeline.enqueue('window-1', redraw2);

      // Third redraw within 50ms
      vi.advanceTimersByTime(10);
      const redraw3 = '\x1b[2J\x1b[HFrame 3';
      pipeline.enqueue('window-1', redraw3);

      // Flush — should only see the LAST frame (Frame 3)
      vi.advanceTimersByTime(24); // light throttle after >3 redraws
      localRafCallbacks.forEach((cb) => cb(performance.now()));

      // The flushed data should be the last redraw, not all three concatenated
      const flushedData = onFlush.mock.calls.map(c => c[1]).join('');
      expect(flushedData).toContain('Frame 3');
      // Should NOT contain Frame 1 content (it was replaced)
      expect(flushedData).not.toContain('Frame 1');

      vi.useRealTimers();
    });

    it('does not coalesce redraws >50ms apart', () => {
      vi.useFakeTimers();

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

      // First Ink redraw
      const redraw1 = '\x1b[2J\x1b[HFrame 1';
      pipeline.enqueue('window-1', redraw1);

      // Wait for flush (RAF)
      localRafCallbacks.forEach((cb) => cb(performance.now()));
      localRafCallbacks.clear();
      expect(onFlush).toHaveBeenCalledTimes(1);
      onFlush.mockClear();

      // Second redraw >50ms later — should NOT replace
      vi.advanceTimersByTime(100);
      const redraw2 = '\x1b[2J\x1b[HFrame 2';
      pipeline.enqueue('window-1', redraw2);

      localRafCallbacks.forEach((cb) => cb(performance.now()));
      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(onFlush).toHaveBeenCalledWith('window-1', redraw2);

      vi.useRealTimers();
    });
  });

  describe('mobile thresholds', () => {
    it('should use 50% lower thresholds on mobile', () => {
      vi.useFakeTimers();

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
      const pipeline = new OutputPipelineManager(onFlush, { isMobile: true });

      // Seed the throttle window to avoid burst spike
      pipeline.enqueue('window-1', 'seed');
      vi.advanceTimersByTime(1100);
      localRafCallbacks.forEach((cb) => cb(performance.now()));
      localRafCallbacks.clear();
      onFlush.mockClear();

      // 12KB/s — above mobile light threshold (20KB * 0.5 = 10KB) but below desktop
      const data = 'x'.repeat(12_000);
      pipeline.enqueue('window-1', data);

      // Should be in light throttle mode (24ms delay) on mobile
      expect(onFlush).not.toHaveBeenCalled();

      vi.advanceTimersByTime(24);
      expect(onFlush).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('should use normal thresholds on desktop', () => {
      vi.useFakeTimers();

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
      const pipeline = new OutputPipelineManager(onFlush, { isMobile: false });

      // Seed the throttle window to avoid burst spike
      pipeline.enqueue('window-1', 'seed');
      vi.advanceTimersByTime(1100);
      localRafCallbacks.forEach((cb) => cb(performance.now()));
      localRafCallbacks.clear();
      onFlush.mockClear();

      // 12KB/s — below desktop light threshold (20KB/s) → normal mode (RAF)
      const data = 'x'.repeat(12_000);
      pipeline.enqueue('window-1', data);

      expect(globalThis.requestAnimationFrame).toHaveBeenCalled();

      localRafCallbacks.forEach((cb) => cb(performance.now()));
      expect(onFlush).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe('backpressure callback', () => {
    it('should fire backpressure callback when buffer exceeds 80%', () => {
      const onFlush = vi.fn();
      const onBackpressure = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);
      pipeline.setBackpressureCallback(onBackpressure);

      // Fill buffer to >80% of MAX_BUFFER_SIZE (512KB)
      const largeData = 'x'.repeat(420_000); // ~82% of 512KB
      pipeline.enqueue('window-1', largeData);

      expect(onBackpressure).toHaveBeenCalledWith('window-1', true);
    });

    it('should release backpressure after flush', () => {
      vi.useFakeTimers();
      const onFlush = vi.fn();
      const onBackpressure = vi.fn();
      const pipeline = new OutputPipelineManager(onFlush);
      pipeline.setBackpressureCallback(onBackpressure);

      // Fill buffer to trigger backpressure
      const largeData = 'x'.repeat(420_000);
      pipeline.enqueue('window-1', largeData);

      expect(onBackpressure).toHaveBeenCalledWith('window-1', true);
      onBackpressure.mockClear();

      // Flush via critical throttle (200ms delay for large data)
      vi.advanceTimersByTime(200);

      expect(onBackpressure).toHaveBeenCalledWith('window-1', false);

      vi.useRealTimers();
    });
  });
});
