# Zeus Terminal - Development Guide for Claude Code

**Version:** 1.0.0  
**Last Updated:** December 17, 2025  
**Purpose:** Comprehensive guide for AI-assisted development with centralized logging

---

## Quick Start for Claude Code

### Understanding the Codebase (5 minutes)

1. **Read Core Documentation:**
   ```bash
   cat CLAUDE.md                           # Project context
   cat docs/ARCHITECTURE.md                # System architecture
   cat docs/guides/DEBUGGING_GUIDE.md      # Logging & debugging
   ```

2. **Understand File Structure:**
   ```
   src/
   ├── client/              # React frontend
   │   ├── components/      # UI components
   │   │   ├── TerminalCore/  # XTerm wrapper with renderer fallback
   │   │   ├── SplitView/     # Multi-window layout manager
   │   │   ├── SidePanel/     # Tabbed tools panel
   │   │   └── Canvas/        # Artifact rendering
   │   ├── hooks/           # React hooks
   │   │   ├── useXTermSetup.ts      # XTerm configuration
   │   │   ├── useRendererSetup.ts   # WebGL/Canvas/DOM fallback
   │   │   ├── useResizeCoordinator.ts  # Coordinated resize
   │   │   └── useWebSocket.ts       # WebSocket client
   │   ├── styles/          # CSS
   │   │   └── terminal.css   # Terminal layout & styling
   │   └── App.tsx          # Main app entry
   ├── server/              # Node.js backend
   │   ├── websocket/       # WebSocket handling
   │   ├── session/         # Session management
   │   ├── tmux/            # Tmux operations
   │   ├── canvas/          # Artifact watcher
   │   └── config.ts        # Server configuration
   └── shared/              # TypeScript types, constants
       └── constants.ts     # Shared config defaults
   ```

3. **Check Current State:**
   ```bash
   # Service status
   curl http://localhost:8096/api/health
   
   # View logs
   docker logs --tail 50 zeus-terminal
   
   # Check database
   sqlite3 data/zeus.db "SELECT COUNT(*) FROM sessions"
   ```

---

## Logging Strategy

### Philosophy

**Server-side:** Comprehensive, structured logging for all business logic  
**Client-side:** Minimal logging - only unexpected errors

### Winston Logger Architecture

```typescript
// Global logger
import { logger } from './server/utils/logger.js';
logger.info('message', { key: 'value' });

// Component-specific loggers
import { wsLogger, dbLogger, authLogger, tmuxLogger } from './server/utils/logger.js';
wsLogger.info('WebSocket message received', { connectionId, type });

// HTTP request logging (automatic)
// Middleware logs all requests with: method, url, status, duration, userEmail, ip
```

### Log Levels

| Level | When to Use | Example |
|-------|-------------|---------|
| `error` | Exceptions, critical failures, 500+ errors | `logger.error('Failed to create session', { error: err.message })` |
| `warn` | Expected errors, rate limits, 400-499 errors | `logger.warn('Session not found', { sessionId })` |
| `info` | Normal operations, lifecycle events, requests | `logger.info('Session created', { sessionId, userEmail })` |
| `debug` | Detailed tracing (enabled with LOG_LEVEL=debug) | `logger.debug('Parsing tmux output', { output })` |

### Audit Logging

**Purpose:** Security-focused audit trail, separate from operational logs  
**Storage:** SQLite `audit_log` table  
**Events:** auth.*, session.*, window.*, automation.*, rate_limit.*, token.*

```typescript
import { AuditLogger } from './server/audit/AuditLogger.js';

const auditLogger = new AuditLogger(sessionStore);

// Predefined methods
auditLogger.logAuthSuccess({ userEmail, deviceId, ip, userAgent });
auditLogger.logSessionCreate({ sessionId, sessionName, userEmail, deviceId, ip, userAgent });
auditLogger.logWindowCreate({ windowId, sessionId, userEmail, deviceId, ip, userAgent });

// Generic method
auditLogger.log('info', 'custom.event', {
  userEmail,
  ip,
  details: { key: 'value' }
});
```

**Automatic Redaction:**  
Patterns: `password`, `token`, `secret`, `api_key`, `auth`, `credential`, `bearer`  
Result: `"password": "[REDACTED]"`

