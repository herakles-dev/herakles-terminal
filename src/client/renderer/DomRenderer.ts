/**
 * DomRenderer — Renders terminal cells as DOM rows (divs) with styled spans.
 *
 * Each row is a <div> with white-space:pre. Styled character runs are coalesced
 * into <span> elements. Only dirty rows are re-rendered (diff-based updates).
 */

import type { TerminalTheme } from '@shared/types';
import { type CellStyle, ColorMode, type ScreenBuffer, StyleFlags } from './ScreenBuffer.js';

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

export class DomRenderer {
  private container: HTMLElement;
  private rowElements: HTMLDivElement[] = [];
  private styleCache = new Map<number, StyleEntry>();
  private lineHeight = 0;
  // Instance-level palette — indices 0-15 are theme colors, 16-255 are static
  private ansiColors: string[];

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

  setTheme(theme: TerminalTheme): void {
    // Update only instance palette indices 0-15
    this.ansiColors[0] = theme.black;
    this.ansiColors[1] = theme.red;
    this.ansiColors[2] = theme.green;
    this.ansiColors[3] = theme.yellow;
    this.ansiColors[4] = theme.blue;
    this.ansiColors[5] = theme.magenta;
    this.ansiColors[6] = theme.cyan;
    this.ansiColors[7] = theme.white;
    this.ansiColors[8] = theme.brightBlack;
    this.ansiColors[9] = theme.brightRed;
    this.ansiColors[10] = theme.brightGreen;
    this.ansiColors[11] = theme.brightYellow;
    this.ansiColors[12] = theme.brightBlue;
    this.ansiColors[13] = theme.brightMagenta;
    this.ansiColors[14] = theme.brightCyan;
    this.ansiColors[15] = theme.brightWhite;
    this.container.style.backgroundColor = theme.background;
    this.container.style.color = theme.foreground;
    this.styleCache.clear();
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
    this.ensureRows(buffer.rows);
    for (const y of dirtyRows) {
      if (y >= this.rowElements.length) continue;
      this.renderRow(this.rowElements[y]!, buffer, y);
    }
  }

  renderAll(buffer: ScreenBuffer): void {
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
    rowEl.innerHTML = html;
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
    if (style.flags & StyleFlags.DIM) parts.push('opacity:0.5');
    if (style.flags & StyleFlags.ITALIC) parts.push('font-style:italic');

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
    for (const row of this.rowElements) {
      row.remove();
    }
    this.rowElements = [];
    this.styleCache.clear();
  }
}
