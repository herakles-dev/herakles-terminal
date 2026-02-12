# Comprehensive WebGL Terminal Stability Fix Plan

**Date:** 2026-01-25
**Status:** 🔴 CRITICAL BUGS FOUND - Comprehensive Fix Required
**Scope:** WebGL stability + Resize coordination

---

## Executive Summary

Deep analysis revealed **7 critical bugs** across two systems:
1. **WebGL Recovery System** (3 bugs) - Terminal freezes permanently
2. **Resize Coordination System** (4 bugs) - Black screen / text overflow

These bugs **compound each other**, creating cascading failures where resize during recovery leaves terminals in broken states.

---

## Critical Bugs Overview

| ID | System | Severity | Symptom | Impact |
|----|----|----------|---------|--------|
| **WG-1** | Recovery | 🔴 CRITICAL | Exception during recovery doesn't resume pipeline | Terminal freezes permanently |
| **WG-2** | Recovery | 🔴 CRITICAL | Restore flag cleared too early | Blank terminal after recovery |
| **WG-3** | Recovery | 🟡 MEDIUM | Pending restore timeout coordination | Content lost on slow mount |
| **RS-1** | Resize | 🔴 CRITICAL | WebGL canvas doesn't auto-resize | Black screen / text overflow |
| **RS-2** | Resize | 🔴 CRITICAL | Resize during recovery breaks content | Garbled output after recovery |
| **RS-3** | Resize | 🟡 MEDIUM | Resize buffer + recovery conflict | Output lost in edge case |
| **RS-4** | Resize | 🟡 MEDIUM | fit() reads mid-transition dimensions | Wrong terminal size |

---

## Cascading Failure Example

**What user experiences:**

1. User drags window divider to resize terminal
2. During drag, WebGL runs out of memory → context loss
3. **Bug RS-2:** Size changes during recovery
4. **Bug WG-2:** Restore flag cleared before context loss
5. **Bug RS-1:** WebGL canvas stuck at old size
6. **Bug WG-1:** Recovery throws exception, pipeline stays paused
7. **Result:** Black screen, frozen terminal, no recovery possible

---

## Implementation Strategy

### Approach: Surgical Fixes in Dependency Order

**Phase 1 (P0 - Day 1):**
- Fix WG-1: Add onRecoveryEnd call on exception
- Fix RS-1: Add double RAF to resize coordinator
- Add critical test coverage

**Phase 2 (P0 - Day 2):**
- Fix WG-2: Keep restore flag until after recovery
- Fix RS-2: Block resize during recovery
- Add recovery-resize integration tests

**Phase 3 (P1 - Day 3):**
- Fix WG-3: Check recovery status in timeout
- Fix RS-3: Clear resize buffer on recovery start
- Fix RS-4: Increase timeout to 250ms
- Full test suite

**Phase 4 (P1 - Day 4):**
- Manual verification
- Performance testing
- Documentation updates

---

## Detailed Fixes

### Fix WG-1: Recovery Exception Handler

**File:** `src/client/hooks/useRendererSetup.ts:231-237`

**Current:**
```typescript
} catch (e) {
  const errorMsg = e instanceof Error ? e.message : String(e);
  const error = `WebGL init failed: ${errorMsg}`;
  console.error(`[${terminalId}] WebGL initialization failed:`, e);
  setState({ status: 'failed', lastError: error });
  return { success: false, rendererType: null, error };
  // ❌ Missing onRecoveryEnd call!
}
```

**Fixed:**
```typescript
} catch (e) {
  const errorMsg = e instanceof Error ? e.message : String(e);
  const error = `WebGL init failed: ${errorMsg}`;
  console.error(`[${terminalId}] WebGL initialization failed:`, e);
  setState({ status: 'failed', lastError: error });

  // FIX: Notify recovery failed so pipeline can resume
  if (isRecovery) {
    onRecoveryEnd?.(terminalId, false);
  }

  return { success: false, rendererType: null, error };
}
```

**Impact:** Terminal no longer freezes on recovery exception. Pipeline resumes, output works.

---

### Fix RS-1: Wait for Canvas Paint Before fit()

**File:** `src/client/hooks/useResizeCoordinator.ts:66-102`

**Current:**
```typescript
const performAtomicResize = useCallback((target: ResizeTarget) => {
  try {
    const dims = target.fitAddon.proposeDimensions();
    if (!dims || dims.cols < MIN_COLS || dims.rows < MIN_ROWS) {
      return;
    }
    target.fitAddon.fit();  // ❌ Immediate fit, canvas might not be resized yet
    // ...
  } catch (e) {
    console.warn(`[ResizeCoordinator] Atomic resize failed for ${target.id}:`, e);
  }
}, []);
```

