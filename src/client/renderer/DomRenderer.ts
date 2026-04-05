/**
 * DomRenderer — Renders terminal cells as DOM rows (divs) with styled spans.
 *
 * Each row is a <div> with white-space:pre. Styled character runs are coalesced
 * into <span> elements. Only dirty rows are re-rendered (diff-based updates).
 *
 * Highlight overlay: call setHighlights() with character column ranges to wrap
 * matching characters in .search-match / .search-match-active spans. Highlights
 * are injected as a post-pass on the final HTML string so the normal rendering
 * path is completely unchanged for rows with no matches.
 */

import type { TerminalTheme } from '@shared/types';
import { CharPool, type CellStyle, ColorMode, type ScreenBuffer, StyleFlags } from './ScreenBuffer.js';

// ---------------------------------------------------------------------------
// Static ANSI 256-color palette (indices 16-255, theme-independent)
// ---------------------------------------------------------------------------

const ANSI_256_STATIC: string[] = new Array(256).fill('');

// Colors 16-231: 6x6x6 RGB cube
for (let r = 0; r < 6; r++) {
  for (let g = 0; g < 6; g++) {
    for (let b = 0; b < 6; b++) {
      const index = 16 + r * 36 + g * 6 + b;
      const rv = r === 0 ? 0 : 55 + r * 40;
      const gv = g === 0 ? 0 : 55 + g * 40;
      const bv = b === 0 ? 0 : 55 + b * 40;
      ANSI_256_STATIC[index] = `#${rv.toString(16).padStart(2, '0')}${gv.toString(16).padStart(2, '0')}${bv.toString(16).padStart(2, '0')}`;
    }
  }
}

