import { SessionStore } from '../session/SessionStore.js';
import { config } from '../config.js';

export type AuditLevel = 'info' | 'warn' | 'error' | 'security';

export type AuditEvent =
  | 'auth.success'
  | 'auth.failure'
  | 'auth.lockout'
  | 'authz.denied'
  | 'session.create'
  | 'session.resume'
  | 'session.terminate'
  | 'window.create'
  | 'window.close'
  | 'automation.create'
  | 'automation.execute'
  | 'automation.fail'
  | 'rate_limit.exceeded'
  | 'token.created'
  | 'token.expired';

export interface AuditContext {
  sessionId?: string;
  userEmail: string;
  deviceId?: string;
  ip: string;
  userAgent?: string;
  details?: Record<string, unknown>;
}

const SENSITIVE_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /api[_-]?key/i,
  /auth/i,
  /credential/i,
  /bearer/i,
];

export class AuditLogger {
  private store: SessionStore;

  constructor(store: SessionStore) {
    this.store = store;
  }

  log(level: AuditLevel, event: AuditEvent, context: AuditContext): void {
    const sanitizedDetails = context.details
      ? this.redactSensitive(context.details)
      : null;

    this.store.logAudit({
      timestamp: new Date().toISOString(),
      level,
      event,
      session_id: context.sessionId || null,
      user_email: context.userEmail,
      device_id: context.deviceId || null,
      ip: context.ip,
      user_agent: context.userAgent || null,
      details: sanitizedDetails ? JSON.stringify(sanitizedDetails) : null,
    });
  }

  info(event: AuditEvent, context: AuditContext): void {
    this.log('info', event, context);
  }

  warn(event: AuditEvent, context: AuditContext): void {
    this.log('warn', event, context);
  }

  error(event: AuditEvent, context: AuditContext): void {
    this.log('error', event, context);
  }

  security(event: AuditEvent, context: AuditContext): void {
    this.log('security', event, context);
  }

  logAuthSuccess(context: AuditContext): void {
    this.info('auth.success', context);
  }

  logAuthFailure(context: AuditContext & { reason?: string }): void {
    this.security('auth.failure', {
      ...context,
      details: { ...context.details, reason: context.reason },
    });
  }

  logAuthLockout(context: AuditContext & { lockoutMinutes: number }): void {
    this.security('auth.lockout', {
      ...context,
      details: { ...context.details, lockoutMinutes: context.lockoutMinutes },
    });
  }

  logAuthzDenied(context: AuditContext & { resource: string; action: string }): void {
    this.security('authz.denied', {
      ...context,
      details: { ...context.details, resource: context.resource, action: context.action },
    });
  }

  logSessionCreate(context: AuditContext & { sessionId: string; sessionName: string }): void {
    this.info('session.create', {
      ...context,
      sessionId: context.sessionId,
      details: { ...context.details, sessionName: context.sessionName },
    });
  }

  logSessionResume(context: AuditContext & { sessionId: string }): void {
    this.info('session.resume', {
      ...context,
      sessionId: context.sessionId,
    });
  }

  logSessionTerminate(context: AuditContext & { sessionId: string; reason: string }): void {
    this.info('session.terminate', {
      ...context,
      sessionId: context.sessionId,
      details: { ...context.details, reason: context.reason },
    });
  }

  logWindowCreate(context: AuditContext & { windowId: string; sessionId: string }): void {
    this.info('window.create', {
      ...context,
      sessionId: context.sessionId,
      details: { ...context.details, windowId: context.windowId },
    });
  }

  logWindowClose(context: AuditContext & { windowId: string; sessionId: string }): void {
    this.info('window.close', {
      ...context,
      sessionId: context.sessionId,
      details: { ...context.details, windowId: context.windowId },
    });
  }

  logAutomationCreate(context: AuditContext & { automationId: string; name: string }): void {
    this.info('automation.create', {
      ...context,
      details: { ...context.details, automationId: context.automationId, name: context.name },
    });
  }

  logAutomationExecute(context: AuditContext & { automationId: string; trigger: string }): void {
    this.info('automation.execute', {
      ...context,
      details: { ...context.details, automationId: context.automationId, trigger: context.trigger },
    });
  }

  logAutomationFail(context: AuditContext & { automationId: string; error: string }): void {
    this.error('automation.fail', {
      ...context,
      details: { ...context.details, automationId: context.automationId, error: context.error },
    });
  }

  logRateLimitExceeded(context: AuditContext & { endpoint: string; limit: number }): void {
    this.warn('rate_limit.exceeded', {
      ...context,
      details: { ...context.details, endpoint: context.endpoint, limit: context.limit },
    });
  }

  logTokenCreated(context: AuditContext & { sessionId: string }): void {
    this.info('token.created', {
      ...context,
      sessionId: context.sessionId,
    });
  }

  logTokenExpired(context: AuditContext & { sessionId: string }): void {
    this.info('token.expired', {
      ...context,
      sessionId: context.sessionId,
    });
  }

  private redactSensitive(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_PATTERNS.some(pattern => pattern.test(key))) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'string' && SENSITIVE_PATTERNS.some(pattern => pattern.test(value))) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.redactSensitive(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  async cleanupOldLogs(): Promise<number> {
    return this.store.cleanupOldAuditLogs(config.audit.retentionDays);
  }
}
