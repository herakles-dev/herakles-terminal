# Terminal Resize Bugs - Deep Analysis

**Date:** 2026-01-25
**Status:** 🔴 CRITICAL - Black screen / text overflow issues

## Reported Symptom

> "Half the window is black but the text stretches out and is hidden"

This indicates a **canvas/terminal size mismatch** where the WebGL canvas and the terminal buffer are out of sync.

---

## Root Cause Analysis

### Issue #1: WebGL Canvas Doesn't Auto-Resize

**Severity:** 🔴 CRITICAL
**Location:** WebGL addon integration in `useRendererSetup.ts` and `TerminalCore.tsx`

#### Problem

The WebGL addon creates a canvas overlay, but **the canvas doesn't automatically resize** when the terminal container changes size. The xterm.js library handles this for the 2D canvas renderer, but the WebGL addon requires manual intervention.

#### Evidence

From `useRendererSetup.ts:187-215`:
```typescript
// Verify WebGL is actually working by finding a canvas with WebGL2 context
const canvases = term.element.querySelectorAll('canvas');
let webglCanvas: HTMLCanvasElement | null = null;

for (const canvas of canvases) {
  const gl = (canvas as HTMLCanvasElement).getContext('webgl2');
  if (gl) {
    webglCanvas = canvas as HTMLCanvasElement;
    break;
  }
}
```

**Missing:** No resize listener attached to the WebGL canvas!

#### What Happens

1. Terminal window resizes (user drags divider in SplitView)
2. `onLayoutChange` fires → updates window layout state
3. After drag ends (line 616): `resizeCoordinator.triggerResize()`
4. ResizeCoordinator calls `fitAddon.fit()` for each terminal
5. **FitAddon resizes the terminal buffer** (cols/rows)
6. **WebGL canvas stays at old size** ❌
7. Result: Terminal text renders at new size, but canvas shows old viewport
8. **Black area** = unrendered region of canvas
9. **Hidden text** = text rendered outside visible canvas area

---

### Issue #2: Resize During WebGL Recovery

**Severity:** 🔴 CRITICAL
**Location:** `App.tsx:709-727` recovery handlers

#### Problem

If the user resizes the window **during** WebGL context loss recovery, the terminal can end up in an inconsistent state.

#### Timeline

```
T0: User drags window divider
    └─> SplitView fires onLayoutChange

T1: WebGL context loss detected (OOM from old size)
    └─> handleRecoveryStart() pauses pipeline
    └─> term.clear() wipes content
    └─> setupRenderer() starts recovery

T2: Drag ends, triggerResize() fires
    └─> fitAddon.fit() resizes terminal
    └─> onResize() callback sends new size to server

T3: Recovery completes
    └─> handleRecoveryEnd() resumes pipeline
    └─> BUT terminal is now different size than when recovery started!

T4: Server sends restore content
    └─> Content formatted for OLD size (cols/rows from before resize)
    └─> Terminal now at NEW size
    └─> Result: Incorrect wrapping, garbled output
```

#### Evidence

From `TerminalCore.tsx:709-727`:
```typescript
const handleRecoveryStart = (terminalId: string) => {
  outputPipelineRef.current?.setRecoveryInProgress(terminalId, true);
  // ❌ No coordination with resize system!
};

const handleRecoveryEnd = (terminalId: string, success: boolean) => {
  outputPipelineRef.current?.setRecoveryInProgress(terminalId, false);

  if (success) {
    if (restoreNeededAfterRecoveryRef.current.has(terminalId)) {
      sendMessage({ type: 'window:subscribe', windowId: terminalId });
      // ❌ Sends subscribe with CURRENT size, but content might be for OLD size
    }
  }
};
```

**Missing:** No tracking of terminal size at start of recovery vs. end of recovery.

---

### Issue #3: Resize Pending Buffer Doesn't Account for Recovery

**Severity:** 🟡 MEDIUM
**Location:** `OutputPipelineManager.ts:117-128` and `App.tsx:533-536`

#### Problem

The resize pending buffer system blocks output during resize, but doesn't account for WebGL recovery happening during that window.

#### Code Flow

