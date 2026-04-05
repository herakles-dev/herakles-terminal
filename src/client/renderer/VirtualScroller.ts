/**
 * VirtualScroller — Efficient scrollback navigation for the DOM terminal renderer.
 *
 * Design:
 * - Tracks a `scrollOffset` (lines scrolled up from bottom, 0 = at bottom).
 * - Keeps a fixed-size pool of `viewportRows + 2*OVERSCAN` row divs that get
 *   recycled on scroll (no create/destroy per scroll step).
 * - On every render tick, callers call getViewportRange() to determine which
 *   slice of the xterm buffer ScreenBuffer should read.
 * - A virtual scrollbar DIV is rendered inside the container; its thumb position
 *   reflects the current scroll position relative to total scrollback length.
 * - Auto-scroll: if the terminal was at bottom before new output arrives, it
 *   snaps back to bottom automatically.
 *
 * Row recycling strategy:
 * - DomRenderer owns a rowPool (surplus rows beyond viewport). On scroll,
 *   VirtualScroller calls DomRenderer.recycleRows(shift) which rotates the
 *   rendered row elements and marks only the newly-exposed rows dirty.
 * - This avoids full re-renders on single-line scroll steps.
 *
 * Integration with DomTerminalCore:
 *   1. Construct VirtualScroller(visibleContainer, renderer, { viewportRows, ... })
 *   2. After term.open(), call scroller.setTerminal(term)
 *   3. Wire wheel events: visibleContainer.addEventListener('wheel', e => scroller.handleWheel(e))
 *   4. In performRender(): const range = scroller.getViewportRange(); then
 *      backBuf.readFromXTermBuffer(term.buffer.active, cols, rows, range.startLine)
 *      Note: ScreenBuffer.readFromXTermBuffer already uses buffer.viewportY as the
 *      start line — VirtualScroller overrides this by temporarily adjusting viewportY
 *      via term.scrollLines() OR by passing an explicit startLine (preferred).
 *
 * Buffer read integration:
 *   VirtualScroller does NOT call readFromXTermBuffer directly. Instead, it exposes
 *   getViewportRange() which DomTerminalCore passes to a new overload of
 *   readFromXTermBuffer that accepts an explicit startLine parameter.
 */

import type { Terminal as XTerm } from '@xterm/xterm';
import type { DomRenderer } from './DomRenderer.js';

// Number of rows to render above and below the visible viewport.
// Reduces blank-row flicker during rapid scrolling.
export const OVERSCAN = 5;

// Minimum scrollbar thumb height in pixels — raised to 44px for touch targets
const MIN_THUMB_PX = 44;

// Scrollbar track width for touch hit area (visual thumb remains at 6px inside)
const SCROLLBAR_TRACK_WIDTH = 44;
const SCROLLBAR_THUMB_WIDTH = 6;

// Wheel scroll sensitivity: lines per 100px of deltaY
const WHEEL_LINES_PER_100PX = 3;

// Passive wheel threshold: if |deltaY| < this px, treat as one-line scroll
const WHEEL_SMALL_DELTA_PX = 50;

// Touch momentum constants
const TOUCH_MOMENTUM_DECAY = 0.85;
const TOUCH_MOMENTUM_MIN_VELOCITY = 0.3;
const TOUCH_MOMENTUM_SCALE = 0.08;

// Duration to keep scrollbar visible after last touch event (ms)
const TOUCH_SCROLLBAR_HIDE_DELAY_MS = 1500;

export interface VirtualScrollerOptions {
  /** Current viewport height in rows */
  viewportRows: number;
  /** Maximum scrollback lines (default: 5000) */
  maxScrollback?: number;
  /** Called after scroll position changes — use to trigger re-render */
  onScrollChange?: () => void;
}

export interface ViewportRange {
  /** First line index in xterm buffer to read (0-based) */
  startLine: number;
  /** Last line index (exclusive) */
  endLine: number;
}

export class VirtualScroller {
  private container: HTMLElement;

  // How many lines we're scrolled up from the bottom (0 = at bottom)
  private scrollOffset = 0;
  // True while the user is actively scrolling up (not at bottom)
  private _isAtBottom = true;

  // Viewport dimensions
  private viewportRows: number;

