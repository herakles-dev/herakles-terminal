import { useCallback, useRef } from 'react';
import type { WebGLHealthMonitor, WebGLHealthMetrics } from '../services/WebGLHealthMonitor';
import type { OutputPipelineManager } from '../services/OutputPipelineManager';
import type { TerminalCoreHandle } from '../components/TerminalCore/TerminalCore';

// Toast context types
interface ToastContextValue {
  showToast: (type: 'success' | 'error' | 'warning' | 'info', message: string, duration?: number) => void;
  success: (message: string, options?: { duration?: number }) => void;
  error: (message: string, options?: { duration?: number }) => void;
  warning: (message: string, options?: { duration?: number }) => void;
  info: (message: string, options?: { duration?: number }) => void;
}

export interface UseHealthActionsOptions {
  healthMonitor: { current: WebGLHealthMonitor | null };
  terminalRefs: { current: Map<string, TerminalCoreHandle> };
  outputPipelineRef: { current: OutputPipelineManager | null };
  toast: ToastContextValue;
}

interface ToastThrottle {
  lastWarnTime: number;
  lastCriticalTime: number;
}

const TOAST_THROTTLE_MS = 60_000; // 60 seconds between same severity toasts

/**
 * Hook for proactive health-based actions.
 *
 * Implements the missing Phase 2 of WebGL stability:
 * - Dynamic scrollback adjustment based on health score
 * - User warnings via toast notifications (debounced)
 * - Forced throttle mode override for output pipeline
 *
 * @example
 * const { applyHealthActions } = useHealthActions({
 *   healthMonitor: healthMonitorRef.current,
 *   terminalRefs,
 *   outputPipeline: outputPipelineRef.current,
 *   toast,
 * });
 *
 * // In WebGLHealthMonitor callback:
 * applyHealthActions(metrics);
 */
export function useHealthActions(options: UseHealthActionsOptions) {
  const { terminalRefs, outputPipelineRef, toast } = options;

  const toastThrottleRef = useRef<ToastThrottle>({
    lastWarnTime: 0,
    lastCriticalTime: 0,
  });

  /**
   * Calculate target scrollback based on health score.
   *
   * Scrollback map:
   * - 80-100: 5000 lines (normal)
   * - 60-79:  3000 lines (light reduction)
   * - 40-59:  1500 lines (moderate reduction)
   * - 0-39:   500 lines (aggressive reduction)
   */
  const getTargetScrollback = useCallback((healthScore: number): number => {
    if (healthScore >= 80) return 5000;  // Normal
    if (healthScore >= 60) return 3000;  // Light reduction (40% less)
    if (healthScore >= 40) return 1500;  // Moderate reduction (70% less)
    return 500;  // Aggressive reduction (90% less)
  }, []);

  /**
   * Get forced throttle mode based on health score.
   *
   * Mode map:
   * - 0-39:  'critical' (most aggressive)
   * - 40-59: 'heavy'
   * - 60-79: 'light'
   * - 80+:   undefined (no override, use calculated mode)
   */
  const getForcedThrottleMode = useCallback((healthScore: number): 'light' | 'heavy' | 'critical' | undefined => {
    if (healthScore < 40) return 'critical';
    if (healthScore < 60) return 'heavy';
    if (healthScore < 80) return 'light';
    return undefined;  // No override
  }, []);

  /**
   * Show debounced toast notifications for health warnings.
   *
   * Debounce rules:
   * - warn_user: Max once per 60 seconds
   * - reinit_required: Max once per 60 seconds
   * - Different severity levels don't block each other
   */
  const showHealthToast = useCallback((recommendation: WebGLHealthMetrics['recommendation'], healthScore: number) => {
    const now = Date.now();
    const throttle = toastThrottleRef.current;

    if (recommendation === 'warn_user') {
      if (now - throttle.lastWarnTime >= TOAST_THROTTLE_MS) {
        toast.warning(
          `Terminal performance degraded (health: ${healthScore}). Consider refreshing if issues persist.`,
          { duration: 8000 }
        );
        throttle.lastWarnTime = now;
      }
    } else if (recommendation === 'reinit_required') {
      if (now - throttle.lastCriticalTime >= TOAST_THROTTLE_MS) {
        toast.error(
          `Terminal stability critical (health: ${healthScore}). Please refresh to continue.`,
          { duration: 10000 }
        );
        throttle.lastCriticalTime = now;
      }
    }
  }, [toast]);

  /**
   * Apply all health-based actions based on current metrics.
   *
   * Actions performed:
   * 1. Adjust scrollback for all terminals
   * 2. Show user warnings (debounced)
   * 3. Override output pipeline throttle mode
   */
  const applyHealthActions = useCallback((metrics: WebGLHealthMetrics) => {
    const { healthScore, recommendation } = metrics;

    // Action 1: Adjust scrollback for all terminals
    const targetScrollback = getTargetScrollback(healthScore);
    terminalRefs.current?.forEach((handle, windowId) => {
      if (handle.terminal && handle.terminal.options.scrollback !== targetScrollback) {
        const oldScrollback = handle.terminal.options.scrollback;
        handle.terminal.options.scrollback = targetScrollback;
        console.log(
          `[HealthActions] Adjusted scrollback for window ${windowId}: ${oldScrollback} → ${targetScrollback}`
        );
      }
    });

    // Action 2: Show user warnings (debounced)
    if (recommendation === 'warn_user' || recommendation === 'reinit_required') {
      showHealthToast(recommendation, healthScore);
    }

    // Action 3: Override throttle mode based on health — read ref at call time
    // so the pipeline instance is always current (not captured at render time)
    const forcedMode = getForcedThrottleMode(healthScore);
    const pipeline = outputPipelineRef.current;
    if (pipeline) {
      pipeline.setForcedThrottleMode(forcedMode);
      if (forcedMode) {
        console.log(`[HealthActions] Forced throttle mode: ${forcedMode} (health: ${healthScore})`);
      }
    }
  }, [getTargetScrollback, getForcedThrottleMode, showHealthToast, terminalRefs, outputPipelineRef]);

  return { applyHealthActions };
}
