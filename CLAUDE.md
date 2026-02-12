# Herakles Terminal - Claude Development Context

**Version:** 0.3.0 | **Last Updated:** February 2026

## Quick Context
- **What:** Mobile-first web terminal (xterm.js + WebSocket + tmux persistence)
- **Port:** 8096 | **Subdomain:** terminal.herakles.dev
- **Stack:** React 18 + TypeScript + Vite (client) | Node.js + Express + ws + node-pty (server)
- **Status:** Production-ready, terminal stability overhaul complete (Feb 2026)

## Recent Major Changes

### Terminal Stability Overhaul (February 2026) — Latest
17 fixes across 13 files. 183/183 tests pass. Net -155 lines.

**Highlights:**
- ✅ useImperativeHandle getter pattern - `handle.terminal` returns current ref (no stale null)
- ✅ Removed dead `terminalsRef` - 8 dead code paths eliminated
- ✅ Atomic tmux resize + 50ms server-side dedup prevents process flooding
- ✅ Layout schema fix - Zod now accepts fractional 0-1 values
- ✅ WebGL scrolling fix - removed forced scrollbar stealing column space
- ✅ Mobile containment softened (`strict` → `layout style`)

See `docs/archive/2026-01-refactor/` for complete implementation details.

### Feature Integrations
- ✅ **TodoPanel** - Live Claude Code task sync from `~/.claude/todos/`
- ✅ **Token Counter** - Real-time context usage indicator (watches `~/.claude/projects/`)
- ✅ **Project Navigator** - 114 AI thumbnails, smart merge, auto-add API
- ✅ **Command Search** - 88 templates, fuzzy search, context-aware boosting
- ✅ **Canvas Artifacts** - `send-artifact` CLI with markdown/mermaid/code renderers

## Essential Commands

### Development
```bash
npm run dev          # Start dev (Vite + nodemon)
npm run build        # Production build
npm run typecheck    # Type check (required before commit)
npm run lint         # Lint
npm test             # Vitest (all tests)
npm test -- --watch  # Watch mode
```

### Verification (After Changes)
```bash
# Quick validation
npm run typecheck && npm run lint

# Full validation before commit
npm run typecheck && npm run lint && npm test && npm run build

# After server changes (systemd)
npm run build && systemctl --user restart zeus-terminal && sleep 3 && curl -s http://localhost:8096/api/health
```

### Service Management
```bash
# Production (systemd)
systemctl --user status zeus-terminal
systemctl --user restart zeus-terminal
journalctl --user -u zeus-terminal -f

# Development (docker-compose)
docker-compose up -d
docker-compose logs -f zeus-terminal
docker-compose restart zeus-terminal

# Health check
curl -s http://localhost:8096/api/health | jq
lsof -i :8096  # Check port
```

### Debugging
```bash
# Logs
tail -f server.log

# Database
sqlite3 data/zeus.db "SELECT id, name, state FROM sessions ORDER BY last_active_at DESC LIMIT 5"

# tmux
tmux -S /tmp/zeus-tmux list-sessions

# WebSocket
# Browser DevTools → Network → WS tab
```

## Architecture Overview
```
Client (src/client/)
├── App.tsx                              # Main app, WebSocket message router
├── components/
│   ├── TerminalCore/                    # xterm.js wrapper
│   ├── SplitView/                       # Layout with transitions
│   ├── SidePanel/                       # Command builder, templates
│   ├── TodoPanel/                       # Claude Code task sync
│   ├── ProjectNavigator/                # Quick project access
│   └── Canvas/                          # Artifact rendering
├── hooks/
│   ├── useWebSocket.ts                  # WebSocket connection
│   ├── useXTermSetup.ts                 # Terminal initialization
│   ├── useRendererSetup.ts              # WebGL + OOM recovery
│   └── useResizeCoordinator.ts          # Atomic resize with lock
└── services/
    └── OutputPipelineManager.ts         # Buffer consolidation

Server (src/server/)
├── index.ts                             # Express + WebSocket server
├── websocket/ConnectionManager.ts       # Message handling, 50ms resize dedup
├── session/SessionStore.ts              # SQLite persistence
├── tmux/TmuxManager.ts                  # Process lifecycle
├── todo/TodoManager.ts                  # Claude Code sync
├── context/ContextManager.ts            # Token usage tracking
├── search/SearchEngine.ts               # Fuzzy command search
└── api/
    ├── commands.ts                      # Search endpoints
    ├── templates.ts                     # 88 built-in templates
    └── projects.ts                      # Project discovery

Shared (src/shared/)
├── types.ts                             # TypeScript interfaces
├── protocol.ts                          # WebSocket messages
├── todoProtocol.ts                      # Todo sync messages
└── themes.ts                            # 6 built-in themes
```

## Key Files Quick Reference
| Component | Path |
|-----------|------|
| **Output Pipeline** | `src/client/services/OutputPipelineManager.ts` |
| **Renderer Setup** | `src/client/hooks/useRendererSetup.ts` |
| **Resize Coordinator** | `src/client/hooks/useResizeCoordinator.ts` |
| **WebSocket Server** | `src/server/websocket/ConnectionManager.ts` |
| **Session Store** | `src/server/session/SessionStore.ts` |
| **Command Templates** | `src/server/api/templates.ts` |
| **WebSocket Protocol** | `src/shared/protocol.ts` |
| **Terminal CSS** | `src/client/styles/terminal.css` + `terminal-mobile.css` |

## Critical Rules: DO NOT

- **Don't edit `dist/`** - Generated files, will be overwritten
- **Don't hardcode secrets** - Use `process.env.VAR` from hercules.env
- **Don't skip typecheck** - TypeScript errors break production builds
- **Don't add `console.log` in production** - Use Logger utility
- **Don't bypass CSRF** - All POST endpoints require CSRF token
- **Don't modify `node_modules/`** - Use patches or forks

