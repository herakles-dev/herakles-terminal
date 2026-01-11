# Herakles Terminal - Claude Development Context

**Version:** 0.2.0 | **Last Updated:** January 2026

## Quick Context
- **What:** Mobile-first web terminal (xterm.js + WebSocket + tmux persistence)
- **Port:** 8096 | **Subdomain:** terminal.herakles.dev
- **Stack:** React 18 + TypeScript + Vite (client) | Node.js + Express + ws + node-pty (server)
- **Status:** Production-ready with recent display quality improvements complete

## Recent Changes (January 2026)
The 6-phase display quality refactor is **complete**:
- ✅ OutputPipelineManager consolidates buffer handling
- ✅ Resize coordination simplified (8 refs → 4 refs)
- ✅ Renderer lifecycle uses MutationObserver + state machine
- ✅ 6 themes available with runtime switching
- ✅ CSS split into modular files

See `docs/archive/2026-01-refactor/` for historical implementation details.

## Project Discovery
```bash
# Structure
ls src/client/components/    # React components (17 dirs)
ls src/server/               # Backend modules (16 dirs, incl. search/)
ls docs/                     # Documentation

# Current state
curl -s http://localhost:8096/api/health | jq
lsof -i :8096                # Check port
sqlite3 data/zeus.db "SELECT COUNT(*) FROM sessions"  # DB state
```

## Development Commands
```bash
npm run dev          # Start dev (Vite + nodemon)
npm run build        # Production build
npm run typecheck    # Type check
npm run lint         # Lint
npm test             # Vitest
```

## Verification (Run After Changes)
```bash
# After ANY code change - quick validation
npm run typecheck && npm run lint

# After client changes
npm run build && curl -s http://localhost:8096/api/health | jq

# After server changes
npm run build && docker restart zeus-terminal && sleep 3 && curl -s http://localhost:8096/api/health

# After WebSocket changes
npm test -- --grep "websocket" && npm run dev  # Manual test in browser

# Full validation before commit
npm run typecheck && npm run lint && npm test && npm run build
```

## Testing Patterns
```bash
# Run all tests
npm test

# Run specific test file
npm test -- src/client/services/__tests__/OutputPipelineManager.test.ts

# Run tests matching pattern
npm test -- --grep "resize"

# Watch mode during development
npm test -- --watch
```
**Test location:** Tests live next to source in `__tests__/` directories.
**Naming:** `ComponentName.test.ts` or `hookName.test.ts`

## Docker / Service Commands
```bash
# View container status
docker ps | grep zeus

# Restart service
docker restart zeus-terminal

# View container logs
docker logs zeus-terminal --tail 100

# Rebuild and restart
docker-compose build && docker-compose up -d

# Enter container shell
docker exec -it zeus-terminal /bin/sh
```

## DO NOT
- **Don't edit `dist/`** - Generated files, will be overwritten
- **Don't hardcode secrets** - Use `process.env.VAR` and load from hercules.env
- **Don't skip typecheck** - TypeScript errors break production builds
- **Don't modify `node_modules/`** - Use patches or forks if needed
- **Don't add `console.log` in production** - Use the Logger utility instead
- **Don't bypass CSRF** - All POST endpoints require CSRF token

## Architecture
```
Client (src/client/)                Server (src/server/)
├── App.tsx                         ├── index.ts (Express + WebSocket)
├── components/                     ├── api/routes.ts
│   ├── TerminalCore/               ├── api/commands.ts (search integration)
│   ├── SplitView/                  ├── api/templates.ts (595 built-in templates)
│   ├── SidePanel/                  ├── websocket/ConnectionManager.ts
│   │   └── CommandBuilder.tsx      ├── session/SessionManager.ts
│   ├── Canvas/                     ├── session/SessionStore.ts (SQLite)
│   ├── MobileInputHandler/         ├── tmux/TmuxManager.ts
│   ├── QuickKeyBar/                ├── canvas/ArtifactWatcher.ts
│   └── Toast/                      ├── search/ (command discovery)
├── hooks/                          │   ├── SearchEngine.ts (fuzzy search)
│   ├── useWebSocket.ts             │   └── ContextDetector.ts
│   ├── useXTermSetup.ts            ├── middleware/ (auth, csrf, rate-limit)
│   ├── useRendererSetup.ts         └── audit/AuditLogger.ts
│   └── useResizeCoordinator.ts
├── services/
│   └── OutputPipelineManager.ts
└── styles/terminal.css

Shared (src/shared/)
├── types.ts       # TypeScript interfaces
├── protocol.ts    # WebSocket message types
├── constants.ts   # Config defaults
├── themes.ts      # Terminal themes (6 built-in)
└── errors.ts      # Error types
```

## Key Files
| Purpose | Path |
|---------|------|
| Main app | `src/client/App.tsx` |
| Terminal wrapper | `src/client/components/TerminalCore/TerminalCore.tsx` |
| Split view layout | `src/client/components/SplitView/SplitView.tsx` |
| Side panel | `src/client/components/SidePanel/SidePanel.tsx` |
| Command builder | `src/client/components/SidePanel/CommandBuilder.tsx` |
| **Output pipeline** | `src/client/services/OutputPipelineManager.ts` |
| WebSocket client | `src/client/hooks/useWebSocket.ts` |
| XTerm setup | `src/client/hooks/useXTermSetup.ts` |
| Resize coordinator | `src/client/hooks/useResizeCoordinator.ts` |
| Renderer setup | `src/client/hooks/useRendererSetup.ts` |
| Terminal CSS | `src/client/styles/terminal.css` |
| Server entry | `src/server/index.ts` |
| WebSocket server | `src/server/websocket/ConnectionManager.ts` |
| Session store | `src/server/session/SessionStore.ts` |
| Command routes | `src/server/api/commands.ts` |
| Search engine | `src/server/search/SearchEngine.ts` |
| Built-in templates | `src/server/api/templates.ts` |
| Config | `src/server/config.ts` |
| Shared types | `src/shared/types.ts` |
| **Theme definitions** | `src/shared/themes.ts` |
| WebSocket protocol | `src/shared/protocol.ts` |

