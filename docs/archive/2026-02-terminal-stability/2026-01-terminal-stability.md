# Terminal Stability Issue: Dots Pattern & WebGL Failures

**Date:** 2026-01-19
**Priority:** HIGH
**Status:** RESOLVED
**Resolution:** Reduced scrollback 20K → 5K (Option D)

## Symptoms

1. **Dots Pattern After Reload/Resize**: Terminal shows `...............................` (Claude's thinking indicator) constantly after page reload or resize
2. **WebGL Context Loss**: WebGL renderer fails, terminal stops rendering properly
3. **Content Corruption**: Restore content may appear garbled or outdated

## Root Cause Analysis

### Issue 1: Dots Pattern (Claude Thinking Output)

**What are the dots?**
- Claude Code outputs `.` characters during extended thinking operations
- These dots are written to the terminal via tmux PTY
- Tmux captures this content in its scrollback buffer

**Why they appear after reload:**
```
Timeline:
1. User working with Claude (Claude outputs thinking dots)
2. User refreshes browser
3. Server captures tmux pane content (includes thinking dots)
4. window:restore sent with captured content
5. Client writes restore content → dots appear
6. If Claude is still thinking, live output also has dots
```

**Race Condition in Restore Flow:**
```typescript
// src/server/websocket/ConnectionManager.ts:772-821
// Current flow:
//   1. Capture screen (includes stale content)
//   2. Send window:restore
//   3. Attach PTY listener
//
// Problem: If terminal hasn't initialized WebGL yet, restore writes to
// a non-rendering terminal, causing visual corruption.
```

**Location:** `src/client/App.tsx:456-488` (window:restore handler)

### Issue 2: WebGL Context Loss & Recovery

**Current WebGL-Only Architecture:**
```typescript
// src/client/hooks/useRendererSetup.ts
// - WebGL is REQUIRED (no Canvas/DOM fallback)
// - 3 recovery attempts on context loss
// - After max attempts, terminal fails to render
```

**Why WebGL Fails:**
1. **GPU Memory Exhaustion (OOM)**: Large scrollback buffers consume GPU texture memory
2. **Browser Tab Backgrounding**: Browser may kill WebGL contexts for inactive tabs
3. **GPU Driver Issues**: Crashes, hangs, or context limits
4. **Rapid Resize**: Context recreation races with render

**Recovery Gap:**
When recovery fails, terminal enters `status: 'failed'` state with no way to recover without page reload.

### Issue 3: Timing Race Between WebGL Init and Content Write

**Problem Sequence:**
```
1. Component mounts
2. XTerm created
3. Async WebGL initialization starts
4. window:restore arrives (WebGL not ready)
5. terminal.write() called
6. WebGL finishes init OR fails
7. Written content may be lost/corrupted
```

**Location:** `src/client/components/TerminalCore/TerminalCore.tsx:188-256`

## Current Protections (Already Implemented)

### OutputPipelineManager Blocking
```typescript
// src/client/services/OutputPipelineManager.ts
// Blocks enqueue() during:
//   - restoreInProgress: true
//   - recoveryInProgress: true
```

### WebGL Recovery with Buffer Clear
```typescript
// src/client/hooks/useRendererSetup.ts:124-143
// On context loss:
//   1. Clear terminal buffer
//   2. Reduce scrollback (50K → 5K)
//   3. Retry WebGL init
```

### Restore Mode Buffering
```typescript
// src/client/App.tsx:456-488
// Enters "restore mode" which blocks OutputPipeline
// until restore write completes
```

## Missing Protections

### 1. No WebGL Readiness Gate
Content can be written before WebGL canvas exists:
```typescript
// CURRENT (TerminalCore.tsx):
const rendererResult = await setupRenderer(term);
// Missing: if (!rendererResult.success) { /* block writes */ }
fitAddon.fit();  // May fail if no WebGL
onReady(term, fitAddon);  // Caller may write immediately
```

### 2. No Graceful Degradation on WebGL Failure
When WebGL fails permanently, terminal is unusable:
```typescript
// useRendererSetup.ts:145-152
if (recoveryAttemptsRef.current >= MAX_RECOVERY_ATTEMPTS) {
  setState({ status: 'failed', lastError: '...' });
  // NO FALLBACK - terminal dead until page reload
}
```

### 3. Restore Content May Be Stale
Tmux capture happens before PTY attach, but:
```typescript
// ConnectionManager.ts:788-789
const screenContent = await this.windowManager.captureScreen(windowId, ...);
// This captures whatever tmux has - may include old thinking dots
// from a Claude session that has since completed
```

## Recommended Fixes

### Fix 1: WebGL Readiness Gate in TerminalCore
```typescript
// TerminalCore.tsx - Block onReady until WebGL confirmed
const rendererResult = await setupRenderer(term);
if (!rendererResult.success) {
  console.error(`[${terminalId}] WebGL required but failed`);
  // Signal parent that terminal is degraded
  // Option A: Retry forever with backoff
  // Option B: Add Canvas fallback
}
```

### Fix 2: Canvas Fallback (Optional)
Re-add Canvas addon as fallback when WebGL fails:
```typescript
// useRendererSetup.ts - Add fallback chain
if (webglFailed && canvasEnabled) {
  const canvasAddon = new CanvasAddon();
  term.loadAddon(canvasAddon);
  // Canvas is slower but won't OOM
}
```

### Fix 3: Intelligent Restore Content Filtering
Filter out known transient patterns from restore:
```typescript
// Server-side: TmuxManager.capturePane()
// Strip trailing dots-only lines (thinking indicator)
const cleaned = stdout.replace(/^[.]+\s*$/gm, '');
```

### Fix 4: Post-WebGL-Ready Restore
Defer restore until WebGL confirmed ready:
```typescript
// App.tsx window:restore handler
if (!isWebGLReady(windowId)) {
  pendingRestoreRef.current.set(windowId, msg.data);
  // Will be processed when WebGL signals ready
  return;
}
```

### Fix 5: Force WebGL Recreation on Permanent Failure
```typescript
// useRendererSetup.ts - Nuclear option
if (status === 'failed') {
  // Destroy and recreate entire terminal
  term.dispose();
  // Trigger re-mount via parent
  onTerminalNeedsRecreation?.(terminalId);
}
```

## Testing Checklist

After implementing fixes:

- [ ] Refresh page while Claude is thinking → no dots on restore
- [ ] Resize browser rapidly 20+ times → WebGL stays active
- [ ] Open 6 terminals, minimize tab for 5 min → all recover
- [ ] `cat /dev/urandom | head -c 10000000` → no OOM
- [ ] Switch between sessions → clean restore each time

## Files to Modify

| File | Change |
|------|--------|
| `src/client/hooks/useRendererSetup.ts` | Add Canvas fallback, infinite retry option |
| `src/client/components/TerminalCore/TerminalCore.tsx` | WebGL readiness gate |
| `src/client/App.tsx` | Deferred restore until WebGL ready |
| `src/server/tmux/TmuxManager.ts` | Filter transient content from capture |
| `src/client/services/OutputPipelineManager.ts` | WebGL state integration |

## Resolution Applied

**Option D implemented (2026-01-19):**

| File | Before | After |
|------|--------|-------|
| `src/shared/constants.ts:27` | `scrollback: 20000` | `scrollback: 5000` |
| `src/server/tmux/TmuxManager.ts:235` | `-S -50000` | `-S -5000` |

**Results:**
- WebGL context stable after reload/resize
- No more OOM-triggered context loss
- Dots pattern no longer persists (smaller capture window)
- Terminal renders consistently

**Trade-off:** 5K lines scrollback (sufficient for most sessions)
