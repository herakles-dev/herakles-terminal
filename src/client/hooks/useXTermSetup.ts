import { Terminal as XTerm, ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { THEMES, TERMINAL_DEFAULTS } from '@shared/constants';

/**
 * Options for configuring XTerm terminal instance
 */
const MOBILE_SCROLLBACK = 2000;

interface UseXTermSetupOptions {
  /** Theme name from THEMES constant (default: 'dark') */
  theme?: keyof typeof THEMES;
  /** Font size in pixels (default: TERMINAL_DEFAULTS.fontSize) */
  fontSize?: number;
  /** Font family string (default: TERMINAL_DEFAULTS.fontFamily) */
  fontFamily?: string;
  /** Scrollback buffer size (default: TERMINAL_DEFAULTS.scrollback, 2000 on mobile) */
  scrollback?: number;
  /** Whether running on a mobile device */
  isMobile?: boolean;
  /** Additional XTerm options to merge with defaults */
  additionalOptions?: Partial<ITerminalOptions>;
}

/**
 * Return value from useXTermSetup hook
 */
interface UseXTermSetupReturn {
  /** Initialize terminal instance and attach to DOM container */
  initializeTerminal: (container: HTMLDivElement) => {
    term: XTerm;
    fitAddon: FitAddon;
  };
}

/**
 * Hook for setting up XTerm.js terminal with configuration, theme, and base addons.
 * 
 * Responsibilities:
 * - Generate XTerm configuration from options
 * - Apply theme from THEMES constant
 * - Create XTerm instance with merged config
 * - Load base addons (FitAddon, WebLinksAddon, SearchAddon)
 * - Attach terminal to DOM container
 * 
 * IMPORTANT: Addons are loaded AFTER term.open() per XTerm.js best practices.
 * The terminal must be attached to the DOM before addons can function correctly.
 * 
 * @example
 * ```tsx
 * const { initializeTerminal } = useXTermSetup({
 *   theme: 'dark',
 *   fontSize: 14,
 * });
 * 
 * useEffect(() => {
 *   if (!containerRef.current) return;
 *   const { term, fitAddon } = initializeTerminal(containerRef.current);
 *   terminalRef.current = term;
 *   fitAddonRef.current = fitAddon;
 * }, []);
 * ```
 */
export function useXTermSetup(options: UseXTermSetupOptions = {}): UseXTermSetupReturn {
  const {
    theme = 'dark',
    fontSize = TERMINAL_DEFAULTS.fontSize,
    fontFamily = TERMINAL_DEFAULTS.fontFamily,
    scrollback: scrollbackOption,
    isMobile = false,
    additionalOptions = {},
  } = options;

  // Cap scrollback at 2000 on mobile to reduce memory usage
  const scrollback = scrollbackOption ?? (isMobile ? MOBILE_SCROLLBACK : TERMINAL_DEFAULTS.scrollback);

  /**
   * Initialize XTerm instance with configuration and addons
   * 
   * @param container - HTMLDivElement to attach terminal to
   * @returns Initialized terminal instance and FitAddon
   */
  const initializeTerminal = (container: HTMLDivElement) => {
    const startTime = performance.now();
    console.debug('[useXTermSetup] Initializing terminal', { theme, fontSize, fontFamily });
    
    // Generate base XTerm configuration
    const baseConfig: ITerminalOptions = {
      theme: THEMES[theme],
      fontSize,
      fontFamily,
      scrollback,
      cursorStyle: 'block',
      cursorBlink: true,
      allowTransparency: false,
      macOptionIsMeta: true,
      convertEol: false,
      scrollOnUserInput: true,
      windowsMode: false,
      fastScrollModifier: 'alt',
      fastScrollSensitivity: 5,
      rightClickSelectsWord: false,  // Don't auto-select word on right-click (interferes with WebGL selection)
    };

    // Merge with additional options (user overrides take precedence)
    const config: ITerminalOptions = {
      ...baseConfig,
      ...additionalOptions,
    };

    // Create XTerm instance
    const term = new XTerm(config);
    const createTime = performance.now();
    console.debug(`[useXTermSetup] XTerm instance created in ${(createTime - startTime).toFixed(2)}ms`);

    // Create base addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    // CRITICAL: Open terminal FIRST before loading addons
    // XTerm.js requires the terminal to be attached to DOM before addons can initialize
    term.open(container);
    const openTime = performance.now();
    console.debug(`[useXTermSetup] Terminal opened in ${(openTime - createTime).toFixed(2)}ms`);

    // Load addons after terminal is opened
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);
    const addonTime = performance.now();
    console.debug(`[useXTermSetup] Addons loaded in ${(addonTime - openTime).toFixed(2)}ms`);

    const totalTime = performance.now() - startTime;
    console.debug(`[useXTermSetup] Total initialization: ${totalTime.toFixed(2)}ms`);

    return {
      term,
      fitAddon,
    };
  };

  return {
    initializeTerminal,
  };
}
