import type { TerminalTheme } from './types';

export const THEMES: Record<string, TerminalTheme> = {
  dark: {
    name: 'Zeus Dark',
    background: '#000000',
    foreground: '#ffffff',
    cursor: '#00d4ff',
    cursorAccent: '#000000',
    selectionBackground: 'rgba(0, 212, 255, 0.3)',
    black: '#000000',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#eab308',
    blue: '#3b82f6',
    magenta: '#9333ea',
    cyan: '#00d4ff',
    white: '#ffffff',
    brightBlack: '#52525b',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#facc15',
    brightBlue: '#60a5fa',
    brightMagenta: '#a855f7',
    brightCyan: '#22d3ee',
    brightWhite: '#ffffff',
  },
  light: {
    name: 'Zeus Light',
    background: '#ffffff',
    foreground: '#1e1e1e',
    cursor: '#0066cc',
    cursorAccent: '#ffffff',
    selectionBackground: 'rgba(0, 102, 204, 0.3)',
    black: '#1e1e1e',
    red: '#dc2626',
    green: '#16a34a',
    yellow: '#ca8a04',
    blue: '#2563eb',
    magenta: '#7c3aed',
    cyan: '#0891b2',
    white: '#f5f5f5',
    brightBlack: '#6b7280',
    brightRed: '#ef4444',
    brightGreen: '#22c55e',
    brightYellow: '#eab308',
    brightBlue: '#3b82f6',
    brightMagenta: '#8b5cf6',
    brightCyan: '#06b6d4',
    brightWhite: '#ffffff',
  },
  solarizedDark: {
    name: 'Solarized Dark',
    background: '#002b36',
    foreground: '#839496',
    cursor: '#93a1a1',
    cursorAccent: '#002b36',
    selectionBackground: 'rgba(147, 161, 161, 0.3)',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#586e75',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
  monokai: {
    name: 'Monokai',
    background: '#272822',
    foreground: '#f8f8f2',
    cursor: '#f8f8f0',
    cursorAccent: '#272822',
    selectionBackground: 'rgba(73, 72, 62, 0.6)',
    black: '#272822',
    red: '#f92672',
    green: '#a6e22e',
    yellow: '#f4bf75',
    blue: '#66d9ef',
    magenta: '#ae81ff',
    cyan: '#a1efe4',
    white: '#f8f8f2',
    brightBlack: '#75715e',
    brightRed: '#f92672',
    brightGreen: '#a6e22e',
    brightYellow: '#f4bf75',
    brightBlue: '#66d9ef',
    brightMagenta: '#ae81ff',
    brightCyan: '#a1efe4',
    brightWhite: '#f9f8f5',
  },
  dracula: {
    name: 'Dracula',
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    cursorAccent: '#282a36',
    selectionBackground: 'rgba(68, 71, 90, 0.6)',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff',
  },
  nord: {
    name: 'Nord',
    background: '#2e3440',
    foreground: '#d8dee9',
    cursor: '#d8dee9',
    cursorAccent: '#2e3440',
    selectionBackground: 'rgba(136, 192, 208, 0.3)',
    black: '#3b4252',
    red: '#bf616a',
    green: '#a3be8c',
    yellow: '#ebcb8b',
    blue: '#81a1c1',
    magenta: '#b48ead',
    cyan: '#88c0d0',
    white: '#e5e9f0',
    brightBlack: '#4c566a',
    brightRed: '#bf616a',
    brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b',
    brightBlue: '#81a1c1',
    brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb',
    brightWhite: '#eceff4',
  },
};

export type ThemeName = keyof typeof THEMES;

const REQUIRED_THEME_KEYS: (keyof TerminalTheme)[] = [
  'name', 'background', 'foreground', 'cursor', 'cursorAccent', 'selectionBackground',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
  'brightMagenta', 'brightCyan', 'brightWhite',
];

export function validateTheme(theme: unknown): theme is TerminalTheme {
  if (typeof theme !== 'object' || theme === null) {
    return false;
  }

  const obj = theme as Record<string, unknown>;
  return REQUIRED_THEME_KEYS.every(
    (key) => typeof obj[key] === 'string' && obj[key] !== ''
  );
}

export function getTheme(name: string): TerminalTheme {
  return THEMES[name] || THEMES.dark;
}

export function getThemeNames(): string[] {
  return Object.keys(THEMES);
}

