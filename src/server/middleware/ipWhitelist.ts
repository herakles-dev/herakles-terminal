import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export function ipWhitelistMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip if whitelist is disabled
  if (!config.security.ipWhitelistEnabled) {
    return next();
  }

  // Skip if no IPs configured (fail-open for safety)
  if (config.security.allowedIPs.length === 0) {
    logger.warn('IP whitelist enabled but no IPs configured - allowing all traffic');
    return next();
  }

  const clientIP = req.ip || req.socket.remoteAddress || 'unknown';

  // Check if IP is in whitelist
  const isAllowed = config.security.allowedIPs.some(allowedIP => {
    // Handle CIDR notation in the future
    return clientIP.includes(allowedIP) || allowedIP === clientIP;
  });

  if (!isAllowed) {
    logger.warn('Blocked request from non-whitelisted IP', {
      ip: clientIP,
      path: req.path,
      userAgent: req.get('user-agent'),
    });

    res.status(403).json({
      error: {
        code: 'IP_NOT_ALLOWED',
        message: 'Your IP address is not authorized to access this service',
      },
    });
    return;
  }

  next();
}
