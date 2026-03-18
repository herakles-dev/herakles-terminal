# Terminal Stability V2 + Team Cockpit

## Intent
Replace Zeus Terminal's fragile multi-window resize system (CSS transitions + debounce chains + canvas retry loops) with a CSS Grid + ResizeObserver architecture. Add Claude Code Team Cockpit mode with per-agent windows.

## Constraints
- Zero visual regressions in existing features
- Feature flag for A/B comparison during development
- Backward-compatible with server-stored fractional layouts
- Mobile layout unchanged (separate code path)
- All existing window features preserved (minimize, zoom, rename, media)
- Tests must pass at each phase gate

## Tech Stack
- React 18 + TypeScript + Vite (client)
- Node.js + Express + ws + node-pty (server)
- xterm.js + WebGL addon + FitAddon
- CSS Grid + ResizeObserver + CSS Containment

## Key Files
- `src/client/components/SplitView/SplitView.tsx` — current layout (to be replaced)
- `src/client/hooks/useResizeCoordinator.ts` — current resize (to be replaced)
- `src/client/components/TerminalCore/TerminalCore.tsx` — terminal component
- `src/client/services/OutputPipelineManager.ts` — output buffering
- `src/client/App.tsx` — window orchestration
- `src/shared/types.ts` — WindowType definition
- `src/server/todo/TodoManager.ts` — pattern for TeamManager

## Phases
1. Core Grid Engine (sprint-01)
2. Drag Handles (sprint-01)
3. Window Management (sprint-02)
4. Pipeline Cleanup (sprint-02)
5. Team Cockpit Server (sprint-03)
6. Team Cockpit Client (sprint-03)
7. Team Integration (sprint-04)
8. Testing + Polish (sprint-04)

## Gates
- Gate 1: Grid renders terminals correctly, feature flag works (after Phase 2)
- Gate 2: All window operations work on grid, old resize code removed (after Phase 4)
- Gate 3: Team cockpit detects and displays agents (after Phase 6)
- Gate 4: Full integration tests pass, production build verified (after Phase 8)