**Fixed:**
```typescript
const performAtomicResize = useCallback((target: ResizeTarget) => {
  // Wait for CSS paint with double RAF
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        const dims = target.fitAddon.proposeDimensions();
        if (!dims || dims.cols < MIN_COLS || dims.rows < MIN_ROWS) {
          return;
        }

        const pending = pendingResizesRef.current.get(target.id);
        if (pending && pending.cols === dims.cols && pending.rows === dims.rows) {
          return;
        }

        target.fitAddon.fit();

        if (target.onResize) {
          const existingPending = pendingResizesRef.current.get(target.id);
          if (existingPending) {
            clearTimeout(existingPending.timeoutId);
          }

          const timeoutId = setTimeout(() => {
            pendingResizesRef.current.delete(target.id);
          }, RESIZE_TIMEOUT_MS);

          pendingResizesRef.current.set(target.id, {
            cols: dims.cols,
            rows: dims.rows,
            expiresAt: Date.now() + RESIZE_TIMEOUT_MS,
            timeoutId,
          });

          target.onResize(dims.cols, dims.rows);
        }
      } catch (e) {
        console.warn(`[ResizeCoordinator] Atomic resize failed for ${target.id}:`, e);
      }
    });
  });
}, []);
```

**Impact:** WebGL canvas has time to resize. No more black screen / text overflow.

---

### Fix WG-2: Keep Restore Flag Until After Recovery

**File:** `src/client/App.tsx:484-498, 720-725`

**Current:**
```typescript
// Line 493-499
terminal.write(msg.data, () => {
  terminal.scrollToBottom();
  // ❌ Cleared immediately after write completes
  outputPipelineRef.current?.setRestoreInProgress(msg.windowId, false);
  restoreNeededAfterRecoveryRef.current.delete(msg.windowId);  // ❌ Too early!
});

// Line 720-725
if (success) {
  if (restoreNeededAfterRecoveryRef.current.has(terminalId)) {
    sendMessage({ type: 'window:subscribe', windowId: terminalId });
    restoreNeededAfterRecoveryRef.current.delete(terminalId);  // ✅ Good
  }
}
```

**Fixed:**
```typescript
// Line 493-499
terminal.write(msg.data, () => {
  terminal.scrollToBottom();
  outputPipelineRef.current?.setRestoreInProgress(msg.windowId, false);

  // FIX: Don't clear flag here - recovery might happen after write completes
  // Flag will be cleared in handleRecoveryEnd after re-request is sent
  // restoreNeededAfterRecoveryRef.current.delete(msg.windowId);  // ❌ REMOVED
});

// Line 720-725 (no change - this is correct)
if (success) {
  if (restoreNeededAfterRecoveryRef.current.has(terminalId)) {
    console.info(`[${terminalId}] Re-requesting restore after WebGL recovery`);
    sendMessage({ type: 'window:subscribe', windowId: terminalId });
    restoreNeededAfterRecoveryRef.current.delete(terminalId);  // ✅ Clear AFTER re-request
  }
}
```

**Impact:** Terminal content restores correctly after WebGL context loss.

---

### Fix RS-2: Block Resize During Recovery

**File:** `src/client/hooks/useResizeCoordinator.ts:66` + `src/client/App.tsx:709-727`

**Step 1: Add isRecovering callback to ResizeTarget**

**File:** `src/client/hooks/useResizeCoordinator.ts:5-9`

```typescript
export interface ResizeTarget {
  id: string;
  fitAddon: FitAddon;
  onResize?: (cols: number, rows: number) => void;
  isRecovering?: () => boolean;  // NEW
}
```

**Step 2: Check recovery status before resize**

**File:** `src/client/hooks/useResizeCoordinator.ts:66`

