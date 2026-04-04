/**
 * DomTerminalCore — Drop-in replacement for TerminalCore using DOM-based rendering.
 *
 * Architecture:
 * - xterm.js Terminal runs headless (hidden container) for ANSI parsing + buffer
 * - ScreenBuffer reads xterm's buffer into a packed Int32Array
 * - DomRenderer patches DOM rows/spans based on dirty row diffs
 * - TerminalCursor renders an absolutely positioned blinking cursor
 * - ResizeObserver → measureFont → term.resize() → SIGWINCH
 *
 * No canvas, no fitAddon, no WebGL, no timing races. CSS handles resize natively.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { THEMES, getTheme, TERMINAL_DEFAULTS, MOBILE_CONSTANTS } from '@shared/constants';
import { ScreenBuffer, CharPool, StylePool } from '../../renderer/ScreenBuffer.js';
import { DomRenderer } from '../../renderer/DomRenderer.js';
import { TerminalCursor } from '../../renderer/Cursor.js';
import { measureCharDimensions, calculateTerminalDimensions, invalidateFontCache } from '../../renderer/measureFont.js';
import type { TerminalCoreProps, TerminalCoreHandle } from '../TerminalCore/TerminalCore';
import type { FitAddon } from '@xterm/addon-fit';

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

        // --- xterm.js headless ---
        const term = new XTerm({
          cols, rows, fontSize, fontFamily,
          scrollback: TERMINAL_DEFAULTS.scrollback,
          allowTransparency: false,
          cursorBlink: false,
          cursorStyle: 'block',
          lineHeight: 1,
        });

        term.open(hiddenContainer);
        termRef.current = term;

        // Hide xterm's canvases
        hiddenContainer.querySelectorAll('canvas').forEach(c => { c.style.display = 'none'; });

        if (cancelled) { term.dispose(); hiddenContainer.remove(); visibleContainer.remove(); return; }

        // --- Rows container (below textarea) ---
        const rowsContainer = document.createElement('div');
        rowsContainer.className = 'dom-term-rows';
        rowsContainer.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none';
        visibleContainer.appendChild(rowsContainer);

        const renderer = new DomRenderer(rowsContainer);
        const themeConfig = THEMES[theme] ?? THEMES['dark']!;
        renderer.setTheme(themeConfig);
        renderer.setLineHeight(lineHeight);
        rendererRef.current = renderer;

        // Cursor on visibleContainer (not rowsContainer) for correct absolute positioning
        const cursor = new TerminalCursor(visibleContainer);
        cursor.setCharDimensions(charWidth, lineHeight);
        cursor.setColor(themeConfig.cursor);
        cursor.setBlink(true);
        cursorRef.current = cursor;

        // --- Textarea for keyboard input (on top, desktop only) ---
        // On mobile, MobileInputHandler (a sibling in App.tsx) handles all input via
        // onData. Reparenting xterm's textarea into the visible layer on mobile causes
        // double input: both xterm's internal onData AND MobileInputHandler's onInput
        // fire for every keystroke, producing duplicated characters.
        // Fix: on mobile we leave the textarea inside hiddenContainer (pointer-events:none)
        // so it is invisible to the virtual keyboard. MobileInputHandler is the sole
        // input path on mobile.
        const isMobileDevice = /Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent)
          || navigator.maxTouchPoints > 0 && window.innerWidth < MOBILE_CONSTANTS.breakpoint;
        const textarea = hiddenContainer.querySelector('textarea');
        if (textarea) {
          if (isMobileDevice) {
            // Keep textarea hidden — disable pointer-events so the virtual keyboard
            // cannot attach to it and trigger xterm's internal input pipeline.
            textarea.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none';
          } else {
            // Desktop: reparent into visible layer so xterm captures keyboard focus.
            textarea.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;z-index:30;cursor:text;pointer-events:auto';
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
        // Always full-buffer diff for stability. Shell history cycling, cursor
        // movement, and line clearing produce complex sequences where onRender
        // row hints can miss affected rows. Correctness > performance.
        function performRender(): void {
          const t = termRef.current;
          const r = rendererRef.current;
          const frontBuf = frontBufferRef.current;
          const backBuf = backBufferRef.current;
          if (!t || !r || !frontBuf || !backBuf) return;

          backBuf.readFromXTermBuffer(t.buffer.active, t.cols, t.rows);

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
          cursor.setPosition(t.buffer.active.cursorX, t.buffer.active.cursorY);
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
        // onRender fires after xterm commits a complete batch to the buffer
        const renderDisposable = term.onRender(() => scheduleRender());

        const cursorDisposable = term.onCursorMove(() => {
          const buf = term.buffer.active;
          cursor.setPosition(buf.cursorX, buf.cursorY);
        });

        const dataDisposable = term.onData((data) => onData(data));

        // Scroll events (user scrolling through scrollback)
        const scrollDisposable = term.onScroll(() => scheduleFullRender());

        // Buffer switch (normal ↔ alternate screen)
        const bufferChangeDisposable = term.buffer.onBufferChange(() => scheduleFullRender());

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
      rendererRef.current?.setTheme(themeConfig);
      cursorRef.current?.setColor(themeConfig.cursor);
      if (frontBufferRef.current && rendererRef.current) {
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
        dirtyFullRef.current = true;
        scheduleRenderRef.current?.();
        onResize?.(dims.cols, dims.rows);
      }
    }, [fontSize, onResize]);

    useImperativeHandle(
      ref,
      () => ({
        get terminal() { return termRef.current; },
        get fitAddon() { return null; },
        get renderError() { return null; },
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
              dirtyFullRef.current = true;
              scheduleRenderRef.current?.();
              onResize?.(dims.cols, dims.rows);
            }
          }
        },
        focus: () => termRef.current?.focus(),
        clear: () => termRef.current?.clear(),
        setTheme: (themeName: string) => {
          const themeConfig = getTheme(themeName);
          rendererRef.current?.setTheme(themeConfig);
          cursorRef.current?.setColor(themeConfig.cursor);
          if (frontBufferRef.current && rendererRef.current) {
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
      />
    );
  }
);

DomTerminalCore.displayName = 'DomTerminalCore';
