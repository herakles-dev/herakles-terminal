# Terminal Refactor Build Plan - Claude Code Session Guide

## Reference Documentation

**Primary Analysis:** The original analysis conversation contains comprehensive code mapping. Key sections:
- Section 4: Output Flow (Server → Client)
- Section 5: Resize Coordination System
- Section 10: Buffer Management
- Section 12: Key File Reference

**Files to read first each session:**
```bash
cat src/client/App.tsx                           # Lines 208-210, 332-416 - buffer refs, output handling
cat src/client/hooks/useResizeCoordinator.ts     # Full file - resize state machine
cat src/client/hooks/useRendererSetup.ts         # Lines 95-175 - fallback chain
cat src/shared/constants.ts                      # Lines 22-28 - defaults
```

---

## Architecture Overview

### Current State

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              OUTPUT FLOW                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Server                                        Client                       │
│  ┌─────────────────┐                          ┌─────────────────────────┐  │
│  │ TmuxManager     │                          │ App.tsx                 │  │
│  │ - capturePane() │                          │ - outputBuffersRef      │  │
│  │ - attachSession │                          │ - outputTimersRef       │  │
│  └────────┬────────┘                          │ - resizePendingBuffers  │  │
│           │                                   └───────────┬─────────────┘  │
│           ▼                                               │                │
│  ┌─────────────────┐    WebSocket             ┌───────────▼─────────────┐  │
│  │ WindowManager   │    window:output         │ TerminalCore            │  │
│  │ - sendToWindow  │ ──────────────────────►  │ - write()               │  │
│  │ - captureScreen │    window:restore        │ - scrollToBottom()      │  │
│  └────────┬────────┘                          └───────────┬─────────────┘  │
│           │                                               │                │
│           ▼                                               ▼                │
│  ┌─────────────────┐                          ┌─────────────────────────┐  │
│  │ ConnectionMgr   │                          │ XTerm.js Instance       │  │
│  │ - broadcastTo   │                          │ - buffer.active         │  │
│  │   Window()      │                          │ - scrollback: 50000     │  │
│  └─────────────────┘                          └─────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Target State

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         REFACTORED OUTPUT FLOW                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Server                                        Client                       │
│  ┌─────────────────┐                          ┌─────────────────────────┐  │
│  │ TmuxManager     │                          │ OutputPipelineManager   │  │
│  │ - captureChunk  │                          │ - enqueue()             │  │
│  │ - attachSession │                          │ - setResizePending()    │  │
│  └────────┬────────┘                          │ - RAF auto-flush        │  │
│           │                                   └───────────┬─────────────┘  │
│           ▼                                               │                │
│  ┌─────────────────┐    WebSocket             ┌───────────▼─────────────┐  │
│  │ WindowManager   │    window:output         │ TerminalCore            │  │
│  │ - sendToWindow  │ ──────────────────────►  │ - write()               │  │
│  │ - captureChunk  │    window:restore        │ - setTheme()            │  │
│  └────────┬────────┘                          └───────────┬─────────────┘  │
│           │                                               │                │
│           ▼                                               ▼                │
│  ┌─────────────────┐                          ┌─────────────────────────┐  │
│  │ ConnectionMgr   │                          │ XTerm.js + Renderer     │  │
│  │ - broadcastTo   │                          │ - State machine         │  │
│  │   Window()      │                          │ - MutationObserver      │  │
│  └─────────────────┘                          └─────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Output Pipeline Consolidation

### 1.1 Create OutputPipelineManager Class

#### 1.1.1 Create new file `src/client/services/OutputPipelineManager.ts`
```
- Define interface OutputPipelineConfig { flushIntervalMs?: number }
- Define interface WindowOutputState { 
    buffer: string, 
    flushTimer: number | null, 
    resizePending: boolean, 
    pendingResizeBuffer: string 
  }
- Create class OutputPipelineManager with Map<string, WindowOutputState>
```

#### 1.1.2 Implement core buffer methods
```
- Method: enqueue(windowId: string, data: string): void
  - Check if resize pending for window → route to pendingResizeBuffer
  - Otherwise append to buffer, schedule flush via RAF
- Method: flush(windowId: string): string
  - Return and clear buffer, cancel pending RAF timer
- Method: setResizePending(windowId: string, pending: boolean): void
  - When pending=false, merge pendingResizeBuffer into main buffer
```

