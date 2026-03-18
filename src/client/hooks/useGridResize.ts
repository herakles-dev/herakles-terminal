/**
 * useGridResize - ResizeObserver-based resize hook for CSS Grid terminals
 *
 * Replaces useResizeCoordinator with a single, unified resize path:
 *   ResizeObserver fires → requestAnimationFrame → fitAddon.fit() → done
 *
 * No debounce timers. No transition waiting. No retry loops.
 * The ONLY resize trigger for ALL scenarios.
 */

import { useRef, useCallback, useEffect } from 'react';
import type { FitAddon } from '@xterm/addon-fit';

export interface GridResizeTarget {
  id: string;
  fitAddon: FitAddon;
  element: HTMLElement;
  onResize?: (cols: number, rows: number) => void;
  isRecovering?: () => boolean;
  /** Called before onResize to buffer output during server roundtrip */
  onResizePending?: (pending: boolean) => void;
  /** RC-4: Called when canvas verify completes after a resize */
  onCanvasVerified?: () => void;
}

interface TrackedTarget {
  target: GridResizeTarget;
  rafId: number | null;
  lastCols: number;
  lastRows: number;
  /** Last observed container dimensions (CSS pixels) — skip fit() if unchanged */
  lastWidth: number;
  lastHeight: number;
  /** True if a resize was skipped during WebGL recovery */
  deferredResize: boolean;
}

/**
 * Single ResizeObserver manages all terminal panes.
 * Each pane gets RAF-debounced fit() calls when its container resizes.
 */
export function useGridResize() {
  const targetsRef = useRef<Map<string, TrackedTarget>>(new Map());
  const observerRef = useRef<ResizeObserver | null>(null);

  // Create the single shared ResizeObserver
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const id = el.dataset.gridPaneId;
        if (!id) continue;

        const tracked = targetsRef.current.get(id);
        if (!tracked) continue;

        // Cancel any pending RAF for this pane
        if (tracked.rafId !== null) {
          cancelAnimationFrame(tracked.rafId);
        }

        // Schedule fit on next frame
        tracked.rafId = requestAnimationFrame(() => {
          tracked.rafId = null;
          performFit(tracked);
        });
      }
    });

    observerRef.current = observer;

    return () => {
      observer.disconnect();
      // Cancel all pending RAFs
      for (const tracked of targetsRef.current.values()) {
        if (tracked.rafId !== null) {
          cancelAnimationFrame(tracked.rafId);
        }
      }
    };
  }, []);

  /**
   * Register a terminal pane for resize observation.
   */
  const register = useCallback((target: GridResizeTarget) => {
    const observer = observerRef.current;
    if (!observer) return;

    // Set data attribute for lookup in ResizeObserver callback
    target.element.dataset.gridPaneId = target.id;

    // Seed lastCols/lastRows from current terminal dimensions.
    // The terminal already called fit() in handleTerminalReady before registration,
    // so we skip the initial fit to avoid a redundant resize cycle that races
    // with window:subscribe and causes duplicate content / cursor jumps.
    const dims = target.fitAddon.proposeDimensions();
    const rect = target.element.getBoundingClientRect();
    const tracked: TrackedTarget = {
      target,
      rafId: null,
      lastCols: dims?.cols ?? 0,
      lastRows: dims?.rows ?? 0,
      lastWidth: Math.round(rect.width),
      lastHeight: Math.round(rect.height),
      deferredResize: false,
    };

    targetsRef.current.set(target.id, tracked);
    observer.observe(target.element);
    // No initial fit — ResizeObserver will fire if the container size differs
    // from when the terminal was first fitted in TerminalCore.
  }, []);

  /**
   * Unregister a terminal pane.
   */
  const unregister = useCallback((id: string) => {
    const tracked = targetsRef.current.get(id);
    if (!tracked) return;

    if (tracked.rafId !== null) {
      cancelAnimationFrame(tracked.rafId);
    }

    const observer = observerRef.current;
    if (observer) {
      observer.unobserve(tracked.target.element);
    }

    targetsRef.current.delete(id);
  }, []);

  /**
   * Force a resize on a specific pane (e.g., after window add/remove).
   */
  const resizeTarget = useCallback((id: string) => {
    const tracked = targetsRef.current.get(id);
    if (!tracked) return;
    requestAnimationFrame(() => performFit(tracked));
  }, []);

  /**
   * Force resize on all registered panes.
   */
  const resizeAll = useCallback(() => {
    for (const tracked of targetsRef.current.values()) {
      requestAnimationFrame(() => performFit(tracked));
    }
  }, []);

  /**
   * Notify that WebGL recovery completed for a pane.
   * If a resize was deferred during recovery, replay it now
   * with current container dimensions (single fit()).
   */
  const notifyRecoveryEnd = useCallback((id: string) => {
    const tracked = targetsRef.current.get(id);
    if (!tracked) return;

    if (tracked.deferredResize) {
      tracked.deferredResize = false;
      // Reset all tracked dims to force fit() and onResize notification
      tracked.lastCols = 0;
      tracked.lastRows = 0;
      tracked.lastWidth = 0;
      tracked.lastHeight = 0;
      requestAnimationFrame(() => performFit(tracked));
    }
  }, []);

  /**
   * RC-6: Update tracked dimensions from server-confirmed values.
   * If server constrains cols/rows (min/max), this prevents future
   * resizes to the "wrong" dimensions from being skipped.
   */
  const confirmDimensions = useCallback((id: string, cols: number, rows: number) => {
    const tracked = targetsRef.current.get(id);
    if (!tracked) return;
    tracked.lastCols = cols;
    tracked.lastRows = rows;
  }, []);

  return { register, unregister, resizeTarget, resizeAll, notifyRecoveryEnd, confirmDimensions };
}

