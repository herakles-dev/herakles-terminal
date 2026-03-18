# Terminal Stability V2: Complete Architecture Proposal

**Date:** 2026-03-04 | **Author:** Orchestrator (Claude Code CLI)
**Status:** DRAFT — Awaiting Gate Approval
**Scope:** Multi-window resize rendering overhaul for Zeus Terminal

---

## Part 1: Root Cause Analysis

### 1.1 The Current Resize Pipeline (Full Trace)

When a user drags a divider between two terminal windows, this is what happens:

```
User drags divider (mousemove)
  └→ SplitView:handleMouseMove (every ~16ms at 60fps)
       └→ setDividerPreview({ position }) — React state update, triggers re-render
       └→ dragIdleTimer reset (2000ms timeout for idle resize)
       └→ NO layout change during drag — preview only ✓

User releases mouse (mouseup)
  └→ SplitView:handleMouseUp (line 734)
       ├→ setTransitionsSuppressed(true) — direct classList.remove('transition-all', 'duration-200')
       ├→ snapToGrid(dividerPreview.position)
       ├→ calculateVerticalDividerLayouts() → Map<windowId, layout>
       ├→ forEach: onLayoutChange(windowId, layout, isDragging=false, skipResize=true)
       │    └→ App.tsx:handleLayoutChange (line 903)
       │         ├→ setWindows(prev => prev.map(...)) — React state update #1
       │         ├→ sendMessage({ type: 'window:layout', ...}) — WebSocket to server
       │         └→ skipResize=true → returns early (no 250ms timeout)
       ├→ setDividerPreview(null) — React state update #2
       ├→ setDragging(null) — React state update #3
       ├→ setActiveDragZone(null) — React state update #4
       ├→ setSnapGuides({}) — React state update #5
       ├→ setDropTarget(null) — React state update #6
       ├→ setDropZones([]) — React state update #7
       ├→ setActiveDropZone(null) — React state update #8
       ├→ setFlushGroup(new Set()) — React state update #9
       ├→ setTimeout(safetyTimer, 500ms) — safety fallback for re-enabling transitions
       └→ requestAnimationFrame(() => {
            resizeCoordinator.triggerResize(immediate=true, onComplete)
              └→ doResizeAll()
                   ├→ isResizingRef.current = true (lock)
                   └→ requestAnimationFrame(() => {         ← SECOND RAF!
                        targets.map(target => performAtomicResize(target, immediate=true))
                          └→ Per target:
                               ├→ proposeDimensions() — asks fitAddon what cols/rows fit
                               ├→ fitAddon.fit() — ACTUAL RESIZE
                               ├→ verifyWebGLCanvasSyncWithRetry()
                               │    ├→ Attempt 1: check canvas dims → if mismatch:
                               │    │    └→ RAF + 16ms delay → fitAddon.fit() again
                               │    ├→ Attempt 2: check → if mismatch:
                               │    │    └→ RAF + 48ms delay → fitAddon.fit() again
                               │    └→ Attempt 3: check → if mismatch:
                               │         └→ RAF + 100ms delay → fitAddon.fit() again
                               └→ onResize(cols, rows) → WebSocket to server
                                    └→ server 50ms dedup → tmux resize-pane
                        Promise.all(promises).then(() => {
                          isResizingRef.current = false
                          onComplete() → setTransitionsSuppressed(false)
                        })
                   })
          })
```

**Total worst-case latency from mouseup to final render:**
- 9 React state updates (batched by React 18, but still triggers render cycle): ~16ms
- RAF #1: ~16ms
- RAF #2: ~16ms
- fitAddon.fit(): ~2-5ms
- Canvas verify retry 1: RAF + 16ms = ~32ms
- Canvas verify retry 2: RAF + 48ms = ~64ms
- Canvas verify retry 3: RAF + 100ms = ~116ms
- Server round-trip for tmux resize: ~5-20ms
- **Total worst case: ~280ms+ from mouseup to stable render**

### 1.2 Identified Bottlenecks (Ranked by Severity)

#### Bottleneck #1: Double-RAF before fit() (Severity: 5/5)
`triggerResize` wraps `doResizeAll` which itself is wrapped in `requestAnimationFrame`. Then `doResizeAll` wraps the actual resize in ANOTHER `requestAnimationFrame`. That's 2 frames (~32ms) of delay before `fitAddon.fit()` even runs.

