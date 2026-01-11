import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { ConnectionManager } from './websocket/ConnectionManager.js';
import { SessionStore } from './session/SessionStore.js';
import { TmuxManager } from './tmux/TmuxManager.js';
import { WindowManager } from './window/WindowManager.js';
import { MultiDeviceManager } from './device/MultiDeviceManager.js';
import { AutomationEngine } from './automation/AutomationEngine.js';
import { AuditLogger } from './audit/AuditLogger.js';
import { apiRoutes } from './api/routes.js';
import { automationRoutes } from './api/automations.js';
import { templateRoutes } from './api/templates.js';
import { commandRoutes } from './api/commands.js';
import { uploadRoutes } from './api/uploads.js';
import { projectRoutes } from './api/projects.js';
import { securityHeaders, corsMiddleware } from './middleware/security.js';
import { autheliaAuth } from './middleware/autheliaAuth.js';
import { httpRateLimiter } from './middleware/rateLimit.js';
import { csrfToken, csrfProtection } from './middleware/csrf.js';
import { ipWhitelistMiddleware } from './middleware/ipWhitelist.js';
import { logger, httpLogger, wsLogger } from './utils/logger.js';
import { cleanupOldUploads } from './utils/cleanup.js';
import { artifactWatcher } from './canvas/ArtifactWatcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

const store = new SessionStore(config.database.path);
const tmux = new TmuxManager(config.tmux.socket, config.tmux.configPath);
const windowManager = new WindowManager(tmux, store);
const deviceManager = new MultiDeviceManager(store);
const auditLogger = new AuditLogger(store);
const automationEngine = new AutomationEngine(store, windowManager);
const connectionManager = new ConnectionManager(
  store,
  windowManager,
  deviceManager,
  automationEngine,
  auditLogger
);

app.use(express.json());
app.use(ipWhitelistMiddleware); // SECURITY: IP whitelist (if enabled)
app.use(securityHeaders);
app.use(corsMiddleware);
app.use(httpLogger);
app.use(httpRateLimiter(store.getDatabase()));

app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

const wss = new WebSocketServer({ 
  server, 
  path: config.websocket.path,
  maxPayload: config.websocket.maxMessageSize, // SECURITY: Limit message size
  clientTracking: true,
  perMessageDeflate: false, // SECURITY: Disable compression to prevent compression bombs
});

wss.on('connection', (ws, req) => {
  const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  
  wsLogger.info('New WebSocket connection', { clientIp, userAgent });
  connectionManager.handleConnection(ws, { clientIp, userAgent, req });
});

app.get('/api/health', (_req, res) => {
  const dbHealthy = (() => {
    try {
      store.getDatabase().prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  })();

  res.json({
    status: dbHealthy ? 'healthy' : 'degraded',
    uptime: process.uptime(),
    connections: connectionManager.getConnectionCount(),
    version: '0.1.0',
    database: { connected: dbHealthy },
    websocket: { connections: connectionManager.getConnectionCount() },
  });
});

app.get('/api/metrics', (_req, res) => {
  const metrics = [
    `# HELP zeus_connections_total Total WebSocket connections`,
    `# TYPE zeus_connections_total gauge`,
    `zeus_connections_total ${connectionManager.getConnectionCount()}`,
    `# HELP zeus_uptime_seconds Server uptime in seconds`,
    `# TYPE zeus_uptime_seconds gauge`,
    `zeus_uptime_seconds ${Math.floor(process.uptime())}`,
  ];
  
  res.type('text/plain').send(metrics.join('\n'));
});

app.get('/api/csrf-token', autheliaAuth, csrfToken, (_req, res) => {
  res.json({ data: { token: res.locals.csrfToken } });
});

app.use('/api/automations', autheliaAuth, csrfToken, csrfProtection, automationRoutes(store, automationEngine, windowManager, connectionManager));
app.use('/api/templates', autheliaAuth, csrfToken, csrfProtection, templateRoutes(store));
app.use('/api/commands', autheliaAuth, csrfToken, csrfProtection, commandRoutes(store));
app.use('/api/uploads', autheliaAuth, csrfToken, csrfProtection, uploadRoutes(store, connectionManager));
app.use('/api/projects', autheliaAuth, projectRoutes());
app.use('/api', autheliaAuth, csrfToken, csrfProtection, apiRoutes(store));

if (config.nodeEnv === 'production') {
  const clientPath = path.join(__dirname, '../client');
  app.use(express.static(clientPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
  });
} else {
  // Development: Proxy to Vite for HMR
  // Note: In production through nginx, nginx directly proxies to Vite
  // This is for local development on localhost:8096
  app.get('/', (req, res) => {
    // If accessed through nginx (has x-forwarded headers), let nginx handle routing
    if (req.headers['x-forwarded-for']) {
      res.status(503).send('Service should be accessed through nginx reverse proxy');
      return;
    }
    
    // Local development: serve HTML that loads from Vite
    const vitePort = process.env.VITE_PORT || '3005';
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <link rel="icon" type="image/svg+xml" href="http://localhost:${vitePort}/vite.svg" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Zeus Terminal</title>
        </head>
        <body>
          <div id="root"></div>
          <script type="module" src="http://localhost:${vitePort}/@vite/client"></script>
          <script type="module" src="http://localhost:${vitePort}/src/client/main.tsx"></script>
        </body>
      </html>
    `);
  });
}

const host = config.host;
server.listen(config.port, host, () => {
  logger.info('Server started', {
    port: config.port,
    host,
    environment: config.nodeEnv,
    wsPath: config.websocket.path,
    database: config.database.path,
  });
});

artifactWatcher.on('artifact', (artifact) => {
  connectionManager.broadcastToAll({
    type: 'canvas:artifact',
    artifact,
  } as any);
  
  const connectedUsers = connectionManager.getConnectedUserEmails();
  for (const email of connectedUsers) {
    store.saveTempArtifact({
      id: artifact.id,
      user_email: email,
      type: artifact.type,
      content: artifact.content,
      language: artifact.language || null,
      title: artifact.title || null,
      source_window: artifact.sourceWindow || null,
    });
  }
});
artifactWatcher.start().catch((err) => {
  logger.error('Failed to start artifact watcher:', err);
});

const cleanupInterval = setInterval(() => {
  store.cleanupExpiredTokens();
  store.cleanupInactiveSessions();
  store.cleanupExpiredTempArtifacts();
  auditLogger.cleanupOldLogs();
  cleanupOldUploads();
}, 15 * 60 * 1000);

process.on('SIGTERM', () => {
  logger.warn('SIGTERM received, shutting down gracefully...');
  clearInterval(cleanupInterval);
  artifactWatcher.stop();
  connectionManager.closeAll();
  deviceManager.destroy();
  automationEngine.destroy();
  store.close();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.warn('SIGINT received, shutting down gracefully...');
  clearInterval(cleanupInterval);
  artifactWatcher.stop();
  connectionManager.closeAll();
  deviceManager.destroy();
  automationEngine.destroy();
  store.close();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
