import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE = 'zeus-csrf';
const TOKEN_LENGTH = 32;

const tokens = new Map<string, { token: string; expires: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of tokens) {
    if (value.expires < now) {
      tokens.delete(key);
    }
  }
}, 60000);

function generateToken(): string {
  return crypto.randomBytes(TOKEN_LENGTH).toString('hex');
}

export function csrfToken(req: Request, res: Response, next: NextFunction): void {
  const userEmail = (req as any).user?.email;
  if (!userEmail) {
    return next();
  }

  let tokenData = tokens.get(userEmail);
  
  if (!tokenData || tokenData.expires < Date.now()) {
    const token = generateToken();
    tokenData = { token, expires: Date.now() + 3600000 };
    tokens.set(userEmail, tokenData);
  }

  res.cookie(CSRF_COOKIE, tokenData.token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 3600000,
  });

  res.locals.csrfToken = tokenData.token;
  next();
}

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    next();
    return;
  }

  const userEmail = (req as any).user?.email;
  if (!userEmail) {
    res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });
    return;
  }

  const headerToken = req.headers[CSRF_HEADER] as string;
  const storedData = tokens.get(userEmail);

  if (!headerToken || !storedData || headerToken !== storedData.token) {
    res.status(403).json({ error: { code: 'CSRF_INVALID', message: 'Invalid or missing CSRF token' } });
    return;
  }

  if (storedData.expires < Date.now()) {
    tokens.delete(userEmail);
    res.status(403).json({ error: { code: 'CSRF_EXPIRED', message: 'CSRF token expired' } });
    return;
  }

  next();
}

export function getCsrfToken(req: Request): string | null {
  const userEmail = (req as any).user?.email;
  if (!userEmail) return null;
  return tokens.get(userEmail)?.token || null;
}