**Location:** `useResizeCoordinator.ts:361` and `triggerResize:375`

#### Bottleneck #2: Canvas Verify Retry Loop (Severity: 4/5)
After every fit(), we run up to 3 rounds of canvas dimension verification with delays of 16ms, 48ms, 100ms. Each retry calls fitAddon.fit() AGAIN. This exists because fitAddon.fit() sometimes produces wrong canvas dimensions — but the retry loop makes EVERY resize slow, not just the broken ones.

**Location:** `useResizeCoordinator.ts:84-125`

#### Bottleneck #3: Transition-Based Layout with Manual Suppression (Severity: 5/5)
The fundamental problem: window containers have `transition-all duration-200` applied via Tailwind classes. This means when layouts change, the containers ANIMATE to their new positions over 200ms. During this animation, `fitAddon.proposeDimensions()` and `fitAddon.fit()` measure intermediate sizes, producing wrong terminal dimensions.

The current fix (suppressTransitions via direct DOM classList manipulation) is fragile:
- Race condition between React batch rendering and DOM manipulation
- Safety timeout (500ms) means transitions can re-enable before resize completes
- onComplete callback from triggerResize depends on Promise.all resolving correctly

**Location:** `SplitView.tsx:126-141`, `SplitView.tsx:737-816`

#### Bottleneck #4: React State Avalanche on mouseUp (Severity: 3/5)
handleMouseUp triggers 9+ React state updates. Even though React 18 batches these, the batch still triggers a re-render cycle. The re-render recalculates all window positions, which can cause a visible layout jump before the resize coordinator runs.

**Location:** `SplitView.tsx:788-802`

#### Bottleneck #5: Parallel Resize Pipeline Paths (Severity: 4/5)
There are 5 different paths that can trigger a terminal resize, each with different timing:
1. **Divider drag mouseup** → immediate triggerResize via SplitView
2. **Edge resize mouseup** → onLayoutChange → App.tsx 250ms timeout → resizeTarget
3. **Browser resize** → window 'resize' event → triggerResize(false) → 150ms debounce
4. **Side panel toggle** → useEffect → 220ms timeout → triggerResize
5. **Window add/remove** → layout recalculation → resize

These paths can overlap and fight each other. The isResizingRef lock prevents concurrent fits but can cause dropped resizes.

**Location:** Various — `App.tsx:895`, `App.tsx:920`, `useResizeCoordinator.ts:429`

### 1.3 Why Dark Gaps Appear

Dark gaps (black/background-colored strips) appear when:
1. **fitAddon.fit() measures during transition**: Container is at 60% of final width → terminal gets fewer cols → content renders at wrong size → gap visible on the right/bottom
2. **WebGL canvas dimensions lag**: The WebGL canvas's internal pixel dimensions don't update immediately after CSS layout changes. The canvas verify loop tries to catch this but adds latency.
3. **Terminal content reflow delay**: Even after correct fit(), the terminal content needs to reflow to new dimensions. If transitions re-enable before this completes, the visible size changes while content is still at old dimensions.

### 1.4 Why Period/Dot Glitches Appear

The dot filter (`terminalFilters.ts:35`) catches lines matching `^[.\s]+$`. During resize:
1. tmux redraws the pane content for new dimensions
2. This redraw can produce partial ANSI sequences that the strip regex doesn't fully handle
3. The stripped result looks like a line of dots
4. The filter is too conservative (only exact dot-lines) or too aggressive (ratio-based catches legitimate content)

---

## Part 2: Proposed Architecture — "Zero-Transition Resize"

### 2.1 Core Principle

**Eliminate CSS transitions on terminal containers entirely.** Use a fundamentally different approach:

1. **CSS Grid for layout** (not absolute positioning with fractional coordinates)
2. **ResizeObserver as the single resize trigger** (not debounce timers)
3. **Contain and isolate** each terminal pane with CSS containment
4. **Single resize path** through one unified coordinator
5. **Canvas pre-sizing** to prevent dark gaps