  // Total lines in xterm buffer (updated on each render)
  private totalLines = 0;
  // Tracks totalLines as of the last onNewOutput() call. Separate from
  // this.totalLines which can be mutated by getViewportRange() — using
  // this.totalLines directly caused missed deltas when getViewportRange()
  // ran between successive onNewOutput() calls (zeroing the delta).
  private prevTotalLinesAtOutput = 0;
  // xterm handle (set after open())
  private term: XTerm | null = null;

  // Scrollbar elements
  private scrollbarEl: HTMLDivElement | null = null;
  private thumbEl: HTMLDivElement | null = null;
  private scrollbarDragging = false;
  private scrollbarDragStartY = 0;
  private scrollbarDragStartOffset = 0;

  // Touch scroll state
  private touchStartY = 0;
  private touchPrevY = 0;
  private touchPrevDeltaLines = 0;
  private touchVelocity = 0;
  private touchMomentumRaf: number | null = null;
  private touchScrollbarHideTimer: ReturnType<typeof setTimeout> | null = null;

  // Bound event handlers for cleanup
  private boundWheel: (e: WheelEvent) => void;
  private boundScrollbarPointerDown: (e: PointerEvent) => void;
  private boundScrollbarPointerMove: (e: PointerEvent) => void;
  private boundScrollbarPointerUp: (e: PointerEvent) => void;
  private _boundKeyDown: (e: KeyboardEvent) => void;
  private boundTouchStart: (e: TouchEvent) => void;
  private boundTouchMove: (e: TouchEvent) => void;
  private boundTouchEnd: (e: TouchEvent) => void;
  private boundMouseEnter: () => void;
  private boundMouseLeave: () => void;

  // Dirty rows from last scroll step (for recycling optimisation)
  private dirtyFromScroll: Set<number> | null = null;

