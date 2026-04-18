import { DEFAULT_PORT, SESSION_DEFAULTS } from '../shared/constants.js';

export interface Config {
  port: number;
  host: string;
  nodeEnv: string;
  logLevel: string;
  
  database: {
    path: string;
  };
  
  session: {
    secret: string;
    timeout: number;
    maxSessions: number;
    maxConnectionsPerSession: number;
    maxWindowsPerSession: number;
    initialWindows: number;
    defaultTimeout: number;
  };
  
  websocket: {
    path: string;
    heartbeatInterval: number;
    heartbeatTimeout: number;
    maxMessageSize: number;
  };
  
  tmux: {
    socket: string;
    defaultShell: string;
    configPath: string;
  };
  
  multiDevice: {
    softLockMs: number;
  };
  
  backup: {
    enabled: boolean;
    frequency: string;
    retentionDays: number;
    path: string;
  };
  
  observability: {
    prometheusEnabled: boolean;
    lokiEnabled: boolean;
    lokiUrl: string;
  };
  
  audit: {
    logPath: string;
    retentionDays: number;
  };
  
  security: {
    allowedOrigins: string[];
    rateLimitRequests: number;
    rateLimitWindowMs: number;
    trustedProxies: string[];
    allowedIPs: string[];
    ipWhitelistEnabled: boolean;
  };
  
  gemini: {
    apiKey: string;
    model: string;
  };
  
  uploads: {
    path: string;
    maxFileSize: number;
    maxFiles: number;
    retentionDays: number;
    quotaBytes: number;
  };
}

export const config: Config = {
  port: parseInt(process.env.PORT || String(DEFAULT_PORT), 10),
  host: process.env.HOST || '127.0.0.1',
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  
  database: {
    path: process.env.DB_PATH || '/home/hercules/herakles-terminal/data/zeus.db',
  },
  
  session: {
    secret: process.env.SESSION_SECRET || (() => {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('SESSION_SECRET environment variable must be set in production');
      }
      return 'dev-secret-for-development-only';
    })(),
    timeout: parseInt(process.env.SESSION_TIMEOUT || String(SESSION_DEFAULTS.timeout), 10),
    maxSessions: parseInt(process.env.MAX_SESSIONS || '50', 10),
    maxConnectionsPerSession: parseInt(
      process.env.MAX_CONNECTIONS_PER_SESSION || String(SESSION_DEFAULTS.maxConnectionsPerSession),
      10
    ),
    maxWindowsPerSession: parseInt(process.env.MAX_WINDOWS_PER_SESSION || '6', 10),
    initialWindows: parseInt(process.env.INITIAL_WINDOWS || String(SESSION_DEFAULTS.initialWindows), 10),
    defaultTimeout: parseInt(process.env.DEFAULT_SESSION_TIMEOUT_HOURS || '168', 10),
  },
  
  websocket: {
    path: process.env.WS_PATH || '/ws',
    heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL || '30000', 10),
    heartbeatTimeout: parseInt(process.env.WS_HEARTBEAT_TIMEOUT || '180000', 10),
    maxMessageSize: parseInt(process.env.WS_MAX_MESSAGE_SIZE || String(10 * 1024 * 1024), 10),
  },
  
  tmux: {
    socket: process.env.TMUX_SOCKET || '/tmp/zeus-tmux',
    defaultShell: process.env.DEFAULT_SHELL || '/bin/bash',
    configPath: process.env.TMUX_CONFIG || '/home/hercules/herakles-terminal/config/tmux.conf',
  },
  
  multiDevice: {
    softLockMs: parseInt(process.env.SOFT_LOCK_MS || '2000', 10),
  },
  
  backup: {
    enabled: process.env.BACKUP_ENABLED !== 'false',
    frequency: process.env.BACKUP_FREQUENCY || 'hourly',
    retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || '7', 10),
    path: process.env.BACKUP_PATH || '/home/hercules/herakles-terminal/backups',
  },
  
  observability: {
    prometheusEnabled: process.env.PROMETHEUS_ENABLED !== 'false',
    lokiEnabled: process.env.LOKI_ENABLED !== 'false',
    lokiUrl: process.env.LOKI_URL || 'http://localhost:3100',
  },
  
  audit: {
    logPath: process.env.AUDIT_LOG_PATH || './data/audit.log',
    retentionDays: parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '90', 10),
  },
  
  security: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS || 'https://zeus.herakles.dev').split(','),
    rateLimitRequests: parseInt(process.env.RATE_LIMIT_REQUESTS || '100', 10),
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    trustedProxies: (process.env.TRUSTED_PROXIES || '127.0.0.1,::1').split(','),
    allowedIPs: process.env.ALLOWED_IPS ? process.env.ALLOWED_IPS.split(',') : [],
    ipWhitelistEnabled: process.env.IP_WHITELIST_ENABLED === 'true',
  },
  
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
  },
  
  uploads: {
    path: process.env.UPLOAD_PATH || '/home/hercules/uploads',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || String(50 * 1024 * 1024), 10),  // 50MB per file
    maxFiles: parseInt(process.env.MAX_FILES_PER_REQUEST || '10', 10),
    retentionDays: parseInt(process.env.UPLOAD_RETENTION_DAYS || '30', 10),
    quotaBytes: parseInt(process.env.UPLOAD_QUOTA_BYTES || String(500 * 1024 * 1024), 10),  // 500MB total
  },
};

export function getConfig(): Config {
  return config;
}