### 2.2 Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  WindowGrid (CSS Grid)                          │
│  grid-template-columns: 1fr 6px 1fr             │
│  grid-template-rows: 1fr 6px 1fr               │
│                                                  │
│  ┌──────────┐ ║ ┌──────────┐                    │
│  │TermPane  │ ║ │TermPane  │                    │
│  │contain:  │ ║ │contain:  │                    │
│  │strict    │ ║ │strict    │                    │
│  │          │ ║ │          │                    │
│  └──────────┘ ║ └──────────┘                    │
│  ═════════════╬══════════════                    │
│  ┌──────────┐ ║ ┌──────────┐                    │
│  │TermPane  │ ║ │MediaPane │                    │
│  │contain:  │ ║ │          │                    │
│  │strict    │ ║ │          │                    │
│  └──────────┘ ║ └──────────┘                    │
│               ║ = Drag Handles (6px)            │
└─────────────────────────────────────────────────┘

Drag Handle interaction:
  mousedown → capture initial grid-template values
  mousemove → update grid-template-columns/rows (CSS only, no React state)
  mouseup   → commit final values to React state

ResizeObserver on each TermPane:
  size change detected → requestAnimationFrame → fitAddon.fit() → done
  (single step, no debounce, no retry, no transition waiting)
```

### 2.3 Detailed Design

#### Component: `WindowGrid` (replaces SplitView resize logic)

```typescript
// Core concept: CSS Grid tracks define layout, not absolute positioning
interface GridLayout {
  columns: string; // e.g., "1fr 6px 2fr"
  rows: string;    // e.g., "1fr 6px 1fr"
  areas: string[]; // e.g., ["a handle-v b", "handle-h center handle-h", "c handle-v d"]
  panes: Map<string, { gridArea: string; type: 'terminal' | 'media' }>;
}
```

**Why CSS Grid eliminates transitions:**
- Grid track sizes update SYNCHRONOUSLY with the CSS property change
- No animation needed — the browser reflows instantly
- `grid-template-columns: 1fr 6px 2fr` → change to `2fr 6px 1fr` → instant
- ResizeObserver fires on the pane containers with their FINAL dimensions
- fitAddon.fit() measures the correct size on the first call

#### Component: `DragHandle` (replaces divider drag logic)

```typescript
// Drag handle sits in grid gap, purely CSS-driven resize
function DragHandle({ orientation, onDragStart, onDrag, onDragEnd }) {
  // mousemove → update parent's grid-template via ref (no React state)
  // This means: zero re-renders during drag, just CSS property changes

  const handleMouseMove = (e: MouseEvent) => {
    // Calculate new fr values from mouse position
    // Update grid container style directly via ref
    gridContainerRef.current.style.gridTemplateColumns = newColumns;
    // ResizeObserver fires on affected panes → fit() → done
  };
}
```

**Key insight:** By updating `gridTemplateColumns` directly on the DOM element during drag (via ref, not state), we get:
- Zero React re-renders during drag
- Browser handles layout synchronously
- ResizeObserver fires with correct final dimensions
- fitAddon.fit() called exactly once per frame (RAF-throttled)

#### Component: `TerminalPane` (wraps TerminalCore)

```typescript
function TerminalPane({ windowId, ... }) {
  const containerRef = useRef<HTMLDivElement>(null);

  // CSS containment prevents layout thrashing
  // `contain: strict` means this element's layout is fully independent
  const style = {
    contain: 'strict',           // Layout isolation
    overflow: 'hidden',          // Required for contain: strict
    contentVisibility: 'auto',   // Lazy rendering for off-screen/minimized
  };

  // Single ResizeObserver per pane — the ONLY resize trigger
  useEffect(() => {
    if (!containerRef.current) return;

    let rafId: number | null = null;
    const observer = new ResizeObserver((entries) => {
      // Throttle to one fit() per frame
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const entry = entries[0];
        if (!entry) return;

        const { width, height } = entry.contentRect;
        if (width < 50 || height < 50) return; // Skip tiny sizes

        fitAddon.fit();

        // Notify server of new dimensions (no verify loop needed)
        const dims = fitAddon.proposeDimensions();
        if (dims) onResize(dims.cols, dims.rows);
      });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} style={style}>
      <TerminalCore ... />
    </div>
  );
}
```

#### Eliminating Canvas Verify Loop

The canvas verify loop exists because WebGL canvas dimensions don't update immediately after fitAddon.fit(). The root cause is that fit() is called while the container is still transitioning.

**With the new architecture, this problem doesn't exist:**
1. No CSS transitions on terminal containers
2. CSS Grid reflow is synchronous
3. ResizeObserver fires with FINAL dimensions
4. fitAddon.fit() measures correctly on first call
5. If WebGL canvas needs a frame to sync: single RAF + fit() retry (not a 3-retry loop)

```typescript
// Simplified canvas sync — at most 1 retry
async function ensureCanvasSync(fitAddon: FitAddon, element: HTMLElement): Promise<void> {
  fitAddon.fit();

  // Single-frame wait for WebGL to process
  await new Promise<void>(r => requestAnimationFrame(r));

  // One check — if canvas is still wrong, fit once more
  const canvas = element.querySelector('canvas');
  if (canvas) {
    const rect = element.getBoundingClientRect();
    const dpr = devicePixelRatio;
    if (Math.abs(canvas.width - rect.width * dpr) > 4) {
      fitAddon.fit();
    }
  }
}
```

### 2.4 Layout Model Conversion

**Current:** Fractional coordinates (x, y, width, height as 0-1 floats)
```typescript
// Current: each window has absolute position
{ id: "w1", x: 0, y: 0, width: 0.5, height: 1 }
{ id: "w2", x: 0.5, y: 0, width: 0.5, height: 1 }
```

**Proposed:** Grid tracks with named areas
```typescript
// Proposed: layout is defined by grid template
{
  columns: "1fr 6px 1fr",      // Two equal columns with 6px handle
  rows: "1fr",                  // Single row
  areas: [["w1", "handle", "w2"]],
}