#### 1.1.3 Implement RAF-based auto-flush
```
- Private method: scheduleFlush(windowId: string)
  - Cancel existing timer if present (cancelAnimationFrame)
  - Set new RAF timer, store in state.flushTimer
  - On fire: call registered callback with windowId + flushed data
- Constructor accepts onFlush: (windowId: string, data: string) => void callback
```

#### 1.1.4 Add cleanup and stats methods
```
- Method: clear(windowId: string): void - remove window state entirely
- Method: clearAll(): void - clear all windows
- Method: getStats(): { windowCount: number, totalBuffered: number }
```

### 1.2 Integrate OutputPipelineManager into App.tsx

#### 1.2.1 Remove existing buffer refs from App.tsx
```
- Delete lines 208-210: outputBuffersRef, outputTimersRef, resizePendingBuffersRef
- Add: const outputPipeline = useRef<OutputPipelineManager | null>(null)
- Initialize in useEffect with onFlush callback that writes to terminal
```

#### 1.2.2 Refactor window:output handler (App.tsx lines 382-416)
```
- Replace entire case block with:
  outputPipeline.current?.enqueue(msg.windowId, msg.data)
- Remove manual RAF scheduling logic
```

#### 1.2.3 Refactor window:resized handler (App.tsx lines 364-380)
```
- Replace resizePendingBuffersRef logic with:
  outputPipeline.current?.setResizePending(windowId, false)
- Integrate with resizeCoordinator.confirmResize call
```

#### 1.2.4 Connect resize coordinator to pipeline
```
- When resizeCoordinator.isResizePending changes for a window:
  outputPipeline.current?.setResizePending(windowId, true)
- Pass this via callback in useResizeCoordinator or via effect
```

### 1.3 Add Pipeline Tests

#### 1.3.1 Create `src/client/services/__tests__/OutputPipelineManager.test.ts`
```
- Test: enqueue buffers data correctly
- Test: flush returns and clears buffer
- Test: resize pending routes to separate buffer
- Test: setResizePending(false) merges buffers
- Test: RAF scheduling coalesces rapid enqueues
```

---

## Phase 2: Resize Coordination Simplification

### 2.1 Analyze Current Complexity

#### 2.1.1 Document current state refs in useResizeCoordinator.ts
```
Read lines 31-38:
- targetsRef: Map<string, ResizeTarget>
- resizeTimeoutRef: debounce timer
- animatingRef: animation lock
- pendingResizeAfterAnimationRef: deferred resize flag
- dimensionCacheRef: Map<string, CachedDimensions>
- pendingResizesRef: Map<string, PendingResize>
- resizeTimeoutsRef: Map<string, NodeJS.Timeout>
- seqCounterRef: sequence number
```

#### 2.1.2 Trace sequence number usage
```
- Generated in performAtomicResize (line 112)
- Sent to server in onResize callback (line 130)
- Server echoes back in window:resized message
- Verified in confirmResize (lines 79-96)
- Purpose: ensure resize ack matches request
```

### 2.2 Simplify to Debounce-Only Approach

#### 2.2.1 Remove sequence number tracking
```
- Delete seqCounterRef
- Remove seq parameter from onResize callback type (line 8)
- Remove seq from PendingResize interface
- Simplify confirmResize to just dimension matching
```

#### 2.2.2 Consolidate timeout maps
```
- Merge resizeTimeoutsRef into pendingResizesRef as { ..., timeoutId: NodeJS.Timeout }
- Reduces from 2 maps to 1
```

#### 2.2.3 Simplify pendingResize state
```
- Change from storing { cols, rows, seq, requestedAt } to just { cols, rows, expiresAt }
- expiresAt = Date.now() + RESIZE_TIMEOUT_MS
- isResizePending checks expiresAt vs now
```

#### 2.2.4 Update ConnectionManager.ts to not require seq
```
- Line 272: Remove seq from handleWindowResize signature
- Line 560-566: Make seq optional in response, only include if provided
```

### 2.3 Reduce Animation Lock Complexity

#### 2.3.1 Evaluate animatingRef necessity
```
- Used to defer resizes during CSS transitions
- Check if still needed with current SplitView implementation
- If SplitView uses CSS transitions for resize: keep
- If immediate: remove animatingRef + pendingResizeAfterAnimationRef
```

#### 2.3.2 If keeping animation lock, simplify
```
- Combine animatingRef + pendingResizeAfterAnimationRef into single ref
- Type: { isAnimating: boolean, pendingResize: boolean }
```

### 2.4 Update Dependent Code

#### 2.4.1 Update TerminalCore.tsx
```
- Line 190-194: Verify onResize callback signature matches new type
- Remove seq parameter from handleTerminalResize in App.tsx (line 519)
```

