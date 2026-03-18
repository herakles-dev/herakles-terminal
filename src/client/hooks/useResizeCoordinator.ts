/**
 * @deprecated v1 resize coordinator — use useGridResize.ts instead.
 *
 * This 453-line debounce-based coordinator is the fallback when USE_GRID_LAYOUT = false.
 * The v2 replacement (useGridResize) achieves the same with ~140 lines via ResizeObserver.
 *
 * Migration path:
 * - v2 uses ResizeObserver → RAF → fitAddon.fit() (single path for ALL resize triggers)
 * - v2 has no debounce timers, no CSS transition waiting, no retry loops
 * - v2 is the default since v1.2.1 (USE_GRID_LAYOUT = true in constants.ts)
 *
 * This file will be removed once the v1 SplitView layout is fully retired.
 */

import { useEffect, useRef, useCallback } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import { RESIZE_CONSTANTS } from '@shared/constants';

/** @deprecated Use GridResizeTarget from useGridResize.ts instead */
export interface ResizeTarget {
  id: string;
  fitAddon: FitAddon;
  onResize?: (cols: number, rows: number) => void;
  /**
   * FIX RS-2: Check if terminal is recovering from WebGL context loss
   * Resize should be blocked during recovery to prevent dimension mismatch
   */
  isRecovering?: () => boolean;
  /**
   * FIX WG-1: Get terminal element for WebGL canvas dimension verification
   * Used to verify canvas pixel dimensions match container after fit
   */
  getTermElement?: () => HTMLElement | null;
}

/**
 * Options for registering a resize target.
 * @deprecated Use useGridResize.ts instead
 */
export interface RegisterOptions {
  /**
   * Skip the initial resize that normally happens on register.
   * Use this when the caller will do their own fit() after async setup (e.g., WebGL init).
   */
  skipInitialResize?: boolean;
}

interface PendingResize {
  cols: number;
  rows: number;
  expiresAt: number;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface AnimationState {
  isAnimating: boolean;
  pendingResize: boolean;
}

const MIN_COLS = RESIZE_CONSTANTS.minCols;
const MIN_ROWS = RESIZE_CONSTANTS.minRows;
const COALESCE_DEBOUNCE_MS = 150;
const RESIZE_TIMEOUT_MS = 3000;
const CANVAS_DIMENSION_TOLERANCE = 4; // RC-3 fix: relaxed from 2 to reduce false mismatches
const TRANSITION_WAIT_TIMEOUT_MS = 300;
const CANVAS_VERIFY_MAX_RETRIES = 1; // Single retry — avoids visible "reset" flicker
const CANVAS_VERIFY_DELAYS = [32]; // One RAF-aligned delay
const RESIZE_OBSERVER_FALLBACK_MS = 150; // Fallback if ResizeObserver doesn't fire
const TRANSITION_PROPERTIES = new Set(['all', 'width', 'height', 'left', 'top', 'transform']);

/**
 * Walk up the DOM tree to find an ancestor with an active CSS transition on layout properties.
 * CSS transition-duration is NOT inherited, so we must check each ancestor explicitly.
 * Returns the element with the transition, or null if none found.
 */
function findTransitionAncestor(element: HTMLElement, maxDepth = 5): HTMLElement | null {
  let current: HTMLElement | null = element;
  for (let depth = 0; depth < maxDepth && current; depth++) {
    const style = getComputedStyle(current);
    const durations = style.transitionDuration?.split(',').map(s => s.trim()) || [];
    const properties = style.transitionProperty?.split(',').map(s => s.trim()) || [];

    for (let i = 0; i < properties.length; i++) {
      const prop = properties[i];
      const dur = durations[i] || durations[0] || '0s';
      if (TRANSITION_PROPERTIES.has(prop) && dur !== '0s' && dur !== 'none') {
        return current;
      }
    }

    current = current.parentElement;
  }
  return null;
}

/**
 * Verify WebGL canvas dimensions with retry and exponential backoff.
 * Returns true if canvas is properly synced after all retries.
 */
async function verifyWebGLCanvasSyncWithRetry(
  termElement: HTMLElement | null,
  fitAddon: FitAddon,
  isRecovering?: () => boolean
): Promise<boolean> {
  if (!termElement) return true;

  for (let attempt = 0; attempt < CANVAS_VERIFY_MAX_RETRIES; attempt++) {
    if (verifyWebGLCanvasSync(termElement)) {
      return true;
    }

    if (isRecovering?.()) return true; // Abort if recovery started

    // RC-3 fix: Wait using RAF + small delay to sync with browser paint cycle
    const delay = CANVAS_VERIFY_DELAYS[attempt] ?? 48;
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => setTimeout(resolve, delay));
    });

    if (isRecovering?.()) return true;

    try {
      fitAddon.fit();
    } catch {
      // Silently ignore fit failures during retry
    }
  }

  // All retries exhausted - log detailed state
  if (termElement) {
    const rect = termElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const canvases = Array.from(termElement.querySelectorAll('canvas'));
    console.error(
      `[ResizeCoordinator] Canvas sync failed after ${CANVAS_VERIFY_MAX_RETRIES} retries\n` +
      `  Container: ${rect.width}x${rect.height} (DPR: ${dpr})\n` +
      `  Canvases: ${canvases.map(c => `${c.width}x${c.height}`).join(', ')}`
    );
  }
  return false;
}

