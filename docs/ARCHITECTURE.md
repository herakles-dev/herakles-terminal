# Zeus Terminal Architecture

## Overview

Zeus Terminal is a mobile-first web terminal with multi-window support, tmux persistence, and real-time artifact rendering.

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite |
| Terminal | xterm.js + WebGL/Canvas/DOM fallback |
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
│           ▼                     ▼                   │         │
│  ┌─────────────────┐  ┌─────────────────┐          │         │
│  │   PTY Manager   │  │   SQLite DB     │          │         │
│  │   (node-pty)    │  │   (zeus.db)     │          │         │
│  └────────┬────────┘  └─────────────────┘          │         │
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
| `App.tsx` | Main app, WebSocket handling, state management |
| `components/TerminalCore/` | xterm.js wrapper with renderer fallback |
| `components/MobileInputHandler.tsx` | iOS/Android keyboard handling |
| `components/SplitView/` | Multi-window layout manager |
| `components/SidePanel/` | Tabbed tools panel (commands, templates, canvas, etc.) |
| `components/Canvas/` | Artifact rendering (markdown, mermaid, code, etc.) |
| `hooks/useXTermSetup.ts` | XTerm configuration and initialization |
| `hooks/useRendererSetup.ts` | WebGL → Canvas → DOM fallback chain |
| `hooks/useResizeCoordinator.ts` | Coordinated terminal resize handling |
| `styles/terminal.css` | Terminal and layout CSS variables |

### Backend (`src/server/`)

| Module | Purpose |
|--------|---------|
| `index.ts` | Express server, WebSocket setup |
| `websocket/ConnectionManager.ts` | WebSocket connection handling |
| `session/SessionManager.ts` | Session/window lifecycle |
| `tmux/TmuxManager.ts` | tmux process management |
| `canvas/ArtifactWatcher.ts` | File watcher for artifact delivery |

### Shared (`src/shared/`)

| File | Purpose |
|------|---------|
| `constants.ts` | Shared configuration defaults |
| `protocol.ts` | WebSocket message types |

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

## Security

- Cloudflare Access authentication (via Authelia)
- CSRF protection on API endpoints
- Rate limiting on HTTP/WebSocket
- IP whitelist support
- Secrets loaded from `/home/hercules/.secrets/hercules.env`
