import { useCallback, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import type { WebGLHealthMonitor } from '../services/WebGLHealthMonitor';

export type RendererType = 'webgl';

export type RendererState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'active'; type: RendererType }
  | { status: 'context_lost' }
  | { status: 'disposing' }
  | { status: 'reinitializing'; attempts: number }
  | { status: 'validating' }
  | { status: 'failed'; lastError?: string };

/**
 * Result returned by setupRenderer after async initialization completes.
 * Used by TerminalCore to ensure WebGL is ready before calling fit/onReady.
 */
export interface SetupResult {
  success: boolean;
  rendererType: RendererType | null;
  error?: string;
}

export interface UseRendererSetupOptions {
  terminalId?: string;
  enableWebGL?: boolean;
  onStateChange?: (state: RendererState) => void;
  /**
   * Called when WebGL recovery starts, before term.clear()
   * Use this to pause the output pipeline and clear buffers
   */
  onRecoveryStart?: (terminalId: string) => void;
  /**
   * Called when WebGL recovery ends
   * @param success - true if recovery succeeded, false if it failed
   */
  onRecoveryEnd?: (terminalId: string, success: boolean) => void;
  /**
   * Health monitor for proactive GPU memory management
   */
  healthMonitor?: WebGLHealthMonitor;
}

export interface UseRendererSetupReturn {
  setupRenderer: (term: XTerm) => Promise<SetupResult>;
  activeRenderer: RendererType | null;
  rendererState: RendererState;
  dispose: () => void;
}

const MAX_RECOVERY_ATTEMPTS = 3;
// Reduced scrollback after context loss to free GPU memory
const RECOVERY_SCROLLBACK_LIMIT = 5000;
// Timeout for WebGL initialization to prevent hanging
const WEBGL_INIT_TIMEOUT_MS = 3000;
// Tolerance for canvas dimension validation (pixels)
const CANVAS_DIMENSION_TOLERANCE = 10;

/**
 * FIX WG-3: Validate WebGL state after recovery
 * Checks that WebGL context is valid and canvas dimensions match container
 */
function validateWebGLState(
  term: XTerm,
  _terminalId: string
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!term.element) {
    issues.push('Terminal element not found');
    return { valid: false, issues };
  }

  const canvases = term.element.querySelectorAll('canvas');
  let webglCanvas: HTMLCanvasElement | null = null;

  for (const canvas of canvases) {
    try {
      const gl = (canvas as HTMLCanvasElement).getContext('webgl2');
      if (gl) {
        webglCanvas = canvas as HTMLCanvasElement;
        if (gl.isContextLost()) {
          issues.push('WebGL context is lost');
        }
        break;
      }
    } catch {
      // Context type mismatch
    }
  }

  if (!webglCanvas) {
    issues.push('WebGL canvas not found');
  } else {
    const rect = term.element.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const expectedWidth = Math.floor(rect.width * dpr);

    if (Math.abs(webglCanvas.width - expectedWidth) > CANVAS_DIMENSION_TOLERANCE) {
      issues.push(`Canvas width mismatch: ${webglCanvas.width} vs expected ~${expectedWidth}`);
    }
  }

  return { valid: issues.length === 0, issues };
}

