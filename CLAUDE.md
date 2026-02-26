# Herakles Terminal - Claude Development Context

**Version:** 1.1.0 | **Last Updated:** February 25, 2026

## Quick Context
- **What:** Mobile-first web terminal (xterm.js + WebSocket + tmux persistence)
- **Port:** 8096 | **Subdomain:** terminal.herakles.dev
- **Stack:** React 18 + TypeScript + Vite (client) | Node.js + Express + ws + node-pty (server)
- **Status:** Production v1.1.0 (Media Windows, Feb 17, 2026)

## Recent Major Changes

### v1.0.0 Production Feature Set (February 12, 2026) — Latest
**Team**: V9 Agent Teams `feature-impl` formation | **Duration**: 4.5 hours | **Tests**: 320/320

**7 Major Features Delivered:**
- ✨ **Icon Template Toolbar** - 9 icon categories, hover dropdowns, mobile menu (88 templates accessible in 1 hover)
- ⚡ **Lightning Welcome Page** - Animated background, feature cards, keyboard shortcuts showcase
- 📊 **Per-Window Token Tracking** - Accurate context usage with toast warnings at 90/95/98% thresholds
- ✨ **Enhanced Tasks Panel** - Resizable 200-400px, vertical progress bars, status badges, metadata chips
- 🎵 **Dockable YouTube Player** - 4 snap positions (corners), drag-to-dock zones, multi-device sync
- 🎨 **Fullscreen Canvas Mode** - Toolbar button + Ctrl+Shift+A, navigation arrows, download (D key)
- 📚 **Artifact History** - 50-artifact cache, thumbnails, auto-tagging

**Quality:** 320 tests (+137 new), 0 regressions, TypeScript strict mode, production build verified

**New Components:** TemplateToolbar, WelcomePage, MusicDock, ArtifactToolbarButton, enhanced TodoPanel/FullscreenViewer

**New Protocols:** music:subscribe/dock:update/dock:restore, artifact:subscribe/history, context:warning

See `/home/hercules/sessions/herakles-terminal/LAUNCH_SUMMARY.md` for complete details.

### Media Windows Integration (February 13, 2026) — v1.1.0
**Implementation**: Type-based window system | **Duration**: 2 hours | **Tests**: 345/345 ✅

**Feature**: YouTube music player can now render as a SplitView window alongside terminals

**Key Components:**
- 🪟 **Type-Based Windows** - `WindowType = 'terminal' | 'media'` with full TypeScript support
- 🎵 **Window Mode Player** - YouTube player integrated into SplitView grid
- 🔄 **Mode Toggle** - Seamless floating ↔ window transitions with "Dock to Window" button
- 📊 **Smart Layouts** - Terminals use grid (left), media positioned bottom-right
- 💾 **State Persistence** - Shared musicPlayerState, playback continues during transitions

**Technical:**
- Database migration 006: `ALTER TABLE windows ADD COLUMN type TEXT DEFAULT 'terminal'`
- Type-safe rendering dispatcher in App.tsx
- 11 shared music control callbacks
- Starred videos API sync at App level
- Zero regressions, 100% backward compatible

**User Workflows:**
1. Click YouTube icon → Load video → Click "Dock to Window" → Player becomes window
2. Media window playing → Click "Toggle Mode" → Returns to floating
3. Mix terminal windows + media window → Auto-layout handles both types

**Files**: 14 modified (+1514/-389 lines) | **Docs**: `docs/MEDIA_WINDOWS_IMPLEMENTATION.md`

### Terminal Pulsing Fix (February 17, 2026)
**Impact**: Long-session stability | **Changed**: 4 files

**Problem**: Terminal content pulsed/flickered on one side during Claude Code spinner, worsening over time
**Solution**: 4 root cause fixes across rendering, filtering, and resize verification

**Key Fixes:**
- ✅ `renderWindow` ref-stabilized — music state via refs, terminal windows no longer re-render from playback
- ✅ `filterThinkingOutput` fixed — ANSI regex handles `?`-prefixed sequences, splits on `\r`, catches braille-prefixed lines
- ✅ WebGL canvas verify reduced — 2 retries (was 5), 4px tolerance (was 2), RAF-aligned waits
- ✅ `handleStateChange` stabilized — uses `windowsRef` instead of closing over `windows` array