// 4-window layout:
{
  columns: "1fr 6px 1fr",
  rows: "1fr 6px 1fr",
  areas: [
    ["w1", "vhandle", "w2"],
    ["hhandle", "center", "hhandle"],
    ["w3", "vhandle", "w4"],
  ],
}
```

**Migration path:** The server stores fractional layouts. We convert fr↔fraction:
- `1fr 6px 2fr` → fractions `[0.333, 0.667]` (excluding handle pixels)
- On load: convert stored fractions → grid template
- On save: convert grid template → fractions for backward compat

### 2.5 Output Pipeline Simplification

With stable resize, the output pipeline can be simplified:

1. **Remove `resizePending` buffer** — No longer needed since resize is instant (no transition delay)
2. **Remove canvas verify retry** — Single-frame sync replaces 3-retry loop
3. **Keep volume-based throttling** — Still valuable for heavy output (build logs)
4. **Keep thinking output filter** — Still needed but decoupled from resize
5. **Remove `setAnimating` flag** — No animation states to track

### 2.6 Browser Resize Handling

```typescript
// Single path for ALL resize triggers:
// ResizeObserver on each TerminalPane container → RAF → fit()
//
// Browser resize → CSS Grid reflows → ResizeObserver fires → fit()
// Divider drag → grid-template change → ResizeObserver fires → fit()
// Side panel → available width changes → CSS Grid reflows → ResizeObserver fires → fit()
// Window add/remove → grid template recalculated → ResizeObserver fires → fit()
//
// ONE PATH. No debounce timers. No transition waiting. No retry loops.
```

### 2.7 Smooth Divider Drag UX

During divider drag, the user sees:
1. **60fps cursor tracking** — grid-template updated via DOM ref every mousemove
2. **Terminals resize live** — ResizeObserver → fit() on every frame the size changes
3. **Optional: throttle fit() during fast drag** — If fit() is too expensive at 60fps, throttle to 30fps during active drag, full speed on mouseup. This is a tunable parameter.

```typescript
// Throttle strategy during drag (optional, measured empirically)
const DRAG_FIT_INTERVAL = 33; // ~30fps during drag
let lastFitTime = 0;

