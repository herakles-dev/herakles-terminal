# Herakles Terminal - Claude Development Context

**Version:** 2.0.0 | **Last Updated:** April 4, 2026 | **Protocol:** [V11](/home/hercules/v11/CLAUDE.md)

## Quick Context
- **What:** Mobile-first web terminal (xterm.js + WebSocket + tmux persistence)
- **Port:** 8096 | **Subdomain:** terminal.herakles.dev
- **Stack:** React 18 + TypeScript + Vite (client) | Node.js + Express + ws + node-pty (server)
- **Status:** Production v2.0.0 (557 tests, Apr 4, 2026)
- **Layout:** SplitView v1 = PRODUCTION (`USE_GRID_LAYOUT = false`). WindowGrid v2 = TESTING.
- **Renderer:** DOM renderer v2.0 = PRODUCTION (`USE_DOM_RENDERER = true`). WebGL fallback available.

## Essential Commands

### Development
```bash
npm run dev          # Start dev (Vite + tsx watch)
npm run build        # Production build
npm run typecheck    # Type check (required before commit)
npm run lint         # Lint
npm test             # Vitest (all tests)
npm test -- --watch  # Watch mode
```

### Verification
```bash
npm run typecheck && npm run lint                                # Quick
npm run typecheck && npm run lint && npm test && npm run build   # Full (before commit)
```

### Service Management
```bash
lsof -i :8096                            # Find PID
kill $(lsof -i :8096 -t)                 # Stop
source ~/.secrets/hercules.env && SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}" NODE_ENV=production nohup node dist/server/index.js > server.log 2>&1 & disown  # Start
curl -s http://localhost:8096/api/health | jq               # Verify
```

### Debugging
```bash
tail -f server.log                        # Logs
sqlite3 data/zeus.db "SELECT id, name, state FROM sessions ORDER BY last_active_at DESC LIMIT 5"
tmux -S /tmp/zeus-tmux list-sessions      # tmux state
```

## Critical Rules: DO NOT

- **Don't edit `dist/`** - Generated files, will be overwritten
- **Don't hardcode secrets** - Use `process.env.VAR` from hercules.env
- **Don't skip typecheck** - TypeScript errors break production builds
- **Don't add `console.log` in production** - Use Logger utility
- **Don't bypass CSRF** - All POST endpoints require CSRF token
- **Don't modify `node_modules/`** - Use patches or forks

## Architecture Overview
```
Client (src/client/)
├── App.tsx                              # Main app, WebSocket router, layout dispatch
├── components/
│   ├── TerminalCore/                    # xterm.js wrapper
│   ├── SplitView/                       # [v1] Absolute positioning layout (PRODUCTION)
│   ├── WindowGrid/                      # [v2] CSS Grid layout (TESTING)
│   ├── TeamBar/                         # Team cockpit (bottom bar + accordion)
│   ├── SearchOverlay/                    # Ctrl+F terminal search with highlights
│   ├── SidePanel/                       # Command builder, templates
│   ├── TodoPanel/                       # Claude Code task sync
│   ├── Canvas/                          # Artifact rendering + fullscreen
│   ├── MusicPlayer/ + MusicDock/        # YouTube player (floating + window modes)
│   ├── ProjectNavigator/                # Quick project access
│   ├── TemplateToolbar/                 # Icon template toolbar
│   └── WelcomePage/                     # Lightning welcome screen
├── hooks/
│   ├── useResizeCoordinator.ts          # [v1] Debounce-based resize
│   ├── useGridResize.ts                 # [v2] ResizeObserver → RAF → fit()
│   ├── useTeamCockpit.ts                # Team state management
│   └── useWebSocket / useXTermSetup / useRendererSetup
├── renderer/
│   ├── ScreenBuffer.ts                  # Packed Int32Array cells, row-level diff
│   ├── DomRenderer.ts                   # Row divs + styled spans, CSS var themes
│   ├── VirtualScroller.ts               # Scrollback navigation with scrollbar
│   ├── Cursor.ts                        # Blinking cursor overlay
│   ├── measureFont.ts                   # Monospace char measurement
│   └── linkDetector.ts                  # URL detection for clickable links
└── services/
    └── OutputPipelineManager.ts         # Buffer consolidation + spinner filtering

Server (src/server/)
├── index.ts                             # Express + WebSocket server
├── websocket/ConnectionManager.ts       # Message handling
├── session/SessionStore.ts              # SQLite persistence
├── tmux/TmuxManager.ts                  # Process lifecycle
├── team/ (TeamManager + TeamFileWatcher) # Team cockpit server
├── todo/TodoManager.ts                  # Claude Code sync
├── context/ContextManager.ts            # Per-window token tracking
├── music/MusicManager.ts + canvas/ArtifactManager.ts
└── api/ (commands, templates, projects)

Shared (src/shared/)
├── types.ts, constants.ts, protocol.ts, teamProtocol.ts
├── musicProtocol.ts, contextProtocol.ts, todoProtocol.ts
├── terminalFilters.ts, themes.ts
```

