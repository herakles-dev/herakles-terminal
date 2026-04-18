# Zeus Terminal Architecture

## Overview

Zeus Terminal is a mobile-first web terminal with multi-window support, tmux persistence, real-time artifact rendering, and Claude Code team cockpit integration.

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite |
| Terminal | xterm.js + WebGL/Canvas/DOM fallback |
| Layout | CSS Grid (WindowGrid) or absolute positioning (SplitView) — feature-flagged |
| Transport | WebSocket (ws) |
| Backend | Node.js + Express |
| PTY | node-pty |
| Persistence | tmux + SQLite |

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ TerminalCore│  │ SidePanel   │  │ Canvas (Artifacts)  │  │
│  │ (xterm.js)  │  │ - Commands  │  │ - Markdown          │  │
│  │             │  │ - Templates │  │ - Mermaid           │  │
│  │ WebGL ──────┼──│ - Sessions  │  │ - Code              │  │
│  │ Canvas      │  │ - Settings  │  │ - HTML/SVG/JSON     │  │
│  │ DOM         │  │ - Uploads   │  │                     │  │
│  └──────┬──────┘  └─────────────┘  └──────────┬──────────┘  │
│         │                                      │             │
│  ┌──────┴───────────────────────────────────┐  │             │
│  │ Layout: WindowGrid (CSS Grid) [v2]       │  │             │
│  │    or   SplitView (absolute pos) [v1]    │  │             │
│  │ + TeamBar + AgentWindow (cockpit mode)   │  │             │
│  └──────┬───────────────────────────────────┘  │             │
│         │              WebSocket               │             │
└─────────┼──────────────────────────────────────┼─────────────┘
          │                                      │
          ▼                                      ▼
┌─────────────────────────────────────────────────────────────┐
│                     Node.js Server                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │ ConnectionManager│  │ SessionManager  │  │ ArtifactWatcher│
│  │ (WebSocket)      │  │ (Sessions/Windows)│ │ (~/.canvas/)  │
│  └────────┬─────────┘  └────────┬────────┘  └──────┬──────┘  │
│           │                     │                   │         │
│  ┌────────┴────────┐  ┌────────┴────────┐          │         │
│  │ TeamManager     │  │ TodoManager     │          │         │
│  │ (team cockpit)  │  │ (task sync)     │          │         │
│  └────────┬────────┘  └─────────────────┘          │         │
│           │                                        │         │
│  ┌────────┴────────┐  ┌─────────────────┐          │         │
│  │ TeamFileWatcher │  │   SQLite DB     │          │         │
│  │ (~/.claude/     │  │   (zeus.db)     │          │         │
│  │  teams/tasks/)  │  └─────────────────┘          │         │
│  └─────────────────┘                               │         │
│  ┌─────────────────┐                               │         │
│  │   PTY Manager   │                               │         │
│  │   (node-pty)    │                               │         │
│  └────────┬────────┘                               │         │
└───────────┼────────────────────────────────────────┼─────────┘
            │                                        │
            ▼                                        │
┌─────────────────────────────────────────────────────────────┐
│                         tmux                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                      │
│  │ Window 1│  │ Window 2│  │ Window N│  (up to 6)           │
│  │  Shell  │  │  Shell  │  │  Shell  │                      │
│  └─────────┘  └─────────┘  └─────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

## Key Components

### Frontend (`src/client/`)

| Component | Purpose |
|-----------|---------|
| `App.tsx` | Main app, WebSocket handling, state management, layout dispatch |
| `components/TerminalCore/` | xterm.js wrapper with renderer fallback |
| `components/WindowGrid/` | **[v2]** CSS Grid layout with ResizeObserver resize (feature-flagged) |
| `components/SplitView/` | **[v1]** Absolute positioning layout (default fallback) |
| `components/AgentWindow/` | Color-coded agent window with status badge (team cockpit) |
| `components/TeamBar/` | Horizontal team member chip bar (team cockpit) |
| `components/SidePanel/` | Tabbed tools panel (commands, templates, canvas, etc.) |
| `components/Canvas/` | Artifact rendering (markdown, mermaid, code, etc.) |
| `components/TodoPanel/` | Claude Code task sync panel |
| `components/MusicPlayer/` | YouTube player (floating + window modes) |
| `components/TemplateToolbar/` | 88 templates via 9 icon categories |
| `components/WelcomePage/` | Lightning welcome screen |
| `hooks/useGridResize.ts` | **[v2]** Single ResizeObserver for all panes |
| `hooks/useResizeCoordinator.ts` | **[v1]** Debounce-based resize coordination |
| `hooks/useTeamCockpit.ts` | Team state management, auto-enable cockpit |
| `hooks/useXTermSetup.ts` | XTerm configuration and initialization |
| `hooks/useRendererSetup.ts` | WebGL → Canvas → DOM fallback chain |
| `styles/terminal.css` | Terminal and layout CSS variables |
| `styles/grid-layout.css` | Grid, handle, agent, team bar styles |

