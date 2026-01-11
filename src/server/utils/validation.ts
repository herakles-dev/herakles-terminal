const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CRON_PARTS_REGEX = {
  minute: /^(\*|[0-5]?\d(-[0-5]?\d)?(,[0-5]?\d(-[0-5]?\d)?)*(\/[1-9]\d*)?)$/,
  hour: /^(\*|[01]?\d|2[0-3])(-(([01]?\d|2[0-3]))?)?(,([01]?\d|2[0-3])(-(([01]?\d|2[0-3])))?)*(\/(1?\d|2[0-4]))?$/,
  dayOfMonth: /^(\*|[1-9]|[12]\d|3[01])(-(([1-9]|[12]\d|3[01]))?)?(,([1-9]|[12]\d|3[01])(-(([1-9]|[12]\d|3[01])))?)*(\/(1?\d|2\d|3[01]))?$/,
  month: /^(\*|[1-9]|1[0-2])(-(([1-9]|1[0-2]))?)?(,([1-9]|1[0-2])(-(([1-9]|1[0-2])))?)*(\/(1?\d)?)?$/,
  dayOfWeek: /^(\*|[0-6])(-(([0-6]))?)?(,([0-6])(-(([0-6])))?)*(\/(1?[0-7]))?$/,
};

const HTML_TAG_REGEX = /<[^>]*>/g;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateAutomationCommand(command: string): ValidationResult {
  if (!command || typeof command !== 'string') {
    return { valid: false, error: 'Command is required' };
  }

  if (command.length > 10000) {
    return { valid: false, error: 'Command exceeds maximum length of 10000 characters' };
  }

  const dangerousPatterns = [
    /\$\(.*\)/,
    /`.*`/,
    /;\s*rm\s+-rf/i,
    /rm\s+-rf\s+[\/~]/i,
    /rm\s+-fr\s+[\/~]/i,
    /rm\s+--no-preserve-root/i,
    />\s*\/dev\/sd/i,
    /mkfs\./i,
    /dd\s+if=/i,
    /chmod\s+(-R\s+)?777\s+\//i,
    /chown\s+-R\s+.*\s+\//i,
    /:\(\)\s*{\s*:\|:\s*&\s*}\s*;/,
    /curl\s+.*\|\s*(ba)?sh/i,
    /wget\s+.*\|\s*(ba)?sh/i,
    /curl\s+.*\|\s*python/i,
    /wget\s+.*\|\s*python/i,
    />\s*\/etc\/passwd/i,
    />\s*\/etc\/shadow/i,
    />\s*\/etc\/sudoers/i,
    /shutdown\s+/i,
    /reboot\s*$/i,
    /init\s+0/i,
    /halt\s*$/i,
    /poweroff/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      return { valid: false, error: 'Command contains potentially dangerous patterns' };
    }
  }

  return { valid: true };
}

export function validateCronExpression(expression: string): ValidationResult {
  if (!expression || typeof expression !== 'string') {
    return { valid: false, error: 'Cron expression is required' };
  }

  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { valid: false, error: 'Cron expression must have 5 parts (minute hour day month weekday)' };
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  if (!CRON_PARTS_REGEX.minute.test(minute)) {
    return { valid: false, error: 'Invalid minute field in cron expression' };
  }

  if (!CRON_PARTS_REGEX.hour.test(hour)) {
    return { valid: false, error: 'Invalid hour field in cron expression' };
  }

  if (!CRON_PARTS_REGEX.dayOfMonth.test(dayOfMonth)) {
    return { valid: false, error: 'Invalid day of month field in cron expression' };
  }

  if (!CRON_PARTS_REGEX.month.test(month)) {
    return { valid: false, error: 'Invalid month field in cron expression' };
  }

  if (!CRON_PARTS_REGEX.dayOfWeek.test(dayOfWeek)) {
    return { valid: false, error: 'Invalid day of week field in cron expression' };
  }

  if (minute === '*' && hour === '*') {
    return { valid: false, error: 'Cron cannot run more frequently than once per minute' };
  }

  return { valid: true };
}

export function validateRegexPattern(pattern: string, timeoutMs = 100): ValidationResult {
  if (!pattern || typeof pattern !== 'string') {
    return { valid: false, error: 'Pattern is required' };
  }

  if (pattern.length > 500) {
    return { valid: false, error: 'Pattern exceeds maximum length of 500 characters' };
  }

  try {
    const start = Date.now();
    new RegExp(pattern);
    
    const testString = 'a'.repeat(100);
    const regex = new RegExp(pattern);
    regex.test(testString);
    
    if (Date.now() - start > timeoutMs) {
      return { valid: false, error: 'Pattern is too complex or potentially catastrophic' };
    }
    
    return { valid: true };
  } catch (e) {
    return { valid: false, error: `Invalid regex pattern: ${(e as Error).message}` };
  }
}

export function sanitizeWindowName(name: string): string {
  if (!name || typeof name !== 'string') {
    return '';
  }

  return name
    .replace(HTML_TAG_REGEX, '')
    .replace(/[<>'"]/g, '')
    .trim()
    .slice(0, 50);
}

export function sanitizeSessionName(name: string): string {
  if (!name || typeof name !== 'string') {
    return '';
  }

  return name
    .replace(HTML_TAG_REGEX, '')
    .replace(/[<>'"]/g, '')
    .trim()
    .slice(0, 100);
}

export function validateTemplateContent(content: unknown): ValidationResult {
  if (!content || typeof content !== 'object') {
    return { valid: false, error: 'Template content must be an object' };
  }

  const template = content as Record<string, unknown>;

  if (typeof template.text !== 'string') {
    return { valid: false, error: 'Template must have a text field' };
  }

  if (template.text.length > 50000) {
    return { valid: false, error: 'Template text exceeds maximum length' };
  }

  if (template.variables) {
    if (!Array.isArray(template.variables)) {
      return { valid: false, error: 'Template variables must be an array' };
    }

    for (const variable of template.variables) {
      if (typeof variable !== 'object' || !variable) {
        return { valid: false, error: 'Each variable must be an object' };
      }

      const v = variable as Record<string, unknown>;
      if (typeof v.id !== 'string' || typeof v.label !== 'string') {
        return { valid: false, error: 'Variables must have id and label strings' };
      }

      const validTypes = ['text', 'select', 'file', 'dynamic'];
      if (typeof v.type !== 'string' || !validTypes.includes(v.type)) {
        return { valid: false, error: 'Variable type must be one of: text, select, file, dynamic' };
      }
    }
  }

  return { valid: true };
}

export function isValidUUID(str: string): boolean {
  return UUID_REGEX.test(str);
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validateUsername(username: string): boolean {
  const usernameRegex = /^[a-zA-Z0-9_-]{1,64}$/;
  return usernameRegex.test(username);
}

export function sanitizeForLogging(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) {
    return data;
  }

  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth', 'credential'];
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeForLogging(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}