---

## Adding New Features

### Workflow: Add New UI Component

1. **Create Component:**
   ```bash
   mkdir -p src/client/components/MyComponent
   touch src/client/components/MyComponent/MyComponent.tsx
   touch src/client/components/MyComponent/index.ts
   ```

2. **Write Component (TypeScript + React):**
   ```typescript
   // src/client/components/MyComponent/MyComponent.tsx
   import { useCallback, useState } from 'react';
   
   interface MyComponentProps {
     onAction: (data: string) => void;
   }
   
   export default function MyComponent({ onAction }: MyComponentProps) {
     const [state, setState] = useState('');
     
     const handleClick = useCallback(() => {
       onAction(state);
     }, [state, onAction]);
     
     return (
       <div className="flex flex-col gap-2 p-4">
         <input
           value={state}
           onChange={(e) => setState(e.target.value)}
           className="px-3 py-2 bg-black border border-gray-700 rounded"
         />
         <button onClick={handleClick} className="px-4 py-2 bg-cyan-500 text-black rounded">
           Execute
         </button>
       </div>
     );
   }
   ```

3. **Export from index.ts:**
   ```typescript
   // src/client/components/MyComponent/index.ts
   export { default } from './MyComponent';
   ```

4. **Add to Parent Component:**
   ```typescript
   import MyComponent from './components/MyComponent';
   
   <MyComponent onAction={(data) => console.log(data)} />
   ```

5. **Logging:**
   - **Client-side:** Only add console.warn/error for unexpected states
   - **Server-side:** If component triggers API calls, add logging there

6. **Document:**
   - Update `CLAUDE.md` if significant
   - Update `docs/ARCHITECTURE.md` if architectural

---

### Workflow: Add New Server Feature

1. **Identify Component:**
   - Session logic → `src/server/session/SessionManager.ts`
   - Window/terminal → `src/server/window/WindowManager.ts`
   - Tmux operations → `src/server/tmux/TmuxManager.ts`
   - Authentication → `src/server/middleware/autheliaAuth.ts`
   - Automation → `src/server/automation/AutomationEngine.ts`

2. **Add Business Logic:**
   ```typescript
   // Example: Add method to SessionManager
   import { logger } from '../utils/logger.js';
   
   class SessionManager {
     async archiveSession(sessionId: string, userEmail: string): Promise<void> {
       logger.info('Archiving session', { sessionId, userEmail });
       
       try {
         const session = this.store.getSession(sessionId, userEmail);
         if (!session) {
           logger.warn('Session not found for archival', { sessionId, userEmail });
           throw new Error('Session not found');
         }
         
         // Archive logic here
         this.store.updateState(sessionId, 'archived');
         
         logger.info('Session archived successfully', { sessionId });
       } catch (error) {
         logger.error('Failed to archive session', { 
           sessionId, 
           error: error.message 
         });
         throw error;
       }
     }
   }
   ```

3. **Add WebSocket Handler (if needed):**
   ```typescript
   // src/server/websocket/ConnectionManager.ts
   
   private handleMessage(connectionId: string, message: ValidatedClientMessage): void {
     const connection = this.connections.get(connectionId);
     if (!connection) return;
   
     switch (message.type) {
       case 'session:archive':
         this.handleSessionArchive(connection, (message as any).sessionId);
         break;
       // ... other cases
     }
   }
   
   private async handleSessionArchive(connection: Connection, sessionId: string): Promise<void> {
     try {
       await this.sessionManager.archiveSession(sessionId, connection.user.email);
       
       this.auditLogger.log('info', 'session.archive', {
         sessionId,
         userEmail: connection.user.email,
         deviceId: connection.deviceId,
         ip: connection.clientIp,
         userAgent: connection.userAgent,
       });
       
       this.send(connection.ws, {
         type: 'session:archived',
         sessionId,
       });
     } catch (error) {
       logger.error('Session archive failed', { sessionId, error: error.message });
       this.send(connection.ws, {
         type: 'error',
         code: 'ARCHIVE_FAILED',
         message: error.message,
       });
     }
   }
   ```