**Files**: `App.tsx`, `OutputPipelineManager.ts`, `TmuxManager.ts`, `useResizeCoordinator.ts`

### Multiwindow Drag Fix (February 12, 2026)
**Commit**: `47b581a` | **Impact**: UX Critical | **Changed**: +193 / -124 lines

**Problem**: Instant resize during drag caused black bars and dimension mismatches
**Solution**: Visual-only preview with deferred resize (on mouseup or 2s idle)

**Key Improvements:**
- ✅ 60fps smooth drag with cyan preview line
- ✅ Zero visual glitches during drag (no black bars)
- ✅ Deferred terminal resize (mouseup or 2s idle)
- ✅ Extracted reusable layout calculation helpers
- ✅ Clean separation: preview state vs. actual layouts

See commit `47b581a` and `docs/archive/2026-02-terminal-stability/README.md` for details.

### Terminal Stability Overhaul (January 2026)
17 fixes across 13 files. 183/183 tests pass. Net -155 lines.

**Highlights:**
- ✅ useImperativeHandle getter pattern - `handle.terminal` returns current ref (no stale null)
- ✅ Removed dead `terminalsRef` - 8 dead code paths eliminated
- ✅ Atomic tmux resize + 50ms server-side dedup prevents process flooding
- ✅ Layout schema fix - Zod now accepts fractional 0-1 values
- ✅ WebGL scrolling fix - removed forced scrollbar stealing column space
- ✅ Mobile containment softened (`strict` → `layout style`)

See `docs/archive/2026-02-terminal-stability/` for complete implementation details.

### Feature Integrations (Legacy + v1.0.0 + v1.1.0)
- ✅ **TodoPanel** - Live Claude Code task sync from `~/.claude/todos/` (v1.0: resizable, progress bars, metadata chips)
- ✅ **Token Counter** - Real-time per-window context usage with toast warnings at 90/95/98% (v1.0 fix)
- ✅ **Project Navigator** - 114 AI thumbnails, smart merge, auto-add API
- ✅ **Template Toolbar** - 88 templates via 9 icon categories with hover dropdowns (v1.0 NEW)
- ✅ **Canvas Artifacts** - Fullscreen mode (Ctrl+Shift+A), navigation, download, 50-artifact history (v1.0 enhanced)
- ✅ **YouTube Player** - Dockable to 4 corners OR window mode (v1.1: "Dock to Window" button, SplitView integration)
- ✅ **Media Windows** - Type-based window system supports YouTube player in grid (v1.1 NEW)
- ✅ **Welcome Page** - Lightning effects, feature cards, keyboard shortcuts (v1.0 NEW)

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
├── App.tsx                              # Main app, WebSocket router, type-based window dispatcher (v1.1)
├── components/
│   ├── TerminalCore/                    # xterm.js wrapper
│   ├── SplitView/                       # Layout with transitions, multi-type rendering (v1.1)
│   ├── SidePanel/                       # Command builder, templates
│   ├── TodoPanel/                       # Claude Code task sync (v1.0: resizable, badges)
│   ├── ProjectNavigator/                # Quick project access
│   ├── Canvas/                          # Artifact rendering (v1.0: fullscreen, history)
│   ├── TemplateToolbar/                 # Icon template toolbar (v1.0 NEW)
│   ├── WelcomePage/                     # Lightning welcome screen (v1.0 NEW)
│   ├── MusicPlayer/                     # YouTube player (v1.1: floating + window modes)
│   └── MusicDock/                       # Dockable player wrapper (v1.0 NEW)
├── hooks/
│   ├── useWebSocket.ts                  # WebSocket connection
│   ├── useXTermSetup.ts                 # Terminal initialization
│   ├── useRendererSetup.ts              # WebGL + OOM recovery
│   └── useResizeCoordinator.ts          # Atomic resize with lock
└── services/
    └── OutputPipelineManager.ts         # Buffer consolidation + spinner filtering