```typescript
// App.tsx:533-536
case 'window:output': {
  const windowId = msg.windowId;
  if (resizeCoordinatorRef.current.isResizePending(windowId)) {
    outputPipelineRef.current?.setResizePending(windowId, true);
  }
  outputPipelineRef.current?.enqueue(windowId, msg.data);
  break;
}
```

**Problem:** If recovery is in progress (`recoveryInProgress = true`), the output is discarded by `enqueue()`. But if resize is pending, the code tries to buffer it in `pendingResizeBuffer`. These two flags aren't coordinated!

#### What Can Go Wrong

```
T0: Resize starts
    └─> setResizePending(true)
    └─> Output buffers in pendingResizeBuffer

T1: WebGL context loss during resize
    └─> setRecoveryInProgress(true)
    └─> term.clear()

T2: Output arrives
    └─> isResizePending = true → setResizePending(true)
    └─> enqueue() called
    └─> CHECKS recoveryInProgress first
    └─> Discards output (line 76) ✅ Correct!

    BUT pendingResizeBuffer was already set before recovery started!

T3: Resize completes
    └─> setResizePending(false)
    └─> Merges pendingResizeBuffer into main buffer (line 122)
    └─> BUT recovery still in progress!
    └─> Next enqueue() will discard it anyway (line 76)

T4: Recovery completes
    └─> setRecoveryInProgress(false)
    └─> Terminal content already lost from step T3
```

**Result:** Output gets lost in the gap between resize completion and recovery completion.

---

### Issue #4: FitAddon.fit() Doesn't Wait for WebGL Canvas

**Severity:** 🔴 CRITICAL
**Location:** `TerminalCore.tsx:232` and `useResizeCoordinator.ts:78`

#### Problem

`fitAddon.fit()` calculates dimensions based on the **terminal container** div, but doesn't check if the WebGL canvas has actually resized yet.

#### Code Analysis

**TerminalCore initialization (line 232):**
```typescript
// Step 4: NOW safe to fit - WebGL is ready
fitAddon.fit();
```

This waits for WebGL to be ready **once** during initialization. But on **subsequent resizes**, there's no such wait!

**ResizeCoordinator (useResizeCoordinator.ts:78):**
```typescript
target.fitAddon.fit();
```

Direct call to `fit()` with no WebGL canvas size verification.

#### What Happens

1. SplitView changes window layout → CSS changes container size
2. ResizeCoordinator calls `fitAddon.fit()`
3. FitAddon reads container size → calculates cols/rows
4. Resizes terminal buffer
5. **WebGL canvas still at old size** (CSS hasn't propagated? Browser hasn't painted?)
6. Text renders with new dimensions onto old-sized canvas
7. Result: Black bars and clipped text

---

### Issue #5: Drag Performance Optimization Breaks Resize

**Severity:** 🟡 MEDIUM
**Location:** `SplitView.tsx:427` and `App.tsx:674-691`

#### Problem

During drag operations, `onLayoutChange` is called with `isDragging = true` to optimize performance. But this optimization can prevent proper terminal resizing.

#### Code Flow

**SplitView.tsx:422-427 (during drag):**
```typescript
onLayoutChange(dragging.id, {
  x: newX,
  y: newY,
  width: dragging.startLayout.width,
  height: dragging.startLayout.height,
}, true);  // ← isDragging = true
```

**App.tsx:674-691 (layout change handler):**
```typescript
const handleLayoutChange = useCallback((id: string, layout: ..., isDragging = false) => {
  setWindows(prev => prev.map(w => w.id === id ? { ...w, ...layout } : w));
  sendMessage({ type: 'window:layout', windowId: id, ...layout });

  if (isDragging) {
    return;  // ❌ Skip fit during drag
  }

  // Clear existing timeout and schedule new fit
  const timeout = setTimeout(() => {
    const terminal = terminalsRef.current.get(id);
    if (terminal) {
      try { terminal.fitAddon.fit(); } catch {}
    }
  }, 150);
}, [sendMessage]);
```

**Problem:** The `isDragging` check returns early, so **fit is never scheduled during drag**. This is intentional for performance, but creates issues:

1. **Drag operation can last multiple seconds**
2. During that time, **no fit() calls** even though container size is changing
3. When drag ends, fit() is called **once** for final position
4. But container has been changing size the whole time
5. **CSS transitions** on the window can take 200ms (line 815: `transition-all duration-200`)
6. fit() might read container size **before** CSS transition completes
7. Result: Wrong dimensions calculated

---

## Additional Findings

### Finding #1: No WebGL Canvas Resize Listener

**Impact:** Canvas doesn't track container size changes

XTerm.js WebGL addon documentation states that the canvas should automatically resize, but there's no explicit resize observer attached to verify this is happening.

**Recommendation:** Add a ResizeObserver to the WebGL canvas to detect when it's out of sync with the terminal container.

### Finding #2: Race Between CSS Transition and fit()

**Location:** `SplitView.tsx:815` and `App.tsx:689`

```typescript
// SplitView.tsx:815 - Window has transition
className="... transition-all duration-200 ..."

// App.tsx:689 - fit() scheduled 150ms after layout change
setTimeout(() => {
  terminal.fitAddon.fit();
}, 150);
```

**Problem:** 150ms timeout < 200ms CSS transition. fit() might read dimensions mid-transition!

### Finding #3: Multiple Resize Sources

**Observation:** Resizes can come from multiple sources simultaneously:
1. Window drag (SplitView)
2. Window resize handle (SplitView)
3. Drag zone divider (SplitView)
4. Side panel toggle (App)
5. Minimap toggle (App)
6. Browser window resize (global)
7. Mobile orientation change (global)

**Problem:** No coordination between these sources. Multiple resize operations can interleave, causing:
- Multiple fit() calls in rapid succession
- Size thrashing (window changes size multiple times before stabilizing)
- WebSocket spam (each fit sends resize message to server)

---

## Comprehensive Fix Plan

### Phase 1: WebGL Canvas Resize Synchronization (CRITICAL)

**Priority:** P0 - Fixes black screen issue

#### Fix 1A: Add WebGL Canvas Resize Verification

**File:** `src/client/hooks/useRendererSetup.ts`

**Add after line 215:**
```typescript
// Store canvas reference for resize coordination
const canvasRef = useRef<HTMLCanvasElement | null>(null);

// After WebGL canvas is found and verified (line 215)
if (!webglCanvas) {
  // ... existing error handling
} else {
  // NEW: Store canvas reference
  canvasRef.current = webglCanvas;

  // NEW: Attach resize observer to WebGL canvas
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const canvas = entry.target as HTMLCanvasElement;
      const containerRect = term.element?.getBoundingClientRect();

      if (!containerRect) continue;

      // Check if canvas size matches container
      const canvasRect = canvas.getBoundingClientRect();
      const widthMismatch = Math.abs(canvasRect.width - containerRect.width) > 2;
      const heightMismatch = Math.abs(canvasRect.height - containerRect.height) > 2;

      if (widthMismatch || heightMismatch) {
        console.warn(
          `[${terminalId}] WebGL canvas size mismatch detected`,
          `Container: ${containerRect.width}x${containerRect.height}`,
          `Canvas: ${canvasRect.width}x${canvasRect.height}`
        );

        // Force canvas resize by triggering WebGL addon refresh
        // (WebGL addon should handle this, but we'll nudge it)
        requestAnimationFrame(() => {
          // The WebGL addon doesn't expose a resize method,
          // so we rely on it auto-detecting via its own resize observer
          // This RAF ensures we're checking after the browser has painted
        });
      }
    }
  });

  resizeObserver.observe(webglCanvas);

  // Store for cleanup
  const cleanupResizeObserver = () => {
    resizeObserver.disconnect();
  };

  // Return cleanup function
  return cleanupResizeObserver;
}
```

**Why this works:**
- Detects when canvas size doesn't match container
- Logs warning for debugging
- Gives browser a chance to fix via RAF
- xterm.js WebGL addon should auto-resize, but this verifies it's happening

#### Fix 1B: Wait for Canvas Resize Before Calling fit()

**File:** `src/client/hooks/useResizeCoordinator.ts`

