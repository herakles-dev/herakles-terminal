# Terminal Stability Archive (February 2026)

This archive contains documentation from the terminal stability overhaul completed in February 2026.

## Summary

17 fixes across 13 files addressing:
- useImperativeHandle getter pattern fix
- Layout schema corrections (Zod int → fractional values)
- Resize pipeline improvements (atomic tmux, server-side dedup, lock release)
- Display optimizations (overflow-y, backpressure, canvas verification)
- Mobile containment and keyboard handling

**Result**: 183/183 tests passing, net -155 lines of code.

## Documents

### Latest Fixes (February 2026)
- **Feb 12, 2026** - Multiwindow drag fix (Commit `47b581a`)
  - Visual-only preview during drag (60fps smooth movement)
  - Deferred resize on mouseup or 2s idle
  - Eliminates black bars and dimension mismatches
  - +193 / -124 lines, helper function extraction

### Implementation Tracking
- `PHASE_1_IMPLEMENTATION.md` - Initial WebGL telemetry phase
- `PHASE_2_IMPLEMENTATION.md` - Display pipeline phase
- `PHASE_1_WEBGL_TELEMETRY.md` - WebGL monitoring details

### Issue Analysis
- `2026-01-terminal-stability.md` - Root cause analysis
- `webgl-stability-bugs.md` - WebGL-specific issues
- `resize-bugs-analysis.md` - Resize race conditions
- `COMPREHENSIVE_FIX_PLAN.md` - Master fix plan
- `FIXES_IMPLEMENTED.md` - Implementation tracking
- `EXECUTIVE_SUMMARY.md` - High-level summary

### Task System
- `TASK_SYSTEM_UPGRADE_SUMMARY.md` - TaskCreate/TodoWrite migration
- `TODO_SYSTEM_COMPARISON.md` - System comparison analysis

## Current State

All fixes have been implemented and verified. The terminal is now stable with:
- WebGL-only rendering (no canvas fallback)
- Robust resize coordination
- Mobile-optimized layout
- 5K scrollback (down from 20K)

See `/home/hercules/herakles-terminal/CLAUDE.md` for current implementation details.
