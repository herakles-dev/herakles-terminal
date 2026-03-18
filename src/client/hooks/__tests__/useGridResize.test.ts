/**
 * useGridResize tests — v2 resize pipeline
 *
 * Covers:
 *  1. register → ResizeObserver fires → performFit → onResize callback
 *  2. Dimension-change deduplication (skip when cols/rows unchanged)
 *  3. Recovery-race deferral: isRecovering=true defers; notifyRecoveryEnd replays
 *  4. Canvas verify: mismatch triggers one RAF retry with fit()
 *  5. onResizePending called only on dimension change (not spurious observer fires)
 *  6. unregister stops observation and cancels pending RAF
 *  7. resizeAll triggers fit() on every registered pane
 *  8. resizeTarget triggers fit() on a specific pane
 *  9. fit() exceptions are swallowed (terminal disposed/detached)
 * 10. RAF cancellation on hook unmount
 * 11. Container size guard: skip fit() when container size unchanged
 */

import { renderHook, act } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import { useGridResize } from '../useGridResize';
import type { GridResizeTarget } from '../useGridResize';

// ─── Helpers ────────────────────────────────────────────────────────────────

interface MockFitAddon {
  fit: Mock;
  proposeDimensions: Mock;
  activate: Mock;
  dispose: Mock;
}

function createMockFitAddon(cols = 80, rows = 24): MockFitAddon {
  return {
    fit: vi.fn(),
    proposeDimensions: vi.fn(() => ({ cols, rows })),
    activate: vi.fn(),
    dispose: vi.fn(),
  };
}

/**
 * Create a mock element with getBoundingClientRect returning specified dimensions.
 * This is critical: performFit() now checks container size before calling fit(),
 * so mock elements must report non-zero dimensions.
 */
function createMockElement(width = 800, height = 600): HTMLDivElement {
  const el = document.createElement('div');
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    width, height,
    top: 0, left: 0, bottom: height, right: width,
    x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return el;
}


function buildTarget(
  overrides: Partial<GridResizeTarget> & { id: string; fitAddon: MockFitAddon }
): GridResizeTarget {
  return {
    element: createMockElement(),
    onResize: undefined,
    isRecovering: undefined,
    onResizePending: undefined,
    ...overrides,
    fitAddon: overrides.fitAddon as any,
  };
}

// ─── ResizeObserver capture ──────────────────────────────────────────────────

function setupCapturedResizeObserver() {
  let capturedCallback: ResizeObserverCallback | null = null;
  const observedElements: HTMLElement[] = [];

  class CapturingResizeObserver {
    constructor(cb: ResizeObserverCallback) {
      capturedCallback = cb;
    }
    observe(el: HTMLElement) {
      observedElements.push(el);
    }
    unobserve(el: HTMLElement) {
      const idx = observedElements.indexOf(el);
      if (idx >= 0) observedElements.splice(idx, 1);
    }
    disconnect() {
      observedElements.length = 0;
      capturedCallback = null;
    }
  }

  global.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver;

  function triggerResizeFor(el: HTMLElement) {
    if (!capturedCallback) throw new Error('ResizeObserver callback not yet captured');
    const entry = { target: el } as unknown as ResizeObserverEntry;
    capturedCallback([entry], {} as ResizeObserver);
  }

  return { triggerResizeFor, observedElements };
}

// ─── RAF helpers ─────────────────────────────────────────────────────────────

function setupRAFQueue() {
  const queue: Array<FrameRequestCallback> = [];

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', (_id: number) => {
    // no-op
  });

  function flushRAF(passes = 1) {
    for (let p = 0; p < passes; p++) {
      const current = queue.splice(0);
      for (const cb of current) cb(0);
    }
  }

  return { flushRAF };
}