4. **Add Message Validation:**
   ```typescript
   // src/server/websocket/messageSchema.ts
   
   export function validateClientMessage(data: unknown): ValidationResult {
     // ... existing validation
     
     if (type === 'session:archive') {
       if (typeof data.sessionId !== 'string') {
         return { success: false, error: 'sessionId must be string' };
       }
       return { success: true, data: data as SessionArchiveMessage };
     }
   }
   ```

5. **Add TypeScript Types:**
   ```typescript
   // src/shared/types.ts
   
   export interface SessionArchiveMessage {
     type: 'session:archive';
     sessionId: string;
   }
   
   export interface SessionArchivedMessage {
     type: 'session:archived';
     sessionId: string;
   }
   ```

6. **Add Tests:**
   ```typescript
   // src/server/__tests__/SessionManager.test.ts
   
   import { describe, it, expect } from 'vitest';
   import { SessionManager } from '../session/SessionManager';
   
   describe('SessionManager', () => {
     it('should archive session', async () => {
       const manager = new SessionManager(mockStore);
       await manager.archiveSession('session-id', 'user@example.com');
       expect(mockStore.updateState).toHaveBeenCalledWith('session-id', 'archived');
     });
   });
   ```

7. **Update Documentation:**
   - Update `docs/ARCHITECTURE.md` if architectural
   - Add log examples to `docs/guides/DEBUGGING_GUIDE.md`

---

## Centralized Logging Best Practices

### DO: Log Important Events

```typescript
// Session lifecycle
logger.info('Session created', { sessionId, userEmail });
logger.info('Session resumed', { sessionId, userEmail });
logger.info('Session terminated', { sessionId, reason: 'timeout' });

// Errors with context
logger.error('Database query failed', { 
  query: 'SELECT * FROM sessions', 
  error: err.message,
  userEmail 
});

// Security events (always use audit logger)
auditLogger.logAuthFailure({ userEmail, ip, reason: 'invalid token' });
auditLogger.logRateLimitExceeded({ userEmail, endpoint: '/api/sessions', limit: 100 });
```

### DO NOT: Log Sensitive Data

```typescript
// BAD - logs password
logger.info('User login', { email, password });

// GOOD - no sensitive data
logger.info('User login', { email });

// BAD - logs full token
logger.info('Token generated', { token: 'abc123...' });

// GOOD - logs token ID only
logger.info('Token generated', { tokenId: 'token-xyz' });
```

**Use AuditLogger for sensitive events** - it automatically redacts sensitive patterns.

### DO: Use Structured Logging

```typescript
// BAD - string concatenation
logger.info('User ' + userEmail + ' created session ' + sessionId);

// GOOD - structured metadata
logger.info('Session created', { userEmail, sessionId });

// GOOD - searchable in Loki
logger.info('HTTP Request', { 
  method: 'POST', 
  url: '/api/sessions', 
  status: 201,
  duration: '45ms',
  userEmail 
});
```

### DO: Log at Appropriate Levels

```typescript
// BAD - everything is info
logger.info('Starting server');
logger.info('Configuration loaded');
logger.info('Database error occurred');  // Should be ERROR

// GOOD - appropriate levels
logger.info('Starting server');
logger.debug('Configuration loaded', { config });
logger.error('Database error occurred', { error });
```

### DO NOT: Log in Tight Loops

```typescript
// BAD - logs every message
terminal.onData((data) => {
  logger.debug('Terminal output', { data }); // Too verbose!
});

// GOOD - log summary
let outputBytes = 0;
terminal.onData((data) => {
  outputBytes += data.length;
});
setInterval(() => {
  logger.debug('Terminal output summary', { outputBytes });
  outputBytes = 0;
}, 60000); // Every minute
```

### DO: Include Context for Debugging

```typescript
// BAD - no context
logger.error('Failed to resize');

// GOOD - full context
logger.error('Failed to resize terminal window', {
  windowId,
  sessionId,
  cols,
  rows,
  error: err.message,
  userEmail
});
```

---

## Testing Strategy

### Unit Tests (Vitest)

