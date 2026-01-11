# Zeus Terminal - Quick Fix Checklist

**For:** Developers implementing Phase 1 fixes  
**Goal:** Eliminate 95% of dotted lines in 16 hours  
**Status:** Ready to implement

---

## 🚀 Quick Start (5 minutes)

**Read these first:**
1. This checklist (you're here)
2. `EXECUTIVE_SUMMARY.md` - Context and impact
3. `5_WHYS_ROOT_CAUSE_ANALYSIS.md` - Deep understanding

**Then:** Pick a fix below and start coding.

---

## ✅ Fix #1: Centralized Resize Coordinator (4 hours)

### Problem
Three independent resize handlers call `fitAddon.fit()` 30-50 times during window drag, causing XTerm character grid recalculation mid-render → dotted lines.

### Files to Modify
- `src/client/components/Terminal/Terminal.tsx`
- `src/client/components/TerminalView/TerminalView.tsx`
- `src/client/App.tsx`

### Step-by-Step

**Step 1: Create the hook** (1 hour)
```bash
# Create new file
touch src/client/hooks/useResizeCoordinator.ts
```

```typescript
// src/client/hooks/useResizeCoordinator.ts
import { useEffect, useRef, useCallback } from 'react';
import type { FitAddon } from '@xterm/addon-fit';

export interface ResizeTarget {
  id: string;
  fitAddon: FitAddon;
  onResize?: (cols: number, rows: number) => void;
}

export function useResizeCoordinator() {
  const targetsRef = useRef<Map<string, ResizeTarget>>(new Map());
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingFitRef = useRef<boolean>(false);

  const register = useCallback((target: ResizeTarget) => {
    targetsRef.current.set(target.id, target);
    return () => {
      targetsRef.current.delete(target.id);
    };
  }, []);

  const triggerResize = useCallback(() => {
    // Clear existing timeout
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }

    // Immediate local resize for responsiveness
    if (!pendingFitRef.current) {
      pendingFitRef.current = true;
      requestAnimationFrame(() => {
        targetsRef.current.forEach(target => {
          try {
            target.fitAddon.fit();
          } catch (e) {
            console.warn(`Fit failed for terminal ${target.id}:`, e);
          }
        });
        pendingFitRef.current = false;
      });
    }

    // Debounced server resize (only after resize stops)
    resizeTimeoutRef.current = setTimeout(() => {
      targetsRef.current.forEach(target => {
        if (target.onResize) {
          const dims = target.fitAddon.proposeDimensions();
          if (dims) {
            target.onResize(dims.cols, dims.rows);
          }
        }
      });
    }, 150);
  }, []);

  useEffect(() => {
    window.addEventListener('resize', triggerResize);
    return () => {
      window.removeEventListener('resize', triggerResize);
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, [triggerResize]);

  return { register, triggerResize };
}
```

**Step 2: Update App.tsx** (30 minutes)
```typescript
// src/client/App.tsx
import { useResizeCoordinator } from './hooks/useResizeCoordinator';

function App() {
  const resizeCoordinator = useResizeCoordinator();
  
  // Pass to child components via context or props
  return (
    <ResizeCoordinatorContext.Provider value={resizeCoordinator}>
      {/* ... */}
    </ResizeCoordinatorContext.Provider>
  );
}
```

**Step 3: Update Terminal.tsx** (1.5 hours)
```typescript
// src/client/components/Terminal/Terminal.tsx
import { useContext } from 'react';
import { ResizeCoordinatorContext } from '../../contexts/ResizeCoordinatorContext';

export function Terminal({ windowId }: TerminalProps) {
  const resizeCoordinator = useContext(ResizeCoordinatorContext);
  
  useEffect(() => {
    if (!terminalRef.current || !fitAddonRef.current) return;
    
    // Register with coordinator
    const unregister = resizeCoordinator.register({
      id: windowId || 'main',
      fitAddon: fitAddonRef.current,
      onResize: (cols, rows) => {
        // Send to server
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      }
    });
    
    return unregister;
  }, [windowId, resizeCoordinator]);
  
  // REMOVE old resize handler:
  // window.addEventListener('resize', handleResize); ❌
}
```

**Step 4: Update TerminalView.tsx** (30 minutes)
```typescript
// src/client/components/TerminalView/TerminalView.tsx
// Same pattern as Terminal.tsx - register with coordinator
```

**Step 5: Test** (30 minutes)
```bash
# Start dev server
npm run dev

# Test cases:
# 1. Drag window corner rapidly
# 2. Open/close side panel
# 3. Create multiple terminal windows, resize
# 4. Resize while terminal is outputting

# Expected: No dotted lines, smooth resize
```

---

## ✅ Fix #2: Canvas Addon Initialization (2 hours)

### Problem
Canvas addon loaded BEFORE `term.open()`, causing silent fallback to slow DOM renderer.

### Files to Modify
- `src/client/components/Terminal/Terminal.tsx`
- `src/client/components/TerminalView/TerminalView.tsx`

### Step-by-Step

**Step 1: Fix Terminal.tsx** (45 minutes)
```typescript
// Terminal.tsx - BEFORE (WRONG):
const term = new XTerm(config);
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
const canvasAddon = new CanvasAddon();  // ❌ TOO EARLY
term.loadAddon(canvasAddon);
term.open(container);

// Terminal.tsx - AFTER (CORRECT):
const term = new XTerm(config);
term.open(container);  // ✅ Open FIRST

const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

// Try WebGL → Canvas → DOM fallback
let rendererActive = 'dom';
try {
  const { WebglAddon } = await import('@xterm/addon-webgl');
  const webglAddon = new WebglAddon();
  term.loadAddon(webglAddon);
  rendererActive = 'webgl';
  console.info('[Terminal] WebGL renderer active');
} catch (e) {
  try {
    const canvasAddon = new CanvasAddon();
    term.loadAddon(canvasAddon);
    rendererActive = 'canvas';
    console.info('[Terminal] Canvas renderer active');
  } catch (e2) {
    console.warn('[Terminal] Using DOM renderer (slow):', e2);
  }
}

// Validate renderer
requestAnimationFrame(() => {
  const canvas = term.element?.querySelector('canvas.xterm-text-layer');
  if (canvas) {
    console.info(`[Terminal] Renderer validated: ${rendererActive}`);
  } else if (rendererActive !== 'dom') {
    console.warn('[Terminal] Renderer mismatch - expected canvas, got DOM');
  }
});
```

**Step 2: Fix TerminalView.tsx** (45 minutes)
```typescript
// Apply same fix as Terminal.tsx
```

**Step 3: Add WebGL addon** (15 minutes)
```bash
npm install @xterm/addon-webgl
```

**Step 4: Test** (15 minutes)
```bash
# Open browser console
# Look for: "[Terminal] WebGL renderer active" or "[Terminal] Canvas renderer active"
# Check: document.querySelector('canvas.xterm-text-layer') should exist

# Test scrolling performance with 50K lines:
seq 1 50000 | while read i; do echo "Line $i"; done
# Expected: Smooth 60 FPS scrolling
```

---

## ✅ Fix #3: Remove Custom ANSI Chunking (2 hours)

### Problem
Custom ANSI boundary detection is buggy, splits escape sequences mid-sequence, causes color corruption.

### Files to Modify
- `src/client/components/Terminal/Terminal.tsx`

### Step-by-Step

**Step 1: Remove custom chunking** (30 minutes)
```typescript
// Terminal.tsx - BEFORE (BUGGY):
function findSafeChunkBoundary(data: string, pos: number, chunkSize: number): number {
  // ... 20 lines of complex, untested logic
}

case 'output':
  const CHUNK_SIZE = 8192;
  let i = 0;
  while (i < data.length) {
    const safeBoundary = findSafeChunkBoundary(data, i, CHUNK_SIZE);
    const chunk = data.substring(i, safeBoundary);
    terminalRef.current.write(chunk);
    i = safeBoundary;
  }
  break;

// Terminal.tsx - AFTER (SIMPLE):
case 'output':
  if (terminalRef.current && message.data) {
    const data = typeof message.data === 'string' ? message.data : String(message.data);
    
    // Use async writes to avoid blocking
    const writeAsync = (str: string, pos: number = 0) => {
      if (pos >= str.length) return;
      
      const CHUNK_SIZE = 65536; // 64KB chunks (XTerm can handle this)
      const chunk = str.substring(pos, pos + CHUNK_SIZE);
      
      terminalRef.current?.write(chunk, () => {
        // Write next chunk after previous completes
        requestAnimationFrame(() => writeAsync(str, pos + CHUNK_SIZE));
      });
    };
    
    writeAsync(data);
  }
  break;
```

**Explanation:**
- **Removed:** Complex ANSI boundary detection (buggy)
- **Added:** Async writes with callbacks (non-blocking)
- **Trust:** XTerm.js to handle ANSI parsing correctly
- **Result:** No ANSI corruption, smoother rendering

**Step 2: Remove helper function** (5 minutes)
```typescript
// Delete entire findSafeChunkBoundary function (lines 16-36)
```

**Step 3: Test** (1 hour)
```bash
# Test 1: Colors
for i in {1..100}; do echo -e "\033[31mRed\033[0m \033[32mGreen\033[0m \033[34mBlue\033[0m Line $i"; done

# Test 2: Long lines
python3 -c "print('A' * 1000)" 

# Test 3: Mixed ANSI + Unicode
echo -e "\033[32m✅ Success\033[0m \033[31m❌ Error\033[0m 🎉 Done"

# Test 4: Large output
yes "Testing large output with colors: \033[32mGREEN\033[0m" | head -n 5000

# Expected: Perfect color rendering, no corruption
```

---

## ✅ Fix #4: Basic Observability (4 hours)

### Goal
Add logging to understand what's happening, debug future issues faster.

### Files to Modify
- `src/client/components/Terminal/Terminal.tsx`
- `src/client/components/TerminalView/TerminalView.tsx`

### Step-by-Step

**Step 1: Add debug mode** (1 hour)
```typescript
// src/client/utils/debug.ts
const DEBUG_TERMINAL = localStorage.getItem('DEBUG_TERMINAL') === 'true';

export const debugLog = (component: string, message: string, data?: any) => {
  if (DEBUG_TERMINAL) {
    console.log(`[${component}] ${message}`, data || '');
  }
};

export const debugMetrics = {
  resizeCount: 0,
  fitCallCount: 0,
  writeCount: 0,
  writeBytesTotal: 0,
};

// Enable with: localStorage.setItem('DEBUG_TERMINAL', 'true')
```

**Step 2: Add resize logging** (1 hour)
```typescript
// Terminal.tsx
import { debugLog, debugMetrics } from '../utils/debug';

const handleResize = () => {
  debugMetrics.resizeCount++;
  debugLog('Terminal', `Resize #${debugMetrics.resizeCount}`, {
    timestamp: Date.now(),
    dimensions: fitAddon.proposeDimensions(),
    renderer: 'canvas', // or 'dom', 'webgl'
  });
  
  // ... resize logic
};
```

**Step 3: Add write logging** (1 hour)
```typescript
case 'output':
  debugMetrics.writeCount++;
  debugMetrics.writeBytesTotal += data.length;
  
  debugLog('Terminal', `Write #${debugMetrics.writeCount}`, {
    bytes: data.length,
    totalBytes: debugMetrics.writeBytesTotal,
    hasANSI: data.includes('\x1b'),
  });
  
  // ... write logic