```typescript
const performAtomicResize = useCallback((target: ResizeTarget) => {
  // NEW: Skip resize if terminal is recovering
  if (target.isRecovering?.()) {
    console.debug(`[ResizeCoordinator] Skipping resize for ${target.id} - recovery in progress`);
    return;
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Double-check after RAF delay
      if (target.isRecovering?.()) {
        console.debug(`[ResizeCoordinator] Aborting resize for ${target.id} - recovery started during RAF`);
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

**Step 3: Track size changes during recovery**

**File:** `src/client/App.tsx` (add after line 331)

```typescript
const recoveryTerminalSizeRef = useRef<Map<string, { cols: number; rows: number }>>(new Map());
```

**Step 4: Capture size at recovery start**

**File:** `src/client/App.tsx:710`

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

**Step 5: Detect size change and re-request with correct dimensions**

**File:** `src/client/App.tsx:715`

```typescript
const handleRecoveryEnd = (terminalId: string, success: boolean) => {
  outputPipelineRef.current?.setRecoveryInProgress(terminalId, false);

  if (success) {
    // NEW: Check if size changed during recovery
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
        `[${terminalId}] Terminal size changed during recovery: ${sizeAtStart.cols}x${sizeAtStart.rows} → ${currentSize.cols}x${currentSize.rows}`
      );
      // Re-subscribe with NEW size
      sendMessage({
        type: 'window:subscribe',
        windowId: terminalId,
        cols: currentSize.cols,
        rows: currentSize.rows,
      });
      restoreNeededAfterRecoveryRef.current.delete(terminalId);
    } else if (restoreNeededAfterRecoveryRef.current.has(terminalId)) {
      // Size unchanged - safe to restore
      console.info(`[${terminalId}] Re-requesting restore after WebGL recovery`);
      sendMessage({ type: 'window:subscribe', windowId: terminalId });
      restoreNeededAfterRecoveryRef.current.delete(terminalId);
    }

    recoveryTerminalSizeRef.current.delete(terminalId);
  } else {
    recoveryTerminalSizeRef.current.delete(terminalId);
  }
};
```

**Step 6: Pass isRecovering to resize coordinator**

**File:** `src/client/components/TerminalCore/TerminalCore.tsx:235`

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

**Impact:** Terminal content formats correctly even if window resizes during recovery.

---

### Fix WG-3: Check Recovery in Timeout

**File:** `src/client/App.tsx:508-515`

**Current:**
```typescript
setTimeout(() => {
  if (pendingRestoreRef.current.has(msg.windowId)) {
    console.warn(`Restore timeout - clearing pending restore`);
    pendingRestoreRef.current.delete(msg.windowId);
    outputPipelineRef.current?.setRestoreInProgress(msg.windowId, false);
    restoreNeededAfterRecoveryRef.current.delete(msg.windowId);  // ❌ Will be missing from WG-2 fix
  }
}, 5000);
```

**Fixed:**
```typescript
setTimeout(() => {
  if (pendingRestoreRef.current.has(msg.windowId)) {
    // FIX: Don't clear if recovery is in progress
    if (!outputPipelineRef.current?.isRecoveryInProgress(msg.windowId)) {
      console.warn(`[${msg.windowId}] Restore timeout - clearing pending restore`);
      pendingRestoreRef.current.delete(msg.windowId);
      outputPipelineRef.current?.setRestoreInProgress(msg.windowId, false);
      // Note: No longer need to delete from restoreNeededAfterRecoveryRef (per WG-2 fix)
    } else {
      console.info(`[${msg.windowId}] Restore timeout but recovery in progress - keeping buffer`);
    }
  }
}, 5000);
```

**Impact:** Slow mounts don't lose content during recovery.

---

### Fix RS-3: Clear Resize Buffer on Recovery

**File:** `src/client/services/OutputPipelineManager.ts:179`

**Current:**
```typescript
setRecoveryInProgress(windowId: string, inProgress: boolean): void {
  const state = this.getOrCreateState(windowId);

  if (inProgress) {
    if (state.flushTimer !== null) {
      cancelAnimationFrame(state.flushTimer);
      state.flushTimer = null;
    }
    state.buffer = '';
    state.pendingResizeBuffer = '';  // ✅ Already done
    console.info(`[OutputPipeline] ${windowId}: Entering recovery mode, buffers cleared`);
  } else {
    console.info(`[OutputPipeline] ${windowId}: Exiting recovery mode`);
  }

  state.recoveryInProgress = inProgress;
}
```

**Fixed:**
```typescript
setRecoveryInProgress(windowId: string, inProgress: boolean): void {
  const state = this.getOrCreateState(windowId);

  if (inProgress) {
    if (state.flushTimer !== null) {
      cancelAnimationFrame(state.flushTimer);
      state.flushTimer = null;
    }
    state.buffer = '';
    state.pendingResizeBuffer = '';

    // NEW: Also clear resize pending flag
    state.resizePending = false;

    console.info(`[OutputPipeline] ${windowId}: Entering recovery mode, buffers cleared, resize flag reset`);
  } else {
    console.info(`[OutputPipeline] ${windowId}: Exiting recovery mode`);
  }

  state.recoveryInProgress = inProgress;
}
```

**Impact:** Output doesn't get lost in resize buffer during recovery.

---

### Fix RS-4: Match Timeout to CSS Transition

**File:** `src/client/App.tsx:689`

**Current:**
```typescript
const timeout = setTimeout(() => {
  const terminal = terminalsRef.current.get(id);
  if (terminal) {
    try { terminal.fitAddon.fit(); } catch {}
  }
  fitTimeoutRef.current.delete(id);
}, 150);  // ❌ Too short - CSS transition is 200ms
```

**Fixed:**
```typescript
const timeout = setTimeout(() => {
  const terminal = terminalsRef.current.get(id);
  if (terminal) {
    try { terminal.fitAddon.fit(); } catch {}
  }
  fitTimeoutRef.current.delete(id);
}, 250);  // ✅ 200ms CSS transition + 50ms safety buffer
```

**Impact:** fit() reads correct final dimensions, not mid-transition.

---

## Testing Strategy

### Unit Tests (New)

**File:** `src/client/hooks/__tests__/useRendererSetup.test.ts`

```typescript
it('should call onRecoveryEnd on exception during recovery', async () => {
  const onRecoveryEnd = vi.fn();
  const { result } = renderHook(() =>
    useRendererSetup({ onRecoveryEnd })
  );

  // Setup WebGL successfully first
  await result.current.setupRenderer(mockTerminal as XTerm);

  // Trigger context loss
  const addonInstance = (WebglAddon as any).mock.results[0].value;
  const contextLossCallback = addonInstance.onContextLoss.mock.calls[0][0];

  // Mock setupRenderer to throw during recovery
  vi.spyOn(result.current, 'setupRenderer').mockRejectedValue(new Error('Recovery failed'));

  // Trigger context loss
  contextLossCallback();

  // Wait for recovery attempt
  await vi.advanceTimersByTimeAsync(100);

  // Verify onRecoveryEnd was called with failure
  expect(onRecoveryEnd).toHaveBeenCalledWith(expect.any(String), false);
});
```

**File:** `src/client/services/__tests__/OutputPipelineManager.test.ts`

```typescript
it('should clear resize pending flag when entering recovery mode', () => {
  const onFlush = vi.fn();
  const pipeline = new OutputPipelineManager(onFlush);

  // Start resize
  pipeline.setResizePending('window-1', true);
  expect(pipeline.isResizePending('window-1')).toBe(true);

  // Enter recovery - should clear resize flag
  pipeline.setRecoveryInProgress('window-1', true);
  expect(pipeline.isResizePending('window-1')).toBe(false);
});
```

### Integration Tests (New)

**File:** `src/client/__tests__/integration/recovery-resize.test.tsx` (NEW)

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('Recovery-Resize Integration', () => {
  it('should handle resize during WebGL recovery', async () => {
    // 1. Setup terminal with WebGL
    // 2. Trigger context loss
    // 3. Resize terminal during recovery
    // 4. Verify content restores at new size
  });

  it('should block resize calls during recovery', () => {
    // 1. Start recovery
    // 2. Attempt resize via coordinator
    // 3. Verify fit() not called
    // 4. End recovery
    // 5. Verify next resize works
  });
});
```

