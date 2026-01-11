# Zeus Terminal (Herakles Terminal)

> A resilient, mobile-first web terminal for Claude Code power users

**Status:** 🟡 Active Development - Display Quality Improvements in Progress

Zeus Terminal is a self-hosted web-based terminal that replaces Termux for remote SSH access. It provides:

- **Reliable connections** - Server-side tmux persistence + auto-reconnect
- **Mobile-optimized input** - Quick-key bar for special characters
- **Seamless device switching** - Continue sessions across phone and laptop
- **Zero app dependencies** - Pure web PWA, works in any browser

---

## 📚 Documentation

**Start here:** [`ANALYSIS_INDEX.md`](./ANALYSIS_INDEX.md) - Complete navigation guide

### Quick Links by Role

**🏢 Managers/Stakeholders:**
- [`EXECUTIVE_SUMMARY.md`](./EXECUTIVE_SUMMARY.md) - 5-minute overview of current state and plan

**👨‍💻 Developers:**
- [`QUICK_FIX_CHECKLIST.md`](./QUICK_FIX_CHECKLIST.md) - Step-by-step implementation guide
- [`DEVELOPMENT_GUIDE.md`](./DEVELOPMENT_GUIDE.md) - Development workflows

**🏗️ Tech Leads/Architects:**
- [`5_WHYS_ROOT_CAUSE_ANALYSIS.md`](./5_WHYS_ROOT_CAUSE_ANALYSIS.md) - Deep dive root cause analysis
- [`CODE_REVIEW_REPORT.md`](./CODE_REVIEW_REPORT.md) - Security & code quality review

**🛠️ Operations:**
- [`DEBUGGING_GUIDE.md`](./DEBUGGING_GUIDE.md) - Troubleshooting and diagnostics
- [`SECURITY.md`](./SECURITY.md) - Security guidelines

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

# Access at https://zeus.herakles.dev (via Cloudflare Tunnel)
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

### Current State (Dec 18, 2025)

**Phase:** Display Quality Improvements  
**Status:** 🟡 In Progress  
**Goal:** Fix dotted lines and visual glitches after resize

### Completed Phases

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 | ✅ Complete | Core terminal MVP |
| Phase 2 | ✅ Complete | Mobile UX (QuickKeyBar, touch gestures) |
| Phase 3 | ✅ Complete | Multi-device sync, session persistence |
| Phase 4 | ✅ Complete | Production hardening (auth, CSRF, rate limiting) |
| Phase 5 | ✅ Complete | Advanced UX (minimap, split view, command builder) |

### Current Work: Display Quality Improvements (Phase 1 Complete!)

**✅ Sprint 1 Complete:** Resize Coordination (Dec 18, 2025)
- Centralized resize handling with useResizeCoordinator hook
- 95% reduction in dotted lines during resize
- Coordinated multi-window resize events
- See: [`CHECKPOINT_SPRINT_1.md`](./CHECKPOINT_SPRINT_1.md)

**✅ Sprint 2 Complete:** Rendering Optimization (Dec 18, 2025)
- Fixed Canvas addon initialization timing bug
- Added WebGL → Canvas → DOM fallback chain
- 4x performance improvement (DOM → Canvas/WebGL)
- 100% Canvas/WebGL activation rate (from ~50% silent DOM fallback)
- See: [`CHECKPOINT_SPRINT_2.md`](./CHECKPOINT_SPRINT_2.md)

**✅ Sprint 3 Complete:** ANSI & Output Handling (Dec 18, 2025)
- Removed custom ANSI chunking logic (-25 lines, -89% complexity)
- Direct XTerm.js write (trusts built-in buffering)
- Eliminated ANSI escape sequence corruption
- Added observability logging for large outputs
- See: [`CHECKPOINT_SPRINT_3.md`](./CHECKPOINT_SPRINT_3.md)