## Key Files Quick Reference
| Component | Path |
|-----------|------|
| **Layout v1 (prod)** | `src/client/components/SplitView/` + `hooks/useResizeCoordinator.ts` |
| **Layout v2 (test)** | `src/client/components/WindowGrid/` + `hooks/useGridResize.ts` |
| **Team Cockpit** | `src/client/hooks/useTeamCockpit.ts` + `src/server/team/` |
| **Output Pipeline** | `src/client/services/OutputPipelineManager.ts` |
| **WebSocket Server** | `src/server/websocket/ConnectionManager.ts` |
| **Protocol** | `src/shared/protocol.ts` + `teamProtocol.ts` + `musicProtocol.ts` |
| **Terminal CSS** | `src/client/styles/terminal.css` + `grid-layout.css` |

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

## Error Recovery
| Problem | Solution |
|---------|----------|
| Build fails | `rm -rf node_modules && npm install && npm run build` |
| Port 8096 in use | `lsof -i :8096` then `kill -9 <PID>` |
| Database locked | `sqlite3 data/zeus.db ".tables"` to test, restart |
| tmux stuck | `tmux -S /tmp/zeus-tmux kill-server` and restart |
| Resize glitches | RESOLVED v1.3.3. Zero layout transitions. See [changelog](.claude/docs/CHANGELOG.md) |
| Grid v2 issues | Testing only. Set `USE_GRID_LAYOUT = true` in constants.ts |

## Git Conventions
```
feat|fix|refactor|docs|test|chore: short description
```
Pre-commit: `npm run typecheck && npm run lint && npm test`

**Author:** Hercules <noreply@herakles.dev>

## Security
- **Auth:** Cloudflare Access (Authelia middleware)
- **Secrets:** `source /home/hercules/.secrets/hercules.env`
- **CSRF:** Required on all POST endpoints
- **Rate limiting:** Configurable per endpoint
- **Audit logging:** SQLite (`audit_log` table)

## Known Issues
- **v1 (SplitView)** is STABLE PRODUCTION (`USE_GRID_LAYOUT = false`)
- **v2 (WindowGrid)** is TESTING — has typing glitches (line duplication, cursor jumps)
- V1 resize pipeline hardened: 80ms drain, 50ms dedup, dot filter, post-resize suppression

## Docs
| Doc | Purpose |
|-----|---------|
| [Changelog](.claude/docs/CHANGELOG.md) | Version history (v1.0.0 through v1.3.3) |
| [Features](.claude/docs/FEATURES.md) | Feature system references + component patterns |
| [Protocol](.claude/docs/PROTOCOL.md) | WebSocket protocol summary |
| [Architecture](docs/ARCHITECTURE.md) | System diagram, component details |
| [Canvas](docs/CANVAS.md) | Artifact system complete reference |
| [Media Windows](docs/MEDIA_WINDOWS_IMPLEMENTATION.md) | v1.1.0 window mode feature |
| [Development](docs/guides/DEVELOPMENT_GUIDE.md) | Workflows, logging, testing patterns |
| [Debugging](docs/guides/DEBUGGING_GUIDE.md) | Log correlation, troubleshooting flows |
| [Archive](docs/archive/) | Historical refactor plans and fixes |

<!-- Validated: 2026-03-31 by v11-drift -->
