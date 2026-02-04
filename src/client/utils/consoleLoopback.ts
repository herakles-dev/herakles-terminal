/**
 * Console Loopback - Captures browser console logs and sends to server
 * Enables server-side visibility into client-side debugging
 */

type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  level: LogLevel;
  message: string;
  data?: unknown;
  component?: string;
  timestamp: string;
}

const LOG_ENDPOINT = '/api/debug/console';
const LOG_QUEUE: LogEntry[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let isEnabled = false;

// Flush queued logs to server
async function flushLogs() {
  if (LOG_QUEUE.length === 0) return;

  const logsToSend = [...LOG_QUEUE];
  LOG_QUEUE.length = 0;

  for (const log of logsToSend) {
    try {
      await fetch(LOG_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(log),
      });
    } catch {
      // Silently fail - don't spam console about logging failures
    }
  }
}

// Queue a log entry
function queueLog(level: LogLevel, args: unknown[]) {
  if (!isEnabled) return;

  // Extract component name if first arg matches [ComponentName] pattern
  let component: string | undefined;
  let message: string;
  const firstArg = args[0];

  if (typeof firstArg === 'string' && firstArg.startsWith('[') && firstArg.includes(']')) {
    const match = firstArg.match(/^\[([^\]]+)\]/);
    if (match) {
      component = match[1];
      message = firstArg.substring(match[0].length).trim();
      args = [message, ...args.slice(1)];
    } else {
      message = firstArg;
    }
  } else {
    message = String(firstArg);
  }

  // Serialize remaining args
  const data = args.length > 1 ? args.slice(1) : undefined;

  LOG_QUEUE.push({
    level,
    message,
    data,
    component,
    timestamp: new Date().toISOString(),
  });

  // Debounced flush
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushLogs, 100);
}

// Store original console methods
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

/**
 * Enable console loopback - intercepts console.* calls and sends to server
 */
export function enableConsoleLoopback() {
  if (isEnabled) return;
  isEnabled = true;

  console.log = (...args: unknown[]) => {
    originalConsole.log(...args);
    queueLog('log', args);
  };

  console.info = (...args: unknown[]) => {
    originalConsole.info(...args);
    queueLog('info', args);
  };

  console.warn = (...args: unknown[]) => {
    originalConsole.warn(...args);
    queueLog('warn', args);
  };

  console.error = (...args: unknown[]) => {
    originalConsole.error(...args);
    queueLog('error', args);
  };

  console.debug = (...args: unknown[]) => {
    originalConsole.debug(...args);
    queueLog('debug', args);
  };

  // Also capture unhandled errors
  window.addEventListener('error', (event) => {
    queueLog('error', [`Uncaught: ${event.message}`, { filename: event.filename, lineno: event.lineno }]);
  });

  window.addEventListener('unhandledrejection', (event) => {
    queueLog('error', [`Unhandled Promise: ${event.reason}`]);
  });

  originalConsole.log('[ConsoleLoopback] Enabled - logs will be sent to server');
}

/**
 * Disable console loopback - restore original console methods
 */
export function disableConsoleLoopback() {
  if (!isEnabled) return;
  isEnabled = false;

  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.debug = originalConsole.debug;

  originalConsole.log('[ConsoleLoopback] Disabled');
}

/**
 * Check if loopback is enabled
 */
export function isLoopbackEnabled() {
  return isEnabled;
}