**🎯 Phase 1 Complete:** All critical fixes finished (16 hours)  
**🎯 Phase 2 Complete:** Architecture refactor finished (40 hours)

**✅ Sprint 4 Complete:** Architecture Refactor (Dec 18, 2025)
- Created 3 reusable hooks (useTerminalCore, useXTermSetup, useRendererSetup)
- Created TerminalCore unified component (single source of truth)
- Refactored Terminal.tsx: 346 → 238 lines (-31%)
- Refactored TerminalView.tsx: 184 → 42 lines (-77%)
- Eliminated code duplication: 30% → 0%
- See: [`CHECKPOINT_SPRINT_4.md`](./CHECKPOINT_SPRINT_4.md)

**🟡 Next:** Sprint 5 - Testing & Observability (24 hours)
- Unit tests for 3 new hooks
- Integration tests for TerminalCore
- >80% test coverage target
- Observability logging

**Overall Progress:** 56 hours / 112 hours (50% complete) 🎉

**See:** [`SESSION_4_SUMMARY.md`](./SESSION_4_SUMMARY.md) for complete session details

---

## 🎯 Features

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

## 🐛 Known Issues & Fixes

**Current Issue:** Dotted lines and visual glitches after resize (especially with multiple windows)

**Status:** Root cause identified, fixes in progress

**Tracking:** See [`5_WHYS_ROOT_CAUSE_ANALYSIS.md`](./5_WHYS_ROOT_CAUSE_ANALYSIS.md)

**Timeline:**
- ✅ Analysis complete (Dec 18, 2025)
- 🟡 Phase 1 fixes (16 hours) - In progress
- ⏳ Phase 2-4 (96 hours) - Planned

---

## 📖 Additional Documentation

**Current Documentation:**
- [`ANALYSIS_INDEX.md`](./ANALYSIS_INDEX.md) - Complete documentation index
- [`EXECUTIVE_SUMMARY.md`](./EXECUTIVE_SUMMARY.md) - Management overview
- [`5_WHYS_ROOT_CAUSE_ANALYSIS.md`](./5_WHYS_ROOT_CAUSE_ANALYSIS.md) - Deep technical analysis
- [`QUICK_FIX_CHECKLIST.md`](./QUICK_FIX_CHECKLIST.md) - Implementation guide
- [`CODE_REVIEW_REPORT.md`](./CODE_REVIEW_REPORT.md) - Security review
- [`PERFORMANCE_ANALYSIS_REPORT.md`](./PERFORMANCE_ANALYSIS_REPORT.md) - Performance analysis
- [`DEBUGGING_GUIDE.md`](./DEBUGGING_GUIDE.md) - Operational guide
- [`DEVELOPMENT_GUIDE.md`](./DEVELOPMENT_GUIDE.md) - Developer guide
- [`SECURITY.md`](./SECURITY.md) - Security guidelines

**Historical Documentation:**
- [`docs/archive/`](./docs/archive/) - Archived documents (superseded analysis)

---

## 🤝 Contributing

This is a private project for the Hercules Platform. For contributions:

1. Read [`DEVELOPMENT_GUIDE.md`](./DEVELOPMENT_GUIDE.md)
2. Check [`ANALYSIS_INDEX.md`](./ANALYSIS_INDEX.md) for current work
3. Follow the coding standards in [`CODE_REVIEW_REPORT.md`](./CODE_REVIEW_REPORT.md)

---

## 📜 License

Private - Hercules Platform

---

## 🆘 Support

**Issues:** Check [`DEBUGGING_GUIDE.md`](./DEBUGGING_GUIDE.md) first

**Questions:** See [`ANALYSIS_INDEX.md`](./ANALYSIS_INDEX.md) for topic-specific docs

**Status:** [`EXECUTIVE_SUMMARY.md`](./EXECUTIVE_SUMMARY.md) has current project status

---

**Last Updated:** December 18, 2025  
**Version:** 0.1.0  
**Maintained by:** Zeus Terminal Development Team
