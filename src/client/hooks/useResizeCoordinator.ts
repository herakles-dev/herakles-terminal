import { useEffect, useRef, useCallback } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import { RESIZE_CONSTANTS } from '@shared/constants';

export interface ResizeTarget {
  id: string;
  fitAddon: FitAddon;
  onResize?: (cols: number, rows: number) => void;
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

export function useResizeCoordinator() {
  const targetsRef = useRef<Map<string, ResizeTarget>>(new Map());
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationStateRef = useRef<AnimationState>({ isAnimating: false, pendingResize: false });
  const pendingResizesRef = useRef<Map<string, PendingResize>>(new Map());

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
  }, []);

  const register = useCallback((target: ResizeTarget) => {
    targetsRef.current.set(target.id, target);

    requestAnimationFrame(() => {
      if (!targetsRef.current.has(target.id)) return;
      performAtomicResize(target);
    });

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

      requestAnimationFrame(() => {
        const targets = Array.from(targetsRef.current.values());
        for (const target of targets) {
          performAtomicResize(target);
        }
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
    isResizePending,
    confirmResize,
    getStats,
    setAnimating,
  };
}
