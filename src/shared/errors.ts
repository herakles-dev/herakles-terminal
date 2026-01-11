export type ErrorCode =
  | 'AUTH_FAILED'
  | 'SESSION_NOT_FOUND'
  | 'MAX_SESSIONS'
  | 'MAX_WINDOWS'
  | 'TMUX_ERROR'
  | 'WEBSOCKET_ERROR'
  | 'RATE_LIMITED'
  | 'AUTOMATION_FAILED'
  | 'TEMPLATE_ERROR'
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN'
  | 'INTERNAL_ERROR';

export type ErrorSeverity = 'info' | 'warning' | 'error';

export type RecoveryAction =
  | 'redirect_to_login'
  | 'redirect_to_picker'
  | 'show_session_picker'
  | 'retry'
  | 'none';

export interface ErrorMessage {
  message: string;
  severity: ErrorSeverity;
  recovery: RecoveryAction;
}

export const ERROR_MESSAGES: Record<ErrorCode, ErrorMessage> = {
  AUTH_FAILED: {
    message: 'Your session has expired. Please log in again.',
    severity: 'error',
    recovery: 'redirect_to_login',
  },
  SESSION_NOT_FOUND: {
    message: 'This session no longer exists.',
    severity: 'error',
    recovery: 'redirect_to_picker',
  },
  MAX_SESSIONS: {
    message: 'Maximum 50 sessions reached. Delete old sessions to create new ones.',
    severity: 'warning',
    recovery: 'show_session_picker',
  },
  MAX_WINDOWS: {
    message: 'Maximum 6 windows reached. Close a window to open a new one.',
    severity: 'warning',
    recovery: 'none',
  },
  TMUX_ERROR: {
    message: 'Terminal session error. Attempting to recover...',
    severity: 'error',
    recovery: 'retry',
  },
  WEBSOCKET_ERROR: {
    message: 'Connection error. Reconnecting...',
    severity: 'warning',
    recovery: 'retry',
  },
  RATE_LIMITED: {
    message: 'Too many requests. Please wait and try again.',
    severity: 'warning',
    recovery: 'retry',
  },
  AUTOMATION_FAILED: {
    message: 'Automation failed to execute.',
    severity: 'error',
    recovery: 'none',
  },
  TEMPLATE_ERROR: {
    message: 'Failed to save template.',
    severity: 'error',
    recovery: 'retry',
  },
  VALIDATION_ERROR: {
    message: 'Invalid input provided.',
    severity: 'warning',
    recovery: 'none',
  },
  FORBIDDEN: {
    message: 'You do not have permission to perform this action.',
    severity: 'error',
    recovery: 'none',
  },
  INTERNAL_ERROR: {
    message: 'An unexpected error occurred. Please try again.',
    severity: 'error',
    recovery: 'retry',
  },
};

export class ZeusError extends Error {
  constructor(
    public code: ErrorCode,
    message?: string,
    public details?: Record<string, unknown>
  ) {
    super(message || ERROR_MESSAGES[code].message);
    this.name = 'ZeusError';
  }

  get severity(): ErrorSeverity {
    return ERROR_MESSAGES[this.code].severity;
  }

  get recovery(): RecoveryAction {
    return ERROR_MESSAGES[this.code].recovery;
  }

  toJSON(): { code: ErrorCode; message: string; severity: ErrorSeverity; recovery: RecoveryAction; details?: Record<string, unknown> } {
    return {
      code: this.code,
      message: this.message,
      severity: this.severity,
      recovery: this.recovery,
      details: this.details,
    };
  }
}

export function getRecoveryAction(code: ErrorCode): RecoveryAction {
  return ERROR_MESSAGES[code]?.recovery || 'none';
}

export function getUserMessage(code: ErrorCode): string {
  return ERROR_MESSAGES[code]?.message || 'An error occurred.';
}

export function isRetryable(code: ErrorCode): boolean {
  return ERROR_MESSAGES[code]?.recovery === 'retry';
}