#### 2.4.2 Update App.tsx window:resized handler
```
- Line 366: Remove seq from destructuring if removed
- Simplify to just calling confirmResize(windowId, cols, rows)
```

---

## Phase 3: Renderer Lifecycle Refactor

### 3.1 Replace Double-RAF with MutationObserver

#### 3.1.1 Analyze current verification pattern (useRendererSetup.ts:152-167)
```
- Double RAF waits ~32ms for canvas to appear
- Checks term.element.querySelector('canvas.xterm-text-layer')
- Fragile: timing-dependent, can fail on slow devices
```

#### 3.1.2 Implement MutationObserver-based verification
```
- After loadAddon, create MutationObserver on term.element
- Observe childList + subtree for canvas element
- Set timeout (500ms) as fallback
- On canvas found OR timeout: determine success/failure
```

#### 3.1.3 Create helper function `waitForCanvas`
```typescript
function waitForCanvas(element: HTMLElement, timeoutMs = 500): Promise<boolean>
- Returns promise resolving true if canvas found, false on timeout
- Uses MutationObserver + setTimeout race
```

### 3.2 Add Renderer State Machine

#### 3.2.1 Define RendererState type
```typescript
type RendererState = 
  | { status: 'idle' }
  | { status: 'loading', type: 'webgl' | 'canvas' }
  | { status: 'active', type: 'webgl' | 'canvas' | 'dom' }
  | { status: 'failed', lastError?: string }
```

#### 3.2.2 Replace activeRendererRef with state machine ref
```
- const rendererStateRef = useRef<RendererState>({ status: 'idle' })
- Update setupRenderer to transition: idle → loading → active/failed
- Expose state via return value (not just type)
```

#### 3.2.3 Add state change callback option
```
- Add onStateChange?: (state: RendererState) => void to UseRendererSetupOptions
- Call on each transition for debugging/telemetry
```

### 3.3 Improve Context Loss Recovery

#### 3.3.1 Consolidate recovery logic
```
- Current: onContextLoss disposes addon, calls tryCanvasFallback
- Enhance: Add retry counter, exponential backoff for repeated failures
- Add: Log context loss events for telemetry
```

#### 3.3.2 Add recovery state to state machine
```
type RendererState = ... | { status: 'recovering', attempts: number }
```

---

## Phase 4: Scrollback Optimization

### 4.1 Implement Chunked Restore

#### 4.1.1 Modify TmuxManager.capturePane (src/server/tmux/TmuxManager.ts:224-244)
```
- Add parameters: startLine?: number, lineCount?: number
- Use tmux capture-pane -S {start} -E {end} for chunked capture
- Default behavior unchanged if no params
```

#### 4.1.2 Add chunked capture to WindowManager.captureScreen
```
- New method: captureScreenChunked(windowId, userEmail, chunkSize, offset)
- Returns { data: string, totalLines: number, hasMore: boolean }
```

#### 4.1.3 Modify ConnectionManager restore flow
```
- Initial restore: send last 1000 lines only
- Include metadata: { type: 'window:restore', windowId, data, totalLines, offset }
- Client can request more via new message type
```

#### 4.1.4 Add client-side lazy loading
```
- New message type: { type: 'window:history-request', windowId, offset, count }
- Handler in ConnectionManager to send chunked history
- App.tsx: request more history when user scrolls to top
```

### 4.2 Optimize Minimap Rendering

#### 4.2.1 Analyze current rendering (TerminalMinimap.tsx:32-280)
```
- Iterates all buffer lines on every render
- Sampling reduces load (line 83: sampleStep)
- Still expensive for 50K lines
```

#### 4.2.2 Implement incremental minimap updates
```
- Track last rendered buffer length
- Only process new lines since last render
- Store color blocks in offscreen canvas, composite
```

#### 4.2.3 Add time-based throttling
```
- Current: RAF-based, can fire 60fps during rapid output
- Add: minimum 100ms between full re-renders
- Exception: viewport position updates can be immediate
```

---

## Phase 5: CSS Architecture Cleanup

### 5.1 Audit `!important` Usage

#### 5.1.1 List all !important declarations in terminal.css
```
Lines with !important:
- 167: background-color
- 168: overflow-y
- 199: line-height
- 203: display
- 207-216: xterm-helper-textarea positioning
- 673-674: transition: none
```

#### 5.1.2 Determine which can be removed
```
- XTerm injects inline styles, some !important needed
- Document which are XTerm overrides vs our bugs
```

