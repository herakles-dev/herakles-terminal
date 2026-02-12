import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { THEMES, getTheme } from '@shared/constants';
import { useTerminalCore } from '../../hooks/useTerminalCore';
import { useXTermSetup } from '../../hooks/useXTermSetup';
import { useRendererSetup } from '../../hooks/useRendererSetup';
import { useResizeCoordinatorContext } from '../../contexts/ResizeCoordinatorContext';
import type { WebGLHealthMonitor } from '../../services/WebGLHealthMonitor';

/**
 * Props for the TerminalCore component
 */
export interface TerminalCoreProps {
  /**
   * Required: Callback for user input data
   * Called when user types in the terminal
   */
  onData: (data: string) => void;

  /**
   * Optional: Theme name from THEMES constant
   * @default 'dark'
   */
  theme?: keyof typeof THEMES;

  /**
   * Optional: Font size in pixels
   * @default TERMINAL_DEFAULTS.fontSize
   */
  fontSize?: number;

  /**
   * Optional: Terminal identifier for logging
   * @default 'TerminalCore'
   */
  terminalId?: string;

  /**
   * Optional: Enable WebGL renderer (required for rendering)
   * @default true
   */
  enableWebGL?: boolean;

  /**
   * Optional: Callback when terminal dimensions change
   * Called after resize with new columns and rows
   */
  onResize?: (cols: number, rows: number) => void;

  /**
   * Optional: Callback when terminal is fully initialized
   * Called once after XTerm instance is created, rendered, and fitted
   */
  onReady?: (term: XTerm, fitAddon: FitAddon) => void;

  /**
   * Optional: Context menu handler
   * Called when user right-clicks on terminal
   */
  onContextMenu?: (e: React.MouseEvent) => void;

  /**
   * Optional: Called when WebGL recovery starts, before term.clear()
   * Use this to pause the output pipeline and clear buffers
   */
  onRecoveryStart?: (terminalId: string) => void;

  /**
   * Optional: Called when WebGL recovery ends
   * @param success - true if recovery succeeded, false if it failed
   */
  onRecoveryEnd?: (terminalId: string, success: boolean) => void;

  /**
   * FIX RS-2: Check if terminal is recovering from WebGL context loss
   * Used to block resize operations during recovery
   */
  isRecovering?: () => boolean;

  /**
   * Optional: Health monitor for proactive GPU memory management
   */
  healthMonitor?: WebGLHealthMonitor;
}

/**
 * Handle exposed via forwardRef for imperative control
 * Allows parent components to interact with the terminal instance
 */
export interface TerminalCoreHandle {
  /** XTerm instance (null until initialized) */
  terminal: XTerm | null;
  /** FitAddon instance (null until initialized) */
  fitAddon: FitAddon | null;
  /** Render error if WebGL failed (null if rendering OK) */
  renderError: string | null;
  /** Write data to terminal */
  write: (data: string) => void;
  /** Fit terminal to container size */
  fit: () => void;
  /** Focus the terminal */
  focus: () => void;
  /** Clear terminal screen */
  clear: () => void;
  /** Set terminal theme */
  setTheme: (themeName: string) => void;
}

/**
 * TerminalCore - Unified terminal rendering component
 *
 * **Architecture:**
 * - Integrates all terminal hooks (useTerminalCore, useXTermSetup, useRendererSetup)
 * - Provides consistent XTerm experience across all consumers
 * - Handles WebGL → Canvas → DOM fallback automatically
 * - Coordinates with global resize system
 *
 * **Responsibilities:**
 * 1. XTerm instance lifecycle (via useTerminalCore)
 * 2. XTerm initialization and configuration (via useXTermSetup)
 * 3. Renderer setup with fallback chain (via useRendererSetup)
 * 4. Resize coordination (via useResizeCoordinatorContext)
 * 5. Expose terminal methods to parent via imperative handle
 *
 * **Initialization Flow:**
 * 1. Component mounts
 * 2. useTerminalCore creates refs
 * 3. useEffect runs when containerRef is set:
 *    a. Call initializeTerminal(container) → get term + fitAddon
 *    b. Call setupRenderer(term) → WebGL/Canvas/DOM
 *    c. Setup term.onData handler → call onData prop
 *    d. Call fitAddon.fit()
 *    e. Register with resize coordinator
 *    f. Call onReady(term, fitAddon)
 * 4. Expose handle via useImperativeHandle
 *
 * **Usage:**
 * ```tsx
 * const terminalRef = useRef<TerminalCoreHandle>(null);
 *
 * <TerminalCore
 *   ref={terminalRef}
 *   onData={(data) => sendToServer(data)}
 *   theme="dark"
 *   fontSize={14}
 *   onReady={(term, fitAddon) => console.log('Terminal ready!')}
 *   onResize={(cols, rows) => sendResize(cols, rows)}
 * />
 *
 * // Imperative control
 * terminalRef.current?.write('Hello, World!\n');
 * terminalRef.current?.fit();
 * terminalRef.current?.focus();
 * ```
 *
 * @param props - TerminalCore configuration
 * @param ref - Forwarded ref for imperative control
 */