Server (src/server/)
├── index.ts                             # Express + WebSocket server
├── websocket/ConnectionManager.ts       # Message handling, windowType routing (v1.1)
├── session/SessionStore.ts              # SQLite persistence, migration 006 (v1.1)
├── window/WindowManager.ts              # Window lifecycle, type support (v1.1)
├── tmux/TmuxManager.ts                  # Process lifecycle
├── todo/TodoManager.ts                  # Claude Code sync
├── context/ContextManager.ts            # Per-window token tracking (v1.0)
├── music/MusicManager.ts                # YouTube state persistence (v1.0 NEW)
├── canvas/ArtifactManager.ts            # Artifact history (v1.0 NEW)
├── search/SearchEngine.ts               # Fuzzy command search
└── api/
    ├── commands.ts                      # Search endpoints
    ├── templates.ts                     # 88 built-in templates
    └── projects.ts                      # Project discovery

Shared (src/shared/)
├── types.ts                             # TypeScript interfaces, WindowType (v1.1)
├── protocol.ts                          # WebSocket messages
├── todoProtocol.ts                      # Todo sync messages
├── musicProtocol.ts                     # Music player protocol
├── contextProtocol.ts                   # Context tracking protocol
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
| **WebSocket Protocol** | `src/shared/protocol.ts` + `musicProtocol.ts` + `contextProtocol.ts` |
| **Terminal CSS** | `src/client/styles/terminal.css` + `terminal-mobile.css` |
| **v1.0.0 Components** | TemplateToolbar, WelcomePage, MusicDock, ArtifactToolbarButton |
| **v1.0.0 Managers** | ContextManager, MusicManager, ArtifactManager |

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
{ type: 'window:create', sessionId, windowType? }  // v1.1: optional 'terminal' | 'media'
{ type: 'window:resize', windowId, cols, rows }    // Server dedupes (50ms)
{ type: 'session:create', name? }
{ type: 'todo:subscribe', windowId }
{ type: 'context:subscribe', windowId }
{ type: 'music:subscribe' }                        // v1.0 NEW
{ type: 'music:dock:update', state }               // v1.0 NEW
{ type: 'artifact:subscribe' }                     // v1.0 NEW

// Server → Client
{ type: 'window:created', window: { ..., type } }  // v1.1: includes window type
{ type: 'window:output', windowId, data }
{ type: 'window:restore', windowId, content }
{ type: 'todo:sync', windowId, todos }
{ type: 'context:update', windowId, usage }
{ type: 'context:warning', windowId, message, threshold }  // v1.0 NEW
{ type: 'canvas:artifact', artifact }
{ type: 'music:dock:restore', state }            // v1.0 NEW
{ type: 'artifact:history', artifacts }          // v1.0 NEW
```
Complete protocol: `src/shared/protocol.ts`, `todoProtocol.ts`, `musicProtocol.ts`, `contextProtocol.ts`

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
| Terminal pulsing | Ref-stabilized renderWindow + reduced canvas verify retries (2 max, 4px tolerance) |

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
- Thumbnail generation: see `src/server/api/projects.ts`

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

## Known Issues (Active)

### Resize Dot Glitch (Priority: HIGH — Fixed Feb 25, 2026)
**Symptom:** After resizing terminal windows (especially taller/wider), lines of periods "........" appear.
**Root Causes Fixed:**
1. ANSI strip regex missed OSC/DCS/8-bit CSI → consolidated to `src/shared/terminalFilters.ts` with comprehensive regex
2. Dot filter `^[.\s]+$` too strict → added ratio-based detection (>80% dots + >=3 dots)
3. Edge resize fired `onLayoutChange` per-pixel without `isDragging` flag → now defers resize to mouseup
4. Resize lock released via microtask (too fast) → now frame-aligned via `requestAnimationFrame`
5. Browser resize debounce 100ms → increased to 150ms
**Files:** `terminalFilters.ts` (shared filter), `SplitView.tsx:698`, `useResizeCoordinator.ts:46,332`
**Status:** Fixed and verified Feb 25, 2026

## Documentation Index
| Doc | Purpose |
|-----|---------|
| `docs/ARCHITECTURE.md` | System diagram, component details |
| `docs/CANVAS.md` | Artifact system complete reference |
| `docs/MEDIA_WINDOWS_IMPLEMENTATION.md` | v1.1.0 window mode feature |
| `docs/guides/DEVELOPMENT_GUIDE.md` | Workflows, logging, testing patterns |
| `docs/guides/DEBUGGING_GUIDE.md` | Log correlation, troubleshooting flows |
| `docs/archive/` | Historical refactor plans and fixes |