## WebSocket Protocol
```typescript
// Client → Server
{ type: 'input', windowId, data }
{ type: 'window:resize', windowId, cols, rows }
{ type: 'window:subscribe', windowId }
{ type: 'session:create', name? }
{ type: 'session:resume', sessionId }

// Server → Client
{ type: 'auth-success', token, sessions }
{ type: 'session:created', session }
{ type: 'window:created', window }
{ type: 'window:output', windowId, data }
{ type: 'window:restore', windowId, content }
{ type: 'canvas:artifact', artifact }
{ type: 'error', code, message }
```
See `src/shared/protocol.ts` for complete list.

## Canvas Artifact System
```bash
send-artifact markdown '# Title'
send-artifact mermaid 'graph TD; A-->B'
send-artifact code 'console.log("hi")' javascript
send-artifact json '{"key": "value"}'
```
See `docs/CANVAS.md` for full documentation.

## Command Search & Discovery System
The CommandBuilder in SidePanel provides intelligent command suggestions:

**Features:**
- **595 built-in templates** across categories: git, docker, npm, system, ssh, claude
- **Fuzzy search** with Jaro-Winkler similarity (finds "gti status" → "git status")
- **Context-aware boosting** - git commands boosted in git repos, docker commands near compose files
- **User history integration** - recent commands ranked by frequency and recency

**API Endpoints:**
```
GET /api/commands/suggestions?prefix=git&limit=15
GET /api/commands/history?limit=20
POST /api/commands/validate  { command: "rm -rf /" }
```

**Response format:**
```json
{
  "data": [{
    "command": "git status",
    "description": "Show working tree status",
    "category": "git",
    "score": 0.95,
    "source": "template",
    "contextBoosts": ["git-repo-detected"]
  }]
}
```

**Adding new templates:** Edit `src/server/api/templates.ts` BUILT_IN_TEMPLATES array.

## Component Patterns
```tsx
// Styling: Tailwind + CSS variables (terminal.css)
// Colors: --accent-cyan (#00d4ff), --bg-primary (#000)
// Sizing: text-[10px], text-[11px] for compact UI
// Borders: border-[#1a1a1e], rounded (not rounded-lg)

// Imports: use index.ts barrels
import { SplitView } from './components/SplitView';

// Handlers: useCallback for props
const handleClick = useCallback(() => { ... }, [deps]);
```

## Common Tasks

### Add WebSocket message type
1. Define type in `src/shared/protocol.ts`
2. Add validation in `src/server/websocket/messageSchema.ts`
3. Add handler in `src/server/websocket/ConnectionManager.ts`
4. Add client handler in `src/client/App.tsx` → `handleMessage`

### Add SidePanel tab
1. Create component in `src/client/components/SidePanel/`
2. Add to `TABS` array in `SidePanel.tsx`

### Add API endpoint
1. Add route in `src/server/api/routes.ts`
2. Add types if needed in `src/shared/types.ts`

### Send artifact from backend
```typescript
connectionManager.broadcastToAll({
  type: 'canvas:artifact',
  artifact: { type: 'markdown', content: '# Hello', title: 'Test' }
});
```

## Debugging
```bash
# Server logs
tail -f server.log

# tmux sessions
tmux -S /tmp/zeus-tmux list-sessions

# Database
sqlite3 data/zeus.db "SELECT id, name, state FROM sessions ORDER BY last_active_at DESC LIMIT 5"
sqlite3 data/zeus.db "SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 10"

# Port check
lsof -i :8096

# WebSocket: Browser DevTools → Network → WS tab
```
See `docs/guides/DEBUGGING_GUIDE.md` for detailed log correlation.

## Error Recovery
| Problem | Solution |
|---------|----------|
| Build fails | `rm -rf node_modules && npm install && npm run build` |
| TypeScript errors | `npm run typecheck` to see all errors, fix in order |
| Port 8096 in use | `lsof -i :8096` then `kill -9 <PID>` |
| Container won't start | `docker logs zeus-terminal` to see error |
| Database locked | `sqlite3 data/zeus.db ".tables"` to test, restart if locked |
| tmux session stuck | `tmux -S /tmp/zeus-tmux kill-server` and restart |
| WebSocket disconnects | Check `server.log` for connection errors |

## Security
- **Auth:** Cloudflare Access (Authelia middleware)
- **Secrets:** `source /home/hercules/.secrets/hercules.env`
- **CSRF:** Protection on POST endpoints
- **Rate limiting:** Configurable per endpoint
- **Audit logging:** All auth/session events → SQLite

See `SECURITY.md` for full details.

## Documentation
| Doc | Purpose |
|-----|---------|
| `docs/ARCHITECTURE.md` | System diagram, component overview |
| `docs/CANVAS.md` | Artifact system (send-artifact, renderers) |
| `docs/guides/DEVELOPMENT_GUIDE.md` | Workflows, logging, testing |
| `docs/guides/DEBUGGING_GUIDE.md` | Log correlation, troubleshooting |
| `docs/archive/` | Historical: completed refactor plans and fix guides |
