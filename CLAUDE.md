# Herakles Terminal - Claude Development Context

**Version:** 1.1.0 | **Last Updated:** March 18, 2026 | **Protocol:** [V11](/home/hercules/v11/CLAUDE.md)

## Quick Context
- **What:** Mobile-first web terminal (xterm.js + WebSocket + tmux persistence)
- **Port:** 8096 | **Subdomain:** terminal.herakles.dev
- **Stack:** React 18 + TypeScript + Vite (client) | Node.js + Express + ws + node-pty (server)
- **Status:** Production v1.1.0 (440 tests, Mar 18, 2026)

## Recent Major Changes

### v1.3.3 V1 Resize Root Cause Fix (March 18, 2026) — Latest
**Implementation**: Orchestrator-direct | **Tests**: 440/440

**Root cause of V1 resize glitches eliminated.** `transition-all duration-200` on SplitView window containers
caused fitAddon.fit() to measure intermediate CSS dimensions during 200ms animation, sending incorrect
resizes to tmux which produced SIGWINCH dot artifacts. Additionally, React re-renders re-added transition
classes that `setTransitionsSuppressed()` had removed via DOM manipulation, defeating the suppression.

**Fix (two layers)**:
1. Window containers: Replaced `transition-all` with `transition-[border-color,box-shadow,outline,ring]`.
   Layout properties (width, height, left, top) change instantly. Cosmetic properties still animate.
2. Outer SplitView container: Removed `transition-[left,right] duration-200 ease-out` entirely.
   Panel open/close now snaps instantly — eliminates 200ms window where fit() measured intermediate
   dimensions AND removes phantom `findTransitionAncestor()` detection that added 300ms timeout
   to every non-immediate resize. Panel/zoom timers reduced from 220ms to 16ms.

**Root cause analysis**: Athenaeum Master Protocol (doc 684) + Inversion Thinking (doc 324). Classified
as Complicated (not Complex) — deterministic timing chain fully traceable. 5 assumptions surfaced and
challenged via Socratic method. Pre-mortem identified 5 failure modes, all mitigated.

**Files**: `SplitView.tsx` (4 changes: window className, constants, ref callback, outer container),
`App.tsx` (1 change: panel resize timer 220ms→16ms)

### v1.3.2 V1 Restoration + V11 Alignment (March 18, 2026)
**Implementation**: Orchestrator-direct | **Tests**: 440/440

**V1 SplitView restored as production layout engine.** Grid v2 reverted to testing after typing glitches (line duplication, cursor jumps). `USE_GRID_LAYOUT = false`. V2 improvements retained in codebase for future work. V11 alignment: all docs updated to reflect v1 production status.

### v1.3.1 Grid Area Rectangularity Fix (March 18, 2026)
**Implementation**: Orchestrator-direct | **Tests**: 443/443

CSS `grid-template-areas` non-rectangular handle areas fixed via two-pass naming. +6 rectangularity tests.

### v1.3.0 Pipeline Hardening + Grid v2 Re-Promotion (March 18, 2026)
**Implementation**: Orchestrator-direct | **Duration**: Single session | **Tests**: 437/437

**Resize pipeline hardening** (6 fixes across 4 files):
- **RC-1 drain delay** 4ms → 80ms — lets tmux SIGWINCH output arrive before buffer release
- **Server dedup timer** 16ms → 50ms — fixed code/comment discrepancy
- **Consecutive-dot filter** — catches 20+ dot sequences as tmux resize artifacts
- **Post-resize suppression** — 100ms aggressive re-filter window after resize completes
- **Double-filter resize buffer** — two-pass catches reassembled fragments from partial chunks
- **v1 drain delay** — 80ms client-side delay with destroyed-window guard

**Grid v2 re-promotion** (3 fixes + test suite):
- **Pane discovery retry** — 3-attempt with 50ms intervals for DOM readiness
- **TodoPanel resize** — verified ResizeObserver fires automatically on container change
- **USE_GRID_LAYOUT = true** — re-promoted as default layout engine
- **+15 resize stability tests** — dot filters, pipeline suppression, resize cycles

**Files**: 6 modified, 1 new test file | **Tests**: 437/437 (+15 new)

### v1.2.0 Grid Layout + Team Cockpit (March 4, 2026)
**Implementation**: Orchestrator-direct | **Duration**: Single session | **Tests**: 380/380

