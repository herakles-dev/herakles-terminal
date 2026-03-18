export const DEFAULT_PORT = 8096;

export const WEBSOCKET_PATH = '/ws';

export const CONNECTION_DEFAULTS = {
  reconnectAttempts: 50,
  reconnectBackoff: {
    initial: 100,
    multiplier: 1.5,
    max: 30000,
  },
  heartbeatInterval: 15000,
  heartbeatTimeout: 5000,
};

export const SESSION_DEFAULTS = {
  timeout: 86400,
  maxSessions: 50,
  maxConnectionsPerSession: 5,
};

export const TERMINAL_DEFAULTS = {
  cols: 120,
  rows: 40,
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  scrollback: 5000, // Reduced from 20000 to prevent WebGL OOM on context loss recovery
};

export const RESIZE_CONSTANTS = {
  minCols: 10,
  minRows: 3,
  serverDebounceMs: 250,
  pendingClearMs: 1000,
  orientationSettleMs: 150,
  viewportDebounceMs: 200,
};

export const MOBILE_CONSTANTS = {
  breakpoint: 768,
  minKeyboardHeight: 50,
  keyboardScreenRatio: 0.1,
  keyboardThreshold: 0.85,
  inputHeight: 48,
  scrollThrottleMs: 100,
};

export const QUICK_KEYS = [
  { id: 'ctrl', label: 'Ctrl', value: '', category: 'modifier' as const },
  { id: 'esc', label: 'ESC', value: '\x1b', category: 'navigation' as const },
  { id: 'tab', label: 'TAB', value: '\t', category: 'navigation' as const },
  { id: 'shift-tab', label: '\u21E7TAB', value: '\x1b[Z', category: 'navigation' as const },
  { id: 'enter', label: '\u21B5', value: '\r', category: 'navigation' as const },
  { id: 'left', label: '\u2190', value: '\x1b[D', category: 'navigation' as const },
  { id: 'right', label: '\u2192', value: '\x1b[C', category: 'navigation' as const },
  { id: 'up', label: '\u2191', value: '\x1b[A', category: 'navigation' as const },
  { id: 'down', label: '\u2193', value: '\x1b[B', category: 'navigation' as const },
  { id: 'slash', label: '/', value: '/', category: 'symbol' as const },
  { id: 'tilde', label: '~', value: '~', category: 'symbol' as const },
  { id: 'claude', label: 'Claude', value: 'claude --dangerously-skip-permissions\r', category: 'claude' as const },
];

/** Feature flag: use CSS Grid layout instead of SplitView absolute positioning.
 * v1.3.0: Re-promoted then reverted — v2 still has typing glitches (line duplication, cursor jumps).
 * v1 SplitView remains the stable production path. */
export const USE_GRID_LAYOUT = false;

export { THEMES, getTheme, getThemeNames, validateTheme } from './themes.js';
export type { ThemeName } from './themes.js';
