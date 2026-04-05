/**
 * VirtualScroller unit tests.
 *
 * jsdom environment — DOM APIs available, requestAnimationFrame mocked.
 * We test the scroll-state machine and viewport-range calculations directly;
 * we do not test the scrollbar DOM appearance (visual-only).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { VirtualScroller, OVERSCAN } from '../VirtualScroller.js';
import type { VirtualScrollerOptions } from '../VirtualScroller.js';

// ---------------------------------------------------------------------------
// Minimal DomRenderer stub — VirtualScroller only holds a reference to it;
// current implementation does not call any DomRenderer methods directly.
// ---------------------------------------------------------------------------
function makeMockRenderer() {
  return {} as unknown as import('../DomRenderer.js').DomRenderer;
}

// ---------------------------------------------------------------------------
// Minimal xterm Terminal stub matching the API surface VirtualScroller uses:
//   term.rows, term.buffer.active.length
// ---------------------------------------------------------------------------
function makeMockTerm(rows = 24, bufferLength = 24): import('@xterm/xterm').Terminal {
  return {
    rows,
    buffer: {
      active: {
        length: bufferLength,
        viewportY: 0,
        cursorX: 0,
        cursorY: 0,
      },
    },
  } as unknown as import('@xterm/xterm').Terminal;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.width = '800px';
  el.style.height = '600px';
  document.body.appendChild(el);
  return el;
}

function makeScroller(
  opts: Partial<VirtualScrollerOptions> & { rows?: number; bufferLength?: number } = {}
): { scroller: VirtualScroller; container: HTMLDivElement; term: ReturnType<typeof makeMockTerm> } {
  const container = makeContainer();
  const renderer = makeMockRenderer();
  const { rows = 24, bufferLength = 24, ...scrollerOpts } = opts;
  const scroller = new VirtualScroller(container, renderer, {
    viewportRows: rows,
    maxScrollback: 5000,
    ...scrollerOpts,
  });
  const term = makeMockTerm(rows, bufferLength);
  scroller.setTerminal(term);
  return { scroller, container, term };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VirtualScroller', () => {
  let containers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const c of containers) c.remove();
    containers = [];
  });

  function track(container: HTMLDivElement) {
    containers.push(container);
    return container;
  }

  // -------------------------------------------------------------------------
  // Construction & OVERSCAN export
  // -------------------------------------------------------------------------

  describe('module exports', () => {
    it('exports OVERSCAN constant as a positive integer', () => {
      expect(typeof OVERSCAN).toBe('number');
      expect(OVERSCAN).toBeGreaterThan(0);
      expect(Number.isInteger(OVERSCAN)).toBe(true);
    });
  });

  describe('construction', () => {
    it('starts at bottom (isAtBottom = true)', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 24 });
      track(container);
      expect(scroller.isAtBottom()).toBe(true);
      scroller.dispose();
    });

    it('appends a scrollbar child element to the container', () => {
      const { scroller, container } = makeScroller();
      track(container);
      const scrollbar = container.querySelector('.dom-term-scrollbar');
      expect(scrollbar).not.toBeNull();
      scroller.dispose();
    });

    it('dispose removes scrollbar from DOM', () => {
      const { scroller, container } = makeScroller();
      track(container);
      scroller.dispose();
      expect(container.querySelector('.dom-term-scrollbar')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getViewportRange — no scrollback
  // -------------------------------------------------------------------------

  describe('getViewportRange — buffer equals viewport (no scrollback)', () => {
    it('returns startLine=0 when buffer length equals viewport rows', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 24 });
      track(container);
      const range = scroller.getViewportRange();
      expect(range.startLine).toBe(0);
      expect(range.endLine).toBe(24);
      scroller.dispose();
    });

    it('returns startLine=0 when buffer is smaller than viewport', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 10 });
      track(container);
      const range = scroller.getViewportRange();
      expect(range.startLine).toBe(0);
      scroller.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // getViewportRange — with scrollback
  // -------------------------------------------------------------------------

  describe('getViewportRange — with scrollback content', () => {
    it('at bottom: startLine = totalLines - viewportRows', () => {
      // 100 lines total, 24 rows viewport → startLine should be 76
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      expect(scroller.isAtBottom()).toBe(true);
      const range = scroller.getViewportRange();
      expect(range.startLine).toBe(76); // 100 - 24
      expect(range.endLine).toBe(100);
      scroller.dispose();
    });

    it('scrolled up 10 lines: startLine decreases by 10', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      scroller.scrollBy(10); // scroll up 10 lines
      const range = scroller.getViewportRange();
      expect(range.startLine).toBe(66); // 76 - 10
      expect(range.endLine).toBe(90);
      scroller.dispose();
    });

    it('scrolled to top: startLine = 0', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      scroller.scrollBy(9999); // scroll far past top
      const range = scroller.getViewportRange();
      expect(range.startLine).toBe(0);
      scroller.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // scrollBy
  // -------------------------------------------------------------------------

  describe('scrollBy', () => {
    it('scrollBy(0) is a no-op', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      scroller.scrollBy(0);
      expect(scroller.isAtBottom()).toBe(true);
      scroller.dispose();
    });

    it('scrollBy positive moves away from bottom', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      scroller.scrollBy(5);
      expect(scroller.isAtBottom()).toBe(false);
      scroller.dispose();
    });

    it('scrollBy negative from scrolled position moves toward bottom', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      scroller.scrollBy(20);
      scroller.scrollBy(-10);
      // offset is now 10, not at bottom
      expect(scroller.isAtBottom()).toBe(false);
      const range = scroller.getViewportRange();
      // scrollableLines = 76, offset = 10 → startLine = 66
      expect(range.startLine).toBe(66);
      scroller.dispose();
    });

    it('scrollBy negative past zero clamps at bottom', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      scroller.scrollBy(5);
      scroller.scrollBy(-999);
      expect(scroller.isAtBottom()).toBe(true);
      scroller.dispose();
    });

    it('scrollBy positive past max clamps at top of scrollback', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      scroller.scrollBy(9999);
      const range = scroller.getViewportRange();
      expect(range.startLine).toBe(0); // clamped to buffer start
      scroller.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // scrollToBottom
  // -------------------------------------------------------------------------

  describe('scrollToBottom', () => {
    it('resets to bottom after scrolling up', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      scroller.scrollBy(30);
      expect(scroller.isAtBottom()).toBe(false);
      scroller.scrollToBottom();
      expect(scroller.isAtBottom()).toBe(true);
      const range = scroller.getViewportRange();
      expect(range.startLine).toBe(76);
      scroller.dispose();
    });

    it('is idempotent when already at bottom', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      scroller.scrollToBottom();
      expect(scroller.isAtBottom()).toBe(true);
      scroller.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // onNewOutput — auto-scroll behaviour
  // -------------------------------------------------------------------------

  describe('onNewOutput', () => {
    it('stays at bottom when new output arrives while pinned', () => {
      const { scroller, container, term } = makeScroller({ rows: 24, bufferLength: 24 });
      track(container);
      // Simulate 10 new lines pushed into buffer
      (term.buffer.active as { length: number }).length = 34;
      scroller.onNewOutput();
      expect(scroller.isAtBottom()).toBe(true);
      const range = scroller.getViewportRange();
      expect(range.startLine).toBe(10); // 34 - 24
      scroller.dispose();
    });

    it('tracks content position when scrolled up and new output arrives', () => {
      const { scroller, container, term } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      scroller.scrollBy(20); // scroll up 20 lines
      expect(scroller.isAtBottom()).toBe(false);

      // 10 new lines added — onNewOutput self-computes delta from previous totalLines
      (term.buffer.active as { length: number }).length = 110;
      scroller.onNewOutput();
      expect(scroller.isAtBottom()).toBe(false);
      // scrollOffset should have grown to keep showing the same content
      // new scrollableLines = 110 - 24 = 86; offset should be min(86, 20+10) = 30
      const range = scroller.getViewportRange();
      expect(range.startLine).toBe(56); // 86 - 30
      scroller.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // setViewportRows — resize
  // -------------------------------------------------------------------------

  describe('setViewportRows', () => {
    it('updates viewport and re-clamps offset', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      scroller.scrollBy(70); // near top (max scrollable = 76)
      // shrink viewport to 10 rows — now scrollableLines = 90
      scroller.setViewportRows(10);
      const range = scroller.getViewportRange();
      // offset was 70, still valid since scrollableLines = 90
      expect(range.startLine).toBe(20); // 90 - 70
      scroller.dispose();
    });

    it('clamps offset if new viewport makes scrollable range smaller', () => {
      const { scroller, container } = makeScroller({ rows: 10, bufferLength: 100 });
      track(container);
      scroller.scrollBy(85); // offset = 85 (max scrollable = 90)
      // grow viewport to 60 rows — now scrollableLines = 40
      scroller.setViewportRows(60);
      const range = scroller.getViewportRange();
      // offset was clamped to 40
      expect(range.startLine).toBe(0); // 40 - 40 = 0
      scroller.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // consumeDirtyRows
  // -------------------------------------------------------------------------

  describe('consumeDirtyRows', () => {
    it('returns null before any scroll', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      expect(scroller.consumeDirtyRows()).toBeNull();
      scroller.dispose();
    });

    it('returns dirty set for a small upward scroll', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      scroller.scrollBy(3); // scroll up 3 rows
      const dirty = scroller.consumeDirtyRows();
      // top 3 rows (0, 1, 2) are newly exposed
      expect(dirty).not.toBeNull();
      expect(dirty!.has(0)).toBe(true);
      expect(dirty!.has(1)).toBe(true);
      expect(dirty!.has(2)).toBe(true);
      expect(dirty!.has(3)).toBe(false);
      scroller.dispose();
    });

    it('returns dirty set for a small downward scroll', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      scroller.scrollBy(10); // first scroll up
      scroller.consumeDirtyRows(); // clear
      scroller.scrollBy(-3); // scroll down 3
      const dirty = scroller.consumeDirtyRows();
      // bottom 3 rows (21, 22, 23) are newly exposed
      expect(dirty).not.toBeNull();
      expect(dirty!.has(21)).toBe(true);
      expect(dirty!.has(22)).toBe(true);
      expect(dirty!.has(23)).toBe(true);
      expect(dirty!.has(20)).toBe(false);
      scroller.dispose();
    });

    it('returns null for a full-viewport jump', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 5000 });
      track(container);
      scroller.scrollBy(500); // more than viewportRows — full jump
      const dirty = scroller.consumeDirtyRows();
      expect(dirty).toBeNull();
      scroller.dispose();
    });

    it('is consumed once — returns null on second call', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      scroller.scrollBy(3);
      scroller.consumeDirtyRows();
      expect(scroller.consumeDirtyRows()).toBeNull();
      scroller.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // handleWheel
  // -------------------------------------------------------------------------

  describe('handleWheel', () => {
    function makeWheelEvent(deltaY: number, deltaMode = 0): WheelEvent {
      return new WheelEvent('wheel', {
        deltaY,
        deltaMode,
        bubbles: true,
        cancelable: true,
      });
    }

    it('does nothing when no scrollback available (buffer = viewport)', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 24 });
      track(container);
      const e = makeWheelEvent(-100);
      scroller.handleWheel(e);
      expect(scroller.isAtBottom()).toBe(true);
      scroller.dispose();
    });

    it('scrolls up on negative deltaY (pixel mode)', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      const e = makeWheelEvent(-100, 0); // pixel mode, scroll up
      scroller.handleWheel(e);
      expect(scroller.isAtBottom()).toBe(false);
      scroller.dispose();
    });

    it('scrolls down on positive deltaY (pixel mode)', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      scroller.scrollBy(10); // scroll up first
      const e = makeWheelEvent(100, 0); // scroll down
      scroller.handleWheel(e);
      // should have scrolled back toward bottom
      const range = scroller.getViewportRange();
      expect(range.startLine).toBeGreaterThan(66); // was 66, now closer to 76
      scroller.dispose();
    });

    it('handles line-mode delta (deltaMode=1)', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      const e = makeWheelEvent(-3, 1); // 3 lines up
      scroller.handleWheel(e);
      expect(scroller.isAtBottom()).toBe(false);
      const range = scroller.getViewportRange();
      expect(range.startLine).toBe(73); // 76 - 3
      scroller.dispose();
    });

    it('handles page-mode delta (deltaMode=2)', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      const e = makeWheelEvent(-1, 2); // 1 page up
      scroller.handleWheel(e);
      const range = scroller.getViewportRange();
      // 1 page = 24 rows up; startLine = max(0, 76 - 24) = 52
      expect(range.startLine).toBe(52);
      scroller.dispose();
    });

    it('small pixel delta scrolls exactly 1 line', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      const e = makeWheelEvent(-10, 0); // < WHEEL_SMALL_DELTA_PX threshold
      scroller.handleWheel(e);
      const range = scroller.getViewportRange();
      expect(range.startLine).toBe(75); // 76 - 1
      scroller.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // handleKeyDown
  // -------------------------------------------------------------------------

  describe('handleKeyDown', () => {
    function makeKeyEvent(key: string, ctrlKey = false): KeyboardEvent {
      return new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true });
    }

    it('PageUp scrolls up by viewportRows - 1', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 200 });
      track(container);
      scroller.handleKeyDown(makeKeyEvent('PageUp'));
      const range = scroller.getViewportRange();
      // scrollableLines = 176; at bottom startLine = 176; after PageUp = 176 - 23 = 153
      expect(range.startLine).toBe(153);
      scroller.dispose();
    });

    it('PageDown scrolls down by viewportRows - 1', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 200 });
      track(container);
      scroller.scrollBy(50); // go up 50 first
      scroller.handleKeyDown(makeKeyEvent('PageDown'));
      const range = scroller.getViewportRange();
      // offset was 50, after PageDown = 50 - 23 = 27; startLine = 176 - 27 = 149
      expect(range.startLine).toBe(149);
      scroller.dispose();
    });

    it('Ctrl+Home scrolls to top of scrollback', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 200 });
      track(container);
      scroller.handleKeyDown(makeKeyEvent('Home', true));
      const range = scroller.getViewportRange();
      expect(range.startLine).toBe(0);
      scroller.dispose();
    });

    it('Ctrl+End scrolls to bottom', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 200 });
      track(container);
      scroller.scrollBy(50);
      scroller.handleKeyDown(makeKeyEvent('End', true));
      expect(scroller.isAtBottom()).toBe(true);
      scroller.dispose();
    });

    it('Home without Ctrl is a no-op for scroller', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 200 });
      track(container);
      scroller.scrollBy(20);
      scroller.handleKeyDown(makeKeyEvent('Home', false));
      expect(scroller.isAtBottom()).toBe(false); // unchanged
      scroller.dispose();
    });

    it('non-scroll key is a no-op', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      scroller.handleKeyDown(makeKeyEvent('a'));
      expect(scroller.isAtBottom()).toBe(true);
      scroller.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // touch scroll handlers
  // -------------------------------------------------------------------------

  describe('touch scroll', () => {
    /** Helper: build a minimal TouchEvent with a single touch point at clientY. */
    function makeTouchEvent(type: string, clientY: number, touchCount = 1): TouchEvent {
      const touches: Touch[] = [];
      for (let i = 0; i < touchCount; i++) {
        touches.push({ clientY, clientX: 0, identifier: i } as unknown as Touch);
      }
      return new TouchEvent(type, {
        touches,
        changedTouches: touches,
        bubbles: true,
        cancelable: true,
      });
    }

    it('touchstart on container with scrollback shows scrollbar', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      // Find the scrollbar element
      const scrollbar = container.querySelector('.dom-term-scrollbar') as HTMLElement;
      expect(scrollbar).not.toBeNull();

      const startEvent = makeTouchEvent('touchstart', 300);
      container.dispatchEvent(startEvent);
      // Scrollbar should be shown (opacity = '1')
      expect(scrollbar.style.opacity).toBe('1');
      scroller.dispose();
    });

    it('touchstart is ignored on single-line buffer (no scrollback)', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 24 });
      track(container);
      const scrollbar = container.querySelector('.dom-term-scrollbar') as HTMLElement;

      const startEvent = makeTouchEvent('touchstart', 300);
      container.dispatchEvent(startEvent);
      // No scrollback means scrollbar stays hidden
      expect(scrollbar.style.opacity).not.toBe('1');
      scroller.dispose();
    });

    it('touchstart with multiple touches (pinch) is ignored', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      const initialOffset = scroller.isAtBottom();

      const startEvent = makeTouchEvent('touchstart', 300, 2);
      container.dispatchEvent(startEvent);
      // State should be unchanged
      expect(scroller.isAtBottom()).toBe(initialOffset);
      scroller.dispose();
    });

    it('swipe up (finger moves up) scrolls buffer up, increasing offset', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      expect(scroller.isAtBottom()).toBe(true);

      // Mock clientHeight so we get a predictable lineHeight
      Object.defineProperty(container, 'clientHeight', { value: 480, configurable: true });

      // touchstart at y=400, touchmove to y=360 (finger moves up 40px)
      // totalDeltaY = 400 - 360 = 40; lineHeight = 480/24 = 20
      // totalDeltaLines = round(40/20) = 2; scrollBy(2) → offset 0→2
      container.dispatchEvent(makeTouchEvent('touchstart', 400));
      container.dispatchEvent(makeTouchEvent('touchmove', 360));
      expect(scroller.isAtBottom()).toBe(false);
      // scrollableLines=76, offset=2 → startLine = 76-2 = 74
      const range = scroller.getViewportRange();
      expect(range.startLine).toBe(74);
      scroller.dispose();
    });

    it('swipe down (finger moves down) scrolls buffer down, decreasing offset', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      // First scroll up so there is room to scroll down
      scroller.scrollBy(20);
      expect(scroller.isAtBottom()).toBe(false);

      Object.defineProperty(container, 'clientHeight', { value: 480, configurable: true });

      // touchstart at y=200, touchmove to y=220 (finger moves down 20px)
      // totalDeltaY = 200 - 220 = -20; lineHeight=20; totalDeltaLines = round(-20/20) = -1
      // scrollBy(-1) → offset 20→19
      container.dispatchEvent(makeTouchEvent('touchstart', 200));
      container.dispatchEvent(makeTouchEvent('touchmove', 220));
      // scrollableLines=76, offset=19 → startLine = 76-19 = 57
      const range = scroller.getViewportRange();
      expect(range.startLine).toBe(57);
      scroller.dispose();
    });

    it('touchmove with multiple touches is ignored', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);

      container.dispatchEvent(makeTouchEvent('touchstart', 300));
      container.dispatchEvent(makeTouchEvent('touchmove', 200, 2)); // 2-finger move
      // No scroll should have occurred
      expect(scroller.isAtBottom()).toBe(true);
      scroller.dispose();
    });

    it('touchend does not crash when called after touchstart', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      container.dispatchEvent(makeTouchEvent('touchstart', 300));
      // Should not throw
      expect(() => container.dispatchEvent(makeTouchEvent('touchend', 300))).not.toThrow();
      scroller.dispose();
    });

    it('dispose cancels any pending momentum animation', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      // Trigger a touchend with enough velocity to start momentum
      container.dispatchEvent(makeTouchEvent('touchstart', 300));
      // Simulate rapid move to build velocity
      container.dispatchEvent(makeTouchEvent('touchmove', 200));
      container.dispatchEvent(makeTouchEvent('touchend', 200));
      // dispose must not throw even if RAF is pending
      expect(() => scroller.dispose()).not.toThrow();
    });

    it('mouseenter shows scrollbar when scrollback exists', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      const scrollbar = container.querySelector('.dom-term-scrollbar') as HTMLElement;

      container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      expect(scrollbar.style.opacity).toBe('1');
      scroller.dispose();
    });

    it('mouseleave hides scrollbar', () => {
      const { scroller, container } = makeScroller({ rows: 24, bufferLength: 100 });
      track(container);
      const scrollbar = container.querySelector('.dom-term-scrollbar') as HTMLElement;

      container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      expect(scrollbar.style.opacity).toBe('1');
      container.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      expect(scrollbar.style.opacity).toBe('0');
      scroller.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // setTerminal
  // -------------------------------------------------------------------------

  describe('setTerminal', () => {
    it('reads buffer length from the provided terminal', () => {
      const container = makeContainer();
      track(container);
      const renderer = makeMockRenderer();
      const scroller = new VirtualScroller(container, renderer, { viewportRows: 24 });
      const term = makeMockTerm(24, 500);
      scroller.setTerminal(term);
      // With 500 lines and 24 rows, scrollable = 476; at bottom startLine = 476
      const range = scroller.getViewportRange();
      expect(range.startLine).toBe(476);
      scroller.dispose();
    });

    it('updates viewportRows from term.rows', () => {
      const container = makeContainer();
      track(container);
      const renderer = makeMockRenderer();
      // Construct with rows=10, but term has rows=40
      const scroller = new VirtualScroller(container, renderer, { viewportRows: 10 });
      const term = makeMockTerm(40, 100);
      scroller.setTerminal(term);
      // viewportRows now = 40; scrollable = 60; at bottom startLine = 60
      const range = scroller.getViewportRange();
      expect(range.startLine).toBe(60);
      scroller.dispose();
    });
  });
});
