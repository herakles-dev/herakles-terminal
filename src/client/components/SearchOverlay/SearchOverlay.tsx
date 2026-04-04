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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchOverlayProps {
  /** xterm.js Terminal instance for buffer access. May be null before init. */
  terminalRef: React.RefObject<XTerm | null>;
  /** DomRenderer instance for highlight integration. May be null before init. */
  rendererRef: React.RefObject<DomRenderer | null>;
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
    while ((m = pattern.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (end > start) {
        matches.push({ line: y, startCol: start, endCol: end });
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

export function SearchOverlay({ terminalRef, rendererRef, visible, onClose }: SearchOverlayProps) {
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
  // Apply highlights whenever matches or activeIndex changes
  // ---------------------------------------------------------------------------
  const applyHighlights = useCallback(
    (matchList: SearchMatch[], active: number) => {
      const renderer = rendererRef.current;
      if (!renderer) return;

      const highlights: HighlightRange[] = matchList.map((m, i) => ({
        line: m.line,
        startCol: m.startCol,
        endCol: m.endCol,
        active: i === active,
      }));
      renderer.setHighlights(highlights);
    },
    [rendererRef],
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
