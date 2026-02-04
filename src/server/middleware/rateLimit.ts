import { Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';

interface RateLimitConfig {
  limit: number;
  windowMs: number;
  keyGenerator?: (req: Request) => string;
  lockoutMinutes?: number;
}

interface RateLimitRecord {
  key: string;
  count: number;
  window_start: number;
  lockout_until: number | null;
  updated_at: number;
}

export class RateLimiter {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  private getRecord(key: string): RateLimitRecord | null {
    const stmt = this.db.prepare('SELECT * FROM rate_limits WHERE key = ?');
    return stmt.get(key) as RateLimitRecord | null;
  }

  private updateRecord(key: string, count: number, windowStart: number, lockoutUntil: number | null): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO rate_limits (key, count, window_start, lockout_until, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(key, count, windowStart, lockoutUntil, Date.now());
  }

  check(key: string, limit: number, windowMs: number): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const record = this.getRecord(key);

    if (record?.lockout_until && record.lockout_until > now) {
      return { allowed: false, remaining: 0, resetAt: record.lockout_until };
    }

    if (!record || now - record.window_start > windowMs) {
      this.updateRecord(key, 1, now, null);
      return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
    }

    if (record.count >= limit) {
      return { allowed: false, remaining: 0, resetAt: record.window_start + windowMs };
    }

    this.updateRecord(key, record.count + 1, record.window_start, null);
    return { allowed: true, remaining: limit - record.count - 1, resetAt: record.window_start + windowMs };
  }

  lockout(key: string, minutes: number): void {
    const lockoutUntil = Date.now() + minutes * 60 * 1000;
    const record = this.getRecord(key);
    this.updateRecord(key, record?.count || 0, record?.window_start || Date.now(), lockoutUntil);
  }

  isLockedOut(key: string): boolean {
    const record = this.getRecord(key);
    return record?.lockout_until ? record.lockout_until > Date.now() : false;
  }

  cleanup(maxAge: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAge;
    const stmt = this.db.prepare('DELETE FROM rate_limits WHERE updated_at < ? AND lockout_until IS NULL');
    const result = stmt.run(cutoff);
    return result.changes;
  }
}

export function createRateLimiter(db: Database.Database, config: RateLimitConfig) {
  const limiter = new RateLimiter(db);
  const { limit, windowMs, keyGenerator, lockoutMinutes } = config;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyGenerator
      ? keyGenerator(req)
      : req.headers['remote-user'] as string || req.ip || 'anonymous';

    const result = limiter.check(key, limit, windowMs);

    res.setHeader('X-RateLimit-Limit', limit.toString());
    res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000).toString());

    if (!result.allowed) {
      if (lockoutMinutes && result.remaining === 0) {
        limiter.lockout(key, lockoutMinutes);
      }

      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests, please try again later',
          retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
        },
      });
      return;
    }

    next();
  };
}

export function httpRateLimiter(db: Database.Database) {
  return createRateLimiter(db, {
    limit: 10000, // Increased from 100 to 10000 for development (never block)
    windowMs: 60 * 1000,
    keyGenerator: (req) => `http:${req.headers['remote-user'] || req.ip}`,
  });
}

export function sessionCreationLimiter(db: Database.Database) {
  return createRateLimiter(db, {
    limit: 10,
    windowMs: 60 * 60 * 1000,
    keyGenerator: (req) => `session:${req.headers['remote-user'] || req.ip}`,
  });
}

export function automationCreationLimiter(db: Database.Database) {
  return createRateLimiter(db, {
    limit: 50,
    windowMs: 60 * 60 * 1000,
    keyGenerator: (req) => `automation:${req.headers['remote-user'] || req.ip}`,
  });
}

export function templateCreationLimiter(db: Database.Database) {
  return createRateLimiter(db, {
    limit: 100,
    windowMs: 60 * 60 * 1000,
    keyGenerator: (req) => `template:${req.headers['remote-user'] || req.ip}`,
  });
}

export class WebSocketRateLimiter {
  private limiter: RateLimiter;
  private limit: number;
  private windowMs: number;

  constructor(db: Database.Database, limit = 1000, windowMs = 60 * 1000) {
    this.limiter = new RateLimiter(db);
    this.limit = limit;
    this.windowMs = windowMs;
  }

  check(userId: string): { allowed: boolean; remaining: number } {
    const key = `ws:${userId}`;
    const result = this.limiter.check(key, this.limit, this.windowMs);
    return { allowed: result.allowed, remaining: result.remaining };
  }
}

export function handoffLimiter(db: Database.Database) {
  return createRateLimiter(db, {
    limit: 5,
    windowMs: 60 * 1000,  // 1 minute
    keyGenerator: (req) => `handoff:${req.headers['remote-user'] || req.ip}`,
    lockoutMinutes: 5  // 5 minute lockout after exceeding limit
  });
}

export function checkAuthLockout(db: Database.Database, key: string): boolean {
  const limiter = new RateLimiter(db);
  return limiter.isLockedOut(`auth:${key}`);
}

export function recordAuthFailure(db: Database.Database, key: string): void {
  const limiter = new RateLimiter(db);
  const result = limiter.check(`auth:${key}`, 5, 60 * 1000);

  if (!result.allowed) {
    limiter.lockout(`auth:${key}`, 15);
  }
}