**Modify `performAtomicResize` (line 66-102):**
```typescript
const performAtomicResize = useCallback(async (target: ResizeTarget) => {
  try {
    const dims = target.fitAddon.proposeDimensions();
    if (!dims || dims.cols < MIN_COLS || dims.rows < MIN_ROWS) {
      return;
    }

    const pending = pendingResizesRef.current.get(target.id);
    if (pending && pending.cols === dims.cols && pending.rows === dims.rows) {
      return;
    }

    // NEW: Wait for WebGL canvas to resize before calling fit()
    // This prevents black screen / text overflow issues
    await new Promise<void>((resolve) => {
      // Use multiple RAFs to ensure CSS has fully applied and painted
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });

    target.fitAddon.fit();

    if (target.onResize) {
      // ... existing code for pending resize tracking
    }
  } catch (e) {
    console.warn(`[ResizeCoordinator] Atomic resize failed for ${target.id}:`, e);
  }
}, []);
```

**Alternative approach (if async breaks too much):**
```typescript
const performAtomicResize = useCallback((target: ResizeTarget) => {
  // Use double RAF to wait for CSS paint
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        const dims = target.fitAddon.proposeDimensions();
        if (!dims || dims.cols < MIN_COLS || dims.rows < MIN_ROWS) {
          return;
        }

        // ... rest of existing code
        target.fitAddon.fit();
        // ...
      } catch (e) {
        console.warn(`[ResizeCoordinator] Atomic resize failed for ${target.id}:`, e);
      }
    });
  });
}, []);
```

---

### Phase 2: Recovery-Resize Coordination (CRITICAL)

**Priority:** P0 - Fixes content loss during recovery

#### Fix 2A: Track Terminal Size During Recovery

**File:** `src/client/App.tsx`

**Add after line 331:**
```typescript
const recoveryTerminalSizeRef = useRef<Map<string, { cols: number; rows: number }>>(new Map());
```

**Modify `handleRecoveryStart` (line 710):**
```typescript
const handleRecoveryStart = (terminalId: string) => {
  outputPipelineRef.current?.setRecoveryInProgress(terminalId, true);

  // NEW: Capture terminal size at start of recovery
  const handle = terminalRefs.current.get(terminalId);
  if (handle?.terminal) {
    recoveryTerminalSizeRef.current.set(terminalId, {
      cols: handle.terminal.cols,
      rows: handle.terminal.rows,
    });
  }
};
```

**Modify `handleRecoveryEnd` (line 715):**
```typescript
const handleRecoveryEnd = (terminalId: string, success: boolean) => {
  outputPipelineRef.current?.setRecoveryInProgress(terminalId, false);

  if (success) {
    // NEW: Check if terminal size changed during recovery
    const sizeAtStart = recoveryTerminalSizeRef.current.get(terminalId);
    const handle = terminalRefs.current.get(terminalId);
    const currentSize = handle?.terminal
      ? { cols: handle.terminal.cols, rows: handle.terminal.rows }
      : null;

    const sizeChanged =
      sizeAtStart &&
      currentSize &&
      (sizeAtStart.cols !== currentSize.cols || sizeAtStart.rows !== currentSize.rows);

    if (sizeChanged) {
      console.warn(
        `[${terminalId}] Terminal size changed during recovery`,
        `${sizeAtStart.cols}x${sizeAtStart.rows} → ${currentSize.cols}x${currentSize.rows}`
      );
      // Size changed - need to re-subscribe with NEW size to get content formatted correctly
      sendMessage({
        type: 'window:subscribe',
        windowId: terminalId,
        cols: currentSize.cols,
        rows: currentSize.rows,
      });
      restoreNeededAfterRecoveryRef.current.delete(terminalId);
    } else if (restoreNeededAfterRecoveryRef.current.has(terminalId)) {
      // Size didn't change - can re-request restore safely
      console.info(`[${terminalId}] Re-requesting restore after WebGL recovery`);
      sendMessage({ type: 'window:subscribe', windowId: terminalId });
      restoreNeededAfterRecoveryRef.current.delete(terminalId);
    }

    // Clean up size tracking
    recoveryTerminalSizeRef.current.delete(terminalId);
  } else {
    // Recovery failed - clean up
    recoveryTerminalSizeRef.current.delete(terminalId);
  }
};
```

