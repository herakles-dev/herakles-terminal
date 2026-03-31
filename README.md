# Zeus Terminal (Herakles Terminal)

> A resilient, mobile-first web terminal for Claude Code power users

**Version:** 1.2.0 | **Status:** ✅ Production Ready - Team Cockpit + Grid Layout

Zeus Terminal is a self-hosted web-based terminal that replaces Termux for remote SSH access. It provides:

- **Reliable connections** - Server-side tmux persistence + auto-reconnect
- **Mobile-optimized input** - Quick-key bar for special characters
- **Seamless device switching** - Continue sessions across phone and laptop
- **Zero app dependencies** - Pure web PWA, works in any browser

---

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) - Development context and quick reference
- [`SECURITY.md`](./SECURITY.md) - Security guidelines and deployment checklist
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) - System architecture
- [`docs/CANVAS.md`](./docs/CANVAS.md) - Artifact system reference
- [`docs/MEDIA_WINDOWS_IMPLEMENTATION.md`](./docs/MEDIA_WINDOWS_IMPLEMENTATION.md) - v1.1.0 media windows
- [`docs/guides/DEVELOPMENT_GUIDE.md`](./docs/guides/DEVELOPMENT_GUIDE.md) - Development workflows
- [`docs/guides/DEBUGGING_GUIDE.md`](./docs/guides/DEBUGGING_GUIDE.md) - Troubleshooting
- [`docs/archive/`](./docs/archive/) - Historical documentation

---

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Cloudflare Tunnel (for secure access) or Authelia

### Development

```bash
# Clone and install
cd /home/hercules/herakles-terminal
npm install

# Start development server (frontend + backend)
npm run dev

# Access at http://localhost:5173 (Vite frontend)
# Backend runs on http://localhost:8096
```

### Production Deployment

```bash
# Configure secrets
cp .env.example .env
# Edit .env with your values

# Build
npm run build

# Start
npm start

# Access at https://terminal.herakles.dev (via Cloudflare Tunnel)
```

---

## 🏗️ Architecture

```
Browser (Phone/Laptop)
    │
    │ WebSocket (wss://)
    ▼
Authelia (Authentication) → Cloudflare Tunnel (TLS + Auth)
    │
    ▼
Node.js Server (Port 8096 - Production)
    │
    ├── Express (HTTP API)
    ├── ws (WebSocket)
    └── node-pty → tmux → bash
```

**Technology Stack:**
- **Frontend:** React 18 + TypeScript + Vite + TailwindCSS
- **Terminal:** XTerm.js + Canvas/WebGL renderer
- **Backend:** Node.js + Express + WebSocket (ws)
- **PTY:** node-pty + tmux
- **Database:** SQLite (sessions, audit, commands)
- **Auth:** Authelia + Cloudflare Access
- **Observability:** Winston + Loki + Prometheus

---

## ⚙️ Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SESSION_SECRET` | Yes | - | 64+ char random string |
| `CF_TEAM_DOMAIN` | Yes | - | Cloudflare Access domain |
| `CF_AUDIENCE` | Yes | - | Cloudflare Access AUD |
| `PORT` | No | 8096 | Server port |
| `MAX_SESSIONS` | No | 50 | Maximum concurrent sessions |
| `LOKI_URL` | No | - | Loki endpoint for logs |
| `ENABLE_PROMETHEUS` | No | false | Enable Prometheus metrics |

See `.env.example` for all options.

---

## 📊 Project Status

### Release History

**v1.1.0 (February 13, 2026)** - Media Windows Integration ✅
- Type-based window system (`WindowType = 'terminal' | 'media'`)
- YouTube player can render as SplitView window
- Floating ↔ Window mode toggle with seamless state transitions
- Smart mixed layouts (terminals grid + media bottom-right)
- 345/345 tests passing, zero regressions
- Database migration 006, full backward compatibility

**v1.0.0 (February 12, 2026)** - Production Feature Complete ✅
- 7 major features shipped (template toolbar, welcome page, token tracking, enhanced tasks, dockable player, fullscreen canvas, artifact history)
- 320/320 tests passing (+137 new tests)
- V9 Agent Teams formation execution (4.5 hours)
- Zero regressions, TypeScript strict mode maintained

**v0.3.0 (January 2026)** - Terminal Stability Overhaul ✅
- 17 fixes across 13 files (183/183 tests passing)
- WebGL scrolling fix, atomic tmux resize, layout schema fix
- Multiwindow drag improvements (smooth resize-on-release)
- Net -155 lines (code reduction)

**v0.2.0 (December 2025)** - Display Quality & Architecture ✅
- 4 sprints completed (resize coordination, rendering optimization, ANSI handling, architecture refactor)
- Created reusable hooks (useTerminalCore, useXTermSetup, useRendererSetup)
- 95% reduction in visual glitches, 4x performance improvement

### Completed Phases

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1-5 | ✅ Complete | Core MVP → Production hardening |
| Phase 6 | ✅ Complete | Display quality improvements (v0.2.0) |
| Phase 7 | ✅ Complete | Terminal stability overhaul (v0.3.0) |
| Phase 8 | ✅ Complete | Production feature set (v1.0.0) |

