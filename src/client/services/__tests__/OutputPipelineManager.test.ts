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

    expect(cancelAnimationFrame).toHaveBeenCalledTimes(3);

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
});