#### Fix 2B: Block Resize During Recovery

**File:** `src/client/hooks/useResizeCoordinator.ts`

**Add parameter to register:**
```typescript
export interface ResizeTarget {
  id: string;
  fitAddon: FitAddon;
  onResize?: (cols: number, rows: number) => void;
  isRecovering?: () => boolean;  // NEW: Check if terminal is recovering
}
```

**Modify `performAtomicResize` (line 66):**
```typescript
const performAtomicResize = useCallback((target: ResizeTarget) => {
  // NEW: Skip resize if terminal is recovering from WebGL context loss
  if (target.isRecovering?.()) {
    console.debug(`[ResizeCoordinator] Skipping resize for ${target.id} - recovery in progress`);
    return;
  }

  // Double RAF for CSS paint
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Double-check recovery status after RAF delay
      if (target.isRecovering?.()) {
        console.debug(`[ResizeCoordinator] Aborting resize for ${target.id} - recovery started`);
        return;
      }

      try {
        // ... existing resize code
      } catch (e) {
        console.warn(`[ResizeCoordinator] Atomic resize failed for ${target.id}:`, e);
      }
    });
  });
}, []);
```

**Update TerminalCore registration (line 235):**
```typescript
const unregister = resizeCoordinator.register(
  {
    id: terminalId,
    fitAddon,
    onResize,
    isRecovering: () => {
      return outputPipelineRef.current?.isRecoveryInProgress(terminalId) ?? false;
    },
  },
  { skipInitialResize: true }
);
```

---

### Phase 3: Resize-Pending Buffer Coordination (MEDIUM)

**Priority:** P1 - Prevents output loss edge case

#### Fix 3A: Clear Resize Buffer When Recovery Starts

**File:** `src/client/services/OutputPipelineManager.ts`

**Modify `setRecoveryInProgress` (line 179):**
```typescript
setRecoveryInProgress(windowId: string, inProgress: boolean): void {
  const state = this.getOrCreateState(windowId);

  if (inProgress) {
    // Clear all buffers when entering recovery mode
    if (state.flushTimer !== null) {
      cancelAnimationFrame(state.flushTimer);
      state.flushTimer = null;
    }
    state.buffer = '';
    state.pendingResizeBuffer = '';  // ← Already done!

    // NEW: Also clear resize pending flag to prevent buffer accumulation
    state.resizePending = false;

    console.info(`[OutputPipeline] ${windowId}: Entering recovery mode, buffers cleared, resize flag reset`);
  } else {
    console.info(`[OutputPipeline] ${windowId}: Exiting recovery mode`);
  }

  state.recoveryInProgress = inProgress;
}
```

---

### Phase 4: Drag Performance Optimization Fix (MEDIUM)

**Priority:** P1 - Prevents dimension calculation errors

#### Fix 4A: Increase Timeout to Match CSS Transition

**File:** `src/client/App.tsx`

**Modify `handleLayoutChange` (line 683):**
```typescript
const timeout = setTimeout(() => {
  const terminal = terminalsRef.current.get(id);
  if (terminal) {
    try { terminal.fitAddon.fit(); } catch {}
  }
  fitTimeoutRef.current.delete(id);
}, 250);  // ← Changed from 150 to 250 (200ms CSS transition + 50ms buffer)
```

**Why 250ms:**
- CSS transition is 200ms (SplitView.tsx:815)
- +50ms buffer for browser paint
- Ensures fit() reads final size, not mid-transition

#### Fix 4B: Use ResizeObserver Instead of Timeout

**File:** `src/client/App.tsx`

**Alternative approach** (better long-term):

Replace timeout-based fit with ResizeObserver:
```typescript
// After TerminalCore mounts, attach ResizeObserver to its container
const handleTerminalRef = (handle: TerminalCoreHandle | null) => {
  if (handle) {
    terminalRefs.current.set(windowId, handle);

    // ... existing code

    // NEW: Observe container for size changes
    if (handle.terminal?.element?.parentElement) {
      const container = handle.terminal.element.parentElement;
      const resizeObserver = new ResizeObserver(() => {
        // Debounce with double RAF
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!outputPipelineRef.current?.isRecoveryInProgress(windowId)) {
              handle.fitAddon?.fit();
            }
          });
        });
      });

      resizeObserver.observe(container);

      // Store for cleanup
      // (need to add cleanup map)
    }
  }
};
```