**CSS Grid Layout Engine** (`USE_GRID_LAYOUT` flag, now default `true`):
- **WindowGrid** — CSS Grid replaces SplitView absolute positioning, zero-transition resize
- **useGridResize** — Single ResizeObserver for all panes (replaces 454-line useResizeCoordinator)
- **Window Swap** — Drag title bar to swap window positions
- **Zoom** — Expand any pane to fill entire grid

**Team Cockpit** (Claude Code agent team integration):
- **TeamFileWatcher** — Watches `~/.claude/teams/` and `~/.claude/tasks/` directories
- **TeamManager** — WebSocket broadcasting of team state (follows TodoManager pattern)
- **TeamBar** — Bottom bar with accordion overlay, agent chips, progress bars, log stream
- **useTeamCockpit** — Auto-detects teams, enables cockpit mode, dismiss/expand state

**Notes:**
- Team Viewer v2 (Mar 5) replaced AgentWindow with self-contained TeamBar + accordion (~650 lines removed)
- `WindowType = 'terminal' | 'media' | 'agent'` (agent type kept for forward compat)
- `team:subscribe`/`team:unsubscribe` + `team:log` wired into ConnectionManager + messageSchema

**Files**: 16 new files, 7 modified | **Tests**: 380/380 (+29 new) | **Archived**: `docs/archive/2026-03-stability-v2-cockpit/`

### v1.0.0 Production Feature Set (February 12, 2026)
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

### Feature Integrations (Legacy + v1.0.0 + v1.1.0 + v1.2.0)
- ✅ **CSS Grid Layout** - Zero-transition resize via ResizeObserver, feature-flagged (v1.2 NEW)
- ✅ **Team Cockpit** - TeamBar + accordion (v2), auto-detect from `~/.claude/teams/` (v1.2)
- ✅ **Window Swap** - Drag title bar to swap window positions (v1.2 NEW)
- ✅ **TodoPanel** - Live Claude Code task sync from `~/.claude/todos/` (v1.0: resizable, progress bars, metadata chips)
- ✅ **Token Counter** - Real-time per-window context usage with toast warnings at 90/95/98% (v1.0 fix)
- ✅ **Project Navigator** - 114 AI thumbnails, smart merge, auto-add API
- ✅ **Template Toolbar** - 88 templates via 9 icon categories with hover dropdowns (v1.0)
- ✅ **Canvas Artifacts** - Fullscreen mode (Ctrl+Shift+A), navigation, download, 50-artifact history (v1.0)
- ✅ **YouTube Player** - Dockable to 4 corners OR window mode (v1.1: SplitView + WindowGrid)
- ✅ **Media Windows** - Type-based window system supports YouTube player in grid (v1.1)
- ✅ **Welcome Page** - Lightning effects, feature cards, keyboard shortcuts (v1.0)

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

# After server changes
npm run build && kill $(lsof -i :8096 -t) && source ~/.secrets/hercules.env && SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}" NODE_ENV=production nohup node dist/server/index.js > server.log 2>&1 & disown && sleep 3 && curl -s http://localhost:8096/api/health
```

### Service Management
```bash
# Production (raw node process — MUST set NODE_ENV + SESSION_SECRET)
lsof -i :8096                            # Find PID
kill $(lsof -i :8096 -t)                 # Stop
source ~/.secrets/hercules.env && SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}" NODE_ENV=production nohup node dist/server/index.js > server.log 2>&1 & disown  # Start
curl -s http://localhost:8096/api/health | jq               # Verify

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
├── App.tsx                              # Main app, WebSocket router, layout dispatch (v1.2)
├── components/
│   ├── TerminalCore/                    # xterm.js wrapper
│   ├── WindowGrid/                      # [v2] CSS Grid layout, drag handles, window swap (DEFAULT)
│   ├── SplitView/                       # [v1] Absolute positioning layout (deprecated fallback)
│   ├── TeamBar/                         # Team bottom bar + accordion overlay (v1.2)
│   ├── SidePanel/                       # Command builder, templates
│   ├── TodoPanel/                       # Claude Code task sync (v1.0: resizable, badges)
│   ├── ProjectNavigator/                # Quick project access
│   ├── Canvas/                          # Artifact rendering (v1.0: fullscreen, history)
│   ├── TemplateToolbar/                 # Icon template toolbar (v1.0)
│   ├── WelcomePage/                     # Lightning welcome screen (v1.0)
│   ├── MusicPlayer/                     # YouTube player (v1.1: floating + window modes)
│   └── MusicDock/                       # Dockable player wrapper (v1.0)
├── hooks/
│   ├── useWebSocket.ts                  # WebSocket connection
│   ├── useGridResize.ts                 # [v2] ResizeObserver → RAF → fit() (v1.2 NEW)
│   ├── useResizeCoordinator.ts          # [v1] Debounce-based resize (fallback)
│   ├── useTeamCockpit.ts                # Team state, auto-enable cockpit (v1.2 NEW)
│   ├── useXTermSetup.ts                 # Terminal initialization
│   └── useRendererSetup.ts              # WebGL + OOM recovery
└── services/
    └── OutputPipelineManager.ts         # Buffer consolidation + spinner filtering

