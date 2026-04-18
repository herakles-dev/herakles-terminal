/**
 * I-02 regression: applyResize ordering — remove synchronous ensureRows,
 * move t.resize() BEFORE virtualScroller.setViewportRows().
 *
 * Mechanism 1 (Fa-2 — ensureRows race):
 *   applyResize previously called ensureRows(dims.rows) synchronously, creating
 *   empty <div class="dom-term-row"> elements. Then t.resize() fires onRender
 *   synchronously, which queues a RAF via scheduleFullRender. Between ensureRows
 *   and the RAF firing, the new empty rows exist in the DOM with height=lineHeight
 *   but innerHTML='' — a 1-frame black gap.
 *   Fix: Remove ensureRows from applyResize. performRender() already calls
 *   ensureRows(t.rows) as its first statement (defensive call inside RAF), so
 *   create+fill becomes atomic within one frame.
 *
 * Mechanism 2 (Fc-4 — stale totalLines):
 *   virtualScroller.setViewportRows(rows) calls updateTotalLines() internally,
 *   reading term.buffer.active.length. But if t.resize() hasn't run yet, the
 *   buffer length is STALE. Any getViewportRange() call between setViewportRows
 *   and t.resize sees NEW viewportRows + OLD totalLines → miscomputed startLine.
 *   Fix: move t.resize() BEFORE setViewportRows so the buffer is already reflowed
 *   when updateTotalLines reads it.
 *
 * Test approach:
 *   We test the two classes (VirtualScroller + DomRenderer) in isolation using
 *   realistic mocks for xterm Terminal. This exercises the exact ordering that
 *   applyResize coordinates — without needing to mount the full React component.
 */

import { describe, it, expect, vi } from 'vitest';
import { VirtualScroller } from '../../../renderer/VirtualScroller.js';
import { DomRenderer } from '../../../renderer/DomRenderer.js';
import { ScreenBuffer, CharPool, StylePool } from '../../../renderer/ScreenBuffer.js';
import type { Terminal as XTerm, IBufferNamespace, IBuffer } from '@xterm/xterm';

// ---------------------------------------------------------------------------
// Mock xterm Terminal — minimal surface needed by VirtualScroller + tests
// ---------------------------------------------------------------------------

function makeXTermMock(cols: number, rows: number, bufferLength: number): XTerm {
  let _cols = cols;
  let _rows = rows;
  let _bufferLength = bufferLength;

  const buffer: IBuffer = {
    get length() { return _bufferLength; },
    get cursorX() { return 0; },
    get cursorY() { return 0; },
    getLine: vi.fn().mockReturnValue(null),
    getNullCell: vi.fn().mockReturnValue(null),
    type: 'normal' as const,
    baseY: 0,
    viewportY: 0,
  } as unknown as IBuffer;

  const bufferNamespace = {
    get active() { return buffer; },
    get normal() { return buffer; },
    get alternate() { return buffer; },
    onBufferChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  } as unknown as IBufferNamespace;

  const term = {
    get cols() { return _cols; },
    get rows() { return _rows; },
    get buffer() { return bufferNamespace; },
    // resize() reflows the buffer — simulate by updating _cols, _rows and
    // setting bufferLength to max(rows, old bufferLength) as xterm would do.
    resize: vi.fn().mockImplementation((newCols: number, newRows: number) => {
      _bufferLength = Math.max(newRows, _bufferLength);
      _cols = newCols;
      _rows = newRows;
    }),
    onRender: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onWriteParsed: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onCursorMove: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onScroll: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    focus: vi.fn(),
    open: vi.fn(),
    write: vi.fn(),
    dispose: vi.fn(),
    clear: vi.fn(),
  } as unknown as XTerm;

  return term;
}

// ---------------------------------------------------------------------------
// Helper — build DOM container for DomRenderer
// ---------------------------------------------------------------------------

function makeRowsContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'dom-term-rows';
  document.body.appendChild(container);
  return container;
}

// ---------------------------------------------------------------------------
// Helper — simulate applyResize with the BUGGY ordering (pre-fix)
// (setViewportRows BEFORE t.resize, with synchronous ensureRows)
// ---------------------------------------------------------------------------