```typescript
// src/server/__tests__/SessionManager.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../session/SessionManager';

describe('SessionManager', () => {
  let manager: SessionManager;
  
  beforeEach(() => {
    manager = new SessionManager();
  });
  
  it('should create session with valid name', () => {
    const session = manager.createSession('My Session');
    expect(session.name).toBe('My Session');
    expect(session.state).toBe('active');
  });
  
  it('should throw on max sessions exceeded', () => {
    // Create 50 sessions (max)
    for (let i = 0; i < 50; i++) {
      manager.createSession();
    }
    
    expect(() => manager.createSession()).toThrow('Maximum sessions reached');
  });
});
```

**Run tests:**
```bash
npm run test
npm run test:watch  # Watch mode
npm run test:coverage
```

---

### E2E Tests (Playwright)

```typescript
// e2e/terminal.spec.ts
import { test, expect } from '@playwright/test';

test('user can create and use terminal session', async ({ page }) => {
  await page.goto('http://localhost:8096');
  
  // Wait for auth redirect (Authelia)
  // In test environment, mock auth or use test credentials
  
  await page.click('text=New Session');
  await page.waitForSelector('.terminal-view');
  
  // Type command
  await page.keyboard.type('echo "Hello World"\n');
  
  // Verify output
  await expect(page.locator('.terminal-view')).toContainText('Hello World');
});
```

**Run E2E tests:**
```bash
npm run test:e2e
```

---

## Code Quality

### Linting

```bash
npm run lint          # Check for issues
npm run lint:fix      # Auto-fix issues
```

**ESLint Config:** `.eslintrc.js`  
**Rules:** TypeScript strict mode, React hooks rules

---

### Type Checking

```bash
npm run typecheck
```

**TypeScript Config:**
- `tsconfig.json` - Client code
- `tsconfig.server.json` - Server code
- `tsconfig.node.json` - Build tools

---

## Database Migrations

### Adding a New Table

1. **Create Migration:**
   ```typescript
   // src/server/utils/migrate.ts
   
   export function runMigrations(db: Database) {
     const currentVersion = db.pragma('user_version', { simple: true });
     
     if (currentVersion < 5) {
       db.exec(`
         CREATE TABLE IF NOT EXISTS archived_sessions (
           id TEXT PRIMARY KEY,
           session_id TEXT NOT NULL,
           archived_at INTEGER NOT NULL,
           archived_by TEXT NOT NULL,
           data TEXT NOT NULL,
           FOREIGN KEY (session_id) REFERENCES sessions (id)
         );
         CREATE INDEX idx_archived_sessions_date ON archived_sessions (archived_at);
       `);
       
       db.pragma('user_version = 5');
       logger.info('Database migrated to version 5');
     }
   }
   ```

2. **Run Migration:**
   ```bash
   npm run db:migrate
   ```

3. **Verify:**
   ```bash
   sqlite3 data/zeus.db ".schema archived_sessions"
   sqlite3 data/zeus.db "PRAGMA user_version"
   ```

---

## Deployment Checklist

### Pre-Deployment

- [ ] All tests passing: `npm run test`
- [ ] Type check passing: `npm run typecheck`
- [ ] Lint passing: `npm run lint`
- [ ] Build successful: `npm run build`
- [ ] Environment variables set in `.env`
- [ ] Database migrations applied: `npm run db:migrate`
- [ ] Secrets loaded: `source /home/hercules/.secrets/hercules.env`

### Deployment

```bash
# Load secrets
source /home/hercules/.secrets/hercules.env

# Deploy
./scripts/deploy.sh

# Verify health
curl http://localhost:8096/api/health

# Check logs
docker logs -f zeus-terminal

# Test WebSocket
# Open browser to https://zeus.herakles.dev and create session
```

### Post-Deployment

- [ ] Health endpoint responding: `/api/health`
- [ ] Metrics endpoint working: `/api/metrics` (localhost only)
- [ ] WebSocket connections successful
- [ ] Loki receiving logs (if enabled)
- [ ] No errors in docker logs
- [ ] User can create session and use terminal

### Rollback

```bash
# Stop current container
docker-compose down

# Restore previous image
docker tag zeus-terminal:latest zeus-terminal:backup
docker tag zeus-terminal:previous zeus-terminal:latest

# Restart
docker-compose up -d

# Verify
curl http://localhost:8096/api/health
```

---

## Environment Variables Reference