export function useRendererSetup(
  options: UseRendererSetupOptions = {}
): UseRendererSetupReturn {
  const {
    terminalId = 'Terminal',
    enableWebGL = true,
    onStateChange,
    onRecoveryStart,
    onRecoveryEnd,
    healthMonitor,
  } = options;

  const rendererStateRef = useRef<RendererState>({ status: 'idle' });
  const mountedRef = useRef(true);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const recoveryAttemptsRef = useRef(0);
  const originalScrollbackRef = useRef<number | null>(null);

  const setState = useCallback((state: RendererState) => {
    rendererStateRef.current = state;
    onStateChange?.(state);
  }, [onStateChange]);

  const getActiveRenderer = useCallback((): RendererType | null => {
    const state = rendererStateRef.current;
    if (state.status === 'active') {
      return state.type;
    }
    return null;
  }, []);

  const setupRenderer = useCallback(async (term: XTerm, isRecovery = false): Promise<SetupResult> => {
    if (!term.element) {
      const error = 'term.element is null';
      console.error(`[${terminalId}] Cannot setup renderer: ${error}`);
      setState({ status: 'failed', lastError: error });
      return { success: false, rendererType: null, error };
    }

    mountedRef.current = true;

    // Only reset recovery counter on initial setup, not during recovery
    if (!isRecovery) {
      recoveryAttemptsRef.current = 0;
    }

    if (!enableWebGL) {
      const error = 'WebGL disabled';
      console.error(`[${terminalId}] WebGL disabled - no renderer available`);
      setState({ status: 'failed', lastError: error });
      return { success: false, rendererType: null, error };
    }

    setState({ status: 'loading' });

    try {
      const webglAddon = new WebglAddon();
      webglAddonRef.current = webglAddon;

      webglAddon.onContextLoss(() => {
        console.error(`[${terminalId}] WebGL context lost`);

        // Report context loss to health monitor
        healthMonitor?.recordContextLoss();

        // STATE: CONTEXT_LOST - Immediately pause pipeline
        setState({ status: 'context_lost' });
        onRecoveryStart?.(terminalId);

        if (recoveryAttemptsRef.current >= MAX_RECOVERY_ATTEMPTS) {
          console.error(`[${terminalId}] WebGL context lost - max recovery attempts reached`);
          webglAddon.dispose();
          webglAddonRef.current = null;
          setState({ status: 'failed', lastError: 'WebGL context lost after max recovery attempts' });
          onRecoveryEnd?.(terminalId, false);
          return;
        }

        recoveryAttemptsRef.current++;

        // STATE: DISPOSING - Clean up old WebGL addon
        setTimeout(() => {
          // Guard against term teardown racing the delayed callback. `term.options`
          // can be undefined during test teardown or if the terminal was disposed
          // between context-loss and this tick — touching it would throw.
          if (!mountedRef.current || !term.element || !term.options) {
            onRecoveryEnd?.(terminalId, false);
            return;
          }

          setState({ status: 'disposing' });
          webglAddon.dispose();
          webglAddonRef.current = null;

          // Clear buffer and reduce scrollback to free GPU memory
          if (originalScrollbackRef.current === null) {
            originalScrollbackRef.current = term.options.scrollback ?? 20000;
          }

          console.warn(`[${terminalId}] Clearing buffer and reducing scrollback (${originalScrollbackRef.current} → ${RECOVERY_SCROLLBACK_LIMIT}) for WebGL recovery`);
          term.clear();
          term.options.scrollback = RECOVERY_SCROLLBACK_LIMIT;

          // STATE: REINITIALIZING - Create new WebGL addon
          setState({ status: 'reinitializing', attempts: recoveryAttemptsRef.current });
          setupRenderer(term, true);
        }, 100 * recoveryAttemptsRef.current);
      });

      // loadAddon throws synchronously if WebGL2 is not supported
      term.loadAddon(webglAddon);

      if (!mountedRef.current || !term.element) {
        const error = 'Component unmounted or no element';
        setState({ status: 'failed', lastError: error });
        return { success: false, rendererType: null, error };
      }

      // Wait a frame for WebGL to initialize its canvas, with timeout protection
      const waitForFrame = () => new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('WebGL init timeout')), WEBGL_INIT_TIMEOUT_MS)
      );

      try {
        await Promise.race([waitForFrame(), timeoutPromise]);
      } catch (e) {
        const error = 'WebGL init timeout';
        console.error(`[${terminalId}] ${error}`);
        webglAddon.dispose();
        webglAddonRef.current = null;
        setState({ status: 'failed', lastError: error });
        return { success: false, rendererType: null, error };
      }

      // Verify WebGL is actually working by finding a canvas with WebGL2 context
      // XTerm's default canvases use 2D context, WebGL addon uses WebGL2
      // This prevents false positives where we detect XTerm's 2D canvases instead
      const canvases = term.element.querySelectorAll('canvas');
      let webglCanvas: HTMLCanvasElement | null = null;

      for (const canvas of canvases) {
        try {
          // getContext returns existing context if already created
          // XTerm default canvases have 2D context → returns null for webgl2
          // WebGL addon canvas has WebGL2 context → returns the context
          const gl = (canvas as HTMLCanvasElement).getContext('webgl2');
          if (gl) {
            webglCanvas = canvas as HTMLCanvasElement;
            break;
          }
        } catch {
          // getContext can throw if context type doesn't match existing
        }
      }

      if (!webglCanvas) {
        const error = 'WebGL2 context not found - addon may have failed silently';
        console.error(`[${terminalId}] WebGL addon loaded but no WebGL2 context found`);
        webglAddon.dispose();
        webglAddonRef.current = null;
        setState({ status: 'failed', lastError: error });
        return { success: false, rendererType: null, error };
      }

      // STATE: VALIDATING (recovery) or ACTIVE (initial)
      if (isRecovery) {
        setState({ status: 'validating' });

        recoveryAttemptsRef.current = 0;
        console.info(`[${terminalId}] WebGL recovery successful - counter reset`);

        healthMonitor?.reset();

        // Restore original scrollback if health is good after recovery
        if (originalScrollbackRef.current !== null) {
          const postRecoveryHealth = healthMonitor?.getMetrics().healthScore ?? 100;
          if (postRecoveryHealth > 80) {
            console.info(`[${terminalId}] Health score ${postRecoveryHealth} > 80, restoring scrollback to ${originalScrollbackRef.current}`);
            term.options.scrollback = originalScrollbackRef.current;
            originalScrollbackRef.current = null;
          } else {
            console.warn(`[${terminalId}] Health score ${postRecoveryHealth} <= 80, keeping reduced scrollback (${RECOVERY_SCROLLBACK_LIMIT})`);
          }
        }

        // Validate WebGL state
        const validation = validateWebGLState(term, terminalId);
        if (!validation.valid) {
          console.warn(`[${terminalId}] WebGL validation issues after recovery:`, validation.issues);
        }

        // STATE: ACTIVE - recovery complete, pipeline can resume and request replay
        setState({ status: 'active', type: 'webgl' });
        onRecoveryEnd?.(terminalId, true);
      } else {
        setState({ status: 'active', type: 'webgl' });
        console.info(`[${terminalId}] WebGL renderer ACTIVE`);
      }

      return { success: true, rendererType: 'webgl' as RendererType };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      const error = `WebGL init failed: ${errorMsg}`;
      console.error(`[${terminalId}] WebGL initialization failed:`, e);
      setState({ status: 'failed', lastError: error });

      // FIX WG-1: Notify recovery failed so pipeline can resume
      // Without this, the output pipeline stays paused forever if WebGL throws during recovery
      if (isRecovery) {
        onRecoveryEnd?.(terminalId, false);
      }

      return { success: false, rendererType: null, error };
    }
  }, [terminalId, enableWebGL, setState, onRecoveryStart, onRecoveryEnd]);

  const dispose = useCallback(() => {
    mountedRef.current = false;
    if (webglAddonRef.current) {
      try {
        webglAddonRef.current.dispose();
      } catch {
        // Ignore disposal errors
      }
      webglAddonRef.current = null;
    }
    setState({ status: 'idle' });
  }, [setState]);

  return {
    setupRenderer,
    activeRenderer: getActiveRenderer(),
    rendererState: rendererStateRef.current,
    dispose,
  };
}