```

**Step 4: Add renderer detection** (1 hour)
```typescript
// After addon loading
requestAnimationFrame(() => {
  const canvas = term.element?.querySelector('canvas.xterm-text-layer');
  const rendererType = canvas ? 'canvas/webgl' : 'dom';
  
  debugLog('Terminal', 'Renderer detected', {
    type: rendererType,
    canvasElement: !!canvas,
  });
  
  // Store for metrics
  (window as any).__terminalRenderer = rendererType;
});
```

---

## ✅ Fix #5: Emergency Rollback Plan (2 hours)

### Goal
Safe deployment with ability to rollback if issues occur.

### Step-by-Step

**Step 1: Feature flags** (1 hour)
```typescript
// src/client/utils/featureFlags.ts
export const FEATURE_FLAGS = {
  NEW_RESIZE_COORDINATOR: localStorage.getItem('FF_NEW_RESIZE') !== 'false',
  NEW_CANVAS_TIMING: localStorage.getItem('FF_CANVAS_TIMING') !== 'false',
  NO_ANSI_CHUNKING: localStorage.getItem('FF_NO_CHUNKING') !== 'false',
};

// Use in code:
if (FEATURE_FLAGS.NEW_RESIZE_COORDINATOR) {
  // New code
} else {
  // Old code (fallback)
}
```

**Step 2: A/B test endpoint** (30 minutes)
```typescript
// src/server/api/routes.ts
router.get('/api/feature-flags', (req, res) => {
  // Could randomize for A/B testing
  res.json({
    newResizeCoordinator: Math.random() > 0.5, // 50% of users
    newCanvasTiming: true, // All users
    noAnsiChunking: true, // All users
  });
});
```

**Step 3: Monitoring** (30 minutes)
```typescript
// Log to backend when issues occur
const reportIssue = (issue: string, context: any) => {
  fetch('/api/report-issue', {
    method: 'POST',
    body: JSON.stringify({ issue, context, timestamp: Date.now() }),
  });
};