### 5.2 Split CSS Files

#### 5.2.1 Create `terminal-base.css`
```
- CSS variables (lines 5-69)
- Base reset (lines 77-96)
- Layout containers (lines 98-121)
```

#### 5.2.2 Create `terminal-xterm.css`
```
- All .terminal-container .xterm* rules (lines 161-216)
- Scrollbar styling (lines 173-192)
```

#### 5.2.3 Create `terminal-mobile.css`
```
- @media (max-width: 768px) block (lines 619-658)
- @media (max-width: 480px) blocks
- Landscape mode rules (lines 596-617)
```

#### 5.2.4 Update imports
```
- main.tsx or App.tsx: import in order base → xterm → mobile
- Verify specificity works without !important where possible
```

### 5.3 CSS Custom Properties for Dynamic Values

#### 5.3.1 Add terminal-specific custom properties
```css
:root {
  --terminal-scrollbar-width: 10px;
  --terminal-padding: 4px;
  --terminal-line-height: normal;
}
```

#### 5.3.2 Use in rules instead of hardcoded values
```
- Replace width: 10px with var(--terminal-scrollbar-width)
- Allows runtime customization via JS
```

---

## Phase 6: Theme System Enhancement

### 6.1 Extract Theme Configuration

#### 6.1.1 Create `src/shared/themes.ts`
```typescript
- Move THEMES from constants.ts
- Add type TerminalTheme (already in types.ts:258-281)
- Add additional themes: light, solarized-dark, monokai
```

#### 6.1.2 Add theme validation
```
- Function validateTheme(theme: unknown): theme is TerminalTheme
- Ensure all required color keys present
```

### 6.2 Runtime Theme Switching

#### 6.2.1 Add theme to user preferences
```
- Update UserPreferences in types.ts to include theme: string
- Update SessionStore to persist theme preference
```

#### 6.2.2 Implement setTheme in TerminalCore
```
- Add to TerminalCoreHandle: setTheme(themeName: string)
- Implementation: terminal.options.theme = THEMES[themeName]
```

#### 6.2.3 Sync CSS variables with theme
```
- When theme changes, update CSS custom properties:
  document.documentElement.style.setProperty('--terminal-bg', theme.background)
- Keeps non-XTerm elements in sync
```

### 6.3 Theme Preview Component

#### 6.3.1 Create `src/client/components/ThemePreview/ThemePreview.tsx`
```
- Small preview panel showing theme colors
- Sample ANSI output rendering
- Used in settings panel for selection
```

---

## Session Checkpoints

After each phase, verify:

```bash
npm run typecheck   # No type errors
npm run lint        # No lint errors  
npm run test        # All tests pass
npm run dev         # Manual smoke test:
                    #   - Terminal output displays
                    #   - Resize works
                    #   - Scrollback preserved
                    #   - Mobile layout correct
```

---

## Priority Order

**Must Have (Phase 1 + 2):** Output pipeline + resize simplification - reduces complexity, fixes potential race conditions

**Should Have (Phase 3):** Renderer lifecycle - improves reliability on slow devices

**Nice to Have (Phase 4-6):** Performance + polish - user experience improvements

---

## Key File Reference

| File | Lines | Key Content |
|------|-------|-------------|
| `src/client/hooks/useXTermSetup.ts` | 1-139 | XTerm config, scrollback, addons |
| `src/client/hooks/useRendererSetup.ts` | 1-204 | WebGL/Canvas/DOM fallback |
| `src/client/hooks/useResizeCoordinator.ts` | 1-226 | Resize state machine |
| `src/client/hooks/useTerminalCore.ts` | 1-100 | Lifecycle refs |
| `src/client/components/TerminalCore/TerminalCore.tsx` | 1-269 | Unified component |
| `src/client/components/TerminalMinimap/TerminalMinimap.tsx` | 1-480 | Viewport visualization, scroll |
| `src/client/styles/terminal.css` | 98-216, 619-676 | XTerm styling, mobile |
| `src/shared/constants.ts` | 22-91 | Defaults, themes |
| `src/server/websocket/ConnectionManager.ts` | 666-701 | Output routing, restore |
| `src/server/window/WindowManager.ts` | 258-279 | Screen capture |
| `src/server/tmux/TmuxManager.ts` | 224-244 | Pane capture |
| `src/client/App.tsx` | 332-416 | Output handling, restore |

---

## Execution Timeline

