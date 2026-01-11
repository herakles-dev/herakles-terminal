import winston from 'winston';
import LokiTransport from 'winston-loki';

const LOKI_HOST = process.env.LOKI_HOST || 'http://localhost:3100';
const LOKI_ENABLED = process.env.LOKI_ENABLED === 'true';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const NODE_ENV = process.env.NODE_ENV || 'development';

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}] ${message}${metaStr}`;
  })
);

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: NODE_ENV === 'development' ? consoleFormat : jsonFormat,
  }),
];

if (LOKI_ENABLED) {
  transports.push(
    new LokiTransport({
      host: LOKI_HOST,
      labels: { app: 'zeus-terminal', environment: NODE_ENV },
      json: true,
      format: jsonFormat,
      onConnectionError: (err: Error) => {
        console.error('Loki connection error:', err.message);
      },
    })
  );
}

export const logger = winston.createLogger({
  level: LOG_LEVEL,
  defaultMeta: { service: 'zeus-terminal' },
  transports,
});

export const createChildLogger = (component: string) => {
  return logger.child({ component });
};

export const httpLogger = (req: any, res: any, next: any) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      userEmail: req.headers['remote-email'] || 'anonymous',
      ip: req.headers['x-real-ip'] || req.ip,
    };
    
    if (res.statusCode >= 500) {
      logger.error('HTTP Request', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('HTTP Request', logData);
    } else {
      logger.info('HTTP Request', logData);
    }
  });
  
  next();
};

export const wsLogger = createChildLogger('websocket');
export const dbLogger = createChildLogger('database');
export const authLogger = createChildLogger('auth');
export const tmuxLogger = createChildLogger('tmux');
