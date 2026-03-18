import { Request, Response, NextFunction } from 'express';
import { IncomingMessage } from 'http';
import { config } from '../config.js';

export interface AutheliaUser {
  username: string;
  email: string;
  groups: string[];
  name?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AutheliaUser;
    }
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/;

function isFromTrustedProxy(req: Request | IncomingMessage): boolean {
  const remoteAddress = 'socket' in req ? req.socket?.remoteAddress : (req as Request).ip;
  
  if (!remoteAddress) {
    return false;
  }

  const trustedAddresses = [
    '127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost',
    ...config.security.trustedProxies,
  ];
  return trustedAddresses.some(addr => remoteAddress.includes(addr));
}

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

function isValidUsername(username: string): boolean {
  return USERNAME_REGEX.test(username) && username.length >= 1 && username.length <= 64;
}

function extractHeaders(headers: Record<string, string | string[] | undefined>): {
  username?: string;
  email?: string;
  groups?: string;
  name?: string;
} {
  const getHeader = (name: string): string | undefined => {
    const value = headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  };

  return {
    username: getHeader('Remote-User'),
    email: getHeader('Remote-Email'),
    groups: getHeader('Remote-Groups'),
    name: getHeader('Remote-Name'),
  };
}

export function autheliaAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isFromTrustedProxy(req)) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Not from trusted proxy' },
    });
    return;
  }

  const headers = extractHeaders(req.headers as Record<string, string | string[] | undefined>);

  if (!headers.username || !headers.email) {
    res.status(401).json({
      error: { code: 'AUTH_FAILED', message: 'Authentication required' },
    });
    return;
  }

  if (!isValidEmail(headers.email)) {
    res.status(401).json({
      error: { code: 'AUTH_FAILED', message: 'Invalid email format' },
    });
    return;
  }

  if (!isValidUsername(headers.username)) {
    res.status(401).json({
      error: { code: 'AUTH_FAILED', message: 'Invalid username format' },
    });
    return;
  }

  req.user = {
    username: headers.username,
    email: headers.email,
    groups: headers.groups ? headers.groups.split(',').map(g => g.trim()) : [],
    name: headers.name,
  };

  next();
}

export function extractAuthFromUpgrade(req: IncomingMessage): AutheliaUser | null {
  const remoteAddress = req.socket?.remoteAddress;
  const isTrusted = isFromTrustedProxy(req);
  
  console.log(`[Auth] WebSocket upgrade - remoteAddr: ${remoteAddress}, trusted: ${isTrusted}`);
  
  if (!isTrusted) {
    console.log('[Auth] Rejected: not from trusted proxy');
    return null;
  }

  const headers = extractHeaders(req.headers as Record<string, string | string[] | undefined>);
  
  console.log(`[Auth] Headers - user: ${headers.username}, email: ${headers.email}`);

  if (!headers.username) {
    console.log('[Auth] Rejected: missing username header');
    return null;
  }

  // Email may be missing on proxied WebSocket upgrades (nginx auth_request
  // doesn't always pass Remote-Email for WS). Use fallback for trusted proxy.
  if (!headers.email) {
    if (process.env.NODE_ENV === 'development' && process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
      console.log('[Auth] Dev mode auth bypass enabled');
      return {
        username: 'dev-user',
        email: 'dev@herakles.dev',
        groups: ['developers'],
        name: 'Development User',
      };
    }
    console.log(`[Auth] No email for ${headers.username}, using fallback`);
    headers.email = `${headers.username}@herakles.dev`;
  }

  if (!isValidEmail(headers.email) || !isValidUsername(headers.username)) {
    return null;
  }

  return {
    username: headers.username,
    email: headers.email,
    groups: headers.groups ? headers.groups.split(',').map(g => g.trim()) : [],
    name: headers.name,
  };
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const headers = extractHeaders(req.headers as Record<string, string | string[] | undefined>);

  if (headers.username && headers.email && isValidEmail(headers.email) && isValidUsername(headers.username)) {
    req.user = {
      username: headers.username,
      email: headers.email,
      groups: headers.groups ? headers.groups.split(',').map(g => g.trim()) : [],
      name: headers.name,
    };
  }

  next();
}