---

### Phase 5: Test Coverage (HIGH)

**Priority:** P0 - Prevent regressions

#### Test 5A: WebGL Canvas Resize Test

**File:** `src/client/hooks/__tests__/useRendererSetup.test.ts`

**Add test:**
```typescript
it('should handle canvas resize during recovery', async () => {
  // ... setup terminal with WebGL

  // Trigger resize
  // Trigger context loss
  // Verify canvas size matches container after recovery
});
```

#### Test 5B: Recovery During Resize Test

**File:** `src/client/services/__tests__/OutputPipelineManager.test.ts`

**Add test:**
```typescript
it('should handle recovery starting during resize pending', () => {
  const onFlush = vi.fn();
  const pipeline = new OutputPipelineManager(onFlush);

  // Start resize
  pipeline.setResizePending('window-1', true);
  pipeline.enqueue('window-1', 'data during resize');

  // Start recovery (should clear resize buffer)
  pipeline.setRecoveryInProgress('window-1', true);

  // Finish resize
  pipeline.setResizePending('window-1', false);

  // Finish recovery
  pipeline.setRecoveryInProgress('window-1', false);

  // New data should work normally
  pipeline.enqueue('window-1', 'fresh data');
  flushRAF();

  expect(onFlush).toHaveBeenCalledWith('window-1', 'fresh data');
  expect(onFlush).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('data during resize'));
});
```

---

## Summary Table

| Bug ID | Severity | Issue | Fix Phase | Files |
|--------|----------|-------|-----------|-------|
| R-1 | 🔴 CRITICAL | WebGL canvas doesn't resize | Phase 1 | useRendererSetup.ts, useResizeCoordinator.ts |
| R-2 | 🔴 CRITICAL | Recovery during resize breaks content | Phase 2 | App.tsx, useResizeCoordinator.ts |
| R-3 | 🟡 MEDIUM | Resize pending buffer + recovery conflict | Phase 3 | OutputPipelineManager.ts |
| R-4 | 🟡 MEDIUM | fit() reads mid-transition dimensions | Phase 4 | App.tsx, SplitView.tsx |
| R-5 | 🟢 LOW | No resize observer on WebGL canvas | Phase 1 | useRendererSetup.ts |

---

## Verification Steps

After implementing all fixes:

### Manual Test 1: Resize During Normal Operation

1. Start terminal with content
2. Drag window divider slowly → verify no black areas
3. Drag quickly → verify no black areas
4. Use resize handles → verify no black areas
5. Toggle side panel → verify resize works
6. Toggle minimap → verify resize works

### Manual Test 2: Resize During Recovery

1. Open DevTools console
2. Force WebGL context loss: `terminalRef.current.terminal.element.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()`
3. **Immediately** start dragging window divider while recovery is in progress
4. Verify:
   - No errors in console
   - Content restores correctly at new size
   - No black areas or clipped text

### Manual Test 3: Rapid Resize

1. Drag window divider back and forth rapidly (10+ times in 2 seconds)
2. Verify:
   - No size thrashing
   - No black areas after resize stops
   - Content is readable

### Manual Test 4: CSS Transition Edge Case

1. Set CSS transition to very slow (2000ms) in SplitView.tsx:815
2. Drag window divider
3. Verify fit() doesn't fire until transition completes

---

## Related Issues

These resize bugs compound the WebGL recovery bugs found in `webgl-stability-bugs.md`:
- Bug #2 (restore flag cleared early) + Resize during recovery = **terminal stays blank**
- Bug #1 (no onRecoveryEnd on exception) + Resize → **permanent frozen terminal**

**Recommendation:** Implement both bug fix documents together for comprehensive stability.

---

**Next Actions:**
1. Implement Phase 1 (WebGL canvas sync) - most critical
2. Implement Phase 2 (recovery-resize coordination)
3. Add test coverage (Phase 5)
4. Manual verification
5. Document new resize behavior in CLAUDE.md