Server (src/server/)
├── index.ts                             # Express + WebSocket server
├── websocket/ConnectionManager.ts       # Message handling, team:subscribe (v1.2)
├── session/SessionStore.ts              # SQLite persistence, migration 006
├── window/WindowManager.ts              # Window lifecycle, type support
├── tmux/TmuxManager.ts                  # Process lifecycle
├── team/TeamFileWatcher.ts              # Watches ~/.claude/teams/ + tasks/ (v1.2 NEW)
├── team/TeamManager.ts                  # Team state + WebSocket broadcast (v1.2 NEW)
├── todo/TodoManager.ts                  # Claude Code sync
├── context/ContextManager.ts            # Per-window token tracking
├── music/MusicManager.ts                # YouTube state persistence
├── canvas/ArtifactManager.ts            # Artifact history
├── search/SearchEngine.ts               # Fuzzy command search
└── api/
    ├── commands.ts                      # Search endpoints
    ├── templates.ts                     # 88 built-in templates
    └── projects.ts                      # Project discovery

Shared (src/shared/)
├── types.ts                             # TypeScript interfaces, WindowType (v1.2: + 'agent')
├── constants.ts                         # Defaults, USE_GRID_LAYOUT feature flag (v1.2)
├── protocol.ts                          # WebSocket messages
├── teamProtocol.ts                      # Team cockpit protocol (v1.2 NEW)
├── todoProtocol.ts                      # Todo sync messages
├── musicProtocol.ts                     # Music player protocol
├── contextProtocol.ts                   # Context tracking protocol
├── terminalFilters.ts                   # ANSI stripping, thinking output filter
└── themes.ts                            # 6 built-in themes
```

## Key Files Quick Reference
| Component | Path |
|-----------|------|
| **Grid Layout [v2]** | `src/client/components/WindowGrid/` |
| **Grid Resize [v2]** | `src/client/hooks/useGridResize.ts` |
| **Team Cockpit** | `src/client/hooks/useTeamCockpit.ts` |
| **Team Server** | `src/server/team/TeamManager.ts` + `TeamFileWatcher.ts` |
| **Output Pipeline** | `src/client/services/OutputPipelineManager.ts` |
| **Renderer Setup** | `src/client/hooks/useRendererSetup.ts` |
| **Resize Coordinator [v1]** | `src/client/hooks/useResizeCoordinator.ts` |
| **WebSocket Server** | `src/server/websocket/ConnectionManager.ts` |
| **Session Store** | `src/server/session/SessionStore.ts` |
| **Command Templates** | `src/server/api/templates.ts` |
| **WebSocket Protocol** | `src/shared/protocol.ts` + `teamProtocol.ts` + `musicProtocol.ts` |
| **Terminal CSS** | `src/client/styles/terminal.css` + `grid-layout.css` |
| **v1.2.0 Components** | WindowGrid, TeamBar |
| **v1.0.0 Components** | TemplateToolbar, WelcomePage, MusicDock, ArtifactToolbarButton |
| **v1.0.0 Managers** | ContextManager, MusicManager, ArtifactManager |
| **v1.2.0 Managers** | TeamManager, TeamFileWatcher |

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
{ type: 'window:create', sessionId, windowType? }  // v1.2: 'terminal' | 'media' | 'agent'
{ type: 'window:resize', windowId, cols, rows }    // Server dedupes (50ms)
{ type: 'session:create', name? }
{ type: 'todo:subscribe', windowId }
{ type: 'context:subscribe', windowId }
{ type: 'music:subscribe' }                        // v1.0
{ type: 'music:dock:update', state }               // v1.0
{ type: 'artifact:subscribe' }                     // v1.0
{ type: 'team:subscribe' }                         // v1.2 NEW
{ type: 'team:unsubscribe' }                       // v1.2 NEW

// Server → Client
{ type: 'window:created', window: { ..., type } }  // v1.2: includes 'agent' type
{ type: 'window:output', windowId, data }
{ type: 'window:restore', windowId, content }
{ type: 'todo:sync', windowId, todos }
{ type: 'context:update', windowId, usage }
{ type: 'context:warning', windowId, message, threshold }
{ type: 'canvas:artifact', artifact }
{ type: 'music:dock:restore', state }
{ type: 'artifact:history', artifacts }
{ type: 'team:sync', teams }                     // v1.2 NEW
{ type: 'team:member:update', teamName, member } // v1.2 NEW
{ type: 'team:detected', team }                  // v1.2 NEW
{ type: 'team:dissolved', team }                 // v1.2 NEW
```
Complete protocol: `src/shared/protocol.ts`, `teamProtocol.ts`, `todoProtocol.ts`, `musicProtocol.ts`, `contextProtocol.ts`