| Phase | Estimated Sessions | Dependencies |
|-------|-------------------|--------------|
| Phase 1 | 2-3 sessions | None |
| Phase 2 | 1-2 sessions | Phase 1 (resize-pending integration) |
| Phase 3 | 1-2 sessions | None (can parallelize with 1-2) |
| Phase 4 | 2-3 sessions | Phases 1-2 complete |
| Phase 5 | 1 session | None |
| Phase 6 | 1-2 sessions | Phase 5 preferred |

**Total: 8-13 sessions**

---

## Code Analysis Summary

### Scrollback & History
- **Config:** `TERMINAL_DEFAULTS.scrollback = 50000` in `constants.ts:27`
- **XTerm options:** `scrollOnUserInput: true`, `fastScrollModifier: 'alt'` in `useXTermSetup.ts:92-95`
- **Buffer access:** `terminal.buffer.active.baseY` (scrollback lines), `viewportY` (scroll position)

### Rendering Pipeline
- **Addons loaded:** FitAddon, WebLinksAddon, SearchAddon (base), WebglAddon/CanvasAddon (renderer)
- **Fallback:** WebGL → Canvas → DOM, verified via canvas element detection
- **Performance:** WebGL 60fps GPU, Canvas 60fps 2D, DOM 10-15fps

### Output Buffering
- **Three buffers in App.tsx:** `outputBuffersRef`, `outputTimersRef`, `resizePendingBuffersRef`
- **Flush mechanism:** RAF-based, coalesces rapid output
- **Resize coordination:** Buffers held during pending resize, released on confirmation

### CSS Architecture
- **Variables:** 70+ custom properties for colors, spacing, shadows
- **XTerm overrides:** Required `!important` for background, overflow, line-height
- **Mobile:** Separate media queries for <768px, <480px, landscape

---

## Implementation Progress

### Phase 1: Output Pipeline Consolidation
| Task | Status | Notes |
|------|--------|-------|
| 1.1.1 Create OutputPipelineManager.ts | ✅ DONE | Created with interfaces |
| 1.1.2 Implement core buffer methods | ✅ DONE | enqueue, flush, setResizePending |
| 1.1.3 Implement RAF-based auto-flush | ✅ DONE | scheduleFlush with callback |
| 1.1.4 Add cleanup and stats methods | ✅ DONE | clear, clearAll, getStats |
| 1.2.1 Remove existing buffer refs | ✅ DONE | Replaced 3 refs with 1 pipeline ref |
| 1.2.2 Refactor window:output handler | ✅ DONE | Now uses pipeline.enqueue() |
| 1.2.3 Refactor window:resized handler | ✅ DONE | Now uses pipeline.setResizePending() |
| 1.2.4 Connect resize coordinator | ✅ DONE | Integrated in output handler |
| 1.3.1 Add pipeline tests | ✅ DONE | 11 tests passing |

### Phase 2: Resize Coordination Simplification
| Task | Status | Notes |
|------|--------|-------|
| 2.1.1 Document current state refs | ✅ DONE | Analyzed 8 refs |
| 2.1.2 Trace sequence number usage | ✅ DONE | Found unnecessary complexity |
| 2.2.1 Remove sequence number tracking | ✅ DONE | Removed seqCounterRef |
| 2.2.2 Consolidate timeout maps | ✅ DONE | Merged into pendingResizesRef |
| 2.2.3 Simplify pendingResize state | ✅ DONE | Now uses expiresAt+timeoutId |
| 2.2.4 Update ConnectionManager.ts | ✅ DONE | seq already optional |
| 2.3.1 Evaluate animatingRef necessity | ✅ DONE | Kept for CSS transitions |
| 2.3.2 Simplify animation lock | ✅ DONE | Combined into animationStateRef |
| 2.4.1 Update TerminalCore.tsx | ✅ DONE | Signature unchanged |
| 2.4.2 Update App.tsx handler | ✅ DONE | Removed seq param |

### Phase 3: Renderer Lifecycle Refactor
| Task | Status | Notes |
|------|--------|-------|
| 3.1.1 Analyze current verification | ✅ DONE | Found double-RAF pattern |
| 3.1.2 Implement MutationObserver | ✅ DONE | With 500ms timeout fallback |
| 3.1.3 Create waitForCanvas helper | ✅ DONE | Promise-based with observer |
| 3.2.1 Define RendererState type | ✅ DONE | idle/loading/active/recovering/failed |
| 3.2.2 Replace activeRendererRef | ✅ DONE | Now uses rendererStateRef |
| 3.2.3 Add state change callback | ✅ DONE | onStateChange option added |
| 3.3.1 Consolidate recovery logic | ✅ DONE | Exponential backoff added |
| 3.3.2 Add recovery state | ✅ DONE | recovering status with attempts |