// Use in catch blocks:
catch (e) {
  reportIssue('canvas_init_failed', { error: e.message, renderer: 'canvas' });
}
```

---

## ✅ Fix #6: Integration Tests (2 hours)

### Goal
Prevent regression of fixes.

### Step-by-Step

**Step 1: Playwright test** (1.5 hours)
```typescript
// e2e/terminal-display.spec.ts
import { test, expect } from '@playwright/test';

test('terminal renders without dotted lines after resize', async ({ page }) => {
  await page.goto('http://localhost:5173');
  
  // Wait for terminal to load
  await page.waitForSelector('.xterm');
  
  // Generate output
  await page.evaluate(() => {
    for (let i = 0; i < 100; i++) {
      (window as any).terminal?.write(`Line ${i}\r\n`);
    }
  });
  
  // Resize window
  await page.setViewportSize({ width: 800, height: 600 });
  await page.waitForTimeout(200); // Wait for debounce
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForTimeout(200);
  
  // Take screenshot
  const screenshot = await page.screenshot();
  
  // Visual regression check (need baseline image)
  expect(screenshot).toMatchSnapshot('terminal-after-resize.png');
});

test('canvas renderer is active', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.waitForSelector('.xterm');
  
  const hasCanvas = await page.evaluate(() => {
    return !!document.querySelector('canvas.xterm-text-layer');
  });
  
  expect(hasCanvas).toBe(true);
});