resizeObserver = new ResizeObserver(() => {
  const now = performance.now();
  if (isDragging && now - lastFitTime < DRAG_FIT_INTERVAL) return;
  lastFitTime = now;
  requestAnimationFrame(() => fitAddon.fit());
});
```

---

## Part 3: What Gets Deleted

### 3.1 Code Removal

| File | What's Removed | Lines |
|------|---------------|-------|
| `useResizeCoordinator.ts` | **Entire file replaced** — new coordinator is ResizeObserver-based, ~100 lines vs ~454 | -454 |
| `SplitView.tsx` | Transition suppression, divider preview state, drag idle timer, edge resize state, 9 useState hooks related to drag/resize | ~-300 |
| `App.tsx` | `handleLayoutChange` 250ms timeout, `fitTimeoutRef`, `panelResizeTimerRef` 220ms timeout | ~-30 |
| `OutputPipelineManager.ts` | `resizePending` buffer, `setResizePending()`, `isResizePending()` | ~-30 |

**Estimated net reduction: ~400-500 lines of complex timing code**

### 3.2 Concepts Eliminated

- CSS transition suppression pattern (classList.remove/add)
- Double-RAF for resize scheduling
- Canvas verify retry loop (3 retries with escalating delays)
- Resize lock (isResizingRef)
- Animation state tracking (setAnimating)
- Pending resize buffer in output pipeline
- Multiple resize paths with different timing
- 250ms, 220ms, 150ms debounce timers for different resize triggers
- Safety timeout (500ms) for transition re-enable

---

## Part 4: Risk Assessment

### 4.1 Low Risk
- CSS Grid layout is well-supported (98%+ browser coverage)
- ResizeObserver is well-supported (96%+ browser coverage)
- CSS containment is well-supported (95%+ browser coverage)
- fitAddon.fit() works correctly when container has final dimensions

### 4.2 Medium Risk
- **Grid template ↔ fractional coordinate conversion** needs careful math to preserve existing layouts
- **Window drag-and-drop** (moving windows between positions) needs grid area reassignment logic
- **Mobile layout** currently uses a completely different code path — needs to stay separate
- **Media windows** (YouTube) need to work in grid alongside terminal panes

### 4.3 Mitigations
- Keep existing SplitView as fallback during development
- Feature flag to switch between old/new layout engine
- Comprehensive test suite for layout conversion
- Preserve all window management features (minimize, zoom, rename, etc.)

---

## Part 5: Implementation Phases (V11 Spec Preview)

### Phase 1: Core Grid Engine (3-5 tasks)
- New `WindowGrid` component with CSS Grid layout
- Grid template ↔ fractional coordinate bidirectional conversion
- ResizeObserver-based resize for single terminal pane
- Feature flag for A/B comparison

### Phase 2: Drag Handles (3-4 tasks)
- `DragHandle` component for divider dragging
- Direct DOM grid-template manipulation during drag
- Snap-to-grid on mouseup
- Edge resize via grid track adjustment

### Phase 3: Window Management (3-4 tasks)
- Window add/remove with grid recalculation
- Window drag-and-drop (grid area swap)
- Zoom/minimize behavior in grid context
- Media window type support in grid

### Phase 4: Pipeline Cleanup (2-3 tasks)
- Remove transition suppression code
- Remove canvas verify retry loop (replace with single-frame check)
- Remove resizePending buffer from OutputPipelineManager
- Simplify useResizeCoordinator to thin ResizeObserver wrapper

### Phase 5: Testing & Polish (2-3 tasks)
- Resize stability tests (automated)
- Performance benchmarks (drag fps, resize latency)
- Mobile layout verification (unchanged)
- Remove old SplitView resize code + feature flag

**Total: ~15-19 tasks across 5 phases**

---

## Part 6: Success Criteria

| Metric | Current | Target |
|--------|---------|--------|
| Dark gaps during resize | Frequent | Zero |
| Dot/period glitches | Occasional | Zero |
| Divider drag FPS | ~30fps with jank | 60fps smooth |
| Mouseup-to-stable latency | ~280ms worst case | <50ms |
| Resize code complexity | ~800 lines across 4 files | ~300 lines in 2 files |
| Resize trigger paths | 5 different paths | 1 unified path |
| Debounce/timeout timers | 5 timers (150ms, 220ms, 250ms, 500ms, 2000ms) | 0 timers |
| Canvas verify retries | 3 retries (up to 164ms) | 1 check (16ms) |

---

## Appendix: Key References

- xterm.js FitAddon source: `@xterm/addon-fit` — `fit()` calls `this._terminal.resize(dims.cols, dims.rows)`
- CSS Grid spec: `grid-template-columns` is synchronously applied (no animation by default)
- ResizeObserver spec: fires after layout, before paint — ideal timing for fit()
- CSS Containment spec: `contain: strict` = `contain: size layout style paint`