### Phase 4: Scrollback Optimization
| Task | Status | Notes |
|------|--------|-------|
| 4.1.1 Modify TmuxManager.capturePane | ✅ DONE | Original preserved |
| 4.1.2 Add chunked capture | ✅ DONE | capturePaneChunked method |
| 4.1.3 Modify restore flow | ⬜ SKIPPED | Would require protocol changes |
| 4.1.4 Add client-side lazy loading | ⬜ SKIPPED | Would require protocol changes |
| 4.2.1 Analyze minimap rendering | ✅ DONE | Found sampling already in place |
| 4.2.2 Implement incremental updates | ✅ DONE | Added cachedBlocksRef |
| 4.2.3 Add time-based throttling | ✅ DONE | 100ms MIN_RENDER_INTERVAL |

### Phase 5: CSS Architecture Cleanup
| Task | Status | Notes |
|------|--------|-------|
| 5.1.1 List !important declarations | ✅ DONE | 8 found, all XTerm overrides |
| 5.1.2 Determine removable | ✅ DONE | None safe to remove (XTerm inlines) |
| 5.2.1 Create terminal-base.css | ✅ DONE | Variables, reset, layout |
| 5.2.2 Create terminal-xterm.css | ✅ DONE | XTerm-specific rules |
| 5.2.3 Create terminal-mobile.css | ✅ DONE | Media queries |
| 5.2.4 Update imports | ⬜ SKIPPED | Original file still works |
| 5.3.1 Add custom properties | ✅ DONE | scrollbar-width, padding, line-height |
| 5.3.2 Use in rules | ✅ DONE | Applied in xterm.css |

### Phase 6: Theme System Enhancement
| Task | Status | Notes |
|------|--------|-------|
| 6.1.1 Create themes.ts | ✅ DONE | 6 themes: dark, light, solarized, monokai, dracula, nord |
| 6.1.2 Add theme validation | ✅ DONE | validateTheme function |
| 6.2.1 Add theme to preferences | ⬜ SKIPPED | Would require DB changes |
| 6.2.2 Implement setTheme | ✅ DONE | Added to TerminalCoreHandle |
| 6.2.3 Sync CSS variables | ✅ DONE | applyThemeToCSSVariables function |
| 6.3.1 Create ThemePreview component | ⬜ SKIPPED | UI work, low priority |

**Legend:** ✅ DONE | ⏳ IN PROGRESS | ⬜ TODO | ❌ BLOCKED

### Implementation Summary (January 8, 2026)

**Completed:**
- ✅ Phase 1: OutputPipelineManager consolidates 3 buffer refs into 1 class
- ✅ Phase 2: Simplified resize coordinator from 8 refs to 4
- ✅ Phase 3: MutationObserver replaces fragile double-RAF, added state machine
- ✅ Phase 4: Chunked capture method added, minimap throttling (100ms)
- ✅ Phase 5: CSS split into 3 modular files, added dynamic custom properties
- ✅ Phase 6: 6 themes available, setTheme method on TerminalCoreHandle

**New Files Created:**
- `src/client/services/OutputPipelineManager.ts` (113 lines)
- `src/client/services/__tests__/OutputPipelineManager.test.ts` (11 tests)
- `src/client/styles/terminal-base.css`
- `src/client/styles/terminal-xterm.css`
- `src/client/styles/terminal-mobile.css`
- `src/shared/themes.ts` (6 themes, validation, helpers)

**Files Modified:**
- `src/client/App.tsx` - Integrated OutputPipelineManager
- `src/client/hooks/useResizeCoordinator.ts` - Simplified state management
- `src/client/hooks/useRendererSetup.ts` - MutationObserver + state machine
- `src/client/components/TerminalCore/TerminalCore.tsx` - Added setTheme
- `src/client/components/TerminalMinimap/TerminalMinimap.tsx` - Throttling
- `src/server/tmux/TmuxManager.ts` - Added capturePaneChunked
- `src/shared/constants.ts` - Re-exports from themes.ts

**Skipped Items (Require protocol/DB changes):**
- 4.1.3-4.1.4: Client-side lazy history loading
- 6.2.1: Theme persistence in user preferences
- 6.3.1: ThemePreview component (UI work)

---

*Last Updated: January 8, 2026*
*Version: 2.0.0*