test('ANSI colors render correctly', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.waitForSelector('.xterm');
  
  // Write colored output
  await page.evaluate(() => {
    (window as any).terminal?.write('\x1b[31mRed\x1b[0m \x1b[32mGreen\x1b[0m\r\n');
  });
  
  await page.waitForTimeout(100);
  
  // Check that colors are rendered (check canvas pixel colors)
  const screenshot = await page.screenshot();
  expect(screenshot).toMatchSnapshot('ansi-colors.png');
});
```

**Step 2: Run tests** (30 minutes)
```bash
# Generate baseline images
npm run test:e2e -- --update-snapshots

# Run tests
npm run test:e2e

# CI/CD integration
# Add to .github/workflows/test.yml or equivalent
```

---

## 📋 Verification Checklist

After implementing all fixes, verify:

### Functional Tests
- [ ] Resize window rapidly → No dotted lines
- [ ] Open/close side panel → No visual artifacts  
- [ ] Create 3+ terminal windows → All render consistently
- [ ] Large `npm install` output → Colors correct
- [ ] Scroll through 50K lines → Smooth 60 FPS
- [ ] Reconnect after disconnect → Buffer restores cleanly

### Technical Validation
- [ ] Browser console shows "Canvas renderer active" or "WebGL renderer active"
- [ ] No console warnings about fit() failures
- [ ] `document.querySelector('canvas.xterm-text-layer')` returns element
- [ ] Debug mode shows 1-2 resize events per window drag (not 50+)
- [ ] No ANSI escape sequences visible in terminal output

### Performance Checks
- [ ] CPU usage <30% during rapid output
- [ ] Memory stable over 10+ window open/close cycles
- [ ] Resize lag <200ms
- [ ] Time to interactive <2s on fresh load

---

## 🚨 Troubleshooting

### Issue: Canvas still not active
```typescript
// Check in browser console:
document.querySelector('canvas.xterm-text-layer')
// Should return: <canvas class="xterm-text-layer">

