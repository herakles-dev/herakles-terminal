# Herakles Terminal - Feature System References

## Feature Integrations
- **CSS Grid Layout** - Zero-transition resize via ResizeObserver, feature-flagged (v1.2)
- **Team Cockpit** - TeamBar + accordion (v2), auto-detect from `~/.claude/teams/` (v1.2)
- **Window Swap** - Drag title bar to swap window positions (v1.2)
- **TodoPanel** - Live Claude Code task sync from `~/.claude/todos/` (v1.0: resizable, progress bars, metadata chips)
- **Token Counter** - Real-time per-window context usage with toast warnings at 90/95/98% (v1.0)
- **Project Navigator** - 114 AI thumbnails, smart merge, auto-add API
- **Template Toolbar** - 88 templates via 9 icon categories with hover dropdowns (v1.0)
- **Canvas Artifacts** - Fullscreen mode (Ctrl+Shift+A), navigation, download, 50-artifact history (v1.0)
- **YouTube Player** - Dockable to 4 corners OR window mode (v1.1: SplitView + WindowGrid)
- **Media Windows** - Type-based window system supports YouTube player in grid (v1.1)
- **Welcome Page** - Lightning effects, feature cards, keyboard shortcuts (v1.0)

## Team Cockpit (v1.2, Team Viewer v2)
- Watches `~/.claude/teams/` and `~/.claude/tasks/` for active Claude Code agent teams
- WebSocket: `team:subscribe`, `team:sync`, `team:member:update`, `team:detected`, `team:dissolved`, `team:log`
- Self-contained TeamBar at bottom with accordion overlay — no agent windows in grid
- Auto-enables cockpit mode when team detected, disables on dissolve
- 10-color palette for agent identification
- See: `src/server/team/`, `src/client/components/TeamBar/`

## CSS Grid Layout (v1.3, TESTING — USE_GRID_LAYOUT = false)
- Feature flag: `USE_GRID_LAYOUT` in `src/shared/constants.ts` (default: `false`, set `true` to test v2)
- Resize: ResizeObserver -> RAF -> fitAddon.fit() (single path for all triggers)
- Canvas verify: RAF-aligned, 4px tolerance, 1 retry max
- Recovery: deferred resize queue, replayed via `notifyRecoveryEnd`
- Output pipeline: resize-pending flag set before server message, cleared on ack
- Drag: direct DOM grid-template manipulation (zero React re-renders during drag)
- Window swap: drag title bar onto another pane to swap positions
- See: `src/client/components/WindowGrid/`, `src/client/hooks/useGridResize.ts`

## TodoPanel (Claude Code Integration)
- Watches `~/.claude/todos/` for task updates
- WebSocket: `todo:subscribe`, `todo:sync`, `todo:update`
- See: `src/server/todo/`, `src/client/components/TodoPanel/`

## Token Counter (Context Tracking)
- Watches `~/.claude/projects/{project}/*.jsonl`
- Auto-matches windows via `auto_name` field (extracted from cwd)
- Color-coded: green -> yellow -> orange -> red
- See: `src/server/context/`

## Project Navigator
- API: `/api/projects`, `/api/projects/unregistered`, `POST /api/projects/register`
- 114 AI thumbnails in `public/thumbnails/`
- Thumbnail generation: see `src/server/api/projects.ts`

## Command Search
- API: `/api/commands/suggestions?prefix=git&limit=15`
- 88 templates with fuzzy search (Jaro-Winkler)
- Context-aware boosting (git repos, docker files)

## Canvas Artifacts
```bash
send-artifact markdown '# Title'
send-artifact mermaid 'graph TD; A-->B'
send-artifact code 'console.log("hi")' javascript
```
Full docs: `docs/CANVAS.md`

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

<!-- Extracted from CLAUDE.md by v11-drift on 2026-03-31 -->