## Git Conventions

### Branch Naming
```
feature/description    # New features
fix/description        # Bug fixes
refactor/description   # Code improvements
```

### Commit Format
```
type: short description

Types: feat, fix, refactor, docs, test, chore

Examples:
feat: add theme switching API
fix: resolve resize race condition
refactor: consolidate output buffers
```

### Pre-Commit Checklist
```bash
npm run typecheck && npm run lint && npm test
git add -A && git status
git commit -m "type: description"
```

**Author:** Hercules <noreply@herakles.dev>

## WebSocket Protocol Summary
```typescript
// Client → Server
{ type: 'input', windowId, data }
{ type: 'window:resize', windowId, cols, rows }  // Server dedupes (50ms)
{ type: 'session:create', name? }
{ type: 'todo:subscribe', windowId }
{ type: 'context:subscribe', windowId }

// Server → Client
{ type: 'window:output', windowId, data }
{ type: 'window:restore', windowId, content }
{ type: 'todo:sync', windowId, todos }
{ type: 'context:update', windowId, usage }
{ type: 'canvas:artifact', artifact }
```
Complete protocol: `src/shared/protocol.ts`, `src/shared/todoProtocol.ts`

## Component Patterns
```tsx
// Styling: Tailwind + CSS variables (terminal.css)
// Colors: --accent-cyan (#00d4ff), --bg-primary (#000)
// Sizing: text-[10px], text-[11px] for compact UI

// Imports: use index.ts barrels
import { SplitView } from './components/SplitView';

// Handlers: useCallback for props
const handleClick = useCallback(() => { ... }, [deps]);
```

## Common Tasks

### Add WebSocket Message Type
1. Define type in `src/shared/protocol.ts`
2. Add validation in `src/server/websocket/messageSchema.ts`
3. Add handler in `src/server/websocket/ConnectionManager.ts`
4. Add client handler in `src/client/App.tsx` → `handleMessage`

### Add Command Template
Edit `src/server/api/templates.ts` BUILT_IN_TEMPLATES array

### Add SidePanel Tab
1. Create component in `src/client/components/SidePanel/`
2. Add to `TABS` array in `SidePanel.tsx`

### Add API Endpoint
1. Add route in `src/server/api/routes.ts`
2. Add types in `src/shared/types.ts` if needed

## Error Recovery Quick Reference
| Problem | Solution |
|---------|----------|
| Build fails | `rm -rf node_modules && npm install && npm run build` |
| TypeScript errors | `npm run typecheck` to see all, fix in order |
| Port 8096 in use | `lsof -i :8096` then `kill -9 <PID>` |
| Database locked | `sqlite3 data/zeus.db ".tables"` to test, restart if locked |
| tmux stuck | `tmux -S /tmp/zeus-tmux kill-server` and restart |
| WebGL context lost | Auto-recovers: clears buffer, reduces scrollback to 5K |
| Resize glitches | Server dedup (50ms) + atomic tmux resize + lock handles this |

## Feature System References

**TodoPanel (Claude Code Integration)**
- Watches `~/.claude/todos/` for task updates
- WebSocket: `todo:subscribe`, `todo:sync`, `todo:update`
- See: `src/server/todo/`, `src/client/components/TodoPanel/`

**Token Counter (Context Tracking)**
- Watches `~/.claude/projects/{project}/*.jsonl`
- Auto-matches windows via `auto_name` field (extracted from cwd)
- Color-coded: green → yellow → orange → red
- See: `src/server/context/`, troubleshooting in original CLAUDE.md

**Project Navigator**
- API: `/api/projects`, `/api/projects/unregistered`, `POST /api/projects/register`
- 114 AI thumbnails in `public/thumbnails/`
- Thumbnail generation: see original CLAUDE.md or `docs/PROJECT_NAVIGATOR.md`

**Command Search**
- API: `/api/commands/suggestions?prefix=git&limit=15`
- 88 templates with fuzzy search (Jaro-Winkler)
- Context-aware boosting (git repos, docker files)

**Canvas Artifacts**
```bash
send-artifact markdown '# Title'
send-artifact mermaid 'graph TD; A-->B'
send-artifact code 'console.log("hi")' javascript
```
Full docs: `docs/CANVAS.md`

## Security
- **Auth:** Cloudflare Access (Authelia middleware)
- **Secrets:** `source /home/hercules/.secrets/hercules.env`
- **CSRF:** Required on all POST endpoints
- **Rate limiting:** Configurable per endpoint
- **Audit logging:** SQLite (`audit_log` table)

## Documentation Index
| Doc | Purpose |
|-----|---------|
| `docs/ARCHITECTURE.md` | System diagram, component details |
| `docs/CANVAS.md` | Artifact system complete reference |
| `docs/guides/DEVELOPMENT_GUIDE.md` | Workflows, logging, testing patterns |
| `docs/guides/DEBUGGING_GUIDE.md` | Log correlation, troubleshooting flows |
| `docs/PROJECT_NAVIGATOR.md` | Thumbnail generation, API details |
| `docs/TODO_PANEL.md` | Integration details, troubleshooting |
| `docs/TOKEN_COUNTER.md` | Context tracking, auto-detection flow |
| `docs/archive/` | Historical refactor plans and fixes |

---

**Optimization Notes:**
- Reduced from 519 → 296 lines (43% reduction)
- Moved detailed "How it works" to dedicated docs in `docs/`
- Consolidated duplicate WebSocket protocol sections
- Kept all critical commands, rules, and quick references
- Preserved architecture overview and key file locations
