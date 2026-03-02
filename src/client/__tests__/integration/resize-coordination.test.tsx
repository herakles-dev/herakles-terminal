import { act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { useResizeCoordinator } from '../../hooks/useResizeCoordinator';

function createMockFitAddon() {
  return {
    fit: vi.fn(),
    proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })),
    activate: vi.fn(),
    dispose: vi.fn(),
  } as any;
}

describe('Resize Coordination Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should coordinate resize across multiple terminals', () => {
    const { result } = renderHook(() => useResizeCoordinator());

    const mockFitAddon1 = createMockFitAddon();
    const mockFitAddon2 = createMockFitAddon();
    const mockFitAddon3 = createMockFitAddon();

    act(() => {
      result.current.register({ id: 'term-1', fitAddon: mockFitAddon1 });
      result.current.register({ id: 'term-2', fitAddon: mockFitAddon2 });
      result.current.register({ id: 'term-3', fitAddon: mockFitAddon3 });
    });

    mockFitAddon1.fit.mockClear();
    mockFitAddon2.fit.mockClear();
    mockFitAddon3.fit.mockClear();

    act(() => {
      window.dispatchEvent(new Event('resize'));
      vi.runAllTimers();
    });

    expect(mockFitAddon1.fit).toHaveBeenCalled();
    expect(mockFitAddon2.fit).toHaveBeenCalled();
    expect(mockFitAddon3.fit).toHaveBeenCalled();
  });

  it('should handle resize during output (EC-R-02)', () => {
    const { result } = renderHook(() => useResizeCoordinator());
    const mockFitAddon = createMockFitAddon();

    act(() => {
      result.current.register({ id: 'term-1', fitAddon: mockFitAddon });
    });

    act(() => {
      result.current.triggerResize();
      result.current.triggerResize();
      result.current.triggerResize();
      vi.runAllTimers();
    });

    expect(mockFitAddon.fit).toHaveBeenCalled();
  });

  it('should handle side panel toggle (EC-R-06)', () => {
    const { result } = renderHook(() => useResizeCoordinator());
    const mockFitAddon = createMockFitAddon();
    const onResize = vi.fn();

    act(() => {
      result.current.register({ id: 'term-1', fitAddon: mockFitAddon, onResize });
    });

    mockFitAddon.fit.mockClear();

    act(() => {
      result.current.triggerResize();
      vi.runAllTimers();
    });

    expect(mockFitAddon.fit).toHaveBeenCalled();
    expect(onResize).toHaveBeenCalledWith(80, 24);
  });

  it('should properly cleanup on unmount', () => {
    const { result, unmount } = renderHook(() => useResizeCoordinator());
    const mockFitAddon = createMockFitAddon();

    act(() => {
      result.current.register({ id: 'term-1', fitAddon: mockFitAddon });
    });

    const initialStats = result.current.getStats();
    expect(initialStats.registeredCount).toBe(1);

    unmount();

    const finalStats = result.current.getStats();
    expect(finalStats.registeredCount).toBe(1);
  });

  it('should debounce server resize (100ms debounce)', () => {
    const { result } = renderHook(() => useResizeCoordinator());
    const mockFitAddon = createMockFitAddon();
    const onResize = vi.fn();

    // Register triggers immediate resize via RAF
    act(() => {
      result.current.register({ id: 'term-1', fitAddon: mockFitAddon, onResize });
      vi.runAllTimers(); // Flush the initial RAF
    });

    // Clear the mock after initial registration resize
    onResize.mockClear();

    // Trigger resize events
    act(() => {
      result.current.triggerResize();
      result.current.triggerResize();
    });

    // Before debounce completes (50ms < 100ms) - not called yet
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(onResize).not.toHaveBeenCalled();

    // After debounce completes (another 50ms = 100ms total) - called once
    act(() => {
      vi.advanceTimersByTime(50);
      vi.runAllTimers(); // Flush the RAF inside the debounce callback
    });

    expect(onResize).toHaveBeenCalledTimes(1);
  });

  describe('onComplete callback (Bug 4 fix)', () => {
    it('should call onComplete after immediate resize finishes', async () => {
      const { result } = renderHook(() => useResizeCoordinator());
      const mockFitAddon = createMockFitAddon();
      const onComplete = vi.fn();

      act(() => {
        result.current.register({ id: 'term-1', fitAddon: mockFitAddon });
      });

      mockFitAddon.fit.mockClear();

      await act(async () => {
        result.current.triggerResize(true, onComplete);
        // runAllTimersAsync flushes both macrotasks (RAF) and microtasks (Promise.all.then)
        await vi.runAllTimersAsync();
      });

      // onComplete should fire after resize
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(mockFitAddon.fit).toHaveBeenCalled();
    });

    it('should call onComplete even when resize lock is held', () => {
      const { result } = renderHook(() => useResizeCoordinator());
      const mockFitAddon = createMockFitAddon();
      const onComplete1 = vi.fn();
      const onComplete2 = vi.fn();

      act(() => {
        result.current.register({ id: 'term-1', fitAddon: mockFitAddon });
      });

      // Trigger first resize to grab the lock
      act(() => {
        result.current.triggerResize(true, onComplete1);
      });

      // Trigger second resize while lock is held — onComplete should still be called
      act(() => {
        result.current.triggerResize(true, onComplete2);
      });

      act(() => {
        vi.runAllTimers();
      });

      // Both should have been called
      expect(onComplete2).toHaveBeenCalledTimes(1);
    });

    it('should call onComplete when animating is true', () => {
      const { result } = renderHook(() => useResizeCoordinator());
      const mockFitAddon = createMockFitAddon();
      const onComplete = vi.fn();

      act(() => {
        result.current.register({ id: 'term-1', fitAddon: mockFitAddon });
      });

      // Set animating to true
      act(() => {
        result.current.setAnimating(true);
      });

      act(() => {
        result.current.triggerResize(true, onComplete);
      });

      // onComplete should fire immediately even though resize was deferred
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('should release resize lock after all targets complete', async () => {
      const { result } = renderHook(() => useResizeCoordinator());
      const mockFitAddon1 = createMockFitAddon();
      const mockFitAddon2 = createMockFitAddon();

      act(() => {
        result.current.register({ id: 'term-1', fitAddon: mockFitAddon1 });
        result.current.register({ id: 'term-2', fitAddon: mockFitAddon2 });
      });

      await act(async () => {
        result.current.triggerResize(true);
        await vi.runAllTimersAsync();
      });

      // After all promises settle, lock should be released (can trigger again)
      expect(result.current.isResizeLocked()).toBe(false);
    });
  });

  describe('triggerResize signature compatibility', () => {
    it('should work with no arguments (backward compatible)', () => {
      const { result } = renderHook(() => useResizeCoordinator());
      const mockFitAddon = createMockFitAddon();

      act(() => {
        result.current.register({ id: 'term-1', fitAddon: mockFitAddon });
      });

      mockFitAddon.fit.mockClear();

      // No args — should still work as before
      act(() => {
        result.current.triggerResize();
        vi.runAllTimers();
      });

      expect(mockFitAddon.fit).toHaveBeenCalled();
    });

    it('should work with only immediate=true (backward compatible)', () => {
      const { result } = renderHook(() => useResizeCoordinator());
      const mockFitAddon = createMockFitAddon();

      act(() => {
        result.current.register({ id: 'term-1', fitAddon: mockFitAddon });
      });

      mockFitAddon.fit.mockClear();

      act(() => {
        result.current.triggerResize(true);
        vi.runAllTimers();
      });

      expect(mockFitAddon.fit).toHaveBeenCalled();
    });
  });
});
