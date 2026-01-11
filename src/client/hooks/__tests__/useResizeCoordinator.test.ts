import { renderHook, act } from '@testing-library/react';
import { useResizeCoordinator } from '../useResizeCoordinator';
import type { FitAddon } from '@xterm/addon-fit';
import { vi } from 'vitest';

describe('useResizeCoordinator', () => {
  let mockFitAddon: FitAddon;

  beforeEach(() => {
    mockFitAddon = {
      fit: vi.fn(),
      proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })),
    } as any;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('register/unregister', () => {
    it('should register a terminal', () => {
      const { result } = renderHook(() => useResizeCoordinator());
      
      act(() => {
        result.current.register({
          id: 'term-1',
          fitAddon: mockFitAddon,
        });
      });

      const stats = result.current.getStats();
      expect(stats.registeredCount).toBe(1);
    });

    it('should unregister on cleanup', () => {
      const { result } = renderHook(() => useResizeCoordinator());
      
      let unregister: () => void;
      act(() => {
        unregister = result.current.register({
          id: 'term-1',
          fitAddon: mockFitAddon,
        });
      });

      act(() => {
        unregister();
      });

      const stats = result.current.getStats();
      expect(stats.registeredCount).toBe(0);
    });

    it('should handle multiple registrations', () => {
      const { result } = renderHook(() => useResizeCoordinator());
      const mockFitAddon2 = { ...mockFitAddon };
      
      act(() => {
        result.current.register({ id: 'term-1', fitAddon: mockFitAddon });
        result.current.register({ id: 'term-2', fitAddon: mockFitAddon2 });
      });

      const stats = result.current.getStats();
      expect(stats.registeredCount).toBe(2);
    });
  });

  describe('resize coordination', () => {
    it('should call fit() immediately via RAF', () => {
      const { result} = renderHook(() => useResizeCoordinator());
      
      act(() => {
        result.current.register({ id: 'term-1', fitAddon: mockFitAddon });
      });

      mockFitAddon.fit.mockClear();

      act(() => {
        result.current.triggerResize();
        vi.runAllTimers();
      });

      expect(mockFitAddon.fit).toHaveBeenCalled();
      expect(mockFitAddon.fit.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('should debounce server resize to 150ms', () => {
      const onResize = vi.fn();
      const { result } = renderHook(() => useResizeCoordinator());
      
      act(() => {
        result.current.register({
          id: 'term-1',
          fitAddon: mockFitAddon,
          onResize,
        });
      });

      act(() => {
        result.current.triggerResize();
        result.current.triggerResize();
        result.current.triggerResize();
      });

      expect(onResize).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(onResize).toHaveBeenCalledTimes(1);
      expect(onResize).toHaveBeenCalledWith(80, 24);
    });

    it('should handle rapid resize (EC-R-01)', () => {
      const onResize = vi.fn();
      const { result } = renderHook(() => useResizeCoordinator());
      
      act(() => {
        result.current.register({
          id: 'term-1',
          fitAddon: mockFitAddon,
          onResize,
        });
      });

      act(() => {
        for (let i = 0; i < 50; i++) {
          result.current.triggerResize();
          vi.advanceTimersByTime(10);
        }
      });

      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(onResize).toHaveBeenCalledTimes(1);
    });

    it('should resize all terminals atomically (EC-R-04)', () => {
      const { result } = renderHook(() => useResizeCoordinator());
      const mockFitAddon2 = { ...mockFitAddon };
      const mockFitAddon3 = { ...mockFitAddon };
      
      act(() => {
        result.current.register({ id: 'term-1', fitAddon: mockFitAddon });
        result.current.register({ id: 'term-2', fitAddon: mockFitAddon2 });
        result.current.register({ id: 'term-3', fitAddon: mockFitAddon3 });
      });

      mockFitAddon.fit.mockClear();
      mockFitAddon2.fit.mockClear();
      mockFitAddon3.fit.mockClear();

      act(() => {
        result.current.triggerResize();
        vi.runAllTimers();
      });

      expect(mockFitAddon.fit).toHaveBeenCalled();
      expect(mockFitAddon2.fit).toHaveBeenCalled();
      expect(mockFitAddon3.fit).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle fit() failure gracefully', () => {
      const { result } = renderHook(() => useResizeCoordinator());
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation();
      
      mockFitAddon.fit.mockImplementation(() => {
        throw new Error('Fit failed');
      });

      act(() => {
        result.current.register({ id: 'term-1', fitAddon: mockFitAddon });
        result.current.triggerResize();
        vi.runAllTimers();
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Atomic resize failed'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should track pending resizes', () => {
      const onResize = vi.fn();
      const { result } = renderHook(() => useResizeCoordinator());
      
      act(() => {
        result.current.register({
          id: 'term-1',
          fitAddon: mockFitAddon,
          onResize,
        });
        result.current.triggerResize();
      });

      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(result.current.isResizePending('term-1')).toBe(true);

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.isResizePending('term-1')).toBe(false);
    });
  });

  describe('statistics', () => {
    it('should track resize stats', () => {
      const { result } = renderHook(() => useResizeCoordinator());
      
      act(() => {
        result.current.register({ id: 'term-1', fitAddon: mockFitAddon });
        result.current.register({ id: 'term-2', fitAddon: mockFitAddon });
        result.current.triggerResize();
      });

      const stats = result.current.getStats();
      expect(stats.registeredCount).toBe(2);
    });
  });
});