```bash
# Server
PORT=8096
NODE_ENV=production
LOG_LEVEL=info  # debug | info | warn | error

# Database
DATABASE_PATH=/app/data/zeus.db

# Session
SESSION_SECRET=<64+ char random string>  # REQUIRED in production
SESSION_TIMEOUT=86400
MAX_SESSIONS=50
MAX_CONNECTIONS_PER_SESSION=5
MAX_WINDOWS_PER_SESSION=6

# WebSocket
WS_PATH=/ws
WS_HEARTBEAT_INTERVAL=30000  # 30 seconds
WS_HEARTBEAT_TIMEOUT=60000   # 1 minute

# Tmux
TMUX_SOCKET=/tmp/zeus-tmux
DEFAULT_SHELL=/bin/bash

# Observability
PROMETHEUS_ENABLED=true
LOKI_ENABLED=true
LOKI_HOST=http://loki:3100

# Security
ALLOWED_ORIGINS=https://zeus.herakles.dev
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000

# Audit
AUDIT_LOG_RETENTION_DAYS=90
```

---

## Common Development Tasks

### Add New WebSocket Message Type

1. Add to `src/shared/types.ts`:
   ```typescript
   export interface MyNewMessage {
     type: 'my:new';
     data: string;
   }
   ```

2. Add validation to `src/server/websocket/messageSchema.ts`:
   ```typescript
   if (type === 'my:new') {
     // Validate fields
     return { success: true, data: data as MyNewMessage };
   }
   ```

3. Add handler to `src/server/websocket/ConnectionManager.ts`:
   ```typescript
   case 'my:new':
     this.handleMyNew(connection, message as MyNewMessage);
     break;
   ```

4. Update `docs/ARCHITECTURE.md` if protocol change is significant

---

### Add New Audit Event

1. Add to `src/server/audit/AuditLogger.ts`:
   ```typescript
   export type AuditEvent =
     | 'auth.success'
     | 'my.new.event';  // Add here
   ```

2. Add typed method:
   ```typescript
   logMyNewEvent(context: AuditContext & { customField: string }): void {
     this.log('info', 'my.new.event', {
       ...context,
       details: { ...context.details, customField: context.customField },
     });
   }
   ```

3. Use in code:
   ```typescript
   auditLogger.logMyNewEvent({
     userEmail: 'user@example.com',
     ip: '127.0.0.1',
     customField: 'value',
   });
   ```

---

### Add New Prometheus Metric

```typescript
// src/server/api/routes.ts

import { register, Counter, Gauge } from 'prom-client';

// Create metric
const myCounter = new Counter({
  name: 'zeus_my_metric_total',
  help: 'Description of my metric',
  labelNames: ['label1', 'label2'],
});

// Use metric
myCounter.inc({ label1: 'value1', label2: 'value2' });

// Metrics automatically exposed at /api/metrics
```

---

## Troubleshooting Development

### "Module not found" Error

```bash
# Rebuild dependencies
rm -rf node_modules package-lock.json
npm install
```

### TypeScript Errors

```bash
# Clear cache and rebuild
rm -rf dist
npm run build
```

### Database Locked

```bash
# Stop all processes using database
docker-compose down
lsof | grep zeus.db
kill <PID>

# Restart
docker-compose up -d
```

### Loki Not Receiving Logs

```bash
# Check Loki health
curl http://localhost:3100/ready

# Check env vars
docker exec zeus-terminal env | grep LOKI

# Check Winston transport
docker logs zeus-terminal | grep "Loki"
```

---

## Resources

**Documentation:**
- `CLAUDE.md` - Project context and quick reference
- `docs/ARCHITECTURE.md` - System architecture
- `docs/CANVAS.md` - Canvas artifact system
- `docs/guides/DEBUGGING_GUIDE.md` - Log correlation and debugging
- `docs/guides/CRITICAL_FIXES_GUIDE.md` - Known issues and fixes

**Code References:**
- Entry Points: `src/client/main.tsx`, `src/server/index.ts`
- Types: `src/shared/types.ts`
- Constants: `src/shared/constants.ts`
- Config: `src/server/config.ts`

**External Tools:**
- Loki UI: `http://localhost:3000` (Grafana)
- Prometheus: `http://localhost:9090`
- Health Check: `http://localhost:8096/api/health`
- Metrics: `http://localhost:8096/api/metrics`

---

**End of Development Guide**