// Colors 232-255: grayscale ramp
for (let i = 0; i < 24; i++) {
  const v = 8 + i * 10;
  ANSI_256_STATIC[232 + i] = `#${v.toString(16).padStart(2, '0')}${v.toString(16).padStart(2, '0')}${v.toString(16).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Style → CSS conversion
// ---------------------------------------------------------------------------

interface StyleEntry {
  inlineStyle: string;
}

// ---------------------------------------------------------------------------
// Highlight range type (exported for SearchOverlay)
// ---------------------------------------------------------------------------

export interface HighlightRange {
  /** Row index in the visible viewport (0 = top visible row). */
  line: number;
  startCol: number;
  endCol: number;
  /** true = currently focused match (.search-match-active class) */
  active: boolean;
}

export class DomRenderer {
  private container: HTMLElement;
  private rowElements: HTMLDivElement[] = [];
  private styleCache = new Map<number, StyleEntry>();
  private lineHeight = 0;
  // Instance-level palette — indices 0-15 are theme colors, 16-255 are static
  private ansiColors: string[];
  // True once a viewportElement has been supplied to setTheme(). Enables the CSS-variable
  // path in resolveColor() so generated spans reference var(--term-ansi-N) instead of
  // hardcoded hex. This allows instant theme switching without clearing the style cache.
  private cssVarsActive = false;

  // ---------------------------------------------------------------------------
  // Highlight overlay state
  // ---------------------------------------------------------------------------
  /** Per-row sorted highlight ranges. Cleared by clearHighlights(). */
  private highlights = new Map<number, HighlightRange[]>();
  /**
   * Most recent buffer passed to renderAll/updateRows. Required so
   * setHighlights() can re-render affected rows without a caller-supplied buffer.
   */
  private lastBuffer: ScreenBuffer | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.style.overflow = 'hidden';
    this.container.style.whiteSpace = 'pre';
    this.container.style.fontVariantLigatures = 'none';
    this.container.style.fontFeatureSettings = '"liga" 0';
    this.container.setAttribute('role', 'log');
    this.container.setAttribute('aria-live', 'off');
    // Copy static palette to instance
    this.ansiColors = [...ANSI_256_STATIC];
  }

  setLineHeight(lineHeight: number): void {
    this.lineHeight = lineHeight;
    for (const row of this.rowElements) {
      row.style.height = `${lineHeight}px`;
    }
  }

  setTheme(theme: TerminalTheme, viewportElement?: HTMLElement): void {
    // Palette mapping: JS index → theme key → CSS variable name
    const palette: [string, string][] = [
      [theme.black,         '--term-ansi-0'],
      [theme.red,           '--term-ansi-1'],
      [theme.green,         '--term-ansi-2'],
      [theme.yellow,        '--term-ansi-3'],
      [theme.blue,          '--term-ansi-4'],
      [theme.magenta,       '--term-ansi-5'],
      [theme.cyan,          '--term-ansi-6'],
      [theme.white,         '--term-ansi-7'],
      [theme.brightBlack,   '--term-ansi-8'],
      [theme.brightRed,     '--term-ansi-9'],
      [theme.brightGreen,   '--term-ansi-10'],
      [theme.brightYellow,  '--term-ansi-11'],
      [theme.brightBlue,    '--term-ansi-12'],
      [theme.brightMagenta, '--term-ansi-13'],
      [theme.brightCyan,    '--term-ansi-14'],
      [theme.brightWhite,   '--term-ansi-15'],
    ];

    // Update JS palette (used as fallback and for indices 16-255 which are always hex)
    for (let i = 0; i < palette.length; i++) {
      this.ansiColors[i] = palette[i]![0];
    }

    // Update CSS variables on the viewport element so existing spans update instantly
    // without clearing the style cache or re-rendering.
    if (viewportElement) {
      for (const [color, varName] of palette) {
        viewportElement.style.setProperty(varName, color);
      }
      viewportElement.style.setProperty('--term-fg', theme.foreground);
      viewportElement.style.setProperty('--term-bg', theme.background);
      viewportElement.style.setProperty('--term-cursor', theme.cursor);
      viewportElement.setAttribute('data-theme', theme.name.toLowerCase().replace(/\s+/g, '-'));
      this.cssVarsActive = true;
    }

    this.container.style.backgroundColor = theme.background;
    this.container.style.color = theme.foreground;

    // Only clear the style cache when there is no viewport element. When CSS variables
    // are in use the cached inline styles already reference var(--term-ansi-N) so they
    // remain valid after a variable value change — no re-render needed for palette colors.
    if (!viewportElement) {
      this.styleCache.clear();
    }
  }

  ensureRows(rows: number): void {
    while (this.rowElements.length < rows) {
      const row = document.createElement('div');
      row.className = 'dom-term-row';
      if (this.lineHeight > 0) row.style.height = `${this.lineHeight}px`;
      this.container.appendChild(row);
      this.rowElements.push(row);
    }
    while (this.rowElements.length > rows) {
      const row = this.rowElements.pop()!;
      this.container.removeChild(row);
    }
  }

  updateRows(buffer: ScreenBuffer, dirtyRows: Set<number>): void {
    this.lastBuffer = buffer;
    this.ensureRows(buffer.rows);
    for (const y of dirtyRows) {
      if (y >= this.rowElements.length) continue;
      this.renderRow(this.rowElements[y]!, buffer, y);
    }
  }

  renderAll(buffer: ScreenBuffer): void {
    this.lastBuffer = buffer;
    this.ensureRows(buffer.rows);
    for (let y = 0; y < buffer.rows; y++) {
      this.renderRow(this.rowElements[y]!, buffer, y);
    }
  }

  private renderRow(rowEl: HTMLDivElement, buffer: ScreenBuffer, y: number): void {
    let html = '';
    let runStyleId = buffer.getStyleId(0, y);
    let runChars = '';

    for (let x = 0; x < buffer.cols; x++) {
      const charId = buffer.getCharId(x, y);

      // Skip wide-char continuation cells — the wide char already spans 2 columns
      if (charId === CharPool.CONTINUATION_ID) continue;

      const styleId = buffer.getStyleId(x, y);
      const char = buffer.charPool.get(charId);

      if (styleId !== runStyleId) {
        html += this.makeSpan(runStyleId, runChars, buffer.stylePool);
        runStyleId = styleId;
        runChars = '';
      }

      if (char === '<') runChars += '&lt;';
      else if (char === '>') runChars += '&gt;';
      else if (char === '&') runChars += '&amp;';
      else if (char === '"') runChars += '&quot;';
      else if (char === '' || char === ' ') runChars += ' ';
      else runChars += char;
    }

    html += this.makeSpan(runStyleId, runChars, buffer.stylePool);

    // Apply search-highlight overlay if this row has active match ranges.
    // Post-pass on the final HTML string — the style-coalescing above is untouched.
    const rowHighlights = this.highlights.get(y);
    if (rowHighlights && rowHighlights.length > 0) {
      html = this.injectHighlightSpans(html, rowHighlights, buffer.cols);
    }

    rowEl.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // Highlight overlay — public API
  // ---------------------------------------------------------------------------

  /**
   * Replace the full highlight set. Rows that changed (gained, lost, or had
   * their ranges modified) are immediately re-rendered from lastBuffer.
   * Pass an empty array to remove all highlights.
   */
  setHighlights(ranges: HighlightRange[]): void {
    const prevRows = new Set(this.highlights.keys());

    this.highlights.clear();
    for (const r of ranges) {
      let list = this.highlights.get(r.line);
      if (!list) {
        list = [];
        this.highlights.set(r.line, list);
      }
      list.push(r);
    }
    // Sort each row's ranges by startCol ascending.
    for (const list of this.highlights.values()) {
      list.sort((a: HighlightRange, b: HighlightRange) => a.startCol - b.startCol);
    }

    // Re-render all rows that are or were highlighted.
    const affectedRows = new Set([...prevRows, ...this.highlights.keys()]);
    if (affectedRows.size === 0 || !this.lastBuffer) return;

    const buf = this.lastBuffer;
    this.ensureRows(buf.rows);
    for (const y of affectedRows) {
      if (y < 0 || y >= this.rowElements.length) continue;
      this.renderRow(this.rowElements[y]!, buf, y);
    }
  }

  /** Remove all highlights and re-render affected rows. */
  clearHighlights(): void {
    this.setHighlights([]);
  }

  /**
   * Inject <span class="search-match"> / <span class="search-match-active">
   * wrappers into a row's HTML string at the character column boundaries given
   * by `ranges`. We walk the HTML character-by-character tracking tag vs. text
   * context. Text characters increment a logical column counter; column ranges
   * map directly to that counter. HTML entities (&amp; etc.) count as 1 column.
   */
  private injectHighlightSpans(
    html: string,
    ranges: HighlightRange[],
    cols: number,
  ): string {
    // Build a flat per-column array of CSS class names (null = unhighlighted).
    const colClass = new Array<string | null>(cols).fill(null);
    for (const r of ranges) {
      const cls = r.active ? 'search-match-active' : 'search-match';
      for (let c = r.startCol; c < r.endCol && c < cols; c++) {
        colClass[c] = cls;
      }
    }

    let result = '';
    let inTag = false;
    let col = 0;
    let currentHighlightCls: string | null = null;
    let inEntity = false;

    for (let i = 0; i < html.length; i++) {
      const ch = html[i]!;

      if (inTag) {
        result += ch;
        if (ch === '>') inTag = false;
        continue;
      }

      if (ch === '<') {
        // Leaving text — close any open highlight span before the tag.
        if (currentHighlightCls !== null) {
          result += '</span>';
          currentHighlightCls = null;
        }
        inTag = true;
        result += ch;
        continue;
      }

      // Text character (possibly inside an HTML entity).
      if (ch === '&') inEntity = true;

      const wantedCls = col < cols ? (colClass[col] ?? null) : null;

      if (wantedCls !== currentHighlightCls) {
        if (currentHighlightCls !== null) result += '</span>';
        if (wantedCls !== null) result += `<span class="${wantedCls}">`;
        currentHighlightCls = wantedCls;
      }

      result += ch;

      // Advance column: HTML entities count as 1 col (only on the ';').
      if (inEntity) {
        if (ch === ';') { inEntity = false; col++; }
        // Don't increment col for intermediate entity chars.
      } else {
        col++;
      }
    }

    // Close any trailing open highlight span.
    if (currentHighlightCls !== null) result += '</span>';

    return result;
  }

  private makeSpan(styleId: number, text: string, stylePool: import('./ScreenBuffer.js').StylePool): string {
    if (!text) return '';
    if (styleId === stylePool.defaultStyleId) return text;
    const entry = this.getStyleEntry(styleId, stylePool);
    if (entry.inlineStyle) {
      return `<span style="${entry.inlineStyle}">${text}</span>`;
    }
    return text;
  }

  private getStyleEntry(styleId: number, stylePool: import('./ScreenBuffer.js').StylePool): StyleEntry {
    let entry = this.styleCache.get(styleId);
    if (entry) return entry;
    const style = stylePool.get(styleId);
    entry = { inlineStyle: this.buildInlineStyle(style) };
    this.styleCache.set(styleId, entry);
    return entry;
  }

  private buildInlineStyle(style: CellStyle): string {
    const parts: string[] = [];
    const isInverse = !!(style.flags & StyleFlags.INVERSE);

    // Swap fg/bg when INVERSE flag is set (xterm buffer reports logical colors)
    const fgMode = isInverse ? style.bgMode : style.fgMode;
    const fgColor = isInverse ? style.bgColor : style.fgColor;
    const bgMode = isInverse ? style.fgMode : style.bgMode;
    const bgColor = isInverse ? style.fgColor : style.bgColor;

    const fgCss = this.resolveColor(fgMode, fgColor);
    if (fgCss) parts.push(`color:${fgCss}`);
    const bgCss = this.resolveColor(bgMode, bgColor);
    if (bgCss) parts.push(`background-color:${bgCss}`);

    if (style.flags & StyleFlags.BOLD) parts.push('font-weight:bold');
    if (style.flags & StyleFlags.DIM) parts.push('opacity:0.5;filter:brightness(0.75)');
    if (style.flags & StyleFlags.ITALIC) parts.push('font-style:italic');
    if (style.flags & StyleFlags.BLINK) parts.push('animation:dom-term-text-blink 1s step-end infinite');

    const decorations: string[] = [];
    if (style.flags & StyleFlags.UNDERLINE) decorations.push('underline');
    if (style.flags & StyleFlags.STRIKETHROUGH) decorations.push('line-through');
    if (decorations.length > 0) parts.push(`text-decoration:${decorations.join(' ')}`);

    if (style.flags & StyleFlags.INVISIBLE) parts.push('visibility:hidden');

    return parts.join(';');
  }

  private resolveColor(mode: ColorMode, value: number): string | null {
    switch (mode) {
      case ColorMode.DEFAULT:
        return null;
      case ColorMode.PALETTE:
        // Palette indices 0-15 are theme colors. When CSS variables are active, reference
        // var(--term-ansi-N) so that a theme switch (which updates the variable on the
        // viewport element) instantly recolors all existing spans without re-rendering.
        // Indices 16-255 are static (256-color cube + grayscale) — always inline hex.
        if (this.cssVarsActive && value >= 0 && value <= 15) {
          return `var(--term-ansi-${value})`;
        }
        return this.ansiColors[value] ?? null;
      case ColorMode.RGB: {
        const r = (value >> 16) & 0xff;
        const g = (value >> 8) & 0xff;
        const b = value & 0xff;
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      }
      default:
        return null;
    }
  }

  clear(): void {
    for (const row of this.rowElements) {
      row.innerHTML = '';
    }
  }

  dispose(): void {
    this.highlights.clear();
    this.lastBuffer = null;
    for (const row of this.rowElements) {
      row.remove();
    }
    this.rowElements = [];
    this.styleCache.clear();
  }
}
