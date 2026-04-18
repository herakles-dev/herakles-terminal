'use client';

/**
 * SearchOverlay — Floating search bar for the DOM terminal renderer.
 *
 * Searches the xterm.js buffer directly (no SearchAddon — canvas-based) and
 * calls DomRenderer.setHighlights() to mark matches in the DOM. Only valid
 * when the DOM renderer is active; silently no-ops otherwise.
 *
 * Props:
 *   terminalRef   — xterm.js Terminal instance for buffer access
 *   rendererRef   — DomRenderer instance to receive highlight calls
 *   visible       — whether the overlay is shown
 *   onClose       — called when the user closes the search bar
 *
 * Keyboard shortcuts (when overlay is open):
 *   Enter            — next match
 *   Shift+Enter      — previous match
 *   Escape           — close
 *   Ctrl+F           — next match (so Ctrl+F again cycles forward)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { DomRenderer, HighlightRange } from '../../renderer/DomRenderer.js';
import type { VirtualScroller } from '../../renderer/VirtualScroller.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchOverlayProps {
  /** xterm.js Terminal instance for buffer access. May be null before init. */
  terminalRef: React.RefObject<XTerm | null>;
  /** DomRenderer instance for highlight integration. May be null before init. */
  rendererRef: React.RefObject<DomRenderer | null>;
  /** VirtualScroller for viewport position and scroll-to-match. May be null before init. */
  scrollerRef: React.RefObject<VirtualScroller | null>;
  onClose: () => void;
  visible: boolean;
}

interface SearchMatch {
  /** Row index in the xterm buffer (0 = first scrollback line). */
  line: number;
  startCol: number;
  endCol: number;
}

interface SearchOptions {
  caseSensitive: boolean;
  regex: boolean;
}

// ---------------------------------------------------------------------------
// Search logic (runs against xterm buffer — no DOM, no SearchAddon)
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a mapping from JS string code-unit index (as used by RegExp.exec()
 * m.index) to buffer column index. This handles two divergences between
 * xterm buffer columns and JS string positions:
 *
 *   1. Wide characters (CJK): occupy 2 buffer columns but translateToString()
 *      produces 1 string character (1 code unit). The continuation cell
 *      (width=0) has no corresponding string position.
 *
 *   2. Surrogate pairs (emoji): occupy 1 or 2 buffer columns but produce
 *      2 JS code units. RegExp indices count in code units, so the map
 *      must emit one entry per code unit.
 *
 * Returns an array where map[codeUnitIndex] = bufferColumn.
 * An extra sentinel at map[string.length] = cols allows computing exclusive
 * end columns directly: endCol = map[stringEnd].
 */
function buildStringToBufColMap(line: import('@xterm/xterm').IBufferLine, cols: number): number[] {
  const map: number[] = [];
  for (let col = 0; col < cols; col++) {
    const cell = line.getCell(col);
    if (!cell) break;
    const width = cell.getWidth();
    // Width 0 = continuation cell (second half of wide char) — no string char
    if (width === 0) continue;
    // Emit one map entry per JS code unit. Most characters produce 1 code unit,
    // but emoji/astral plane characters produce 2 (surrogate pairs).
    const chars = cell.getChars();
    const codeUnits = chars.length || 1; // empty cell → 1 space in translateToString
    for (let u = 0; u < codeUnits; u++) {
      map.push(col);
    }
  }
  map.push(cols); // sentinel for end-of-line
  return map;
}