---

## 🎯 Features

### v1.1.0 New Features (February 2026)
- 🪟 **Media Windows** - YouTube player can render as SplitView window alongside terminals
- 🔄 **Mode Toggle** - Seamless floating ↔ window transitions with "Dock to Window" button
- 📐 **Type-Based Layouts** - Smart auto-layout for mixed terminal + media window types
- 💾 **State Persistence** - Playback continues uninterrupted during mode switches

### v1.0.0 Features (February 2026)
- ✨ **Icon Template Toolbar** - 88 command templates accessible via 9 icon categories with hover dropdowns
- ⚡ **Lightning Welcome Page** - Animated welcome screen with feature cards and keyboard shortcuts
- 📊 **Per-Window Token Tracking** - Accurate Claude Code context usage per terminal with toast warnings at 90/95/98%
- ✨ **Enhanced Tasks Panel** - Resizable width (200-400px), vertical progress bars, status badges, metadata chips
- 🎵 **Dockable YouTube Player** - Snap-to-corner positioning with 4 dock zones, drag-to-resize, multi-device sync
- 🎨 **Fullscreen Canvas Mode** - Toolbar access + Ctrl+Shift+A shortcut, artifact navigation, download functionality
- 📚 **Artifact History System** - 50-artifact cache with thumbnails, auto-tagging, WebSocket sync

### Core Features
- ✅ Server-side tmux sessions (persistent across disconnects)
- ✅ WebSocket communication with auto-reconnect
- ✅ 50,000 line scrollback buffer
- ✅ ANSI color and escape sequence support
- ✅ Multiple terminal windows (split view)
- ✅ Session persistence across browser restarts

### Mobile Optimizations
- ✅ Touch-optimized UI
- ✅ QuickKey bar for special characters (Ctrl, Alt, Esc, Tab, etc.)
- ✅ Responsive layout (works on phones, tablets, desktops)
- ✅ PWA support (installable web app)

### Advanced Features
- ✅ Terminal minimap (VS Code-style overview)
- ✅ Command history search
- ✅ Session management (create, resume, terminate)
- ✅ Multi-window drag-and-drop repositioning
- ✅ Layout presets (single, split, quad, etc.)
- ✅ Automation engine (cron triggers, output patterns)
- ✅ File uploads to session
- ✅ Claude Code integration (TodoPanel, token counter, canvas artifacts)

### Security
- ✅ Authelia authentication
- ✅ Cloudflare Access integration
- ✅ CSRF protection
- ✅ Rate limiting (HTTP + WebSocket)
- ✅ IP whitelisting
- ✅ Audit logging
- ✅ Security headers (CSP, HSTS, etc.)

### Observability
- ✅ Structured logging (Winston + Loki)
- ✅ Prometheus metrics
- ✅ Audit trail (sessions, commands, auth)
- ✅ Health checks (`/api/health`)

---

## 🔧 Development

### Project Structure

```
herakles-terminal/
├── src/
│   ├── client/           # React frontend
│   │   ├── components/   # UI components
│   │   ├── hooks/        # React hooks
│   │   ├── services/     # API clients
│   │   └── styles/       # CSS
│   ├── server/           # Node.js backend
│   │   ├── api/          # Express routes
│   │   ├── websocket/    # WebSocket handling
│   │   ├── session/      # Session management
│   │   ├── tmux/         # Tmux operations
│   │   ├── middleware/   # Auth, security, rate limiting
│   │   └── utils/        # Logger, validation
│   └── shared/           # TypeScript types, constants
├── docs/
│   └── archive/          # Historical documentation
├── scripts/              # Helper scripts
├── dist/                 # Build output
└── data/                 # SQLite database
```

### Scripts

```bash
npm run dev              # Development server (watch mode)
npm run build            # Production build
npm start                # Run production build
npm run lint             # ESLint check
npm run lint:fix         # Auto-fix linting issues
npm run typecheck        # TypeScript check
npm test                 # Run tests
npm run test:e2e         # End-to-end tests (Playwright)
npm run db:migrate       # Run database migrations
npm run db:backup        # Backup database
```

### Testing

```bash
# Unit tests
npm test

# E2E tests
npm run test:e2e

# Coverage
npm run test:coverage
```

---

## Known Issues

All major issues have been resolved:

- ✅ **Resize dot glitch** - Fixed Feb 25, 2026 (CSS transition suppression + shared filter module)
- ✅ **Terminal pulsing** - Fixed Feb 17, 2026 (ref-stabilized renderWindow)
- ✅ **Multiwindow drag** - Fixed Feb 12, 2026 (smooth resize-on-release)
- ✅ **WebGL stability** - Fixed Jan 2026 (17 fixes across 13 files)

---

## License

Private - Hercules Platform

---

**Last Updated:** March 31, 2026
**Version:** 1.2.0
**Author:** Hercules <noreply@herakles.dev>

<!-- Validated: 2026-03-31 by v11-drift -->