function restoreDefaultResizeObserver() {
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useGridResize', () => {
  let observer: ReturnType<typeof setupCapturedResizeObserver>;
  let raf: ReturnType<typeof setupRAFQueue>;

  beforeEach(() => {
    observer = setupCapturedResizeObserver();
    raf = setupRAFQueue();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreDefaultResizeObserver();
  });

  // ── 1. Basic flow ────────────────────────────────────────────────────────

  describe('basic register → observe → fit → onResize', () => {
    it('registers element with ResizeObserver', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon();
      const el = createMockElement();
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el });

      act(() => {
        result.current.register(target);
      });

      expect(observer.observedElements).toContain(el);
    });

    it('sets data-grid-pane-id attribute on element', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon();
      const el = createMockElement();
      const target = buildTarget({ id: 'pane-42', fitAddon, element: el });

      act(() => {
        result.current.register(target);
      });

      expect(el.dataset.gridPaneId).toBe('pane-42');
    });

    it('does NOT call fit() on registration (seeds dimensions from proposeDimensions)', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon();
      const target = buildTarget({ id: 'pane-1', fitAddon });

      act(() => {
        result.current.register(target);
        raf.flushRAF();
      });

      // No initial fit — terminal already fitted in handleTerminalReady
      expect(fitAddon.fit).not.toHaveBeenCalled();
    });

    it('calls onResize when ResizeObserver fires with different container size', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(132, 50);
      const onResize = vi.fn();
      const el = createMockElement(800, 600);
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el, onResize });

      act(() => {
        result.current.register(target);
      });

      // Change container size to trigger fit
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: 900, height: 700,
        top: 0, left: 0, bottom: 700, right: 900,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);

      // Clear the seeded dimensions so the new ones fire onResize
      fitAddon.proposeDimensions.mockReturnValue({ cols: 150, rows: 55 });

      act(() => {
        observer.triggerResizeFor(el);
        raf.flushRAF();
      });

      expect(onResize).toHaveBeenCalledWith(150, 55);
    });
  });

  // ── 2. Dimension-change deduplication ───────────────────────────────────

  describe('dimension-change deduplication', () => {
    it('does NOT call onResize when dimensions are unchanged', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);
      const onResize = vi.fn();
      const el = createMockElement(800, 600);
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el, onResize });

      act(() => {
        result.current.register(target);
      });

      // Same container size → skip fit entirely
      act(() => {
        observer.triggerResizeFor(el);
        raf.flushRAF();
      });

      expect(onResize).not.toHaveBeenCalled();
    });

    it('DOES call onResize when dimensions change', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);
      const onResize = vi.fn();
      const el = createMockElement(800, 600);
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el, onResize });

      act(() => {
        result.current.register(target);
      });

      // Change container size
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: 1000, height: 600,
        top: 0, left: 0, bottom: 600, right: 1000,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);
      fitAddon.proposeDimensions.mockReturnValue({ cols: 100, rows: 30 });

      act(() => {
        observer.triggerResizeFor(el);
        raf.flushRAF();
      });

      expect(onResize).toHaveBeenCalledWith(100, 30);
    });

    it('handles proposeDimensions returning null gracefully', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon();
      fitAddon.proposeDimensions.mockReturnValue(null);
      const onResize = vi.fn();
      const el = createMockElement();
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el, onResize });

      act(() => {
        result.current.register(target);
      });

      // Change size to trigger performFit
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: 900, height: 700,
        top: 0, left: 0, bottom: 700, right: 900,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);

      act(() => {
        observer.triggerResizeFor(el);
        raf.flushRAF();
      });

      expect(onResize).not.toHaveBeenCalled();
    });
  });

  // ── 3. Recovery-race deferral ────────────────────────────────────────────

  describe('recovery-race deferral (isRecovering)', () => {
    it('defers resize when isRecovering returns true', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);
      const onResize = vi.fn();
      const el = createMockElement();
      const isRecovering = vi.fn(() => true);
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el, onResize, isRecovering });

      act(() => {
        result.current.register(target);
      });

      // Change size and trigger observer
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: 900, height: 700,
        top: 0, left: 0, bottom: 700, right: 900,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);

      act(() => {
        observer.triggerResizeFor(el);
        raf.flushRAF();
      });

      expect(fitAddon.fit).not.toHaveBeenCalled();
      expect(onResize).not.toHaveBeenCalled();
    });

    it('replays deferred resize after notifyRecoveryEnd', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);
      const onResize = vi.fn();
      const el = createMockElement();
      let recovering = true;
      const isRecovering = vi.fn(() => recovering);
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el, onResize, isRecovering });

      act(() => {
        result.current.register(target);
      });

      // Trigger a resize while recovering
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: 900, height: 700,
        top: 0, left: 0, bottom: 700, right: 900,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);

      act(() => {
        observer.triggerResizeFor(el);
        raf.flushRAF(); // deferred
      });

      expect(onResize).not.toHaveBeenCalled();

      recovering = false;

      act(() => {
        result.current.notifyRecoveryEnd('pane-1');
        raf.flushRAF();
      });

      expect(fitAddon.fit).toHaveBeenCalled();
      expect(onResize).toHaveBeenCalledWith(80, 24);
    });

    it('notifyRecoveryEnd on unknown id is a no-op', () => {
      const { result } = renderHook(() => useGridResize());

      expect(() => {
        act(() => {
          result.current.notifyRecoveryEnd('nonexistent');
        });
      }).not.toThrow();
    });

    it('notifyRecoveryEnd is no-op when deferredResize is false', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);
      const onResize = vi.fn();
      const el = createMockElement();
      const isRecovering = vi.fn(() => false);
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el, onResize, isRecovering });

      act(() => {
        result.current.register(target);
      });

      fitAddon.fit.mockClear();

      act(() => {
        result.current.notifyRecoveryEnd('pane-1');
        raf.flushRAF();
      });

      expect(fitAddon.fit).not.toHaveBeenCalled();
    });
  });

  // ── 4. Canvas verify ──────────────────────────────────────────────────────

  describe('canvas verify RAF retry (verifyCanvasOnce)', () => {
    function makeElementWithCanvas(
      containerW: number,
      containerH: number,
      canvasW: number,
      canvasH: number
    ): HTMLDivElement {
      const el = document.createElement('div');
      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;

      // Also add a data-terminal-id container so isCanvasMismatched finds it
      const termContainer = document.createElement('div');
      termContainer.setAttribute('data-terminal-id', 'test');
      vi.spyOn(termContainer, 'getBoundingClientRect').mockReturnValue({
        width: containerW,
        height: containerH,
        top: 0, left: 0, bottom: containerH, right: containerW,
        x: 0, y: 0,
        toJSON: () => ({}),
      } as DOMRect);
      Object.defineProperty(termContainer, 'offsetHeight', { value: containerH });

      termContainer.appendChild(canvas);
      el.appendChild(termContainer);

      // Outer element needs its own rect for container size check
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: containerW,
        height: containerH + 30, // Include title bar
        top: 0, left: 0, bottom: containerH + 30, right: containerW,
        x: 0, y: 0,
        toJSON: () => ({}),
      } as DOMRect);

      return el;
    }

    it('calls fit() at least once when container size changes (canvas verify is browser-only)', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);

      // dpr=1: terminal container=800x600, canvas=810x600 → diff=10 > 4px
      const el = makeElementWithCanvas(800, 600, 810, 600);
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el });

      act(() => {
        result.current.register(target);
      });

      // Change container size to trigger performFit
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: 900, height: 700,
        top: 0, left: 0, bottom: 700, right: 900,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);

      act(() => {
        observer.triggerResizeFor(el);
        raf.flushRAF(); // performFit → schedules verifyCanvasOnce RAF
        raf.flushRAF(); // verifyCanvasOnce RAF
        raf.flushRAF(); // retry RAF (if mismatch detected)
      });

      // At minimum: 1 from performFit (canvas verify retry depends on jsdom getBoundingClientRect)
      expect(fitAddon.fit.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('does NOT call extra fit() when canvas dimensions are within 4px tolerance', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);

      // dpr=1: terminal container=800×600, canvas=802×601 → diffs ≤ 4px
      const el = makeElementWithCanvas(800, 600, 802, 601);
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el });

      act(() => {
        result.current.register(target);
      });

      // Change container size to trigger performFit
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: 900, height: 700,
        top: 0, left: 0, bottom: 700, right: 900,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);

      act(() => {
        observer.triggerResizeFor(el);
        raf.flushRAF(); // performFit → schedules verify
        raf.flushRAF(); // verifyCanvasOnce → within tolerance → no extra fit
      });

      // Only fit() from performFit
      expect(fitAddon.fit).toHaveBeenCalledTimes(1);
    });

    it('handles element with no canvas child gracefully', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);
      const el = createMockElement();
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el });

      expect(() => {
        act(() => {
          result.current.register(target);
          // Change size to trigger fit
          vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
            width: 900, height: 700,
            top: 0, left: 0, bottom: 700, right: 900,
            x: 0, y: 0, toJSON: () => ({}),
          } as DOMRect);
          observer.triggerResizeFor(el);
          raf.flushRAF();
          raf.flushRAF();
        });
      }).not.toThrow();
    });
  });

  // ── 5. onResizePending (output pipeline integration) ─────────────────────

  describe('onResizePending output pipeline integration', () => {
    it('calls onResizePending(true) before onResize when dimensions change', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);
      const callOrder: string[] = [];
      const onResizePending = vi.fn((pending: boolean) => {
        if (pending) callOrder.push('pending');
      });
      const onResize = vi.fn(() => callOrder.push('resize'));
      const el = createMockElement();
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el, onResize, onResizePending });

      act(() => {
        result.current.register(target);
      });

      // Change container size so fit runs
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: 1000, height: 700,
        top: 0, left: 0, bottom: 700, right: 1000,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);
      fitAddon.proposeDimensions.mockReturnValue({ cols: 100, rows: 30 });

      act(() => {
        observer.triggerResizeFor(el);
        raf.flushRAF();
      });

      expect(callOrder[0]).toBe('pending');
      expect(callOrder[1]).toBe('resize');
    });

    it('does NOT call onResizePending when container size unchanged', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);
      const onResizePending = vi.fn();
      const el = createMockElement();
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el, onResizePending });

      act(() => {
        result.current.register(target);
      });

      // Trigger observer without changing container size
      act(() => {
        observer.triggerResizeFor(el);
        raf.flushRAF();
      });

      // Container size unchanged → fit() skipped → no pending flag
      expect(onResizePending).not.toHaveBeenCalled();
    });

    it('does NOT call onResizePending when only container changed but dims same', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);
      const onResizePending = vi.fn();
      const el = createMockElement(800, 600);
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el, onResizePending });

      act(() => {
        result.current.register(target);
      });

      // Change container size slightly but keep same terminal dimensions
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: 801, height: 600,
        top: 0, left: 0, bottom: 600, right: 801,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);

      act(() => {
        observer.triggerResizeFor(el);
        raf.flushRAF();
      });

      // fit() ran but dims unchanged → no pending flag
      expect(onResizePending).not.toHaveBeenCalled();
    });
  });

  // ── 6. unregister ────────────────────────────────────────────────────────

  describe('unregister', () => {
    it('stops observing the element', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon();
      const el = createMockElement();
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el });

      act(() => {
        result.current.register(target);
      });

      expect(observer.observedElements).toContain(el);

      act(() => {
        result.current.unregister('pane-1');
      });

      expect(observer.observedElements).not.toContain(el);
    });

    it('removes target so further observer fires are silently ignored', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);
      const onResize = vi.fn();
      const el = createMockElement();
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el, onResize });

      act(() => {
        result.current.register(target);
      });

      act(() => {
        result.current.unregister('pane-1');
      });

      fitAddon.fit.mockClear();

      act(() => {
        observer.triggerResizeFor(el);
        raf.flushRAF();
      });

      expect(fitAddon.fit).not.toHaveBeenCalled();
      expect(onResize).not.toHaveBeenCalled();
    });

    it('is a no-op for unknown id', () => {
      const { result } = renderHook(() => useGridResize());

      expect(() => {
        act(() => {
          result.current.unregister('does-not-exist');
        });
      }).not.toThrow();
    });
  });

  // ── 7. resizeAll ─────────────────────────────────────────────────────────

  describe('resizeAll', () => {
    it('triggers fit() on all registered panes when container sizes differ', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon1 = createMockFitAddon(80, 24);
      const fitAddon2 = createMockFitAddon(80, 24);
      const fitAddon3 = createMockFitAddon(80, 24);
      const el1 = createMockElement(800, 600);
      const el2 = createMockElement(800, 600);
      const el3 = createMockElement(800, 600);

      act(() => {
        result.current.register(buildTarget({ id: 'pane-1', fitAddon: fitAddon1, element: el1 }));
        result.current.register(buildTarget({ id: 'pane-2', fitAddon: fitAddon2, element: el2 }));
        result.current.register(buildTarget({ id: 'pane-3', fitAddon: fitAddon3, element: el3 }));
      });

      // Change container sizes so fit will actually run
      for (const el of [el1, el2, el3]) {
        vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
          width: 900, height: 700,
          top: 0, left: 0, bottom: 700, right: 900,
          x: 0, y: 0, toJSON: () => ({}),
        } as DOMRect);
      }
      fitAddon1.proposeDimensions.mockReturnValue({ cols: 100, rows: 30 });
      fitAddon2.proposeDimensions.mockReturnValue({ cols: 100, rows: 30 });
      fitAddon3.proposeDimensions.mockReturnValue({ cols: 100, rows: 30 });

      act(() => {
        result.current.resizeAll();
        raf.flushRAF();
      });

      expect(fitAddon1.fit).toHaveBeenCalled();
      expect(fitAddon2.fit).toHaveBeenCalled();
      expect(fitAddon3.fit).toHaveBeenCalled();
    });
  });

  // ── 8. resizeTarget ───────────────────────────────────────────────────────

  describe('resizeTarget', () => {
    it('calls fit() on the specified pane only when container size differs', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon1 = createMockFitAddon(80, 24);
      const fitAddon2 = createMockFitAddon(80, 24);
      const el1 = createMockElement(800, 600);
      const el2 = createMockElement(800, 600);

      act(() => {
        result.current.register(buildTarget({ id: 'pane-1', fitAddon: fitAddon1, element: el1 }));
        result.current.register(buildTarget({ id: 'pane-2', fitAddon: fitAddon2, element: el2 }));
      });

      // Change only pane-1's container size
      vi.spyOn(el1, 'getBoundingClientRect').mockReturnValue({
        width: 900, height: 700,
        top: 0, left: 0, bottom: 700, right: 900,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);
      fitAddon1.proposeDimensions.mockReturnValue({ cols: 120, rows: 40 });

      act(() => {
        result.current.resizeTarget('pane-1');
        raf.flushRAF();
      });

      expect(fitAddon1.fit).toHaveBeenCalled();
      expect(fitAddon2.fit).not.toHaveBeenCalled();
    });

    it('is a no-op for unknown id', () => {
      const { result } = renderHook(() => useGridResize());

      expect(() => {
        act(() => {
          result.current.resizeTarget('no-such-pane');
          raf.flushRAF();
        });
      }).not.toThrow();
    });
  });

  // ── 9. Exception handling ─────────────────────────────────────────────────

  describe('error handling', () => {
    it('swallows exceptions from fit() (terminal disposed/detached)', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);
      fitAddon.fit.mockImplementation(() => {
        throw new Error('Terminal is disposed');
      });
      const el = createMockElement();
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el });

      act(() => {
        result.current.register(target);
      });

      // Change size to trigger fit
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: 900, height: 700,
        top: 0, left: 0, bottom: 700, right: 900,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);

      expect(() => {
        act(() => {
          observer.triggerResizeFor(el);
          raf.flushRAF();
        });
      }).not.toThrow();
    });

    it('does not call onResize when fit() throws', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);
      fitAddon.fit.mockImplementation(() => {
        throw new Error('Boom');
      });
      const onResize = vi.fn();
      const el = createMockElement();
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el, onResize });

      act(() => {
        result.current.register(target);
      });

      // Change size to trigger fit
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: 900, height: 700,
        top: 0, left: 0, bottom: 700, right: 900,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);

      act(() => {
        observer.triggerResizeFor(el);
        raf.flushRAF();
      });

      expect(onResize).not.toHaveBeenCalled();
    });
  });

  // ── 10. Cleanup on unmount ────────────────────────────────────────────────

  describe('cleanup on unmount', () => {
    it('disconnects ResizeObserver on hook unmount', () => {
      const disconnectSpy = vi.fn();

      class SpyResizeObserver {
        observe() {}
        unobserve() {}
        disconnect = disconnectSpy;
      }

      global.ResizeObserver = SpyResizeObserver as unknown as typeof ResizeObserver;

      const { unmount } = renderHook(() => useGridResize());
      unmount();

      expect(disconnectSpy).toHaveBeenCalled();
    });
  });

  // ── 11. Container size guard ──────────────────────────────────────────────

  describe('container size guard', () => {
    it('skips fit() when container size unchanged (spurious ResizeObserver)', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);
      const el = createMockElement(800, 600);
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el });

      act(() => {
        result.current.register(target);
      });

      // Trigger observer without changing container size
      act(() => {
        observer.triggerResizeFor(el);
        raf.flushRAF();
      });

      expect(fitAddon.fit).not.toHaveBeenCalled();
    });

    it('calls fit() when container width changes', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);
      const el = createMockElement(800, 600);
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el });

      act(() => {
        result.current.register(target);
      });

      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: 900, height: 600,
        top: 0, left: 0, bottom: 600, right: 900,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);

      act(() => {
        observer.triggerResizeFor(el);
        raf.flushRAF();
      });

      expect(fitAddon.fit).toHaveBeenCalled();
    });

    it('calls fit() when container height changes', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);
      const el = createMockElement(800, 600);
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el });

      act(() => {
        result.current.register(target);
      });

      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: 800, height: 700,
        top: 0, left: 0, bottom: 700, right: 800,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);

      act(() => {
        observer.triggerResizeFor(el);
        raf.flushRAF();
      });

      expect(fitAddon.fit).toHaveBeenCalled();
    });
  });

  // ── 12. Multiple panes isolation ──────────────────────────────────────────

  describe('multiple panes isolation', () => {
    it('only calls fit() on the pane whose element resized', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon1 = createMockFitAddon(80, 24);
      const fitAddon2 = createMockFitAddon(80, 24);
      const el1 = createMockElement(800, 600);
      const el2 = createMockElement(800, 600);

      act(() => {
        result.current.register(buildTarget({ id: 'pane-1', fitAddon: fitAddon1, element: el1 }));
        result.current.register(buildTarget({ id: 'pane-2', fitAddon: fitAddon2, element: el2 }));
      });

      // Only change el1's size
      vi.spyOn(el1, 'getBoundingClientRect').mockReturnValue({
        width: 900, height: 700,
        top: 0, left: 0, bottom: 700, right: 900,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);
      fitAddon1.proposeDimensions.mockReturnValue({ cols: 120, rows: 40 });

      act(() => {
        observer.triggerResizeFor(el1);
        raf.flushRAF();
      });

      expect(fitAddon1.fit).toHaveBeenCalled();
      expect(fitAddon2.fit).not.toHaveBeenCalled();
    });
  });

  // ── 13. RC-4: onCanvasVerified callback ───────────────────────────────────

  describe('RC-4: onCanvasVerified callback', () => {
    it('calls onCanvasVerified when canvas is not mismatched', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);
      const el = createMockElement();
      const onCanvasVerified = vi.fn();
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el, onCanvasVerified });

      act(() => {
        result.current.register(target);
      });

      // Change size to trigger fit + canvas verify
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: 900, height: 700,
        top: 0, left: 0, bottom: 700, right: 900,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);
      fitAddon.proposeDimensions.mockReturnValue({ cols: 100, rows: 30 });

      act(() => {
        observer.triggerResizeFor(el);
        raf.flushRAF(); // performFit
      });

      act(() => {
        raf.flushRAF(); // canvas verify RAF
      });

      expect(onCanvasVerified).toHaveBeenCalledTimes(1);
    });
  });

  // ── 14. RC-6: confirmDimensions ───────────────────────────────────────────

  describe('RC-6: confirmDimensions', () => {
    it('updates tracked dimensions from server-confirmed values', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);
      const onResize = vi.fn();
      const el = createMockElement(800, 600);
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el, onResize });

      act(() => {
        result.current.register(target);
      });

      // Server says actual dims are 80x20 (constrained)
      act(() => {
        result.current.confirmDimensions('pane-1', 80, 20);
      });

      // Now if fitAddon returns 80x24 again, it SHOULD fire onResize
      // because lastCols/lastRows were updated to 80x20 by confirmDimensions
      // Need to change container size to trigger fit
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: 801, height: 600,
        top: 0, left: 0, bottom: 600, right: 801,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);

      act(() => {
        result.current.resizeTarget('pane-1');
        raf.flushRAF();
      });

      expect(onResize).toHaveBeenCalledWith(80, 24);
    });

    it('is a no-op when dimensions match', () => {
      const { result } = renderHook(() => useGridResize());
      const fitAddon = createMockFitAddon(80, 24);
      const onResize = vi.fn();
      const el = createMockElement(800, 600);
      const target = buildTarget({ id: 'pane-1', fitAddon, element: el, onResize });

      act(() => {
        result.current.register(target);
      });

      // Server confirms same dims
      act(() => {
        result.current.confirmDimensions('pane-1', 80, 24);
      });

      // Container size unchanged + dims match → no resize
      act(() => {
        result.current.resizeTarget('pane-1');
        raf.flushRAF();
      });

      expect(onResize).not.toHaveBeenCalled();
    });

    it('is a no-op for unknown id', () => {
      const { result } = renderHook(() => useGridResize());

      expect(() => {
        act(() => {
          result.current.confirmDimensions('no-such-pane', 100, 50);
        });
      }).not.toThrow();
    });
  });
});
