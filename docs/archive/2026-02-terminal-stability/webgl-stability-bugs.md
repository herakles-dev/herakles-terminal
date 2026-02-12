# WebGL Stability Implementation - Bug Analysis

**Date:** 2026-01-25
**Analyzer:** Claude Code (Deep Work Mode)
**Status:** 🔴 CRITICAL BUGS FOUND

## Executive Summary

The WebGL stability implementation contains **3 critical bugs** that can leave the terminal in a broken state with no output. The core issue is incomplete error handling in the recovery callback chain, leading to the output pipeline remaining paused indefinitely.

---

## Critical Bug #1: Recovery Exception Doesn't Resume Pipeline

**Severity:** 🔴 CRITICAL
**Impact:** Terminal becomes permanently unresponsive
**Location:** `src/client/hooks/useRendererSetup.ts:231-237`

### Problem

When `setupRenderer` throws an exception during recovery, `onRecoveryEnd` is never called, leaving the output pipeline permanently paused.

### Code Flow

```typescript
// useRendererSetup.ts:111 - Context loss handler
webglAddon.onContextLoss(() => {
  // Step 1: Pause pipeline IMMEDIATELY
  onRecoveryStart?.(terminalId);  // ✅ Called

  setTimeout(() => {
    // Step 2: Clear terminal and retry
    term.clear();
    setupRenderer(term, true);  // ⚠️ Can throw
  }, 100);
});

// useRendererSetup.ts:231 - Exception handler
} catch (e) {
  setState({ status: 'failed', lastError: error });
  return { success: false, rendererType: null, error };
  // ❌ onRecoveryEnd NOT called!
}
```

### Impact

1. User types in terminal → output pipeline discards all data
2. Terminal appears frozen
3. No error message shown to user
4. Only fix: refresh browser (loses session state)

### Evidence

**Tests Missing:** No test case for exception during recovery in `useRendererSetup.test.ts`

---

## Critical Bug #2: Restore Content Lost During Recovery

**Severity:** 🔴 CRITICAL
**Impact:** Terminal content disappears permanently after WebGL recovery
**Location:** `src/client/App.tsx:484-498, 720-725`

### Problem

The `restoreNeededAfterRecoveryRef` flag is cleared **before** WebGL context loss can occur, causing the re-request logic to never trigger.

### Timeline

```
T0: window:restore message arrives
    └─> restoreNeededAfterRecoveryRef.add('window-1')  [Line 484]
    └─> setRestoreInProgress(true)                     [Line 481]
    └─> Schedule RAF

T1: RAF executes
    └─> terminal.write(data, callback)                  [Line 493]

T2: Write completes
    └─> restoreNeededAfterRecoveryRef.delete('window-1')  [Line 498] ❌
    └─> setRestoreInProgress(false)                       [Line 496]

T3: WebGL context loss (can happen AFTER write completes)
    └─> handleRecoveryStart called
    └─> term.clear() wipes all content
    └─> After recovery: handleRecoveryEnd checks ref
    └─> ref.has('window-1') → FALSE ❌
    └─> No re-request sent
    └─> Terminal stays blank
```

### Root Cause

The flag is removed too early (line 498), assuming restore is "complete". But WebGL context loss can occur **after** the write callback executes, wiping the content that was just restored.

### Evidence

From CLAUDE.md:
> "✅ Race Condition Fix - `window:restore` now sent before client joins broadcast group"

But this only fixes the **server-side** race. The **client-side** race between restore completion and context loss is not addressed.

---

## Critical Bug #3: Pending Restore Timeout Coordination

**Severity:** 🟡 MEDIUM
**Impact:** Restore content lost if terminal mounts slowly
**Location:** `src/client/App.tsx:508-515`

### Problem

If a `window:restore` message arrives before the terminal is mounted, the content is buffered in `pendingRestoreRef`. A 5-second timeout clears this buffer if the terminal doesn't mount. But if WebGL recovery happens during this 5 seconds, the content is lost.

### Code Flow

```typescript
// App.tsx:501 - Terminal not ready, buffer restore
if (msg.data) {
  pendingRestoreRef.current.set(msg.windowId, msg.data);

  // Safety timeout
  setTimeout(() => {
    if (pendingRestoreRef.current.has(msg.windowId)) {
      console.warn('Restore timeout - clearing pending restore');
      pendingRestoreRef.current.delete(msg.windowId);  // ❌ Lost!
      setRestoreInProgress(msg.windowId, false);
    }
  }, 5000);
}
```

### Edge Case

1. Page loads, terminal mounting
2. `window:restore` arrives → buffered in `pendingRestoreRef`
3. 3 seconds pass, terminal still initializing (slow device)
4. WebGL context loss occurs → `term.clear()`
5. 2 more seconds pass → timeout fires, deletes pending restore
6. Terminal finishes mounting → no content to restore
7. Result: blank terminal

---

## Medium Issues

### Issue #4: Selection Timeout Accumulation

**Severity:** 🟡 LOW
**Location:** `src/client/App.tsx:791-798`

**Problem:** Rapid selections create many 30-second timeouts that aren't cancelled if a new selection happens.

**Code:**
```typescript
selectionRefs.current.set(windowId, selection);

setTimeout(() => {
  if (selectionRefs.current.get(windowId) === selection) {
    selectionRefs.current.delete(windowId);
  }
}, 30000);
```