/**
 * FIX WG-1: Verify canvas dimensions match container
 * Returns true if canvas is properly synced, false if dimensions mismatch
 *
 * After fitAddon.fit(), the canvas should resize to match the container.
 * If it doesn't, we get a black area on the right/bottom where canvas is smaller.
 *
 * NOTE: Does NOT call getContext() — that's expensive and can interfere with
 * existing WebGL contexts. Just compares pixel dimensions directly.
 */
function verifyWebGLCanvasSync(termElement: HTMLElement | null): boolean {
  if (!termElement) return true;

  // Find the largest canvas (WebGL render canvas, not the text measure canvas)
  const canvases = termElement.querySelectorAll('canvas');
  if (canvases.length === 0) return true;

  const rect = termElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.floor(rect.width * dpr);
  const targetHeight = Math.floor(rect.height * dpr);

  for (const canvas of canvases) {
    // Skip tiny canvases (text measurement, cursor, etc.)
    if (canvas.width < 100 && canvas.height < 100) continue;

    if (Math.abs(canvas.width - targetWidth) > CANVAS_DIMENSION_TOLERANCE ||
        Math.abs(canvas.height - targetHeight) > CANVAS_DIMENSION_TOLERANCE) {
      return false;
    }
    return true; // First large canvas matches
  }

  return true;
}

