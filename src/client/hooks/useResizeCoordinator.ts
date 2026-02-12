import { useEffect, useRef, useCallback } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import { RESIZE_CONSTANTS } from '@shared/constants';

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
const COALESCE_DEBOUNCE_MS = 100;
const RESIZE_TIMEOUT_MS = 3000;
// Tolerance in pixels for canvas dimension mismatch detection
const CANVAS_DIMENSION_TOLERANCE = 2;

/**
 * FIX WG-1: Verify WebGL canvas dimensions match container
 * Returns true if canvas is properly synced, false if dimensions mismatch
 *
 * After fitAddon.fit(), the WebGL canvas should resize to match the container.
 * If it doesn't, we get a black area on the right/bottom where canvas is smaller.
 */
function verifyWebGLCanvasSync(termElement: HTMLElement | null): boolean {
  if (!termElement) return true; // Can't verify, assume OK

  const canvases = termElement.querySelectorAll('canvas');

  for (const canvas of canvases) {
    try {
      // Only check WebGL canvases (XTerm's default canvases use 2D context)
      const gl = (canvas as HTMLCanvasElement).getContext('webgl2', { failIfMajorPerformanceCaveat: true });
      if (gl && !gl.isContextLost()) {
        const rect = termElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const targetWidth = Math.floor(rect.width * dpr);
        const targetHeight = Math.floor(rect.height * dpr);

        // Check if dimensions need sync (allow tolerance for rounding)
        if (Math.abs(canvas.width - targetWidth) > CANVAS_DIMENSION_TOLERANCE ||
            Math.abs(canvas.height - targetHeight) > CANVAS_DIMENSION_TOLERANCE) {
          console.debug(
            `[ResizeCoordinator] Canvas dimension mismatch: ` +
            `canvas ${canvas.width}x${canvas.height} vs expected ~${targetWidth}x${targetHeight}`
          );
          return false; // Dimensions don't match - needs another fit
        }
        return true; // Dimensions match
      }
    } catch {
      // getContext can throw if context type doesn't match existing
    }
  }

  return true; // No WebGL canvas found or couldn't verify, assume OK
}

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

  const performAtomicResize = useCallback((target: ResizeTarget) => {
    // FIX RS-2: Skip resize if terminal is recovering from WebGL context loss
    if (target.isRecovering?.()) {
      console.debug(`[ResizeCoordinator] Skipping resize for ${target.id} - recovery in progress`);
      return;
    }

    // FIX RS-1: Wait for CSS paint with double RAF
    // This prevents black screen where WebGL canvas hasn't resized yet
    // First RAF: queues callback for next frame
    // Second RAF: ensures CSS transitions have completed and browser has painted
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // FIX RS-2: Double-check recovery status after RAF delay
        // Recovery might have started during the RAF delay
        if (target.isRecovering?.()) {
          console.debug(`[ResizeCoordinator] Aborting resize for ${target.id} - recovery started during RAF`);
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

          // FIX WG-1: Verify WebGL canvas dimensions after fit
          // If canvas didn't resize to match container, schedule another fit
          const termElement = target.getTermElement?.() ||
            document.querySelector(`[data-terminal-id="${target.id}"]`) as HTMLElement | null;

          if (termElement && !verifyWebGLCanvasSync(termElement)) {
            // Canvas dimensions don't match - try one more fit after next paint
            requestAnimationFrame(() => {
              if (target.isRecovering?.()) return; // Abort if recovery started
              try {
                target.fitAddon.fit();
                // Log if retry also failed
                if (!verifyWebGLCanvasSync(termElement)) {
                  console.warn(`[ResizeCoordinator] Canvas sync still mismatched after retry for ${target.id}`);
                }
              } catch {
                // Silently ignore retry failures
              }
            });
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
      });
    });
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

  const triggerResize = useCallback(() => {
    if (animationStateRef.current.isAnimating) {
      animationStateRef.current.pendingResize = true;
      return;
    }

    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }

    resizeTimeoutRef.current = setTimeout(() => {
      resizeTimeoutRef.current = null;

      if (animationStateRef.current.isAnimating) {
        animationStateRef.current.pendingResize = true;
        return;
      }

      // FIX: Batch-level lock prevents concurrent resize batches
      // (e.g., layout drag + browser resize firing simultaneously)
      if (isResizingRef.current) {
        return;
      }
      isResizingRef.current = true;

      requestAnimationFrame(() => {
        const targets = Array.from(targetsRef.current.values());
        for (const target of targets) {
          performAtomicResize(target);
        }
        // Release lock after next RAF to ensure all paints complete
        requestAnimationFrame(() => {
          isResizingRef.current = false;
        });
      });
    }, COALESCE_DEBOUNCE_MS);
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

  useEffect(() => {
    window.addEventListener('resize', triggerResize, { passive: true });

    return () => {
      window.removeEventListener('resize', triggerResize);

      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      pendingResizesRef.current.forEach(pending => clearTimeout(pending.timeoutId));
      pendingResizesRef.current.clear();
    };
  }, [triggerResize]);

  return {
    register,
    triggerResize,
    isResizeLocked,
    isResizePending,
    confirmResize,
    getStats,
    setAnimating,
  };
}