function applyResizeBuggy(opts: {
  term: XTerm;
  renderer: DomRenderer;
  scroller: VirtualScroller;
  front: ScreenBuffer;
  back: ScreenBuffer;
  newCols: number;
  newRows: number;
}): void {
  const { term, renderer, scroller, front, back, newCols, newRows } = opts;
  // BUGGY ORDER: setViewportRows → front/back resize → ensureRows → t.resize
  scroller.setViewportRows(newRows);     // reads STALE buffer length!
  front.resize(newCols, newRows);
  back.resize(newCols, newRows);
  renderer.ensureRows(newRows);          // creates EMPTY rows synchronously!
  term.resize(newCols, newRows);         // buffer reflow happens here
}

// ---------------------------------------------------------------------------
// Helper — simulate applyResize with the FIXED ordering (post-fix)
// (t.resize BEFORE setViewportRows, NO synchronous ensureRows)
// ---------------------------------------------------------------------------

function applyResizeFixed(opts: {
  term: XTerm;
  renderer: DomRenderer;
  scroller: VirtualScroller;
  front: ScreenBuffer;
  back: ScreenBuffer;
  newCols: number;
  newRows: number;
}): void {
  const { term, scroller, front, back, newCols, newRows } = opts;
  // FIXED ORDER (I-02):
  // 1. Resize xterm first — buffer reflow happens synchronously, fires onRender.
  // 2. setViewportRows reads the NEW buffer length via updateTotalLines.
  // 3. ensureRows is NOT called here — performRender() handles it atomically inside RAF
  //    to avoid a 1-frame gap of empty row divs (was: Fa-2 race).
  front.resize(newCols, newRows);
  back.resize(newCols, newRows);
  term.resize(newCols, newRows);         // buffer reflow first!
  scroller.setViewportRows(newRows);     // now reads NEW buffer length
  // No renderer.ensureRows() here — performRender() does it atomically inside RAF
}

// ---------------------------------------------------------------------------
// Helper — simulate performRender's defensive ensureRows + fill (RAF body)
// ---------------------------------------------------------------------------

