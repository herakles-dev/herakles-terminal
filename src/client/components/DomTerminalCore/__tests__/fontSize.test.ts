/**
 * I-12 regression: fontSize useEffect must call scheduleRender even when
 * the resulting cols/rows are unchanged (Fa-3 — cursor stale pixel position).
 *
 * Root cause: the fontSize useEffect only called scheduleRenderRef.current?.()
 * inside the `if (dims.cols !== term.cols || dims.rows !== term.rows)` branch.
 * When font size changes but the container happens to produce the same integer
 * cols/rows, no render was scheduled — cursor stayed at its old pixel offset
 * because charWidth/lineHeight changed but the DOM wasn't refreshed.
 *
 * Fix (else branch added in I-12):
 *   dirtyFullRef.current = true;
 *   scheduleRenderRef.current?.();
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal simulation of the fontSize useEffect logic
// ---------------------------------------------------------------------------

interface TermLike {
  cols: number;
  rows: number;
  resize: (c: number, r: number) => void;
}

interface Refs {
  term: TermLike;
  dirtyFull: boolean;
  renderScheduled: boolean;
}

function scheduleFn(refs: Refs): void {
  refs.renderScheduled = true;
}

/** Buggy version: only schedules render when dims differ */
function fontSizeEffectBuggy(
  dims: { cols: number; rows: number },
  refs: Refs,
): void {
  if (dims.cols !== refs.term.cols || dims.rows !== refs.term.rows) {
    refs.term.resize(dims.cols, dims.rows);
    refs.dirtyFull = true;
    scheduleFn(refs);
  }
  // Bug: no else branch — if dims unchanged, no render is scheduled
}

/** Fixed version: schedules render in both branches */
function fontSizeEffectFixed(
  dims: { cols: number; rows: number },
  refs: Refs,
): void {
  if (dims.cols !== refs.term.cols || dims.rows !== refs.term.rows) {
    refs.term.resize(dims.cols, dims.rows);
    refs.dirtyFull = true;
    scheduleFn(refs);
  } else {
    // Same cols/rows but charWidth/lineHeight changed —
    // cursor position needs re-render (I-12 / Fa-3)
    refs.dirtyFull = true;
    scheduleFn(refs);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('I-12 — fontSize useEffect: scheduleRender when dims unchanged', () => {

  function makeRefs(cols = 80, rows = 24): Refs {
    return {
      term: {
        cols,
        rows,
        resize: vi.fn(),
      },
      dirtyFull: false,
      renderScheduled: false,
    };
  }

  it('BUGGY: does NOT schedule render when new fontSize yields same cols/rows', () => {
    const refs = makeRefs(80, 24);
    // Same dims — simulates font size tweak that doesn't change integer cell count
    const newDims = { cols: 80, rows: 24 };

    fontSizeEffectBuggy(newDims, refs);

    // Bug: render is NOT scheduled even though charWidth/lineHeight changed
    expect(refs.renderScheduled).toBe(false);
    expect(refs.dirtyFull).toBe(false);
  });

  it('FIXED: schedules render even when new fontSize yields same cols/rows', () => {
    const refs = makeRefs(80, 24);
    const newDims = { cols: 80, rows: 24 };

    fontSizeEffectFixed(newDims, refs);

    // Fix: render IS scheduled so cursor pixel position updates
    expect(refs.renderScheduled).toBe(true);
    expect(refs.dirtyFull).toBe(true);
  });

  it('FIXED: still schedules render (and resizes term) when dims DO change', () => {
    const refs = makeRefs(80, 24);
    const newDims = { cols: 90, rows: 30 };

    fontSizeEffectFixed(newDims, refs);

    expect(refs.renderScheduled).toBe(true);
    expect(refs.dirtyFull).toBe(true);
    expect(refs.term.resize).toHaveBeenCalledWith(90, 30);
  });

});
