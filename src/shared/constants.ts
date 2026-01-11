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
  scrollback: 50000,
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
  { id: 'ctrl-c', label: '^C', value: '\x03', category: 'control' as const },
  { id: 'ctrl-d', label: '^D', value: '\x04', category: 'control' as const },
  { id: 'ctrl-z', label: '^Z', value: '\x1a', category: 'control' as const },
  { id: 'ctrl-l', label: '^L', value: '\x0c', category: 'control' as const },
  { id: 'pipe', label: '|', value: '|', category: 'symbol' as const },
  { id: 'gt', label: '>', value: '>', longPress: '>>', category: 'symbol' as const },
  { id: 'tilde', label: '~', value: '~', category: 'symbol' as const },
  { id: 'backtick', label: '`', value: '`', category: 'symbol' as const },
  { id: 'tab', label: 'TAB', value: '\t', category: 'navigation' as const },
  { id: 'up', label: '↑', value: '\x1b[A', category: 'navigation' as const },
  { id: 'down', label: '↓', value: '\x1b[B', category: 'navigation' as const },
  { id: 'esc', label: 'ESC', value: '\x1b', category: 'navigation' as const },
  { id: 'slash', label: '/', value: '/', category: 'claude' as const },
  { id: 'yes', label: 'y', value: 'y\n', category: 'claude' as const },
  { id: 'no', label: 'n', value: 'n\n', category: 'claude' as const },
];

export { THEMES, getTheme, getThemeNames, validateTheme } from './themes.js';
export type { ThemeName } from './themes.js';