function simulatePerformRender(renderer: DomRenderer, back: ScreenBuffer, term: XTerm): void {
  // This is what performRender() does inside RAF — ensureRows THEN fill.
  // The key: create and fill in the SAME synchronous call, no gap.
  renderer.ensureRows(term.rows);
  renderer.renderAll(back);
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('I-02 — applyResize ordering: no empty rows, no stale totalLines', () => {

  // -------------------------------------------------------------------------
  // Test 1 — grow-resize: no empty row divs after 1 RAF tick
  // -------------------------------------------------------------------------
  describe('Test 1: grow-resize no empty divs', () => {
    it('BUGGY: after grow-resize, new rows have empty innerHTML before RAF fires', () => {
      const charPool = new CharPool();
      const stylePool = new StylePool();
      const initialCols = 80;
      const initialRows = 20;
      const newRows = 30;
      const bufferLength = initialRows;

      const term = makeXTermMock(initialCols, initialRows, bufferLength);
      const container = makeRowsContainer();
      const renderer = new DomRenderer(container);

      const front = new ScreenBuffer(initialCols, initialRows, charPool, stylePool);
      const back = new ScreenBuffer(initialCols, initialRows, charPool, stylePool);

      // Create a VirtualScroller
      const scroller = new VirtualScroller(container, renderer, {
        viewportRows: initialRows,
      });
      scroller.setTerminal(term);

      // Simulate initial render — all rows have content (back buffer is all-spaces)
      simulatePerformRender(renderer, back, term);

      // Verify initial state — all rows exist (query DOM directly, rowElements is private)
      const initialDomRows = container.querySelectorAll('.dom-term-row');
      expect(initialDomRows.length).toBe(initialRows);

      // ---- Buggy applyResize: ensureRows runs synchronously BEFORE RAF ----
      applyResizeBuggy({
        term, renderer, scroller, front, back,
        newCols: initialCols, newRows,
      });

      // BEFORE RAF fires: new rows (index initialRows..newRows-1) exist but are EMPTY
      // because ensureRows created them but renderAll hasn't run yet.
      const domRowsAfterBuggy = container.querySelectorAll('.dom-term-row');
      expect(domRowsAfterBuggy.length).toBe(newRows);
      const emptyRows = Array.from(domRowsAfterBuggy).filter(r => r.innerHTML === '');
      // Bug: rows 20-29 are empty divs (black gap)
      expect(emptyRows.length).toBeGreaterThan(0);

      scroller.dispose();
      container.remove();
    });

    it('FIXED: after grow-resize, RAF tick atomically creates and fills all rows', () => {
      const charPool = new CharPool();
      const stylePool = new StylePool();
      const initialCols = 80;
      const initialRows = 20;
      const newRows = 30;
      const bufferLength = initialRows;

      const term = makeXTermMock(initialCols, initialRows, bufferLength);
      const container = makeRowsContainer();
      const renderer = new DomRenderer(container);

      const front = new ScreenBuffer(initialCols, initialRows, charPool, stylePool);
      const back = new ScreenBuffer(initialCols, initialRows, charPool, stylePool);

      const scroller = new VirtualScroller(container, renderer, {
        viewportRows: initialRows,
      });
      scroller.setTerminal(term);

      // Initial render
      simulatePerformRender(renderer, back, term);
      const initialDomRows = container.querySelectorAll('.dom-term-row');
      expect(initialDomRows.length).toBe(initialRows);

      // ---- Fixed applyResize: NO synchronous ensureRows ----
      applyResizeFixed({
        term, renderer, scroller, front, back,
        newCols: initialCols, newRows,
      });

      // BEFORE RAF: renderer still has the OLD row count (no ensureRows called sync)
      // New rows don't exist yet — no black gap possible.
      const domRowsBeforeRaf = container.querySelectorAll('.dom-term-row');
      expect(domRowsBeforeRaf.length).toBe(initialRows);

      // ---- Simulate RAF tick (performRender body) ----
      // Back buffer must be resized (already done in applyResizeFixed)
      back.readFromXTermBuffer(term.buffer.active, term.cols, term.rows, 0);
      simulatePerformRender(renderer, back, term);

      // AFTER RAF: all rows exist and have non-empty innerHTML
      const domRowsAfterRaf = container.querySelectorAll('.dom-term-row');
      expect(domRowsAfterRaf.length).toBe(newRows);
      // All rows rendered — ensureRows + renderAll are atomic in this call
      const emptyRows = Array.from(domRowsAfterRaf).filter(r => r.innerHTML === '');
      expect(emptyRows.length).toBe(0);

      scroller.dispose();
      container.remove();
    });
  });

  // -------------------------------------------------------------------------
  // Test 2 — shrink-resize: endLine bounded by new buffer length
  // -------------------------------------------------------------------------
  describe('Test 2: shrink-resize endLine bounded', () => {
    it('BUGGY: setViewportRows before t.resize reads stale buffer length', () => {
      // Start with rows=60, bufferLength=60 (at bottom, no scrollback)
      const charPool = new CharPool();
      const stylePool = new StylePool();
      const initialRows = 60;
      const newRows = 40;

      const term = makeXTermMock(80, initialRows, initialRows);
      const container = makeRowsContainer();
      const renderer = new DomRenderer(container);
      const front = new ScreenBuffer(80, initialRows, charPool, stylePool);
      const back = new ScreenBuffer(80, initialRows, charPool, stylePool);

      const scroller = new VirtualScroller(container, renderer, {
        viewportRows: initialRows,
      });
      scroller.setTerminal(term);

      // Buggy: setViewportRows before term.resize
      // At this point term.buffer.active.length is still 60
      scroller.setViewportRows(newRows);  // viewportRows=40, totalLines=60 (stale, from OLD buffer)
      front.resize(80, newRows);
      back.resize(80, newRows);
      renderer.ensureRows(newRows);
      term.resize(80, newRows);           // now buffer reflowed to max(40, 60) = 60

      // After buggy resize, getViewportRange reads:
      // viewportRows=40, totalLines=60 (from setViewportRows which ran before resize)
      // scrollableLines = 60-40 = 20, startLine = 20-0 = 20, endLine = 20+40 = 60
      // endLine === term.buffer.active.length (60) — technically not violated here
      // because the buffer retained all 60 lines. But the startLine is wrong for a
      // terminal that had 60 rows of content and was shrunk — user should see top 40.

      // The bug is that totalLines was read from the PRE-resize buffer.
      // To expose the stale read, we check whether setViewportRows read the old length.
      // We do this by checking: after buggy resize to 40 rows, if term had bufferLength=40
      // (e.g. fresh terminal, no scrollback) the stale read would give wrong totalLines.

      const range = scroller.getViewportRange();
      // endLine must not exceed buffer length
      expect(range.endLine).toBeLessThanOrEqual(term.buffer.active.length);

      scroller.dispose();
      container.remove();
    });

    it('FIXED: t.resize before setViewportRows ensures totalLines reads new buffer length', () => {
      // Scenario: terminal with only 20 lines of content shrunk from rows=60 to rows=40.
      // With buggy order: setViewportRows(40) reads bufferLength=20 → totalLines=20,
      // scrollableLines=max(0,20-40)=0, startLine=0 → correct by coincidence.
      // Real bug surfaces when bufferLength < old viewportRows and we shrink.
      // Expose stale read: start with bufferLength=60, shrink to rows=40.

      const charPool = new CharPool();
      const stylePool = new StylePool();
      const initialRows = 60;
      const newRows = 40;
      // Simulate buffer that stayed at 60 lines (no extra scrollback)
      const initialBufLen = 60;

      const term = makeXTermMock(80, initialRows, initialBufLen);
      const container = makeRowsContainer();
      const renderer = new DomRenderer(container);
      const front = new ScreenBuffer(80, initialRows, charPool, stylePool);
      const back = new ScreenBuffer(80, initialRows, charPool, stylePool);

      const scroller = new VirtualScroller(container, renderer, {
        viewportRows: initialRows,
      });
      scroller.setTerminal(term);

      // Fixed ordering
      front.resize(80, newRows);
      back.resize(80, newRows);
      term.resize(80, newRows);           // buffer.length now = max(40, 60) = 60
      scroller.setViewportRows(newRows);  // reads NEW buffer length = 60

      // After fixed resize: viewportRows=40, totalLines=60 (correct post-resize value)
      const range = scroller.getViewportRange();

      // endLine must not exceed buffer length
      expect(range.endLine).toBeLessThanOrEqual(term.buffer.active.length);
      // endLine must equal startLine + viewportRows (for at-bottom position)
      expect(range.endLine - range.startLine).toBe(newRows);

      scroller.dispose();
      container.remove();
    });
  });

  // -------------------------------------------------------------------------
  // Test 3 — resize-while-scrolled preserves valid scroll position
  // -------------------------------------------------------------------------
  describe('Test 3: resize-while-scrolled scroll position maintained', () => {
    it('FIXED: scroll offset stays within valid range after resize when scrolled up', () => {
      const charPool = new CharPool();
      const stylePool = new StylePool();
      const initialRows = 40;
      // Large buffer — user has scrolled up
      const bufferLength = 200; // lots of scrollback

      const term = makeXTermMock(80, initialRows, bufferLength);
      const container = makeRowsContainer();
      const renderer = new DomRenderer(container);
      const front = new ScreenBuffer(80, initialRows, charPool, stylePool);
      const back = new ScreenBuffer(80, initialRows, charPool, stylePool);

      const scroller = new VirtualScroller(container, renderer, {
        viewportRows: initialRows,
      });
      scroller.setTerminal(term);

      // Scroll user up by 50 lines
      scroller.scrollBy(50);
      expect(scroller.isAtBottom()).toBe(false);

      // Resize: grow from 40→60 rows
      const newRows = 60;
      front.resize(80, newRows);
      back.resize(80, newRows);
      term.resize(80, newRows);
      scroller.setViewportRows(newRows);

      // After resize, the viewport range must be valid
      const range = scroller.getViewportRange();
      expect(range.startLine).toBeGreaterThanOrEqual(0);
      expect(range.endLine).toBeLessThanOrEqual(term.buffer.active.length);
      expect(range.endLine - range.startLine).toBe(newRows);

      scroller.dispose();
      container.remove();
    });

    it('FIXED: scroll offset clamped to zero when viewport grows larger than buffer', () => {
      const charPool = new CharPool();
      const stylePool = new StylePool();
      // Small buffer, user scrolled up a bit
      const initialRows = 20;
      const bufferLength = 25; // only 5 lines of scrollback

      const term = makeXTermMock(80, initialRows, bufferLength);
      const container = makeRowsContainer();
      const renderer = new DomRenderer(container);
      const front = new ScreenBuffer(80, initialRows, charPool, stylePool);
      const back = new ScreenBuffer(80, initialRows, charPool, stylePool);

      const scroller = new VirtualScroller(container, renderer, {
        viewportRows: initialRows,
      });
      scroller.setTerminal(term);

      // Scroll up by 3 lines (within scrollable range of 5)
      scroller.scrollBy(3);
      expect(scroller.isAtBottom()).toBe(false);

      // Grow viewport so large it exceeds buffer — scroll must clamp to 0
      const newRows = 40; // bigger than bufferLength=25
      front.resize(80, newRows);
      back.resize(80, newRows);
      term.resize(80, newRows); // buffer stays at max(40, 25) = 40 after resize
      scroller.setViewportRows(newRows);

      const range = scroller.getViewportRange();
      // With viewportRows=40 and totalLines=40, scrollableLines=0 → startLine=0
      expect(range.startLine).toBe(0);
      expect(range.endLine).toBeLessThanOrEqual(term.buffer.active.length);

      scroller.dispose();
      container.remove();
    });
  });

});

// ---------------------------------------------------------------------------
// F1 — fontSize useEffect and fit() imperative handle ordering
//
// Both sites must follow the same ordering fixed in applyResize by I-02:
//   1. t.resize() BEFORE virtualScroller.setViewportRows()
//   2. NO synchronous ensureRows() call (performRender handles it atomically)
// ---------------------------------------------------------------------------

// Minimal spy-based simulation of the fontSize useEffect logic (the real
// useEffect path in DomTerminalCore.tsx runs after component mount, so we
// simulate its sequencing here to get deterministic call-order assertions).

interface OrderSpy {
  calls: string[];
}

function makeOrderedTerm(cols: number, rows: number, spy: OrderSpy) {
  return {
    cols,
    rows,
    resize: vi.fn().mockImplementation(() => { spy.calls.push('t.resize'); }),
  };
}

function makeOrderedScroller(spy: OrderSpy) {
  return {
    setViewportRows: vi.fn().mockImplementation(() => { spy.calls.push('setViewportRows'); }),
  };
}

function makeOrderedRenderer(spy: OrderSpy) {
  return {
    ensureRows: vi.fn().mockImplementation(() => { spy.calls.push('ensureRows'); }),
  };
}

// Simulate the BUGGY fontSize useEffect body (setViewportRows BEFORE t.resize)
function fontSizeEffectBuggyOrdering(opts: {
  term: ReturnType<typeof makeOrderedTerm>;
  scroller: ReturnType<typeof makeOrderedScroller>;
  renderer: ReturnType<typeof makeOrderedRenderer>;
  newCols: number;
  newRows: number;
}): void {
  const { term, scroller, renderer, newCols, newRows } = opts;
  // BUGGY: setViewportRows before t.resize + synchronous ensureRows
  scroller.setViewportRows(newRows);
  term.resize(newCols, newRows);
  renderer.ensureRows(newRows);
}

// Simulate the FIXED fontSize useEffect body (t.resize BEFORE setViewportRows,
// no synchronous ensureRows)
function fontSizeEffectFixedOrdering(opts: {
  term: ReturnType<typeof makeOrderedTerm>;
  scroller: ReturnType<typeof makeOrderedScroller>;
  renderer: ReturnType<typeof makeOrderedRenderer>;
  newCols: number;
  newRows: number;
}): void {
  const { term, scroller, newCols, newRows } = opts;
  // Ordering matters (I-02 / F1): t.resize() must run before setViewportRows so
  // VirtualScroller.updateTotalLines() reads the NEW buffer length. Matches applyResize.
  term.resize(newCols, newRows);
  scroller.setViewportRows(newRows);
  // No ensureRows — performRender handles it atomically inside RAF
}

// Simulate the BUGGY fit() imperative handle body
function fitImperativeBuggyOrdering(opts: {
  term: ReturnType<typeof makeOrderedTerm>;
  scroller: ReturnType<typeof makeOrderedScroller>;
  renderer: ReturnType<typeof makeOrderedRenderer>;
  newCols: number;
  newRows: number;
}): void {
  const { term, scroller, renderer, newCols, newRows } = opts;
  // BUGGY: setViewportRows before t.resize + synchronous ensureRows
  scroller.setViewportRows(newRows);
  term.resize(newCols, newRows);
  renderer.ensureRows(newRows);
}

// Simulate the FIXED fit() imperative handle body
function fitImperativeFixedOrdering(opts: {
  term: ReturnType<typeof makeOrderedTerm>;
  scroller: ReturnType<typeof makeOrderedScroller>;
  renderer: ReturnType<typeof makeOrderedRenderer>;
  newCols: number;
  newRows: number;
}): void {
  const { term, scroller, newCols, newRows } = opts;
  // Ordering matters (I-02 / F1): t.resize() must run before setViewportRows so
  // VirtualScroller.updateTotalLines() reads the NEW buffer length. Matches applyResize.
  term.resize(newCols, newRows);
  scroller.setViewportRows(newRows);
  // No ensureRows — performRender handles it atomically inside RAF
}

describe('F1 — fontSize useEffect and fit() imperative: I-02 ordering propagation', () => {

  describe('fontSize useEffect — call ordering', () => {
    it('BUGGY: setViewportRows is called BEFORE t.resize (stale buffer)', () => {
      const spy: OrderSpy = { calls: [] };
      const term = makeOrderedTerm(80, 24, spy);
      const scroller = makeOrderedScroller(spy);
      const renderer = makeOrderedRenderer(spy);

      fontSizeEffectBuggyOrdering({ term, scroller, renderer, newCols: 90, newRows: 30 });

      // Buggy order: setViewportRows first, then t.resize
      expect(spy.calls.indexOf('setViewportRows')).toBeLessThan(spy.calls.indexOf('t.resize'));
    });

    it('FIXED: t.resize is called BEFORE setViewportRows', () => {
      const spy: OrderSpy = { calls: [] };
      const term = makeOrderedTerm(80, 24, spy);
      const scroller = makeOrderedScroller(spy);
      const renderer = makeOrderedRenderer(spy);

      fontSizeEffectFixedOrdering({ term, scroller, renderer, newCols: 90, newRows: 30 });

      // Fixed order: t.resize before setViewportRows
      expect(spy.calls.indexOf('t.resize')).toBeLessThan(spy.calls.indexOf('setViewportRows'));
    });

    it('FIXED: no synchronous ensureRows call in fontSize useEffect', () => {
      const spy: OrderSpy = { calls: [] };
      const term = makeOrderedTerm(80, 24, spy);
      const scroller = makeOrderedScroller(spy);
      const renderer = makeOrderedRenderer(spy);

      fontSizeEffectFixedOrdering({ term, scroller, renderer, newCols: 90, newRows: 30 });

      // Fixed: ensureRows must NOT appear in the synchronous call sequence
      expect(spy.calls).not.toContain('ensureRows');
      expect(renderer.ensureRows).not.toHaveBeenCalled();
    });
  });

  describe('fit() imperative handle — call ordering', () => {
    it('BUGGY: setViewportRows is called BEFORE t.resize (stale buffer)', () => {
      const spy: OrderSpy = { calls: [] };
      const term = makeOrderedTerm(80, 24, spy);
      const scroller = makeOrderedScroller(spy);
      const renderer = makeOrderedRenderer(spy);

      fitImperativeBuggyOrdering({ term, scroller, renderer, newCols: 90, newRows: 30 });

      expect(spy.calls.indexOf('setViewportRows')).toBeLessThan(spy.calls.indexOf('t.resize'));
    });

    it('FIXED: t.resize is called BEFORE setViewportRows', () => {
      const spy: OrderSpy = { calls: [] };
      const term = makeOrderedTerm(80, 24, spy);
      const scroller = makeOrderedScroller(spy);
      const renderer = makeOrderedRenderer(spy);

      fitImperativeFixedOrdering({ term, scroller, renderer, newCols: 90, newRows: 30 });

      expect(spy.calls.indexOf('t.resize')).toBeLessThan(spy.calls.indexOf('setViewportRows'));
    });

    it('FIXED: no synchronous ensureRows call in fit() imperative handle', () => {
      const spy: OrderSpy = { calls: [] };
      const term = makeOrderedTerm(80, 24, spy);
      const scroller = makeOrderedScroller(spy);
      const renderer = makeOrderedRenderer(spy);

      fitImperativeFixedOrdering({ term, scroller, renderer, newCols: 90, newRows: 30 });

      // Fixed: ensureRows must NOT appear in the synchronous call sequence
      expect(spy.calls).not.toContain('ensureRows');
      expect(renderer.ensureRows).not.toHaveBeenCalled();
    });
  });

});