  // Callback to notify DomTerminalCore that scroll position changed and re-render is needed
  private onScrollChange: (() => void) | null = null;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(container: HTMLElement, _renderer: DomRenderer, opts: VirtualScrollerOptions) {
    this.container = container;
    this.viewportRows = opts.viewportRows;
    this.onScrollChange = opts.onScrollChange ?? null;

    this.boundWheel = this.handleWheel.bind(this);
    this.boundScrollbarPointerDown = this.onScrollbarPointerDown.bind(this);
    this.boundScrollbarPointerMove = this.onScrollbarPointerMove.bind(this);
    this.boundScrollbarPointerUp = this.onScrollbarPointerUp.bind(this);
    this._boundKeyDown = this.handleKeyDown.bind(this);
    this.boundTouchStart = this.onTouchStart.bind(this);
    this.boundTouchMove = this.onTouchMove.bind(this);
    this.boundTouchEnd = this.onTouchEnd.bind(this);
    this.boundMouseEnter = this.onMouseEnter.bind(this);
    this.boundMouseLeave = this.onMouseLeave.bind(this);

    this.buildScrollbar();
    this.attachEvents();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Call after xterm Terminal has been opened (term.open()).
   * Subscribes to xterm's onScroll event for auto-scroll behaviour.
   */
  setTerminal(term: XTerm): void {
    this.term = term;
    this.viewportRows = term.rows;
    this.updateTotalLines();
    this.prevTotalLinesAtOutput = this.totalLines;
  }

  /**
   * Update viewport row count when terminal is resized.
   */
  setViewportRows(rows: number): void {
    this.viewportRows = rows;
    this.updateTotalLines();
    this.prevTotalLinesAtOutput = this.totalLines;
    // After resize, clamp scroll offset and update scrollbar
    this.clampOffset();
    this.updateScrollbar();
  }

  /**
   * Get the buffer line range that should be rendered for the current scroll position.
   * DomTerminalCore passes startLine to ScreenBuffer.readFromXTermBuffer.
   */
  getViewportRange(): ViewportRange {
    this.updateTotalLines();
    const scrollableLines = Math.max(0, this.totalLines - this.viewportRows);
    const startLine = scrollableLines - this.scrollOffset;
    return {
      startLine: Math.max(0, startLine),
      endLine: Math.min(this.totalLines, startLine + this.viewportRows),
    };
  }

  /**
   * Scroll by `deltaRows` lines (positive = scroll up, negative = scroll down).
   * Returns the set of row indices that need re-rendering if row recycling
   * is used, or null to request a full re-render.
   */
  scrollBy(deltaRows: number): void {
    if (deltaRows === 0) return;

    const wasAtBottom = this._isAtBottom;
    const scrollableLines = Math.max(0, this.totalLines - this.viewportRows);

    this.scrollOffset = Math.max(
      0,
      Math.min(scrollableLines, this.scrollOffset + deltaRows)
    );

    this._isAtBottom = this.scrollOffset === 0;

    if (wasAtBottom !== this._isAtBottom || deltaRows !== 0) {
      this.updateScrollbar();
      this.computeRecycledDirtyRows(deltaRows);
      this.onScrollChange?.();
    }
  }

  /**
   * Snap the view to the bottom (most-recent output).
   */
  scrollToBottom(): void {
    if (this.scrollOffset === 0) return;
    this.scrollOffset = 0;
    this._isAtBottom = true;
    this.dirtyFromScroll = null; // need full render
    this.updateScrollbar();
    this.onScrollChange?.();
  }

  /**
   * Returns true when the terminal is showing the latest output (not scrolled up).
   */
  isAtBottom(): boolean {
    return this._isAtBottom;
  }

  /**
   * Called on new output arrival (xterm onRender / onScroll).
   * If the terminal was at the bottom, keep it there as new lines push content up.
   * If the user has scrolled up, the scroll offset grows to track the same content.
   *
   * Self-computes the line delta from previous totalLines — callers no longer need
   * to pass newLinesAdded (the parameter was always 0, breaking scroll-up tracking).
   */
  onNewOutput(): void {
    const prevTotal = this.prevTotalLinesAtOutput;
    this.updateTotalLines();
    this.prevTotalLinesAtOutput = this.totalLines;
    const delta = this.totalLines - prevTotal;

    if (this._isAtBottom) {
      // Stay pinned to bottom
      this.scrollOffset = 0;
    } else if (delta > 0) {
      // Keep showing the same content by scrolling up with the added lines
      const scrollableLines = Math.max(0, this.totalLines - this.viewportRows);
      this.scrollOffset = Math.min(scrollableLines, this.scrollOffset + delta);
    } else if (delta < 0) {
      // Buffer shrank (e.g. term.clear()) — clamp offset to valid range
      this.clampOffset();
    }

    this.updateScrollbar();
  }

  /**
   * Handle mouse wheel events. Called by the container's wheel event listener.
   */
  handleWheel(e: WheelEvent): void {
    // Only intercept vertical scrolling when we have scrollback to show
    const scrollableLines = Math.max(0, this.totalLines - this.viewportRows);
    if (scrollableLines === 0) return;

    e.preventDefault();

    let deltaLines: number;
    if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      // Already in lines
      deltaLines = Math.round(e.deltaY);
    } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      deltaLines = Math.round(e.deltaY) * this.viewportRows;
    } else {
      // Pixel mode — convert
      const absDelta = Math.abs(e.deltaY);
      if (absDelta < WHEEL_SMALL_DELTA_PX) {
        deltaLines = e.deltaY > 0 ? 1 : -1;
      } else {
        deltaLines = Math.round((e.deltaY / 100) * WHEEL_LINES_PER_100PX);
        if (deltaLines === 0) deltaLines = e.deltaY > 0 ? 1 : -1;
      }
    }