function searchBuffer(
  term: XTerm,
  query: string,
  options: SearchOptions,
): SearchMatch[] {
  if (!query) return [];

  const buffer = term.buffer.active;
  const bufferLength = buffer.length;
  const matches: SearchMatch[] = [];

  let pattern: RegExp;
  try {
    const src = options.regex ? query : escapeRegex(query);
    pattern = new RegExp(src, options.caseSensitive ? 'g' : 'gi');
  } catch {
    // Invalid regex — return empty results
    return [];
  }

  for (let y = 0; y < bufferLength; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    const text = line.translateToString();
    if (!text.trim()) continue;

    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    // Lazily built — only needed when this line has matches
    let strToBuf: number[] | null = null;

    while ((m = pattern.exec(text)) !== null) {
      const strStart = m.index;
      const strEnd = strStart + m[0].length;
      if (strEnd > strStart) {
        // Convert string code-unit indices to buffer column indices for
        // correct highlight positioning with wide chars and emoji.
        if (!strToBuf) strToBuf = buildStringToBufColMap(line, term.cols);
        // Clamp to the map's sentinel (last entry = cols) rather than
        // falling back to raw string indices, which would reintroduce
        // column drift when wide chars or surrogate pairs are present.
        const mapLen = strToBuf.length;
        const startCol = strToBuf[Math.min(strStart, mapLen - 1)]!;
        const endCol = strToBuf[Math.min(strEnd, mapLen - 1)]!;
        matches.push({ line: y, startCol, endCol });
      }
      // Prevent infinite loop on zero-length match
      if (m[0].length === 0) pattern.lastIndex++;
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 200;

export function SearchOverlay({ terminalRef, rendererRef, scrollerRef, visible, onClose }: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when overlay becomes visible
  useEffect(() => {
    if (visible) {
      // Small delay so the overlay animation doesn't block focus
      const id = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [visible]);

  // Clear highlights when overlay hides
  useEffect(() => {
    if (!visible) {
      rendererRef.current?.clearHighlights();
      setQuery('');
      setMatches([]);
      setActiveIndex(0);
    }
  }, [visible, rendererRef]);

  // ---------------------------------------------------------------------------
  // Apply highlights whenever matches or activeIndex changes.
  // Translates buffer-absolute line indices (from searchBuffer) to viewport-
  // relative indices (expected by DomRenderer.setHighlights).
  // Also scrolls the viewport to ensure the active match is visible.
  // ---------------------------------------------------------------------------
  const applyHighlights = useCallback(
    (matchList: SearchMatch[], active: number) => {
      const renderer = rendererRef.current;
      const scroller = scrollerRef.current;
      if (!renderer) return;

      // Scroll to the active match so it's visible in the viewport
      const activeMatch = matchList[active];
      if (activeMatch && scroller) {
        scroller.scrollToBufferLine(activeMatch.line);
      }

      // Get the current viewport range AFTER scrolling
      const range = scroller?.getViewportRange();
      const startLine = range?.startLine ?? 0;
      const endLine = range?.endLine ?? Infinity;

      // Only emit highlights for matches visible in the current viewport,
      // translated from buffer-absolute to viewport-relative row indices.
      const highlights: HighlightRange[] = [];
      for (let i = 0; i < matchList.length; i++) {
        const m = matchList[i]!;
        if (m.line >= startLine && m.line < endLine) {
          highlights.push({
            line: m.line - startLine,
            startCol: m.startCol,
            endCol: m.endCol,
            active: i === active,
          });
        }
      }
      renderer.setHighlights(highlights);
    },
    [rendererRef, scrollerRef],
  );

  // ---------------------------------------------------------------------------
  // Run search (debounced via the caller)
  // ---------------------------------------------------------------------------
  const runSearch = useCallback(
    (q: string, opts: SearchOptions) => {
      const term = terminalRef.current;
      if (!term || !q) {
        rendererRef.current?.clearHighlights();
        setMatches([]);
        setActiveIndex(0);
        return;
      }

      const found = searchBuffer(term, q, opts);
      setMatches(found);
      const next = 0;
      setActiveIndex(next);
      applyHighlights(found, next);
    },
    [terminalRef, rendererRef, applyHighlights],
  );

  // Debounced query change
  useEffect(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSearch(query, { caseSensitive, regex: useRegex });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [query, caseSensitive, useRegex, runSearch]);

  // ---------------------------------------------------------------------------
  // Navigation helpers
  // ---------------------------------------------------------------------------
  const goNext = useCallback(() => {
    if (matches.length === 0) return;
    const next = (activeIndex + 1) % matches.length;
    setActiveIndex(next);
    applyHighlights(matches, next);
  }, [matches, activeIndex, applyHighlights]);

  const goPrev = useCallback(() => {
    if (matches.length === 0) return;
    const prev = (activeIndex - 1 + matches.length) % matches.length;
    setActiveIndex(prev);
    applyHighlights(matches, prev);
  }, [matches, activeIndex, applyHighlights]);

  // ---------------------------------------------------------------------------
  // Keyboard handling inside the input
  // ---------------------------------------------------------------------------
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) goPrev();
        else goNext();
        return;
      }
    },
    [onClose, goNext, goPrev],
  );

  // ---------------------------------------------------------------------------
  // Match count label
  // ---------------------------------------------------------------------------
  const matchLabel =
    matches.length === 0
      ? query ? 'No results' : ''
      : `${activeIndex + 1} of ${matches.length}`;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (!visible) return null;

  return (
    <div
      role="search"
      aria-label="Terminal search"
      style={{
        position: 'absolute',
        top: '8px',
        right: '8px',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px 6px',
        backgroundColor: 'rgba(20, 20, 28, 0.92)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: '6px',
        backdropFilter: 'blur(6px)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '13px',
        color: '#e2e2e2',
        userSelect: 'none',
        width: '280px',
        maxWidth: 'calc(100vw - 16px)',
      }}
    >
      {/* Search input */}
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search terminal..."
        aria-label="Search query"
        aria-live="polite"
        aria-atomic="true"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: '#e2e2e2',
          fontSize: '13px',
          fontFamily: 'inherit',
          padding: '2px 4px',
          minWidth: 0,
        }}
      />

      {/* Match count */}
      <span
        aria-label={matchLabel || undefined}
        style={{
          fontSize: '11px',
          color: matches.length === 0 && query ? '#f87171' : '#9ca3af',
          whiteSpace: 'nowrap',
          minWidth: '56px',
          textAlign: 'right',
        }}
      >
        {matchLabel}
      </span>

      {/* Divider */}
      <div style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.15)', margin: '0 2px' }} />

      {/* Case-sensitive toggle */}
      <button
        type="button"
        onClick={() => setCaseSensitive((v) => !v)}
        aria-pressed={caseSensitive}
        aria-label="Case sensitive"
        title="Case sensitive"
        style={{
          background: caseSensitive ? 'rgba(253, 224, 71, 0.25)' : 'transparent',
          border: caseSensitive ? '1px solid rgba(253,224,71,0.6)' : '1px solid transparent',
          borderRadius: '3px',
          color: caseSensitive ? '#fde047' : '#9ca3af',
          cursor: 'pointer',
          fontSize: '11px',
          fontWeight: 'bold',
          padding: '1px 5px',
          lineHeight: '16px',
          fontFamily: 'monospace',
        }}
      >
        Aa
      </button>

      {/* Regex toggle */}
      <button
        type="button"
        onClick={() => setUseRegex((v) => !v)}
        aria-pressed={useRegex}
        aria-label="Use regular expression"
        title="Regular expression"
        style={{
          background: useRegex ? 'rgba(253, 224, 71, 0.25)' : 'transparent',
          border: useRegex ? '1px solid rgba(253,224,71,0.6)' : '1px solid transparent',
          borderRadius: '3px',
          color: useRegex ? '#fde047' : '#9ca3af',
          cursor: 'pointer',
          fontSize: '11px',
          padding: '1px 5px',
          lineHeight: '16px',
          fontFamily: 'monospace',
        }}
      >
        .*
      </button>

      {/* Divider */}
      <div style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.15)', margin: '0 2px' }} />

      {/* Prev button */}
      <button
        type="button"
        onClick={goPrev}
        disabled={matches.length === 0}
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        style={{
          background: 'transparent',
          border: 'none',
          color: matches.length === 0 ? '#4b5563' : '#9ca3af',
          cursor: matches.length === 0 ? 'default' : 'pointer',
          fontSize: '14px',
          padding: '1px 4px',
          lineHeight: '16px',
        }}
      >
        &#8593;
      </button>

      {/* Next button */}
      <button
        type="button"
        onClick={goNext}
        disabled={matches.length === 0}
        aria-label="Next match"
        title="Next match (Enter)"
        style={{
          background: 'transparent',
          border: 'none',
          color: matches.length === 0 ? '#4b5563' : '#9ca3af',
          cursor: matches.length === 0 ? 'default' : 'pointer',
          fontSize: '14px',
          padding: '1px 4px',
          lineHeight: '16px',
        }}
      >
        &#8595;
      </button>

      {/* Divider */}
      <div style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.15)', margin: '0 2px' }} />

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close search"
        title="Close (Escape)"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#9ca3af',
          cursor: 'pointer',
          fontSize: '16px',
          padding: '0 4px',
          lineHeight: '16px',
        }}
      >
        &times;
      </button>
    </div>
  );
}