## Component Patterns
```tsx
// Styling: Tailwind + CSS variables (terminal.css)
// Colors: --accent-cyan (#00d4ff), --bg-primary (#000)
// Sizing: text-[10px], text-[11px] for compact UI

// Imports: use index.ts barrels
import { WindowGrid } from './components/WindowGrid';  // v2 (grid)
import { SplitView } from './components/SplitView';    // v1 (fallback)

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
| Resize glitches | v1 SplitView is production. Root cause fixed (layout transitions removed). Pipeline hardened: 80ms drain, 50ms dedup, dot filter, 100ms suppression |
| Terminal pulsing | Ref-stabilized renderWindow + reduced canvas verify retries (2 max, 4px tolerance) |
| Grid layout issues | V2 in testing. Set `USE_GRID_LAYOUT = true` to test Grid v2 (has typing glitches) |

## Feature System References

**Team Cockpit (v1.2, Team Viewer v2)**
- Watches `~/.claude/teams/` and `~/.claude/tasks/` for active Claude Code agent teams
- WebSocket: `team:subscribe`, `team:sync`, `team:member:update`, `team:detected`, `team:dissolved`, `team:log`
- Self-contained TeamBar at bottom with accordion overlay — no agent windows in grid
- Auto-enables cockpit mode when team detected, disables on dissolve
- 10-color palette for agent identification
- See: `src/server/team/`, `src/client/components/TeamBar/`

**CSS Grid Layout (v1.3, TESTING — USE_GRID_LAYOUT = false)**
- Feature flag: `USE_GRID_LAYOUT` in `src/shared/constants.ts` (default: `false`, set `true` to test v2)
- Resize: ResizeObserver → RAF → fitAddon.fit() (single path for all triggers)
- Canvas verify: RAF-aligned, 4px tolerance, 1 retry max
- Recovery: deferred resize queue, replayed via `notifyRecoveryEnd`
- Output pipeline: resize-pending flag set before server message, cleared on ack
- Drag: direct DOM grid-template manipulation (zero React re-renders during drag)
- Window swap: drag title bar onto another pane to swap positions
- See: `src/client/components/WindowGrid/`, `src/client/hooks/useGridResize.ts`

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

### Layout Engine Status (v1.3.3)
- **v1 (SplitView + useResizeCoordinator)** is the PRODUCTION layout engine (`USE_GRID_LAYOUT = false`)
- **v2 (WindowGrid + useGridResize)** is in TESTING — has typing glitches (line duplication, cursor jumps)
- V1 resize root cause fixed: `transition-all` replaced with cosmetic-only transitions on window containers
- Pipeline hardened: 80ms RC-1 drain, 50ms server dedup, consecutive-dot filter, post-resize suppression, double-filter resize buffer

### Resolved: Resize Dot Glitch (Fixed Feb 25, 2026)
Fixed in SplitView (v1) path. The v2 Grid path eliminates this class of bugs entirely via ResizeObserver.
**Files (v1 path):** `terminalFilters.ts`, `SplitView.tsx`, `useResizeCoordinator.ts`
**See:** `docs/archive/2026-02-terminal-stability/` for full analysis

## Documentation Index
| Doc | Purpose |
|-----|---------|
| `docs/ARCHITECTURE.md` | System diagram, component details |
| `docs/CANVAS.md` | Artifact system complete reference |
| `docs/MEDIA_WINDOWS_IMPLEMENTATION.md` | v1.1.0 window mode feature |
| `docs/guides/DEVELOPMENT_GUIDE.md` | Workflows, logging, testing patterns |
| `docs/guides/DEBUGGING_GUIDE.md` | Log correlation, troubleshooting flows |
| `docs/archive/2026-03-stability-v2-cockpit/` | v1.2 proposal + spec (archived) |
| `docs/archive/` | Historical refactor plans and fixes |