### Manual Testing Checklist

**Test 1: Basic Resize**
- [ ] Drag window divider → no black areas
- [ ] Use resize handles → no black areas
- [ ] Toggle side panel → resize works
- [ ] Resize browser window → all terminals resize

**Test 2: Resize During Recovery**
- [ ] Force context loss (DevTools)
- [ ] Immediately drag divider during recovery
- [ ] Verify content restores at new size
- [ ] No errors in console

**Test 3: Rapid Operations**
- [ ] Drag divider rapidly 10+ times
- [ ] No black areas after resize stops
- [ ] Terminal responds to input

**Test 4: Edge Cases**
- [ ] Very slow resize (2000ms CSS transition)
- [ ] Resize during pending restore (before terminal mounts)
- [ ] Multiple context losses in succession
- [ ] Resize + recovery + resize again

---

## Files Modified

### Core Fixes
- `src/client/hooks/useRendererSetup.ts` - WG-1, recovery exception handling
- `src/client/hooks/useResizeCoordinator.ts` - RS-1, RS-2, double RAF + recovery check
- `src/client/components/TerminalCore/TerminalCore.tsx` - RS-2, pass isRecovering callback
- `src/client/App.tsx` - WG-2, WG-3, RS-2, restore flag + recovery size tracking
- `src/client/services/OutputPipelineManager.ts` - RS-3, clear resize flag on recovery