export const TerminalCore = forwardRef<TerminalCoreHandle, TerminalCoreProps>(
  (props, ref) => {
    const {
      onData,
      theme = 'dark',
      fontSize,
      terminalId = 'TerminalCore',
      enableWebGL = true,
      onResize,
      onReady,
      onContextMenu,
      onRecoveryStart,
      onRecoveryEnd,
      isRecovering,
      healthMonitor,
    } = props;

    // Hook 1: Core terminal lifecycle
    const { terminalRef, containerRef, isInitialized } = useTerminalCore();

    // Hook 2: XTerm setup and configuration
    const { initializeTerminal } = useXTermSetup({
      theme,
      fontSize,
    });

    // Hook 3: WebGL renderer setup (no fallback - WebGL required)
    const { setupRenderer, dispose: disposeRenderer } = useRendererSetup({
      terminalId,
      enableWebGL,
      onRecoveryStart,
      onRecoveryEnd,
      healthMonitor,
    });

    // Hook 4: Resize coordination (existing from Sprint 1)
    const resizeCoordinator = useResizeCoordinatorContext();

    // Store fitAddon separately for imperative handle
    const fitAddonRef = useRef<FitAddon | null>(null);

    // Track render error state for WebGL failures
    const renderErrorRef = useRef<string | null>(null);

    // Track cleanup function for async initialization
    const cleanupRef = useRef<(() => void) | null>(null);

    // Initialize terminal on mount
    useEffect(() => {
      // Wait for container to be available
      if (!containerRef.current) return;

      // Track if effect was cleaned up during async init
      let cancelled = false;

      (async () => {
        try {
          // Step 1: Initialize terminal with configuration and base addons
          const { term, fitAddon } = initializeTerminal(containerRef.current!);
          if (cancelled) return;

          terminalRef.current = term;
          fitAddonRef.current = fitAddon;

          // Step 2: CRITICAL - Wait for WebGL to be ready before continuing
          // This prevents race condition where fit/onReady happen before WebGL canvas exists
          const rendererResult = await setupRenderer(term);
          if (cancelled) return;

          if (!rendererResult.success) {
            const errorMsg = rendererResult.error || 'WebGL initialization failed';
            console.error(`[${terminalId}] WebGL setup failed:`, errorMsg);
            renderErrorRef.current = errorMsg;
            // Don't call onReady - terminal cannot function without WebGL
            // Store cleanup for partial initialization
            cleanupRef.current = () => {
              disposeRenderer();
            };
            return;
          }

          // Step 3: Setup user input handler
          const dataDisposable = term.onData((data) => {
            onData(data);
          });

          // Step 4: NOW safe to fit - WebGL is ready
          fitAddon.fit();

          // Step 5: Register with resize coordinator (skip auto-resize, we just did fit)
          const unregister = resizeCoordinator.register(
            {
              id: terminalId,
              fitAddon,
              onResize,
              isRecovering,  // FIX RS-2: Pass recovery check to block resize during recovery
              getTermElement: () => containerRef.current,  // FIX WG-1: For canvas dimension verification
            },
            { skipInitialResize: true }
          );

          // Step 6: NOW safe to call onReady - WebGL is fully initialized
          if (onReady) {
            onReady(term, fitAddon);
          }

          console.info(`[${terminalId}] TerminalCore initialized successfully`);

          // Store cleanup for when effect unmounts
          cleanupRef.current = () => {
            dataDisposable.dispose();
            disposeRenderer();
            unregister();
          };
        } catch (error) {
          console.error(`[${terminalId}] Failed to initialize TerminalCore:`, error);
        }
      })();

      // Cleanup on unmount
      return () => {
        cancelled = true;
        cleanupRef.current?.();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Run once on mount

    useEffect(() => {
      if (terminalRef.current && fitAddonRef.current && fontSize !== undefined) {
        terminalRef.current.options.fontSize = fontSize;
        // Use unified resize path with immediate flag (skips debounce, still waits for transitions)
        resizeCoordinator.resizeTarget(terminalId, true);
      }
    }, [fontSize, resizeCoordinator, terminalId]);

    // Expose imperative handle for parent components
    // Uses getter pattern so handle.terminal always returns current ref value
    useImperativeHandle(
      ref,
      () => ({
        get terminal() { return terminalRef.current; },
        get fitAddon() { return fitAddonRef.current; },
        get renderError() { return renderErrorRef.current; },
        write: (data: string) => {
          terminalRef.current?.write(data);
        },
        fit: () => {
          fitAddonRef.current?.fit();
        },
        focus: () => {
          terminalRef.current?.focus();
        },
        clear: () => {
          terminalRef.current?.clear();
        },
        setTheme: (themeName: string) => {
          const themeConfig = getTheme(themeName);
          if (terminalRef.current) {
            terminalRef.current.options.theme = themeConfig;
          }
          const root = document.documentElement;
          root.style.setProperty('--terminal-bg', themeConfig.background);
          root.style.setProperty('--terminal-fg', themeConfig.foreground);
        },
      }),
      []
    );

    // Render terminal container
    return (
      <div
        ref={containerRef}
        onContextMenu={onContextMenu}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          minHeight: 0,
          flex: 1,
          overflow: 'hidden',
        }}
        data-terminal-id={terminalId}
        data-initialized={isInitialized}
      />
    );
  }
);

TerminalCore.displayName = 'TerminalCore';