/** @deprecated Use useGridResize() instead. Kept as fallback when USE_GRID_LAYOUT = false. */
export function useResizeCoordinator() {
  const targetsRef = useRef<Map<string, ResizeTarget>>(new Map());
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationStateRef = useRef<AnimationState>({ isAnimating: false, pendingResize: false });
  const pendingResizesRef = useRef<Map<string, PendingResize>>(new Map());
  // FIX: Resize lock to prevent concurrent fits from layout drag + browser resize
  const isResizingRef = useRef(false);

  const isResizePending = useCallback((targetId: string): boolean => {
    const pending = pendingResizesRef.current.get(targetId);
    if (!pending) return false;
    if (Date.now() > pending.expiresAt) {
      clearTimeout(pending.timeoutId);
      pendingResizesRef.current.delete(targetId);
      return false;
    }
    return true;
  }, []);

  const confirmResize = useCallback((targetId: string, cols: number, rows: number) => {
    const pending = pendingResizesRef.current.get(targetId);
    if (!pending) return;

    if (pending.cols === cols && pending.rows === rows) {
      clearTimeout(pending.timeoutId);
      pendingResizesRef.current.delete(targetId);
    }
  }, []);

  const performAtomicResize = useCallback((target: ResizeTarget, immediate = false): Promise<void> => {
    // FIX RS-2: Skip resize if terminal is recovering from WebGL context loss
    if (target.isRecovering?.()) {
      console.debug(`[ResizeCoordinator] Skipping resize for ${target.id} - recovery in progress`);
      return Promise.resolve();
    }

    const executeResize = async () => {
      if (target.isRecovering?.()) {
        console.debug(`[ResizeCoordinator] Aborting resize for ${target.id} - recovery started during wait`);
        return;
      }

      try {
        const dims = target.fitAddon.proposeDimensions();
        if (!dims || dims.cols < MIN_COLS || dims.rows < MIN_ROWS) {
          return;
        }

        const pending = pendingResizesRef.current.get(target.id);
        if (pending && pending.cols === dims.cols && pending.rows === dims.rows) {
          return;
        }

        target.fitAddon.fit();

        // Only verify canvas sync on immediate resizes (post-recovery, initial setup).
        // Skip during drag/debounced resizes — canvas will catch up on the next fit().
        if (immediate) {
          const termElement = target.getTermElement?.() ||
            document.querySelector(`[data-terminal-id="${target.id}"]`) as HTMLElement | null;

          if (termElement) {
            await verifyWebGLCanvasSyncWithRetry(termElement, target.fitAddon, target.isRecovering);
          }
        }

        if (target.onResize) {
          const existingPending = pendingResizesRef.current.get(target.id);
          if (existingPending) {
            clearTimeout(existingPending.timeoutId);
          }

          const timeoutId = setTimeout(() => {
            pendingResizesRef.current.delete(target.id);
          }, RESIZE_TIMEOUT_MS);

          pendingResizesRef.current.set(target.id, {
            cols: dims.cols,
            rows: dims.rows,
            expiresAt: Date.now() + RESIZE_TIMEOUT_MS,
            timeoutId,
          });

          target.onResize(dims.cols, dims.rows);
        }

      } catch (e) {
        console.warn(`[ResizeCoordinator] Atomic resize failed for ${target.id}:`, e);
      }
    };

    // Wait for CSS transitions to settle, then execute resize in RAF
    const termElement = target.getTermElement?.() ||
      document.querySelector(`[data-terminal-id="${target.id}"]`) as HTMLElement | null;

    if (!immediate && termElement) {
      // FIX Bug 3: Walk up DOM to find ancestor with active transition (not just termElement)
      const transitionEl = findTransitionAncestor(termElement);

      if (transitionEl) {
        // Wait for transition to end, then resize
        return new Promise<void>((resolve) => {
          let resolved = false;
          const done = () => {
            if (resolved) return;
            resolved = true;
            transitionEl.removeEventListener('transitionend', done);
            requestAnimationFrame(() => { executeResize().then(resolve, resolve); });
          };
          transitionEl.addEventListener('transitionend', done, { once: true });
          setTimeout(done, TRANSITION_WAIT_TIMEOUT_MS);
        });
      }
    }

    // No transitions or immediate mode: use ResizeObserver to wait for final layout
    if (!immediate && termElement) {
      return new Promise<void>((resolve) => {
        let fired = false;
        const observer = new ResizeObserver(() => {
          if (fired) return;
          fired = true;
          observer.disconnect();
          clearTimeout(fallbackTimer);
          requestAnimationFrame(() => { executeResize().then(resolve, resolve); });
        });
        observer.observe(termElement);
        // Fallback timeout in case element size didn't change (ResizeObserver won't fire)
        const fallbackTimer = setTimeout(() => {
          if (fired) return;
          fired = true;
          observer.disconnect();
          requestAnimationFrame(() => { executeResize().then(resolve, resolve); });
        }, RESIZE_OBSERVER_FALLBACK_MS);
      });
    } else {
      // Immediate mode: use double-RAF for CSS paint
      return new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            executeResize().then(resolve, resolve);
          });
        });
      });
    }
  }, []);

  const register = useCallback((target: ResizeTarget, options?: RegisterOptions) => {
    targetsRef.current.set(target.id, target);

    // Only auto-resize if not skipped
    // TerminalCore skips this to do its own fit() after WebGL is ready
    if (!options?.skipInitialResize) {
      requestAnimationFrame(() => {
        if (!targetsRef.current.has(target.id)) return;
        performAtomicResize(target);
      });
    }

    return () => {
      targetsRef.current.delete(target.id);
      const pending = pendingResizesRef.current.get(target.id);
      if (pending) {
        clearTimeout(pending.timeoutId);
        pendingResizesRef.current.delete(target.id);
      }
    };
  }, [performAtomicResize]);

  /**
   * Trigger resize for all registered targets.
   * @param immediate - Skip debounce (used for initial setup, post-recovery).
   *                    When immediate, also skips CSS transition waiting.
   * @param onComplete - Called after all resize operations finish (including async canvas verify).
   *                     Use this to safely re-enable transitions after resize completes.
   */
  const triggerResize = useCallback((immediate = false, onComplete?: () => void) => {
    if (animationStateRef.current.isAnimating) {
      animationStateRef.current.pendingResize = true;
      onComplete?.();
      return;
    }

    const doResizeAll = () => {
      if (animationStateRef.current.isAnimating) {
        animationStateRef.current.pendingResize = true;
        onComplete?.();
        return;
      }

      if (isResizingRef.current) {
        onComplete?.();
        return;
      }
      isResizingRef.current = true;

      requestAnimationFrame(() => {
        const targets = Array.from(targetsRef.current.values());
        const promises = targets.map(target => performAtomicResize(target, immediate));
        // FIX Bug 4: Wait for ALL resize promises (including async canvas verify) before releasing lock
        Promise.all(promises).then(() => {
          isResizingRef.current = false;
          onComplete?.();
        }, () => {
          isResizingRef.current = false;
          onComplete?.();
        });
      });
    };

    if (immediate) {
      // Skip debounce for initial setup, recovery, etc.
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = null;
      }
      doResizeAll();
    } else {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(() => {
        resizeTimeoutRef.current = null;
        doResizeAll();
      }, COALESCE_DEBOUNCE_MS);
    }
  }, [performAtomicResize]);

  /**
   * Trigger an immediate resize for a specific target by ID.
   * Used by TerminalCore after fontSize changes and post-recovery.
   */
  const resizeTarget = useCallback((targetId: string, immediate = false) => {
    const target = targetsRef.current.get(targetId);
    if (target) {
      performAtomicResize(target, immediate);
    }
  }, [performAtomicResize]);

  const setAnimating = useCallback((animating: boolean) => {
    animationStateRef.current.isAnimating = animating;
    if (!animating && animationStateRef.current.pendingResize) {
      animationStateRef.current.pendingResize = false;
      triggerResize();
    }
  }, [triggerResize]);

  const isResizeLocked = useCallback((): boolean => {
    return isResizingRef.current;
  }, []);

  const getStats = useCallback(() => {
    return {
      registeredCount: targetsRef.current.size,
      pendingResizes: pendingResizesRef.current.size,
      pendingTargets: Array.from(pendingResizesRef.current.keys()),
    };
  }, []);

  // Wrap triggerResize for use as event listener (browser resize passes Event, not boolean)
  const handleBrowserResize = useCallback(() => {
    triggerResize(false);
  }, [triggerResize]);

  useEffect(() => {
    window.addEventListener('resize', handleBrowserResize, { passive: true });
    window.addEventListener('orientationchange', handleBrowserResize, { passive: true });

    return () => {
      window.removeEventListener('resize', handleBrowserResize);
      window.removeEventListener('orientationchange', handleBrowserResize);

      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      pendingResizesRef.current.forEach(pending => clearTimeout(pending.timeoutId));
      pendingResizesRef.current.clear();
    };
  }, [handleBrowserResize]);

  return {
    register,
    triggerResize,
    resizeTarget,
    isResizeLocked,
    isResizePending,
    confirmResize,
    getStats,
    setAnimating,
  };
}