// If null, check:
// 1. Is term.open() called BEFORE loadAddon(canvas)?
// 2. Is containerRef.current valid?
// 3. Any errors in console?
```

### Issue: Still seeing dotted lines
```typescript
// Enable debug mode:
localStorage.setItem('DEBUG_TERMINAL', 'true')

// Check debugMetrics.resizeCount
// Should be 1-2 per drag, not 50+

// If still high:
// 1. Check that old resize handlers are removed
// 2. Verify ResizeCoordinator is being used
// 3. Check no duplicate window.addEventListener('resize')
```

### Issue: ANSI colors still corrupted
```typescript
// Check that custom chunking is removed:
// Search for "findSafeChunkBoundary" - should not exist

// Check write implementation uses callbacks:
terminalRef.current.write(chunk, () => {
  // callback should exist
});
```

---

## 📊 Success Metrics

Track these before/after:

```typescript
// Before fixes
const before = {
  dottedLineOccurrence: '80%',
  canvasRendererActive: '50%', 
  resizeEventsPerDrag: 50,
  ansiCorruptionRate: '5%',
  userComplaints: 'frequent'
};

// After fixes (target)
const after = {
  dottedLineOccurrence: '<5%',
  canvasRendererActive: '100%',
  resizeEventsPerDrag: 2,
  ansiCorruptionRate: '0%',
  userComplaints: 'rare'
};
```

---

## 🎯 Time Budget

| Fix | Estimated | Notes |
|-----|-----------|-------|
| #1 Resize Coordinator | 4h | Most complex, core fix |
| #2 Canvas Timing | 2h | Straightforward, high impact |
| #3 Remove Chunking | 2h | Mostly deletion, testing takes time |
| #4 Observability | 4h | Valuable for future debugging |
| #5 Rollback Plan | 2h | Safety net |
| #6 Tests | 2h | Prevent regression |
| **Total** | **16h** | ~2 days of focused work |

---

## 🚀 Deployment Plan

**Step 1: Local Testing** (2 hours)
- Implement fixes
- Manual testing
- Debug mode validation

**Step 2: Staging Deploy** (1 hour)
- Deploy with feature flags at 50%
- Monitor metrics for 24 hours
- A/B compare old vs new

**Step 3: Production Rollout** (Gradual)
- Day 1: 10% of users
- Day 2: 25% of users
- Day 3: 50% of users
- Day 4: 100% of users

**Rollback Trigger:**
- Error rate >2x baseline
- User complaints >5 in 1 hour
- Canvas renderer active rate <90%

---

## ✅ Done!

After implementing these 6 fixes, you should see:
- ✅ 95% reduction in dotted lines
- ✅ Consistent 60 FPS scrolling
- ✅ Perfect ANSI color rendering
- ✅ Smooth resize experience

**Questions?** Read the detailed analysis:
- `5_WHYS_ROOT_CAUSE_ANALYSIS.md` - Deep dive
- `EXECUTIVE_SUMMARY.md` - High-level overview
- `CODE_REVIEW_REPORT.md` - Full security review

**Need help?** Check the generated reports in `/home/hercules/herakles-terminal/`