### Test Coverage
- `src/client/hooks/__tests__/useRendererSetup.test.ts` - Add recovery exception test
- `src/client/services/__tests__/OutputPipelineManager.test.ts` - Add recovery mode tests
- `src/client/__tests__/integration/recovery-resize.test.tsx` - NEW, integration tests

### Documentation
- `docs/issues/webgl-stability-bugs.md` - Bug analysis
- `docs/issues/resize-bugs-analysis.md` - Resize analysis
- `docs/issues/COMPREHENSIVE_FIX_PLAN.md` - This file
- `CLAUDE.md` - Update with recovery behavior notes

---

## Risk Assessment

### Low Risk Changes
- WG-1: Adding onRecoveryEnd call (5 lines)
- RS-4: Timeout change 150→250ms (1 line)
- RS-3: Clear resize flag (1 line)

### Medium Risk Changes
- RS-1: Double RAF in resize (wraps existing code)
- WG-3: Timeout coordination (adds condition)

### High Risk Changes
- WG-2: Restore flag lifecycle (removes delete call)
- RS-2: Recovery-resize coordination (new tracking system)

**Mitigation:**
- Implement in order: Low → Medium → High risk
- Test each phase before moving to next
- Keep fixes small and focused
- Roll back on first sign of regression

---

## Success Criteria

### Functional
- [ ] No black screen after resize
- [ ] No frozen terminal after recovery exception
- [ ] Content restores correctly after context loss
- [ ] Resize during recovery doesn't corrupt output

### Performance
- [ ] No noticeable lag during resize
- [ ] Recovery completes within 1 second
- [ ] No memory leaks after multiple recoveries

### Stability
- [ ] 100 rapid resizes → no failures
- [ ] 10 context loss cycles → no failures
- [ ] All tests pass
- [ ] No console errors during normal operation

---

## Timeline

**Day 1 (4-6 hours):**
- Morning: Implement WG-1, RS-1, RS-4
- Afternoon: Test low-risk fixes, add unit tests
- EOD: Verify no regressions

**Day 2 (6-8 hours):**
- Morning: Implement WG-2, RS-2
- Afternoon: Add recovery-resize integration tests
- EOD: Manual verification of recovery scenarios

**Day 3 (4-6 hours):**
- Morning: Implement WG-3, RS-3
- Afternoon: Full test suite, performance testing
- EOD: Documentation updates

**Day 4 (2-4 hours):**
- Morning: Final manual verification
- Afternoon: Code review, merge
- EOD: Deploy to staging

---

## Rollback Plan

If any phase causes regressions:

1. **Immediate:** Revert the specific fix via git
2. **Isolate:** Remove fix from build, test remaining fixes
3. **Analyze:** Review logs, reproduce issue
4. **Retry:** Fix the fix, re-test in isolation
5. **Integrate:** Merge back after verification

**Point of No Return:** After WG-2 merges, cannot rollback without also rolling back RS-2 (they're coupled).

---

## Post-Implementation

### Monitoring
- Add telemetry for context loss events
- Track resize latency metrics
- Monitor error rates

### Future Improvements
- ResizeObserver instead of timeout (RS-4 alternative)
- WebGL canvas size verification (observer-based)
- Automatic recovery from canvas size mismatch

### Documentation
- Update CLAUDE.md with recovery flow diagram
- Add troubleshooting guide for black screen issues
- Document resize-recovery interaction

---

## Conclusion

This comprehensive fix plan addresses all 7 critical bugs in WebGL stability and resize coordination. Implementation in 4 phases over 4 days provides:
- **Safety:** Low-risk changes first, high-risk last
- **Testability:** Each phase independently verifiable
- **Rollback-ability:** Granular revert points
- **Completeness:** Covers all edge cases and interactions

**Estimated effort:** 16-24 hours
**Risk level:** Medium (mitigated by phased approach)
**Impact:** Eliminates all known terminal freeze / black screen issues

---

**Approval Required:**
- [ ] Technical review
- [ ] Test plan approval
- [ ] Timeline approval
- [ ] Go/No-Go decision

**Implementation:** Ready to begin Phase 1
