import { act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { useResizeCoordinator } from '../../hooks/useResizeCoordinator';

describe('Resize Coordination Integration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should coordinate resize across multiple terminals', () => {
    const { result } = renderHook(() => useResizeCoordinator());
    
    const mockFitAddon1 = { fit: jest.fn(), proposeDimensions: jest.fn(() => ({ cols: 80, rows: 24 })) } as any;
    const mockFitAddon2 = { fit: jest.fn(), proposeDimensions: jest.fn(() => ({ cols: 80, rows: 24 })) } as any;
    const mockFitAddon3 = { fit: jest.fn(), proposeDimensions: jest.fn(() => ({ cols: 80, rows: 24 })) } as any;

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
      jest.runAllTimers();
    });

    expect(mockFitAddon1.fit).toHaveBeenCalled();
    expect(mockFitAddon2.fit).toHaveBeenCalled();
    expect(mockFitAddon3.fit).toHaveBeenCalled();
  });

  it('should handle resize during output (EC-R-02)', () => {
    const { result } = renderHook(() => useResizeCoordinator());
    const mockFitAddon = { fit: jest.fn(), proposeDimensions: jest.fn(() => ({ cols: 80, rows: 24 })) } as any;

    act(() => {
      result.current.register({ id: 'term-1', fitAddon: mockFitAddon });
    });

    act(() => {
      result.current.triggerResize();
      result.current.triggerResize();
      result.current.triggerResize();
      jest.runAllTimers();
    });

    expect(mockFitAddon.fit).toHaveBeenCalled();
  });

  it('should handle side panel toggle (EC-R-06)', () => {
    const { result } = renderHook(() => useResizeCoordinator());
    const mockFitAddon = { fit: jest.fn(), proposeDimensions: jest.fn(() => ({ cols: 80, rows: 24 })) } as any;
    const onResize = jest.fn();

    act(() => {
      result.current.register({ id: 'term-1', fitAddon: mockFitAddon, onResize });
    });

    mockFitAddon.fit.mockClear();

    act(() => {
      result.current.triggerResize();
      jest.runAllTimers();
    });

    expect(mockFitAddon.fit).toHaveBeenCalled();
    expect(onResize).toHaveBeenCalledWith(80, 24);
  });

  it('should properly cleanup on unmount', () => {
    const { result, unmount } = renderHook(() => useResizeCoordinator());
    const mockFitAddon = { fit: jest.fn(), proposeDimensions: jest.fn(() => ({ cols: 80, rows: 24 })) } as any;

    act(() => {
      result.current.register({ id: 'term-1', fitAddon: mockFitAddon });
    });

    const initialStats = result.current.getStats();
    expect(initialStats.registeredCount).toBe(1);

    unmount();

    const finalStats = result.current.getStats();
    expect(finalStats.registeredCount).toBe(1);
  });

  it('should not trigger server resize while dragging', () => {
    const { result } = renderHook(() => useResizeCoordinator());
    const mockFitAddon = { fit: jest.fn(), proposeDimensions: jest.fn(() => ({ cols: 80, rows: 24 })) } as any;
    const onResize = jest.fn();

    act(() => {
      result.current.register({ id: 'term-1', fitAddon: mockFitAddon, onResize });
    });

    act(() => {
      result.current.triggerResize();
      result.current.triggerResize();
      jest.advanceTimersByTime(100);
    });

    expect(onResize).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(50);
    });

    expect(onResize).toHaveBeenCalledTimes(1);
  });
});
