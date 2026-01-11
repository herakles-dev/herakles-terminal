import { useCallback, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { CanvasAddon } from '@xterm/addon-canvas';

export type RendererType = 'webgl' | 'canvas' | 'dom';

export type RendererState =
  | { status: 'idle' }
  | { status: 'loading'; type: 'webgl' | 'canvas' }
  | { status: 'active'; type: RendererType }
  | { status: 'recovering'; attempts: number }
  | { status: 'failed'; lastError?: string };

export interface UseRendererSetupOptions {
  terminalId?: string;
  enableWebGL?: boolean;
  enableCanvas?: boolean;
  onStateChange?: (state: RendererState) => void;
}

export interface UseRendererSetupReturn {
  setupRenderer: (term: XTerm) => void;
  activeRenderer: RendererType | null;
  rendererState: RendererState;
  dispose: () => void;
}

const CANVAS_DETECTION_TIMEOUT_MS = 500;
const MAX_RECOVERY_ATTEMPTS = 3;

function waitForCanvas(element: HTMLElement, timeoutMs = CANVAS_DETECTION_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const canvas = element.querySelector('canvas.xterm-text-layer');
    if (canvas) {
      resolve(true);
      return;
    }

    let resolved = false;
    const observer = new MutationObserver(() => {
      const foundCanvas = element.querySelector('canvas.xterm-text-layer');
      if (foundCanvas && !resolved) {
        resolved = true;
        observer.disconnect();
        resolve(true);
      }
    });

    observer.observe(element, { childList: true, subtree: true });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        resolve(false);
      }
    }, timeoutMs);
  });
}

export function useRendererSetup(
  options: UseRendererSetupOptions = {}
): UseRendererSetupReturn {
  const {
    terminalId = 'Terminal',
    enableWebGL = true,
    enableCanvas = true,
    onStateChange,
  } = options;

  const rendererStateRef = useRef<RendererState>({ status: 'idle' });
  const mountedRef = useRef(true);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const canvasAddonRef = useRef<CanvasAddon | null>(null);
  const recoveryAttemptsRef = useRef(0);

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

  const tryCanvasFallback = useCallback(async (term: XTerm) => {
    if (!enableCanvas) {
      console.warn(`[${terminalId}] Canvas disabled - using DOM fallback`);
      setState({ status: 'active', type: 'dom' });
      return;
    }

    setState({ status: 'loading', type: 'canvas' });

    try {
      const canvasAddon = new CanvasAddon();
      canvasAddonRef.current = canvasAddon;
      term.loadAddon(canvasAddon);

      if (!mountedRef.current || !term.element) {
        setState({ status: 'failed', lastError: 'Component unmounted' });
        return;
      }

      const canvasFound = await waitForCanvas(term.element);

      if (canvasFound) {
        setState({ status: 'active', type: 'canvas' });
        console.info(`[${terminalId}] Canvas renderer ACTIVE`);
      } else {
        setState({ status: 'active', type: 'dom' });
        console.warn(`[${terminalId}] Canvas FAILED - DOM fallback`);
      }
    } catch (e) {
      setState({ status: 'active', type: 'dom' });
      console.warn(`[${terminalId}] Canvas failed - DOM fallback:`, e);
    }
  }, [terminalId, enableCanvas, setState]);

  const setupRenderer = useCallback(async (term: XTerm) => {
    if (!term.element) {
      console.error(`[${terminalId}] Cannot setup renderer: term.element is null`);
      setState({ status: 'failed', lastError: 'term.element is null' });
      return;
    }

    mountedRef.current = true;
    recoveryAttemptsRef.current = 0;

    if (!enableWebGL) {
      console.info(`[${terminalId}] WebGL disabled, using Canvas`);
      await tryCanvasFallback(term);
      return;
    }

    setState({ status: 'loading', type: 'webgl' });

    try {
      const webglAddon = new WebglAddon();
      webglAddonRef.current = webglAddon;

      webglAddon.onContextLoss(() => {
        console.warn(`[${terminalId}] WebGL context lost`);

        if (recoveryAttemptsRef.current < MAX_RECOVERY_ATTEMPTS) {
          recoveryAttemptsRef.current++;
          setState({ status: 'recovering', attempts: recoveryAttemptsRef.current });

          setTimeout(() => {
            if (mountedRef.current) {
              webglAddon.dispose();
              webglAddonRef.current = null;
              tryCanvasFallback(term);
            }
          }, 100 * recoveryAttemptsRef.current);
        } else {
          webglAddon.dispose();
          webglAddonRef.current = null;
          tryCanvasFallback(term);
        }
      });

      term.loadAddon(webglAddon);

      if (!mountedRef.current || !term.element) {
        setState({ status: 'failed', lastError: 'Component unmounted' });
        return;
      }

      const canvasFound = await waitForCanvas(term.element);

      if (canvasFound) {
        setState({ status: 'active', type: 'webgl' });
        console.info(`[${terminalId}] WebGL renderer ACTIVE`);
      } else {
        console.warn(`[${terminalId}] WebGL failed, trying Canvas`);
        webglAddon.dispose();
        webglAddonRef.current = null;
        await tryCanvasFallback(term);
      }
    } catch (e) {
      console.warn(`[${terminalId}] WebGL initialization failed:`, e);
      await tryCanvasFallback(term);
    }
  }, [terminalId, enableWebGL, tryCanvasFallback, setState]);

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
    if (canvasAddonRef.current) {
      try {
        canvasAddonRef.current.dispose();
      } catch {
        // Ignore disposal errors
      }
      canvasAddonRef.current = null;
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
