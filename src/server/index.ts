import express from 'express';
import { createServer } from 'http';
import { writeFileSync, appendFileSync, readFileSync } from 'fs';
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
import { createMusicRoutes } from './music/musicRoutes.js';
import { MusicPlayerStore } from './music/MusicPlayerStore.js';
import { MusicManager } from './music/MusicManager.js';
import { securityHeaders, corsMiddleware } from './middleware/security.js';
import { autheliaAuth } from './middleware/autheliaAuth.js';
import { httpRateLimiter, handoffLimiter } from './middleware/rateLimit.js';
import { csrfToken, csrfProtection } from './middleware/csrf.js';
import { ipWhitelistMiddleware } from './middleware/ipWhitelist.js';
import { logger, httpLogger, wsLogger } from './utils/logger.js';
import { cleanupOldUploads } from './utils/cleanup.js';
import { artifactWatcher } from './canvas/ArtifactWatcher.js';
import { ArtifactManager } from './canvas/ArtifactManager.js';
import './todo/TodoManager.js'; // Side-effect: initializes singleton and sets up event listeners
import { todoFileWatcher } from './todo/TodoFileWatcher.js';
import { contextManager } from './context/ContextManager.js';
import { contextFileWatcher } from './context/ContextFileWatcher.js';
import { migrateWindowAutoNames } from './migrations/migrateWindowAutoNames.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

const store = new SessionStore(config.database.path);
const musicStore = new MusicPlayerStore(store.getDatabase());
const musicManager = new MusicManager(musicStore);
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
connectionManager.setMusicManager(musicManager);

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

// User identity endpoint (used by client to detect role before WebSocket)
app.get('/api/whoami', autheliaAuth, (req, res) => {
  const user = (req as any).user;
  res.json({ username: user?.username || null, groups: user?.groups || [] });
});

// DEBUG: Minimap classification debug endpoint (no auth for debugging)
app.post('/api/debug/minimap', (req, res) => {
  const { lines, classifications } = req.body || {};
  const debugPath = '/tmp/minimap-debug.txt';
  const content = JSON.stringify({ lines, classifications, timestamp: new Date().toISOString() }, null, 2);
  writeFileSync(debugPath, content);
  logger.info(`[DEBUG] Minimap data written to ${debugPath}`);
  res.json({ success: true, path: debugPath });
});

// DEBUG: Browser console loopback (no auth for debugging)
app.post('/api/debug/console', (req, res) => {
  const { level, message, data, component, timestamp } = req.body || {};
  const logLine = `[${timestamp || new Date().toISOString()}] [${(level || 'log').toUpperCase()}] [${component || 'unknown'}] ${message} ${data ? JSON.stringify(data) : ''}`;
  logger.info(`[BROWSER] ${logLine}`);
  try {
    appendFileSync('/tmp/browser-console.log', logLine + '\n');
  } catch { /* ignore */ }
  res.json({ success: true });
});

app.get('/api/debug/console', (_req, res) => {
  try {
    const logs = readFileSync('/tmp/browser-console.log', 'utf-8');
    const lines = logs.split('\n').filter(Boolean).slice(-100);
    res.json({ data: lines });
  } catch {
    res.json({ data: [] });
  }
});

app.delete('/api/debug/console', (_req, res) => {
  try {
    writeFileSync('/tmp/browser-console.log', '');
  } catch { /* ignore */ }
  res.json({ success: true });
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

// Apply handoff-specific rate limiting to the automation run endpoint
app.use('/api/automations/:id/run', handoffLimiter(store.getDatabase()));

app.use('/api/automations', autheliaAuth, csrfToken, csrfProtection, automationRoutes(store, automationEngine, windowManager, connectionManager));
app.use('/api/templates', autheliaAuth, csrfToken, csrfProtection, templateRoutes(store));
app.use('/api/commands', autheliaAuth, csrfToken, csrfProtection, commandRoutes(store));
app.use('/api/uploads', autheliaAuth, csrfToken, csrfProtection, uploadRoutes(store, connectionManager));
app.use('/api/projects', autheliaAuth, projectRoutes());
app.use('/api/music', autheliaAuth, csrfToken, csrfProtection, createMusicRoutes(musicStore));

// Serve project thumbnails statically
app.use('/thumbnails', express.static(path.join(__dirname, '../../public/thumbnails')));
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

const artifactManager = new ArtifactManager();
connectionManager.setArtifactManager(artifactManager);

artifactWatcher.on('artifact', (artifact) => {
  connectionManager.broadcastToAll({
    type: 'canvas:artifact',
    artifact,
  });

  // Track in artifact history (in-memory, last 50)
  artifactManager.recordArtifact(artifact);
  artifactManager.broadcastHistory();

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

// Start watching ~/.claude/todos/ for Claude Code todo changes
// TodoManager listens to 'allTodos' events internally via setupWatcherListener()
todoFileWatcher.startGlobalWatch();

logger.info('TodoManager initialized for Claude Code TodoWrite sync');

// Start watching ~/.claude/projects/ for Claude Code context usage
// ContextManager listens to 'contextUpdate' events internally via setupWatcherListener()
contextManager.setDatabase(store.getDatabase());
contextManager.setTmuxManager(tmux);
contextFileWatcher.startWatch();

logger.info('ContextManager initialized for Claude Code context tracking');

// Run database migrations
migrateWindowAutoNames(store.getDatabase(), tmux)
  .then(() => logger.info('Database migrations completed'))
  .catch((err) => logger.error('Database migration failed:', err));

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
  todoFileWatcher.stopAll();
  contextFileWatcher.stopAll();
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
  todoFileWatcher.stopAll();
  contextFileWatcher.stopAll();
  connectionManager.closeAll();
  deviceManager.destroy();
  automationEngine.destroy();
  store.close();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