    // Positive deltaY = scroll down (content moves up) = reduce scrollOffset
    // Negative deltaY = scroll up (content moves down) = increase scrollOffset
    this.scrollBy(-deltaLines);
  }

  /**
   * Handle keyboard scroll events (Page Up/Down, Home, End, arrow keys).
   * Attach this to the container or terminal element.
   */
  handleKeyDown(e: KeyboardEvent): void {
    const scrollableLines = Math.max(0, this.totalLines - this.viewportRows);
    if (scrollableLines === 0) return;

    switch (e.key) {
      case 'PageUp':
        e.preventDefault();
        this.scrollBy(this.viewportRows - 1);
        break;
      case 'PageDown':
        e.preventDefault();
        this.scrollBy(-(this.viewportRows - 1));
        break;
      case 'Home':
        if (e.ctrlKey) {
          e.preventDefault();
          this.scrollBy(scrollableLines);
        }
        break;
      case 'End':
        if (e.ctrlKey) {
          e.preventDefault();
          this.scrollToBottom();
        }
        break;
    }
  }

  /**
   * If a scroll step produced a partial row shift, return the dirty rows
   * that need re-rendering. Returns null if a full render is required.
   * Consumed once per render cycle.
   */
  consumeDirtyRows(): Set<number> | null {
    const dirty = this.dirtyFromScroll;
    this.dirtyFromScroll = null;
    return dirty;
  }

  /**
   * Lifecycle: detach events, remove DOM elements.
   */
  dispose(): void {
    this.cancelMomentum();
    if (this.touchScrollbarHideTimer !== null) {
      clearTimeout(this.touchScrollbarHideTimer);
      this.touchScrollbarHideTimer = null;
    }
    this.detachEvents();
    this.scrollbarEl?.remove();
    this.scrollbarEl = null;
    this.thumbEl = null;
    this.term = null;
  }

  // ---------------------------------------------------------------------------
  // Private — scrollbar
  // ---------------------------------------------------------------------------

  private buildScrollbar(): void {
    const scrollbar = document.createElement('div');
    scrollbar.className = 'dom-term-scrollbar';
    scrollbar.setAttribute('aria-hidden', 'true');
    scrollbar.style.cssText = [
      'position:absolute',
      'right:0',
      'top:0',
      'bottom:0',
      `width:${SCROLLBAR_TRACK_WIDTH}px`,
      'z-index:20',
      'opacity:0',
      'transition:opacity 0.2s',
      'pointer-events:auto',
      'background:transparent',
    ].join(';');

    const thumb = document.createElement('div');
    thumb.className = 'dom-term-scrollbar-thumb';
    thumb.style.cssText = [
      'position:absolute',
      `right:0`,
      `width:${SCROLLBAR_THUMB_WIDTH}px`,
      `margin-right:${(SCROLLBAR_TRACK_WIDTH - SCROLLBAR_THUMB_WIDTH) / 2}px`,
      'border-radius:3px',
      'background:rgba(128,128,128,0.5)',
      'cursor:pointer',
      'transition:background 0.1s',
      `min-height:${MIN_THUMB_PX}px`,
    ].join(';');

    scrollbar.appendChild(thumb);
    this.container.appendChild(scrollbar);

    this.scrollbarEl = scrollbar;
    this.thumbEl = thumb;
  }

  private updateScrollbar(): void {
    if (!this.scrollbarEl || !this.thumbEl) return;

    const scrollableLines = Math.max(0, this.totalLines - this.viewportRows);

    if (scrollableLines === 0) {
      // No scrollback — hide scrollbar
      this.scrollbarEl.style.opacity = '0';
      this.scrollbarEl.style.pointerEvents = 'none';
      return;
    }

    this.scrollbarEl.style.pointerEvents = 'auto';

    const containerHeight = this.container.clientHeight || 400;
    const thumbRatio = Math.min(1, this.viewportRows / this.totalLines);
    const thumbHeight = Math.max(MIN_THUMB_PX, thumbRatio * containerHeight);

    // scrollOffset=0 → thumb at bottom, scrollOffset=max → thumb at top
    const trackHeight = containerHeight - thumbHeight;
    const thumbTop =
      scrollableLines > 0
        ? ((scrollableLines - this.scrollOffset) / scrollableLines) * trackHeight
        : 0;

    this.thumbEl.style.height = `${thumbHeight}px`;
    this.thumbEl.style.top = `${Math.max(0, Math.min(trackHeight, thumbTop))}px`;
  }

  // ---------------------------------------------------------------------------
  // Private — scrollbar visibility helpers
  // ---------------------------------------------------------------------------

  private showScrollbar(): void {
    if (!this.scrollbarEl || this.totalLines <= this.viewportRows) return;
    this.scrollbarEl.style.opacity = '1';
  }

  private hideScrollbar(): void {
    if (!this.scrollbarEl || this.scrollbarDragging) return;
    this.scrollbarEl.style.opacity = '0';
  }

  private onMouseEnter(): void {
    this.showScrollbar();
  }

  private onMouseLeave(): void {
    this.hideScrollbar();
  }

  /** Show scrollbar and schedule auto-hide after TOUCH_SCROLLBAR_HIDE_DELAY_MS. */
  private touchShowScrollbar(): void {
    this.showScrollbar();
    if (this.touchScrollbarHideTimer !== null) {
      clearTimeout(this.touchScrollbarHideTimer);
    }
    this.touchScrollbarHideTimer = setTimeout(() => {
      this.touchScrollbarHideTimer = null;
      this.hideScrollbar();
    }, TOUCH_SCROLLBAR_HIDE_DELAY_MS);
  }

  // ---------------------------------------------------------------------------
  // Private — touch scroll handlers
  // ---------------------------------------------------------------------------

  private onTouchStart(e: TouchEvent): void {
    // Ignore multi-touch (pinch-zoom etc.)
    if (e.touches.length > 1) return;

    const scrollableLines = Math.max(0, this.totalLines - this.viewportRows);
    if (scrollableLines === 0) return;

    this.cancelMomentum();

    this.touchStartY = e.touches[0].clientY;
    this.touchPrevY = this.touchStartY;
    this.touchPrevDeltaLines = 0;
    this.touchVelocity = 0;

    this.touchShowScrollbar();
  }

  private onTouchMove(e: TouchEvent): void {
    if (e.touches.length > 1) return;

    const scrollableLines = Math.max(0, this.totalLines - this.viewportRows);
    if (scrollableLines === 0) return;

    // Must call preventDefault here to block native page scroll.
    // Listener is registered with { passive: false }.
    e.preventDefault();

    const currentY = e.touches[0].clientY;
    const totalDeltaY = this.touchStartY - currentY;
    const lineHeight = this.container.clientHeight / Math.max(1, this.viewportRows);
    const totalDeltaLines = Math.round(totalDeltaY / lineHeight);

    // Incremental delta since last move
    const incrementalDelta = totalDeltaLines - this.touchPrevDeltaLines;

    // Track velocity for momentum (lines per pixel of finger movement)
    const pixelDelta = this.touchPrevY - currentY;
    this.touchVelocity = pixelDelta / lineHeight;

    this.touchPrevY = currentY;
    this.touchPrevDeltaLines = totalDeltaLines;

    if (incrementalDelta !== 0) {
      this.scrollBy(incrementalDelta);
      this.touchShowScrollbar();
    }
  }

  private onTouchEnd(_e: TouchEvent): void {
    // Apply momentum if velocity is above threshold
    if (Math.abs(this.touchVelocity) > TOUCH_MOMENTUM_MIN_VELOCITY) {
      this.startMomentum(this.touchVelocity);
    }
    this.touchShowScrollbar();
  }

  private startMomentum(initialVelocity: number): void {
    let velocity = initialVelocity;

    const step = () => {
      // Decay velocity
      velocity *= TOUCH_MOMENTUM_DECAY;

      if (Math.abs(velocity) < TOUCH_MOMENTUM_MIN_VELOCITY) {
        this.touchMomentumRaf = null;
        return;
      }

      const deltaLines = Math.round(velocity * TOUCH_MOMENTUM_SCALE * 100);
      if (deltaLines !== 0) {
        this.scrollBy(deltaLines);
      }

      this.touchMomentumRaf = requestAnimationFrame(step);
    };

    this.touchMomentumRaf = requestAnimationFrame(step);
  }

  private cancelMomentum(): void {
    if (this.touchMomentumRaf !== null) {
      cancelAnimationFrame(this.touchMomentumRaf);
      this.touchMomentumRaf = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private — scrollbar drag
  // ---------------------------------------------------------------------------

  private onScrollbarPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    this.scrollbarDragging = true;
    this.scrollbarDragStartY = e.clientY;
    this.scrollbarDragStartOffset = this.scrollOffset;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (this.scrollbarEl) this.scrollbarEl.style.opacity = '1';
  }

  private onScrollbarPointerMove(e: PointerEvent): void {
    if (!this.scrollbarDragging || !this.thumbEl) return;

    const containerHeight = this.container.clientHeight || 400;
    const thumbHeight = parseInt(this.thumbEl.style.height, 10) || MIN_THUMB_PX;
    const trackHeight = Math.max(1, containerHeight - thumbHeight);
    const scrollableLines = Math.max(1, this.totalLines - this.viewportRows);

    const deltaY = e.clientY - this.scrollbarDragStartY;
    const deltaRatio = deltaY / trackHeight;
    const deltaLines = Math.round(deltaRatio * scrollableLines);

    this.scrollOffset = Math.max(
      0,
      Math.min(scrollableLines, this.scrollbarDragStartOffset - deltaLines)
    );
    this._isAtBottom = this.scrollOffset === 0;
    this.dirtyFromScroll = null; // full render on drag
    this.updateScrollbar();
  }

  private onScrollbarPointerUp(e: PointerEvent): void {
    if (!this.scrollbarDragging) return;
    this.scrollbarDragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    // Hide scrollbar if mouse not over container
    if (this.scrollbarEl) {
      this.scrollbarEl.style.opacity = '0';
    }
  }

  // ---------------------------------------------------------------------------
  // Private — events
  // ---------------------------------------------------------------------------

  private attachEvents(): void {
    this.container.addEventListener('wheel', this.boundWheel, { passive: false });
    this.container.addEventListener('keydown', this._boundKeyDown);
    this.container.addEventListener('mouseenter', this.boundMouseEnter);
    this.container.addEventListener('mouseleave', this.boundMouseLeave);
    this.container.addEventListener('touchstart', this.boundTouchStart, { passive: true });
    this.container.addEventListener('touchmove', this.boundTouchMove, { passive: false });
    this.container.addEventListener('touchend', this.boundTouchEnd, { passive: true });

    if (this.thumbEl) {
      this.thumbEl.addEventListener('pointerdown', this.boundScrollbarPointerDown);
      this.thumbEl.addEventListener('pointermove', this.boundScrollbarPointerMove);
      this.thumbEl.addEventListener('pointerup', this.boundScrollbarPointerUp);
    }
  }

  private detachEvents(): void {
    this.container.removeEventListener('wheel', this.boundWheel);
    this.container.removeEventListener('keydown', this._boundKeyDown);
    this.container.removeEventListener('mouseenter', this.boundMouseEnter);
    this.container.removeEventListener('mouseleave', this.boundMouseLeave);
    this.container.removeEventListener('touchstart', this.boundTouchStart);
    this.container.removeEventListener('touchmove', this.boundTouchMove);
    this.container.removeEventListener('touchend', this.boundTouchEnd);

    if (this.thumbEl) {
      this.thumbEl.removeEventListener('pointerdown', this.boundScrollbarPointerDown);
      this.thumbEl.removeEventListener('pointermove', this.boundScrollbarPointerMove);
      this.thumbEl.removeEventListener('pointerup', this.boundScrollbarPointerUp);
    }
  }

  // ---------------------------------------------------------------------------
  // Private — helpers
  // ---------------------------------------------------------------------------

  private updateTotalLines(): void {
    if (this.term) {
      this.totalLines = this.term.buffer.active.length;
    }
  }

  private clampOffset(): void {
    const scrollableLines = Math.max(0, this.totalLines - this.viewportRows);
    if (this.scrollOffset > scrollableLines) {
      this.scrollOffset = scrollableLines;
    }
    this._isAtBottom = this.scrollOffset === 0;
  }

  /**
   * Compute which row indices need re-rendering after a scroll step.
   * For small scrolls (|deltaRows| < viewportRows), only the newly exposed
   * rows at the edge need to be re-rendered. For large jumps, mark all dirty.
   *
   * Note: DomRenderer row recycling (rotating the row element array) must happen
   * before the ScreenBuffer read so that reused elements map to the right buffer rows.
   * We store the dirty set here and let DomTerminalCore apply it.
   */
  private computeRecycledDirtyRows(deltaRows: number): void {
    const absDelta = Math.abs(deltaRows);
    if (absDelta >= this.viewportRows) {
      // Full viewport jump — all rows are dirty
      this.dirtyFromScroll = null;
      return;
    }

    // Small scroll — only the newly exposed rows are dirty
    const dirty = new Set<number>();
    if (deltaRows > 0) {
      // Scrolled up — new rows appear at the top
      for (let i = 0; i < absDelta; i++) dirty.add(i);
    } else {
      // Scrolled down — new rows appear at the bottom
      for (let i = this.viewportRows - absDelta; i < this.viewportRows; i++) {
        dirty.add(i);
      }
    }
    this.dirtyFromScroll = dirty;
  }
}
