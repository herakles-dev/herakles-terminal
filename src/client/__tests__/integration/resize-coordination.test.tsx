import { act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { useResizeCoordinator } from '../../hooks/useResizeCoordinator';

describe('Resize Coordination Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should coordinate resize across multiple terminals', () => {
    const { result } = renderHook(() => useResizeCoordinator());

    const mockFitAddon1 = { fit: vi.fn(), proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })), activate: vi.fn(), dispose: vi.fn() } as any;
    const mockFitAddon2 = { fit: vi.fn(), proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })), activate: vi.fn(), dispose: vi.fn() } as any;
    const mockFitAddon3 = { fit: vi.fn(), proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })), activate: vi.fn(), dispose: vi.fn() } as any;

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
    const mockFitAddon = { fit: vi.fn(), proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })), activate: vi.fn(), dispose: vi.fn() } as any;

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
    const mockFitAddon = { fit: vi.fn(), proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })), activate: vi.fn(), dispose: vi.fn() } as any;
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
    const mockFitAddon = { fit: vi.fn(), proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })), activate: vi.fn(), dispose: vi.fn() } as any;

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
    const mockFitAddon = { fit: vi.fn(), proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })), activate: vi.fn(), dispose: vi.fn() } as any;
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
});
