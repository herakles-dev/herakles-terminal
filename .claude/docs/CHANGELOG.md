# Herakles Terminal - Changelog

## v1.3.3 V1 Resize Root Cause Fix (March 18, 2026)
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
`App.tsx` (1 change: panel resize timer 220ms->16ms)

## v1.3.2 V1 Restoration + V11 Alignment (March 18, 2026)
**Implementation**: Orchestrator-direct | **Tests**: 440/440

**V1 SplitView restored as production layout engine.** Grid v2 reverted to testing after typing glitches (line duplication, cursor jumps). `USE_GRID_LAYOUT = false`. V2 improvements retained in codebase for future work. V11 alignment: all docs updated to reflect v1 production status.

## v1.3.1 Grid Area Rectangularity Fix (March 18, 2026)
**Implementation**: Orchestrator-direct | **Tests**: 443/443

CSS `grid-template-areas` non-rectangular handle areas fixed via two-pass naming. +6 rectangularity tests.

## v1.3.0 Pipeline Hardening + Grid v2 Re-Promotion (March 18, 2026)
**Implementation**: Orchestrator-direct | **Duration**: Single session | **Tests**: 437/437

**Resize pipeline hardening** (6 fixes across 4 files):
- **RC-1 drain delay** 4ms -> 80ms — lets tmux SIGWINCH output arrive before buffer release
- **Server dedup timer** 16ms -> 50ms — fixed code/comment discrepancy
- **Consecutive-dot filter** — catches 20+ dot sequences as tmux resize artifacts
- **Post-resize suppression** — 100ms aggressive re-filter window after resize completes
- **Double-filter resize buffer** — two-pass catches reassembled fragments from partial chunks
- **v1 drain delay** — 80ms client-side delay with destroyed-window guard

**Grid v2 re-promotion** (3 fixes + test suite):
- **Pane discovery retry** — 3-attempt with 50ms intervals for DOM readiness
- **TodoPanel resize** — verified ResizeObserver fires automatically on container change
- **USE_GRID_LAYOUT = true** — re-promoted as default layout engine (later reverted in v1.3.2)
- **+15 resize stability tests** — dot filters, pipeline suppression, resize cycles

**Files**: 6 modified, 1 new test file | **Tests**: 437/437 (+15 new)

## v1.2.0 Grid Layout + Team Cockpit (March 4, 2026)
**Implementation**: Orchestrator-direct | **Duration**: Single session | **Tests**: 380/380

**CSS Grid Layout Engine** (`USE_GRID_LAYOUT` flag):
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

## v1.1.0 Media Windows Integration (February 13, 2026)
**Implementation**: Type-based window system | **Duration**: 2 hours | **Tests**: 345/345

YouTube music player renders as a SplitView window alongside terminals.
- Type-Based Windows: `WindowType = 'terminal' | 'media'` with full TypeScript support
- Mode Toggle: Seamless floating <-> window transitions with "Dock to Window" button
- Database migration 006: `ALTER TABLE windows ADD COLUMN type TEXT DEFAULT 'terminal'`
- Zero regressions, 100% backward compatible

**Files**: 14 modified (+1514/-389 lines) | **Docs**: `docs/MEDIA_WINDOWS_IMPLEMENTATION.md`

## v1.0.0 Production Feature Set (February 12, 2026)
**Team**: V9 Agent Teams `feature-impl` formation | **Duration**: 4.5 hours | **Tests**: 320/320

**7 Major Features:** Icon Template Toolbar, Lightning Welcome Page, Per-Window Token Tracking, Enhanced Tasks Panel, Dockable YouTube Player, Fullscreen Canvas Mode, Artifact History.

**Quality:** 320 tests (+137 new), 0 regressions, TypeScript strict mode, production build verified.

## Terminal Pulsing Fix (February 17, 2026)
4 root cause fixes: ref-stabilized renderWindow, ANSI regex fix, WebGL canvas verify reduced (2 retries, 4px tolerance), handleStateChange stabilized via windowsRef.

## Multiwindow Drag Fix (February 12, 2026)
Visual-only preview with deferred resize (on mouseup or 2s idle). 60fps smooth drag, zero visual glitches. See commit `47b581a`.

## Terminal Stability Overhaul (January 2026)
17 fixes across 13 files. 183/183 tests pass. Net -155 lines. See `docs/archive/2026-02-terminal-stability/`.

<!-- Extracted from CLAUDE.md by v11-drift on 2026-03-31 -->