### Backend (`src/server/`)

| Module | Purpose |
|--------|---------|
| `index.ts` | Express server, WebSocket setup |
| `websocket/ConnectionManager.ts` | WebSocket connection handling, team:subscribe |
| `session/SessionManager.ts` | Session/window lifecycle |
| `tmux/TmuxManager.ts` | tmux process management |
| `team/TeamFileWatcher.ts` | Watches `~/.claude/teams/` and `~/.claude/tasks/` |
| `team/TeamManager.ts` | Central team state, WebSocket broadcasting |
| `todo/TodoManager.ts` | Claude Code task sync |
| `todo/TodoFileWatcher.ts` | Watches `~/.claude/todos/` |
| `context/ContextManager.ts` | Per-window token tracking |
| `music/MusicManager.ts` | YouTube state persistence |
| `canvas/ArtifactManager.ts` | Artifact history |

### Shared (`src/shared/`)

| File | Purpose |
|------|---------|
| `constants.ts` | Shared defaults, `USE_GRID_LAYOUT` feature flag |
| `types.ts` | TypeScript interfaces, `WindowType = 'terminal' \| 'media' \| 'agent'` |
| `protocol.ts` | Binary WebSocket protocol constants |
| `teamProtocol.ts` | Team cockpit protocol, TeamInfo/TeamMember types |
| `todoProtocol.ts` | Todo sync messages |
| `musicProtocol.ts` | Music player protocol |
| `contextProtocol.ts` | Context tracking protocol |
| `terminalFilters.ts` | ANSI stripping and thinking output filter |

## Layout System (v2 — Feature Flagged)

**Feature flag:** `USE_GRID_LAYOUT` in `src/shared/constants.ts` (default: `false`)

### v2 (WindowGrid) — CSS Grid + ResizeObserver
```
Container resize → ResizeObserver → requestAnimationFrame → fitAddon.fit() → server
```
- Single resize path for ALL triggers (drag, browser resize, window add/remove)
- Direct DOM manipulation during drag (zero React re-renders)
- CSS `contain: strict` isolates each pane
- No CSS transitions on terminal containers
- Window swap via title bar drag-and-drop

### v1 (SplitView) — Absolute Positioning + Debounce
```
Drag → useResizeCoordinator (150ms debounce) → fitAddon.fit() → server 50ms dedup → tmux
```
- Multiple resize paths with different timing
- CSS transitions for layout animation
- Transition suppression pattern during resize

## Team Cockpit

Integrates Claude Code agent teams directly into Zeus Terminal windows.

```
~/.claude/teams/{name}/config.json → TeamFileWatcher → TeamManager
→ WebSocket (team:sync) → useTeamCockpit → TeamBar + AgentWindow
```

- Auto-detects active teams from `~/.claude/teams/`
- Each agent gets a color-coded window with status badge
- TeamBar shows member chips with live task progress
- Auto-enables cockpit mode when team detected, disables when dissolved

## Data Flow

### Terminal Input/Output
```
User Input → TerminalCore.onData → WebSocket → PTY → tmux → Shell
Shell Output → tmux → PTY → WebSocket → TerminalCore.write → Display
```

### Artifact Delivery
```
send-artifact → ~/.canvas/artifacts/*.json → ArtifactWatcher
→ WebSocket broadcast (canvas:artifact) → addArtifact → Canvas Panel
```

### Session Persistence
```
Connect → auth-success → session:resume/create → window:created
→ window:subscribe → window:restore (scrollback) → Ready
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8096 | Server port |
| `HOST` | 127.0.0.1 | Bind address |
| `CANVAS_DIR` | ~/.canvas/artifacts | Artifact watch directory |
| `DB_PATH` | ./data/zeus.db | SQLite database |
| `TMUX_SOCKET` | /tmp/zeus-tmux | tmux socket path |
| `USE_GRID_LAYOUT` | `false` | Enable CSS Grid layout (v2) |

## Security

- Cloudflare Access authentication (via Authelia)
- CSRF protection on API endpoints
- Rate limiting on HTTP/WebSocket
- IP whitelist support
- Secrets loaded from `/home/hercules/.secrets/hercules.env`
