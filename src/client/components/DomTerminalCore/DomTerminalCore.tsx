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
    const pendingRenderRef = useRef(false);
    const dirtyFullRef = useRef(true); // first render is always full
    const scheduleRenderRef = useRef<(() => void) | null>(null);
    const cleanupRef = useRef<(() => void) | null>(null);
    const resizeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // VirtualScroller — manages scrollback viewport offset and scrollbar
    const virtualScrollerRef = useRef<VirtualScroller | null>(null);
    // Reference to the .dom-term-viewport element so setTheme() can update CSS variables
    // on it directly — enabling instant theme switching without clearing the style cache.
    const viewportRef = useRef<HTMLElement | null>(null);

    // ---------------------------------------------------------------------------
    // Search overlay state
    // ---------------------------------------------------------------------------
    const [searchVisible, setSearchVisible] = useState(false);

    const handleSearchClose = useCallback(() => {
      setSearchVisible(false);
      // Return focus to the terminal after closing search
      requestAnimationFrame(() => termRef.current?.focus());
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

        invalidateFontCache();
        const { charWidth, lineHeight } = measureCharDimensions(fontFamily, fontSize);
        const { cols, rows } = calculateTerminalDimensions(outer, fontFamily, fontSize, PADDING);

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
        rowsContainer.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none';
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

        const handleOuterClick = () => term.focus();
        outer.addEventListener('click', handleOuterClick);
        requestAnimationFrame(() => term.focus());

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

          // Determine which buffer slice to render
          let startLine: number | undefined;
          if (s && !s.isAtBottom()) {
            const range = s.getViewportRange();
            startLine = range.startLine;
          }

          backBuf.readFromXTermBuffer(t.buffer.active, t.cols, t.rows, startLine);

          // Hide cursor when scrolled into scrollback history
          const atBottom = !s || s.isAtBottom();
          cursor.setVisible(atBottom);

          if (dirtyFullRef.current) {
            r.renderAll(backBuf);
            dirtyFullRef.current = false;
          } else {
            // Full diff — no row-range restriction. Safe for all terminal ops.
            const dirty = backBuf.diff(frontBuf);
            if (dirty.size > 0) {
              r.updateRows(backBuf, dirty);
            }
          }

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
              performRender();
            });
          }
        }

        function scheduleFullRender(): void {
          dirtyFullRef.current = true;
          scheduleRender();
        }

        scheduleRenderRef.current = scheduleRender;

        // --- xterm events ---
        // onRender fires after xterm commits a complete batch to the buffer.
        // Notify VirtualScroller about new output so it can track scrollback growth
        // and auto-scroll to bottom when pinned.
        const renderDisposable = term.onRender((_e) => {
          if (virtualScrollerRef.current) {
            // xterm's buffer length changes when new lines are added.
            // We pass 0 for now — onNewOutput only needs to know that something arrived;
            // it re-reads totalLines internally from term.buffer.active.length.
            virtualScrollerRef.current.onNewOutput(0);
          }
          scheduleRender();
        });

        const cursorDisposable = term.onCursorMove(() => {
          const buf = term.buffer.active;
          if (!virtualScrollerRef.current || virtualScrollerRef.current.isAtBottom()) {
            cursor.setPosition(buf.cursorX, buf.cursorY);
          }
        });

        const dataDisposable = term.onData((data) => onData(data));

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

        // Buffer switch (normal ↔ alternate screen) — always snap to bottom
        const bufferChangeDisposable = term.buffer.onBufferChange(() => {
          virtualScrollerRef.current?.scrollToBottom();
          scheduleFullRender();
        });

        // --- ResizeObserver ---
        // Debounced to coalesce rapid container changes during SplitView drag.
        // Without debouncing, each pixel-level size change during drag fires a
        // term.resize() + onResize(), spamming the server with mid-drag resizes
        // and causing repeated output-buffer holds. The debounce matches RC-1's
        // 80ms drain delay so the final settled size is what gets sent.
        const applyResize = () => {
          const t = termRef.current;
          if (!t || !outer) return;

          const dims = calculateTerminalDimensions(outer, fontFamily, fontSize, PADDING);
          if (dims.cols !== t.cols || dims.rows !== t.rows) {
            t.resize(dims.cols, dims.rows);
            frontBufferRef.current?.resize(dims.cols, dims.rows);
            backBufferRef.current?.resize(dims.cols, dims.rows);
            rendererRef.current?.ensureRows(dims.rows);
            virtualScrollerRef.current?.setViewportRows(dims.rows);
            // RAF-batched full render (coalesces with onRender from term.resize)
            scheduleFullRender();
            onResize?.(dims.cols, dims.rows);
          }
        };

        const resizeObserver = new ResizeObserver(() => {
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
        requestAnimationFrame(() => {
          performRender();
          if (onReady) onReady(term, null as unknown as FitAddon);
        });

        // --- Cleanup ---
        cleanupRef.current = () => {
          outer.removeEventListener('click', handleOuterClick);
          resizeObserver.disconnect();
          if (resizeDebounceRef.current !== null) {
            clearTimeout(resizeDebounceRef.current);
            resizeDebounceRef.current = null;
          }
          renderDisposable.dispose();
          cursorDisposable.dispose();
          dataDisposable.dispose();
          scrollDisposable.dispose();
          bufferChangeDisposable.dispose();
          if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
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

      const viewport = outerRef.current.querySelector('.dom-term-viewport') as HTMLElement;
      if (viewport) {
        viewport.style.fontSize = `${fontSize}px`;
        viewport.style.lineHeight = `${lineHeight}px`;
      }

      const dims = calculateTerminalDimensions(outerRef.current, fontFamily, fontSize, PADDING);
      if (dims.cols !== termRef.current.cols || dims.rows !== termRef.current.rows) {
        termRef.current.resize(dims.cols, dims.rows);
        frontBufferRef.current?.resize(dims.cols, dims.rows);
        backBufferRef.current?.resize(dims.cols, dims.rows);
        rendererRef.current?.ensureRows(dims.rows);
        virtualScrollerRef.current?.setViewportRows(dims.rows);
        dirtyFullRef.current = true;
        scheduleRenderRef.current?.();
        onResize?.(dims.cols, dims.rows);
      }
    }, [fontSize, onResize]);

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
          // DEC 2026 synchronized output — prevents partial-frame reads
          termRef.current?.write('\x1b[?2026h' + data + '\x1b[?2026l');
        },
        fit: () => {
          if (termRef.current && outerRef.current) {
            const fontFamily = TERMINAL_DEFAULTS.fontFamily;
            const dims = calculateTerminalDimensions(outerRef.current, fontFamily, fontSize, PADDING);
            if (dims.cols !== termRef.current.cols || dims.rows !== termRef.current.rows) {
              termRef.current.resize(dims.cols, dims.rows);
              frontBufferRef.current?.resize(dims.cols, dims.rows);
              backBufferRef.current?.resize(dims.cols, dims.rows);
              rendererRef.current?.ensureRows(dims.rows);
              virtualScrollerRef.current?.setViewportRows(dims.rows);
              dirtyFullRef.current = true;
              scheduleRenderRef.current?.();
              onResize?.(dims.cols, dims.rows);
            }
          }
        },
        focus: () => termRef.current?.focus(),
        clear: () => {
          termRef.current?.clear();
          // Snap back to bottom after clear
          virtualScrollerRef.current?.scrollToBottom();
        },
        setTheme: (themeName: string) => {
          const themeConfig = getTheme(themeName);
          rendererRef.current?.setTheme(themeConfig, viewportRef.current ?? undefined);
          cursorRef.current?.setColor(themeConfig.cursor);
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
          backgroundColor: (THEMES[theme] ?? THEMES['dark'])!.background,
        }}
        data-terminal-id={terminalId}
        data-renderer="dom"
      >
        <SearchOverlay
          terminalRef={termRef}
          rendererRef={rendererRef}
          visible={searchVisible}
          onClose={handleSearchClose}
        />
      </div>
    );
  }
);

DomTerminalCore.displayName = 'DomTerminalCore';
