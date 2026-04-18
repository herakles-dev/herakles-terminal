/**
 * DomTerminalCore — Drop-in replacement for TerminalCore using DOM-based rendering.
 *
 * Architecture:
 * - xterm.js Terminal runs headless (hidden container) for ANSI parsing + buffer
 * - ScreenBuffer reads xterm's buffer into a packed Int32Array
 * - DomRenderer patches DOM rows/spans based on dirty row diffs
 * - TerminalCursor renders an absolutely positioned blinking cursor
 * - VirtualScroller manages scrollback: wheel events → viewport offset → buffer slice
 * - ResizeObserver → measureFont → term.resize() → SIGWINCH
 *
 * No canvas, no fitAddon, no WebGL, no timing races. CSS handles resize natively.
 *
 * Scroll flow:
 *   wheel event → VirtualScroller.handleWheel() → scrollOffset changes
 *   → scheduleFullRender() → performRender() reads buffer at getViewportRange().startLine
 *   → cursor hidden when scrolled up, shown at bottom
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { THEMES, getTheme, TERMINAL_DEFAULTS, MOBILE_CONSTANTS } from '@shared/constants';
import { ScreenBuffer, CharPool, StylePool } from '../../renderer/ScreenBuffer.js';
import { DomRenderer } from '../../renderer/DomRenderer.js';
import { TerminalCursor } from '../../renderer/Cursor.js';
import { VirtualScroller } from '../../renderer/VirtualScroller.js';
import {
  measureCharDimensions,
  calculateTerminalDimensions,
  calculateTerminalDimensionsFromSize,
  invalidateFontCache,
} from '../../renderer/measureFont.js';
import type { TerminalCoreProps, TerminalCoreHandle } from '../TerminalCore/TerminalCore';
import type { FitAddon } from '@xterm/addon-fit';
import { SearchOverlay } from '../SearchOverlay/index.js';

const PADDING = 4;
// Debounce delay for ResizeObserver: coalesces rapid container size changes during
// SplitView divider drag into a single resize. 80ms matches the server drain delay
// (RC-1) and avoids spamming the server with mid-drag resize messages.
const RESIZE_DEBOUNCE_MS = 80;

export const DomTerminalCore = forwardRef<TerminalCoreHandle, TerminalCoreProps>(
  (props, ref) => {
    const {
      onData,
      theme = 'dark',
      fontSize = TERMINAL_DEFAULTS.fontSize,
      terminalId = 'DomTerminalCore',
      onResize,
      onReady,
      onContextMenu,
    } = props;

    const outerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<XTerm | null>(null);
    const rendererRef = useRef<DomRenderer | null>(null);
    const cursorRef = useRef<TerminalCursor | null>(null);
    const frontBufferRef = useRef<ScreenBuffer | null>(null);
    const backBufferRef = useRef<ScreenBuffer | null>(null);
    const charPoolRef = useRef<CharPool>(new CharPool());
    const stylePoolRef = useRef<StylePool>(new StylePool());
    const rafIdRef = useRef<number | null>(null);
    const renderWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingRenderRef = useRef(false);
    const cursorVisibleRef = useRef(true); // DECTCEM ?25h/l state
    const dirtyFullRef = useRef(true); // first render is always full
    // Ink-aligned dirty row tracking: xterm's onRender({start, end}) tells us which
    // rows changed. We accumulate ranges between RAF frames to narrow diff() scope.
    const dirtyStartRef = useRef<number>(0);
    const dirtyEndRef = useRef<number>(0);
    const hasDirtyRangeRef = useRef(false);
    const scheduleRenderRef = useRef<(() => void) | null>(null);
    const cleanupRef = useRef<(() => void) | null>(null);
    const resizeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Persists the mobile-detection result across the component lifetime so that
    // useCallback / useImperativeHandle callsites outside init() can check it.
    const isMobileRef = useRef(false);
    // VirtualScroller — manages scrollback viewport offset and scrollbar
    const virtualScrollerRef = useRef<VirtualScroller | null>(null);
    // Reference to the .dom-term-viewport element so setTheme() can update CSS variables
    // on it directly — enabling instant theme switching without clearing the style cache.
    const viewportRef = useRef<HTMLElement | null>(null);
    // Stable refs for props captured by the init() closure — prevents stale closure
    // bugs when isMobile flips on orientation change or fontSize/onResize update.
    const onDataRef = useRef(onData);
    onDataRef.current = onData;
    const onResizeRef = useRef(onResize);
    onResizeRef.current = onResize;
    const fontSizeRef = useRef(fontSize);
    fontSizeRef.current = fontSize;

    // ---------------------------------------------------------------------------
    // Search overlay state
    // ---------------------------------------------------------------------------
    const [searchVisible, setSearchVisible] = useState(false);

    const handleSearchClose = useCallback(() => {
      setSearchVisible(false);
      // Return focus to the terminal after closing search (desktop only —
      // on mobile MobileInputHandler manages focus independently).
      if (!isMobileRef.current) {
        requestAnimationFrame(() => termRef.current?.focus());
      }
    }, []);

    useEffect(() => {
      const outer = outerRef.current;
      if (!outer) return;

      let cancelled = false;
      const fontFamily = TERMINAL_DEFAULTS.fontFamily;

      // Wait for fonts to load before measuring
      const init = async () => {
        await document.fonts.ready;
        if (cancelled) return;

        // Wait for the first ResizeObserver callback to get authoritative
        // post-layout dimensions. A single RAF was insufficient for the deep
        // flex chain (SplitView % → flex → flex → flex → outer) — the outer div
        // could still report stale height, producing wrong row counts that
        // persisted until a subsequent resize (which may never come on desktop).
        // ResizeObserver fires its initial notification once the element has
        // non-zero dimensions, guaranteeing the flex layout has settled.
        const initialSize = await new Promise<{ width: number; height: number }>((resolve) => {
          let resolved = false;
          // Fallback: if the element stays hidden (display:none tab) the ResizeObserver
          // never fires — resolve after 5s to prevent init() hanging indefinitely.
          const fallbackTimer = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              initObserver.disconnect();
              resolve({ width: outer.clientWidth || window.innerWidth, height: outer.clientHeight || window.innerHeight / 2 });
            }
          }, 5000);
          const initObserver = new ResizeObserver((entries) => {
            if (resolved || cancelled) { initObserver.disconnect(); clearTimeout(fallbackTimer); return; }
            const entry = entries[0];
            if (!entry) return;
            let width: number, height: number;
            if (entry.contentBoxSize && entry.contentBoxSize[0]) {
              width = entry.contentBoxSize[0].inlineSize;
              height = entry.contentBoxSize[0].blockSize;
            } else {
              width = entry.contentRect.width;
              height = entry.contentRect.height;
            }
            if (width > 0 && height > 0) {
              resolved = true;
              clearTimeout(fallbackTimer);
              initObserver.disconnect();
              resolve({ width, height });
            }
          });
          initObserver.observe(outer);
        });
        if (cancelled) return;

        invalidateFontCache();
        const { charWidth, lineHeight } = measureCharDimensions(fontFamily, fontSize);
        const { cols, rows } = calculateTerminalDimensionsFromSize(
          initialSize.width, initialSize.height, fontFamily, fontSize, PADDING
        );

        // --- DOM structure ---
        const hiddenContainer = document.createElement('div');
        hiddenContainer.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;opacity:0';
        outer.appendChild(hiddenContainer);

        const visibleContainer = document.createElement('div');
        visibleContainer.className = 'dom-term-viewport';
        visibleContainer.style.cssText = `position:absolute;top:${PADDING}px;left:${PADDING}px;right:${PADDING}px;bottom:${PADDING}px;font-family:${fontFamily};font-size:${fontSize}px;line-height:${lineHeight}px;overflow:hidden`;
        outer.appendChild(visibleContainer);
        // Store viewport reference for CSS-variable-based theme switching
        viewportRef.current = visibleContainer;

        // --- xterm.js headless ---
        const term = new XTerm({
          cols,
          rows,
          fontSize,
          fontFamily,
          scrollback: TERMINAL_DEFAULTS.scrollback,
          allowTransparency: false,
          cursorBlink: false,
          cursorStyle: 'block',
          lineHeight: 1,
        });

        term.open(hiddenContainer);
        termRef.current = term;

        // Partial cleanup: if the component unmounts during async init (between
        // document.fonts.ready and the rest of init), this ensures resources are
        // freed rather than leaking.
        cleanupRef.current = () => {
          term.dispose();
          hiddenContainer.remove();
          visibleContainer.remove();
        };

        // Hide xterm's canvases
        hiddenContainer.querySelectorAll('canvas').forEach((c) => {
          c.style.display = 'none';
        });

        if (cancelled) {
          term.dispose();
          hiddenContainer.remove();
          visibleContainer.remove();
          return;
        }

        // --- Rows container (below textarea) ---
        const rowsContainer = document.createElement('div');
        rowsContainer.className = 'dom-term-rows';
        rowsContainer.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:auto;touch-action:none';
        visibleContainer.appendChild(rowsContainer);

        const renderer = new DomRenderer(rowsContainer);
        const themeConfig = THEMES[theme] ?? THEMES['dark']!;
        renderer.setTheme(themeConfig, visibleContainer);
        renderer.setLineHeight(lineHeight);
        rendererRef.current = renderer;

        // Cursor on visibleContainer (not rowsContainer) for correct absolute positioning
        const cursor = new TerminalCursor(visibleContainer);
        cursor.setCharDimensions(charWidth, lineHeight);
        cursor.setColor(themeConfig.cursor);
        cursor.setBlink(true);
        cursorRef.current = cursor;

        // --- VirtualScroller ---
        // Constructed after visibleContainer exists. Appends a scrollbar div inside
        // visibleContainer and listens for wheel events on it.
        const scroller = new VirtualScroller(visibleContainer, renderer, {
          viewportRows: rows,
          maxScrollback: TERMINAL_DEFAULTS.scrollback,
          onScrollChange: () => scheduleFullRender(),
        });
        scroller.setTerminal(term);
        virtualScrollerRef.current = scroller;

        // --- Textarea for keyboard input (on top, desktop only) ---
        // On mobile, MobileInputHandler (a sibling in App.tsx) handles all input via
        // onData. Reparenting xterm's textarea into the visible layer on mobile causes
        // double input: both xterm's internal onData AND MobileInputHandler's onInput
        // fire for every keystroke, producing duplicated characters.
        // Fix: on mobile we leave the textarea inside hiddenContainer (pointer-events:none)
        // so it is invisible to the virtual keyboard. MobileInputHandler is the sole
        // input path on mobile.
        const isMobileDevice =
          /Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
          (navigator.maxTouchPoints > 0 && window.innerWidth < MOBILE_CONSTANTS.breakpoint);
        // Persist so useCallback / useImperativeHandle callsites can guard focus calls.
        isMobileRef.current = isMobileDevice;

        const textarea = hiddenContainer.querySelector('textarea');
        if (textarea) {
          if (isMobileDevice) {
            // Keep textarea hidden — disable pointer-events so the virtual keyboard
            // cannot attach to it and trigger xterm's internal input pipeline.
            textarea.style.cssText =
              'position:absolute;width:0;height:0;opacity:0;pointer-events:none';
          } else {
            // Desktop: reparent into visible layer so xterm captures keyboard focus.
            textarea.style.cssText =
              'position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;z-index:30;cursor:text;pointer-events:auto';
            visibleContainer.appendChild(textarea);
          }
        }

        // On mobile, skip term.focus() entirely — MobileInputHandler manages focus.
        // Calling term.focus() on mobile would summon the virtual keyboard via
        // xterm's hidden textarea.
        const handleOuterClick = () => {
          if (!isMobileRef.current) term.focus();
        };
        outer.addEventListener('click', handleOuterClick);
        if (!isMobileDevice) {
          requestAnimationFrame(() => term.focus());
        }

        // --- Double buffers ---
        const charPool = charPoolRef.current;
        const stylePool = stylePoolRef.current;
        const front = new ScreenBuffer(cols, rows, charPool, stylePool);
        const back = new ScreenBuffer(cols, rows, charPool, stylePool);
        frontBufferRef.current = front;
        backBufferRef.current = back;

        // --- Render pipeline ---
        // When scrolled up, we read from an explicit buffer startLine rather than
        // xterm's internal viewportY (which is always 0 for the active viewport).
        // The cursor is hidden when not at the bottom, since its position is
        // reported relative to the live viewport, not the scrolled view.
        function performRender(): void {
          const t = termRef.current;
          const r = rendererRef.current;
          const s = virtualScrollerRef.current;
          const frontBuf = frontBufferRef.current;
          const backBuf = backBufferRef.current;
          if (!t || !r || !frontBuf || !backBuf) return;

          // Defensive: ensure DomRenderer row count matches xterm's row count.
          // During debounced resize, these can drift — stale row count means
          // bottom rows won't render, appearing "frozen" on tall desktop windows.
          r.ensureRows(t.rows);

          // Always compute startLine from VirtualScroller rather than relying on
          // xterm's buffer.viewportY. In headless mode (hidden container), viewportY
          // can drift from the actual scroll position — causing the bottom portion
          // of tall desktop windows to render stale content while the top scrolls.
          const range = s?.getViewportRange();
          let startLine = range?.startLine;

          // Defensive clamp: ensure startLine + rows never exceeds the buffer.
          // During resize transitions, stale viewportRows can push startLine too
          // far, causing bottom rows to read past the buffer (rendering blank).
          if (startLine !== undefined) {
            const maxStart = Math.max(0, t.buffer.active.length - t.rows);
            if (startLine > maxStart) startLine = maxStart;
          }

          backBuf.readFromXTermBuffer(t.buffer.active, t.cols, t.rows, startLine);

          // Hide cursor when scrolled into scrollback or when DECTCEM ?25l is active
          const atBottom = !s || s.isAtBottom();
          cursor.setVisible(atBottom && cursorVisibleRef.current);

          if (dirtyFullRef.current) {
            r.renderAll(backBuf);
            dirtyFullRef.current = false;
          } else {
            // Ink-aligned: use xterm's onRender dirty range to narrow diff scope.
            // When onRender fires, it tells us exactly which rows xterm touched.
            // We pass that range to diff() so only those rows are compared, avoiding
            // full-buffer scans on every frame (mirrors Ink's damage rectangle concept).
            const startRow = hasDirtyRangeRef.current ? dirtyStartRef.current : undefined;
            const endRow = hasDirtyRangeRef.current ? dirtyEndRef.current : undefined;
            const dirty = backBuf.diff(frontBuf, startRow, endRow);
            if (dirty.size > 0) {
              r.updateRows(backBuf, dirty);
            }
          }
          // Reset dirty range for next frame
          hasDirtyRangeRef.current = false;

          frontBuf.copyFrom(backBuf);

          if (atBottom) {
            cursor.setPosition(t.buffer.active.cursorX, t.buffer.active.cursorY);
          }
        }

        function scheduleRender(): void {
          if (!pendingRenderRef.current) {
            pendingRenderRef.current = true;
            rafIdRef.current = requestAnimationFrame(() => {
              pendingRenderRef.current = false;
              if (renderWatchdogRef.current) {
                clearTimeout(renderWatchdogRef.current);
                renderWatchdogRef.current = null;
              }
              performRender();
            });
            // Watchdog: mobile browsers throttle RAF during low interaction periods.
            // If RAF doesn't fire within 100ms, force-render via setTimeout to prevent
            // visible freezing of spinner animation and output.
            if (renderWatchdogRef.current) clearTimeout(renderWatchdogRef.current);
            renderWatchdogRef.current = setTimeout(() => {
              renderWatchdogRef.current = null;
              if (pendingRenderRef.current) {
                pendingRenderRef.current = false;
                if (rafIdRef.current !== null) {
                  cancelAnimationFrame(rafIdRef.current);
                  rafIdRef.current = null;
                }
                performRender();
              }
            }, 100);
          }
        }

        function scheduleFullRender(): void {
          dirtyFullRef.current = true;
          // Reset dirty range so post-resize incremental renders don't use a
          // stale narrow range from a pre-resize onRender. Without this, diff()
          // only checks the narrow range and rows outside it stay permanently
          // stale — the "need to refresh" bug.
          hasDirtyRangeRef.current = false;
          dirtyStartRef.current = 0;
          dirtyEndRef.current = 0;
          scheduleRender();
        }

        scheduleRenderRef.current = scheduleRender;

        // --- xterm events ---
        // onRender fires after xterm commits a complete batch to the buffer.
        // Notify VirtualScroller about new output so it can track scrollback growth
        // and auto-scroll to bottom when pinned.
        const renderDisposable = term.onRender((e) => {
          // Accumulate dirty row range from xterm — narrows diff() scope in performRender.
          // Multiple onRender events between RAF frames get merged into the widest range.
          if (hasDirtyRangeRef.current) {
            dirtyStartRef.current = Math.min(dirtyStartRef.current, e.start);
            dirtyEndRef.current = Math.max(dirtyEndRef.current, e.end);
          } else {
            dirtyStartRef.current = e.start;
            dirtyEndRef.current = e.end;
            hasDirtyRangeRef.current = true;
          }
          if (virtualScrollerRef.current) {
            virtualScrollerRef.current.onNewOutput();
          }
          scheduleRender();
        });

        // onWriteParsed fires from setTimeout (after xterm parses data into its buffer),
        // NOT from RAF. On mobile browsers, RAF is throttled during no-interaction periods,
        // which prevents onRender from firing — but onWriteParsed always fires.
        // This ensures spinner animation renders even when the user isn't touching the screen.
        const writeParsedDisposable = term.onWriteParsed(() => {
          scheduleRender();
        });

        const cursorDisposable = term.onCursorMove(() => {
          const buf = term.buffer.active;
          if (!virtualScrollerRef.current || virtualScrollerRef.current.isAtBottom()) {
            cursor.setPosition(buf.cursorX, buf.cursorY);
          }
          // Ensure cursor-only moves (no data output) trigger a render.
          // Without this, a cursor move on an idle terminal would update
          // the cursor DOM element directly but never schedule a RAF.
          scheduleRender();
        });

        const dataDisposable = term.onData((data) => onDataRef.current(data));

        // xterm's own scroll events (e.g. term.scrollLines()) — sync our scroller
        // and trigger a full render so the view updates immediately.
        const scrollDisposable = term.onScroll(() => {
          // When xterm scrolls programmatically (e.g. new output pushes viewport),
          // let VirtualScroller handle the auto-scroll logic, then force a render.
          if (virtualScrollerRef.current?.isAtBottom()) {
            virtualScrollerRef.current.scrollToBottom();
          }
          scheduleFullRender();
        });

        // Buffer switch (normal ↔ alternate screen) — always snap to bottom.
        // Reset cursor visibility: apps leaving ?25l active on alt screen exit
        // shouldn't permanently hide the cursor on the normal screen.
        const bufferChangeDisposable = term.buffer.onBufferChange(() => {
          cursorVisibleRef.current = true;
          cursorRef.current?.setVisible(true);
          virtualScrollerRef.current?.scrollToBottom();
          scheduleFullRender();
        });

        // --- ResizeObserver ---
        // Debounced to coalesce rapid container changes during SplitView drag.
        // Without debouncing, each pixel-level size change during drag fires a
        // term.resize() + onResize(), spamming the server with mid-drag resizes
        // and causing repeated output-buffer holds. The debounce matches RC-1's
        // 80ms drain delay so the final settled size is what gets sent.
        // Use contentBoxSize from ResizeObserver entries when available —
        // these are authoritative post-layout dimensions that avoid the
        // stale-getBoundingClientRect problem during deep flex resolution.
        // Copy dimensions immediately from ResizeObserver entries rather than
        // storing the live entry object — Chromium can mutate contentBoxSize
        // on reused entries before the 80ms debounce fires.
        let latestROSize: { width: number; height: number } | undefined;

        const applyResize = () => {
          const t = termRef.current;
          if (!t || !outer) return;

          let dims;
          if (latestROSize) {
            dims = calculateTerminalDimensionsFromSize(
              latestROSize.width, latestROSize.height, fontFamily, fontSizeRef.current, PADDING
            );
          } else {
            dims = calculateTerminalDimensions(outer, fontFamily, fontSizeRef.current, PADDING);
          }

          if (dims.cols !== t.cols || dims.rows !== t.rows) {
            // Ordering matters (I-02):
            // 1. Resize xterm first — buffer reflow happens synchronously, fires onRender.
            // 2. setViewportRows reads the NEW buffer length via updateTotalLines.
            // 3. ensureRows is NOT called here — performRender() handles it atomically inside RAF
            //    to avoid a 1-frame gap of empty row divs (was: Fa-2 race).
            frontBufferRef.current?.resize(dims.cols, dims.rows);
            backBufferRef.current?.resize(dims.cols, dims.rows);
            t.resize(dims.cols, dims.rows);
            virtualScrollerRef.current?.setViewportRows(dims.rows);
            // RAF-batched full render (coalesces with onRender from term.resize)
            scheduleFullRender();
            onResizeRef.current?.(dims.cols, dims.rows);
          }
        };

        const resizeObserver = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (entry?.contentBoxSize?.[0]) {
            latestROSize = {
              width: entry.contentBoxSize[0].inlineSize,
              height: entry.contentBoxSize[0].blockSize,
            };
          } else if (entry) {
            latestROSize = {
              width: entry.contentRect.width,
              height: entry.contentRect.height,
            };
          }
          if (resizeDebounceRef.current !== null) {
            clearTimeout(resizeDebounceRef.current);
          }
          resizeDebounceRef.current = setTimeout(() => {
            resizeDebounceRef.current = null;
            applyResize();
          }, RESIZE_DEBOUNCE_MS);
        });
        resizeObserver.observe(outer);

        // --- Initial render + onReady ---
        // No RAF wrapper needed — the terminal was created with authoritative
        // dimensions from ResizeObserver, so DOM is ready for immediate render.
        performRender();
        if (onReady) onReady(term, null as unknown as FitAddon);

        // --- Cleanup ---
        cleanupRef.current = () => {
          outer.removeEventListener('click', handleOuterClick);
          resizeObserver.disconnect();
          if (resizeDebounceRef.current !== null) {
            clearTimeout(resizeDebounceRef.current);
            resizeDebounceRef.current = null;
          }
          renderDisposable.dispose();
          writeParsedDisposable.dispose();
          cursorDisposable.dispose();
          dataDisposable.dispose();
          scrollDisposable.dispose();
          bufferChangeDisposable.dispose();
          if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
          if (renderWatchdogRef.current) clearTimeout(renderWatchdogRef.current);
          virtualScrollerRef.current?.dispose();
          virtualScrollerRef.current = null;
          cursor.dispose();
          renderer.dispose();
          term.dispose();
          hiddenContainer.remove();
          visibleContainer.remove();
        };
      };

      init();

      return () => {
        cancelled = true;
        cleanupRef.current?.();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Theme changes
    useEffect(() => {
      const themeConfig = THEMES[theme] ?? THEMES['dark']!;
      // Pass viewportRef so setTheme() updates CSS variables — spans recolor
      // instantly without clearing the style cache or re-rendering.
      rendererRef.current?.setTheme(themeConfig, viewportRef.current ?? undefined);
      cursorRef.current?.setColor(themeConfig.cursor);
      // Match theme bg — fills the Math.floor gap at bottom (I-01 / Fc-1)
      if (outerRef.current) outerRef.current.style.backgroundColor = themeConfig.background;
      // Only re-render all rows when CSS vars are NOT active (first call before
      // viewportRef is set, or fallback path). Once CSS vars are in use, the
      // browser updates span colors automatically via the cascade.
      if (!viewportRef.current && frontBufferRef.current && rendererRef.current) {
        rendererRef.current.renderAll(frontBufferRef.current);
      }
    }, [theme]);

    // Font size changes
    useEffect(() => {
      if (!termRef.current || !outerRef.current) return;
      const fontFamily = TERMINAL_DEFAULTS.fontFamily;
      invalidateFontCache();
      const { charWidth, lineHeight } = measureCharDimensions(fontFamily, fontSize);
      cursorRef.current?.setCharDimensions(charWidth, lineHeight);
      rendererRef.current?.setLineHeight(lineHeight);

      const viewport = viewportRef.current;
      if (viewport) {
        viewport.style.fontSize = `${fontSize}px`;
        viewport.style.lineHeight = `${lineHeight}px`;
      }

      const dims = calculateTerminalDimensions(outerRef.current, fontFamily, fontSize, PADDING);
      if (dims.cols !== termRef.current.cols || dims.rows !== termRef.current.rows) {
        // Ordering matters (I-02 / F1): t.resize() must run before setViewportRows so
        // VirtualScroller.updateTotalLines() reads the NEW buffer length. Matches applyResize.
        frontBufferRef.current?.resize(dims.cols, dims.rows);
        backBufferRef.current?.resize(dims.cols, dims.rows);
        termRef.current.resize(dims.cols, dims.rows);
        virtualScrollerRef.current?.setViewportRows(dims.rows);
        // No ensureRows here — performRender() handles it atomically inside RAF (I-02 / F1)
        dirtyFullRef.current = true;
        scheduleRenderRef.current?.();
        onResizeRef.current?.(dims.cols, dims.rows);
      } else {
        // Same cols/rows but charWidth/lineHeight changed — cursor position needs re-render (I-12 / Fa-3)
        dirtyFullRef.current = true;
        scheduleRenderRef.current?.();
      }
    }, [fontSize]);

    useImperativeHandle(
      ref,
      () => ({
        get terminal() {
          return termRef.current;
        },
        get fitAddon() {
          return null;
        },
        get renderError() {
          return null;
        },
        write: (data: string) => {
          // Track DECTCEM cursor visibility (?25h = show, ?25l = hide).
          // xterm.js parses these but doesn't expose visibility in IModes.
          // Ink's render loop sends ?25l...draw...?25h in a single chunk,
          // so we use lastIndexOf to find whichever appears last (final state wins).
          const hideIdx = data.lastIndexOf('\x1b[?25l');
          const showIdx = data.lastIndexOf('\x1b[?25h');
          if (hideIdx > showIdx) {
            cursorVisibleRef.current = false;
            cursorRef.current?.setVisible(false);
          } else if (showIdx > hideIdx) {
            cursorVisibleRef.current = true;
            cursorRef.current?.setVisible(true);
          }
          // DEC 2026 synchronized output — prevents partial-frame reads
          termRef.current?.write('\x1b[?2026h' + data + '\x1b[?2026l');
        },
        fit: () => {
          if (termRef.current && outerRef.current) {
            const fontFamily = TERMINAL_DEFAULTS.fontFamily;
            const dims = calculateTerminalDimensions(outerRef.current, fontFamily, fontSize, PADDING);
            if (dims.cols !== termRef.current.cols || dims.rows !== termRef.current.rows) {
              // Ordering matters (I-02 / F1): t.resize() must run before setViewportRows so
              // VirtualScroller.updateTotalLines() reads the NEW buffer length. Matches applyResize.
              frontBufferRef.current?.resize(dims.cols, dims.rows);
              backBufferRef.current?.resize(dims.cols, dims.rows);
              termRef.current.resize(dims.cols, dims.rows);
              virtualScrollerRef.current?.setViewportRows(dims.rows);
              // No ensureRows here — performRender() handles it atomically inside RAF (I-02 / F1)
              dirtyFullRef.current = true;
              scheduleRenderRef.current?.();
              onResizeRef.current?.(dims.cols, dims.rows);
            }
          }
        },
        // On mobile this is a no-op — App.tsx should call MobileInputHandler.focus() instead.
        focus: () => { if (!isMobileRef.current) termRef.current?.focus(); },
        clear: () => {
          termRef.current?.clear();
          // Reset cursor visibility — crashed Ink processes may leave ?25l active
          cursorVisibleRef.current = true;
          cursorRef.current?.setVisible(true);
          virtualScrollerRef.current?.scrollToBottom();
        },
        setTheme: (themeName: string) => {
          const themeConfig = getTheme(themeName);
          rendererRef.current?.setTheme(themeConfig, viewportRef.current ?? undefined);
          cursorRef.current?.setColor(themeConfig.cursor);
          // Match theme bg — fills the Math.floor gap at bottom (I-01 / Fc-1)
          if (outerRef.current) outerRef.current.style.backgroundColor = themeConfig.background;
          // Re-render only when CSS vars are not active (viewportRef not yet set)
          if (!viewportRef.current && frontBufferRef.current && rendererRef.current) {
            rendererRef.current.renderAll(frontBufferRef.current);
          }
          document.documentElement.style.setProperty('--terminal-bg', themeConfig.background);
          document.documentElement.style.setProperty('--terminal-fg', themeConfig.foreground);
        },
      }),
      [fontSize, onResize]
    );

    return (
      <div
        ref={outerRef}
        onContextMenu={onContextMenu}
        onKeyDown={(e) => {
          // Ctrl+F — open search overlay (prevent browser default find)
          if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key === 'f') {
            e.preventDefault();
            setSearchVisible(true);
          }
        }}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          minHeight: 0,
          flex: 1,
          overflow: 'hidden',
          touchAction: 'none',
          backgroundColor: (THEMES[theme] ?? THEMES['dark'])!.background,
        }}
        data-terminal-id={terminalId}
        data-renderer="dom"
      >
        <SearchOverlay
          terminalRef={termRef}
          rendererRef={rendererRef}
          scrollerRef={virtualScrollerRef}
          visible={searchVisible}
          onClose={handleSearchClose}
        />
      </div>
    );
  }
);

DomTerminalCore.displayName = 'DomTerminalCore';