/**
 * Tolerance in CSS pixels for canvas dimension mismatch.
 * Matches v1's CANVAS_DIMENSION_TOLERANCE.
 */
const CANVAS_DIMENSION_TOLERANCE = 4;

/**
 * Perform a single fit() call with RAF-aligned canvas verification.
 * This is the ONLY place fit() is called in the grid architecture.
 */
function performFit(tracked: TrackedTarget): void {
  const { target } = tracked;

  // Queue resize if recovering from WebGL context loss.
  // notifyRecoveryEnd() will replay the fit with final dimensions.
  if (target.isRecovering?.()) {
    tracked.deferredResize = true;
    return;
  }

  // Skip fit() entirely if the container hasn't actually changed size.
  // ResizeObserver can fire spuriously (e.g., on scroll, focus changes).
  // Calling fit() when unnecessary causes xterm to reflow content,
  // producing line duplication and cursor jumps.
  const rect = target.element.getBoundingClientRect();
  const curWidth = Math.round(rect.width);
  const curHeight = Math.round(rect.height);
  if (curWidth === tracked.lastWidth && curHeight === tracked.lastHeight
      && tracked.lastCols > 0 && tracked.lastRows > 0) {
    return;
  }
  tracked.lastWidth = curWidth;
  tracked.lastHeight = curHeight;

  try {
    target.fitAddon.fit();

    const dims = target.fitAddon.proposeDimensions();
    if (!dims) return;

    const { cols, rows } = dims;

    // Only notify server if dimensions actually changed
    if (cols !== tracked.lastCols || rows !== tracked.lastRows) {
      // Set resize pending ONLY when dimensions actually change.
      target.onResizePending?.(true);

      tracked.lastCols = cols;
      tracked.lastRows = rows;

      // RAF-align canvas verification: wait for browser paint before checking
      requestAnimationFrame(() => {
        verifyCanvasOnce(target.element, target.fitAddon, target.onCanvasVerified);
      });

      target.onResize?.(cols, rows);
    }
  } catch {
    // fit() can throw if terminal is disposed or element is detached
  }
}

/**
 * RAF-aligned canvas verification — at most 1 retry.
 * Checks both width and height with 4px tolerance (matching v1).
 * If mismatch, schedules ONE retry via another RAF. No exponential backoff.
 */
function verifyCanvasOnce(element: HTMLElement, fitAddon: FitAddon, onDone?: () => void): void {
  if (!isCanvasMismatched(element)) {
    onDone?.();
    return;
  }

  // One retry via RAF to let the re-fit paint
  try {
    fitAddon.fit();
  } catch {
    onDone?.();
    return; // Terminal disposed
  }

  requestAnimationFrame(() => {
    if (isCanvasMismatched(element)) {
      // Final attempt — no more retries
      try {
        fitAddon.fit();
      } catch {
        // Ignore
      }
    }
    onDone?.();
  });
}

/**
 * Check if the WebGL canvas dimensions match the container.
 * Returns true if there is a mismatch requiring a re-fit.
 */
function isCanvasMismatched(element: HTMLElement): boolean {
  const canvas = element.querySelector('canvas');
  if (!canvas) return false;

  // Compare against the canvas's closest terminal container, not the outer grid pane.
  // The outer pane includes the title bar, so comparing against it always finds a
  // height mismatch, causing unnecessary extra fit() calls.
  const termContainer = canvas.closest('[data-terminal-id]') as HTMLElement ?? element;

  // RC-5: Force layout flush so getBoundingClientRect returns post-layout dimensions.
  void termContainer.offsetHeight;

  const rect = termContainer.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  // Compare in CSS pixels (not device pixels) to avoid false negatives at fractional DPR
  const widthMismatch = Math.abs(canvas.width / dpr - rect.width) > CANVAS_DIMENSION_TOLERANCE;
  const heightMismatch = Math.abs(canvas.height / dpr - rect.height) > CANVAS_DIMENSION_TOLERANCE;

  return widthMismatch || heightMismatch;
}