**Impact:** Memory leak in pathological case (user selecting every second for 30+ seconds). Low real-world likelihood.

---

## Documentation Mismatches

### Scrollback Reduction Values

**CLAUDE.md states:**
- Scrollback 20K → 5K ✅
- **Tmux capture 50K → 5K** ❌ (not found in client code)

**Code shows:**
```typescript
// useRendererSetup.ts:49
const RECOVERY_SCROLLBACK_LIMIT = 5000;

// useRendererSetup.ts:131
originalScrollbackRef.current = term.options.scrollback ?? 20000;
```

**Finding:** Tmux capture reduction likely happens server-side. Not visible in client files reviewed.

---

## Test Coverage Gaps

### Missing Test Cases

**useRendererSetup.test.ts:**
- ❌ Exception during recovery attempt (Bug #1)
- ❌ Successful recovery followed by another context loss
- ❌ Component unmount during recovery delay (partially covered)
- ❌ onRecoveryStart/onRecoveryEnd callback verification

**OutputPipelineManager.test.ts:**
- ❌ Recovery mode (`setRecoveryInProgress`) - not tested at all!
- ❌ Interaction between restore and recovery modes
- ❌ Buffer truncation at MAX_BUFFER_SIZE

**Integration tests needed:**
- ❌ Full recovery flow from context loss to terminal restoration
- ❌ Restore + recovery race condition
- ❌ Pipeline pause during recovery

---

## Recommended Fixes

### Fix #1: Call onRecoveryEnd on Exception

**File:** `src/client/hooks/useRendererSetup.ts`

**Change:**
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

### Fix #2: Don't Clear Restore Flag Until After Recovery Window

**File:** `src/client/App.tsx`

**Option A: Time-based window**
```typescript
// Line 493-499
terminal.write(msg.data, () => {
  terminal.scrollToBottom();

  // FIX: Keep flag for 5 seconds to catch context loss during/after write
  setTimeout(() => {
    restoreNeededAfterRecoveryRef.current.delete(msg.windowId);
  }, 5000);

  outputPipelineRef.current?.setRestoreInProgress(msg.windowId, false);
});
```

**Option B: Only clear on successful recovery**
```typescript
// Line 720-725 in handleRecoveryEnd
if (success) {
  if (restoreNeededAfterRecoveryRef.current.has(terminalId)) {
    console.info(`Re-requesting restore after WebGL recovery`);
    sendMessage({ type: 'window:subscribe', windowId: terminalId });
    // FIX: Clear flag AFTER re-request sent
    restoreNeededAfterRecoveryRef.current.delete(terminalId);
  }
}
```

**Recommendation:** Option B is safer - only clear the flag once we've confirmed recovery and re-requested restore if needed.

### Fix #3: Coordinate Pending Restore with Recovery

**File:** `src/client/App.tsx`

**Change:**
```typescript
// Line 508-515
setTimeout(() => {
  if (pendingRestoreRef.current.has(msg.windowId)) {
    // FIX: Check if recovery is in progress before clearing
    if (!outputPipelineRef.current?.isRecoveryInProgress(msg.windowId)) {
      console.warn(`Restore timeout - clearing pending restore`);
      pendingRestoreRef.current.delete(msg.windowId);
      outputPipelineRef.current?.setRestoreInProgress(msg.windowId, false);
      restoreNeededAfterRecoveryRef.current.delete(msg.windowId);
    } else {
      console.info(`Restore timeout but recovery in progress - keeping buffer`);
    }
  }
}, 5000);
```

---

## Verification Steps

After implementing fixes:

1. **Test Exception During Recovery**
   ```bash
   npm test -- --grep "recovery.*exception"
   ```

2. **Test Restore + Recovery Race**
   ```bash
   npm test -- --grep "restore.*recovery"
   ```

3. **Manual Test: Force Context Loss**
   - Open DevTools → Console
   - Run: `terminalRef.current.terminal.element.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()`
   - Verify: Terminal recovers, content restored, output resumes

4. **Manual Test: Restore During Recovery**
   - Refresh page while terminal has content
   - Immediately trigger context loss (above command)
   - Verify: Content restored after recovery

5. **Check Logs**
   - No "discarded" messages in console after recovery
   - "Re-requesting restore after WebGL recovery" appears when expected

---

## Priority

1. **Fix #1** - CRITICAL (blocks all terminal output)
2. **Fix #2** - CRITICAL (blank terminal after recovery)
3. **Add Tests** - HIGH (prevent regressions)
4. **Fix #3** - MEDIUM (rare edge case)
5. **Fix #4** - LOW (theoretical memory leak)

---

## Related Files

- `src/client/hooks/useRendererSetup.ts` - WebGL lifecycle
- `src/client/components/TerminalCore/TerminalCore.tsx` - Integration
- `src/client/App.tsx` - Recovery callbacks, restore coordination
- `src/client/services/OutputPipelineManager.ts` - Pipeline pause/resume
- `src/client/hooks/__tests__/useRendererSetup.test.ts` - Unit tests
- `src/client/services/__tests__/OutputPipelineManager.test.ts` - Pipeline tests

---

**Next Steps:**
1. Implement Fix #1 and Fix #2 (critical)
2. Add missing test cases
3. Run full test suite
4. Manual verification with DevTools
5. Update documentation with recovery flow diagram
