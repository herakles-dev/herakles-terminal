/**
 * ScreenBuffer — Packed cell buffer inspired by Ink's screen.ts
 *
 * Reads xterm.js buffer via IBuffer.getLine/getCell API and stores cells
 * in a packed Int32Array for fast row-level diffing. Each cell uses 2 Int32 words:
 *   word0: charId (index into CharPool)
 *   word1: fgMode[31:30] | fgColor[29:16] | bgMode[15:14] | bgColor[13:2] | flags[1:0] (overflow to word extension)
 *
 * For simplicity and correctness, we use a slightly different packing:
 *   word0: charId (CharPool index)
 *   word1: styleId (StylePool index — encodes fg, bg, bold, italic, etc.)
 *
 * StylePool interns unique (fgMode, fgColor, bgMode, bgColor, flags) tuples.
 * Row-level diff compares entire rows via typed array comparison.
 */

import type { IBuffer, IBufferCell, IBufferLine } from '@xterm/xterm';

// ---------------------------------------------------------------------------
// CharPool — intern character strings to integer IDs (Ink pattern)
// ---------------------------------------------------------------------------

export class CharPool {
  /** Sentinel charId for wide-char continuation cells (width=0).
   *  DomRenderer skips these — the wide char already spans 2 columns.
   *  Uses a private-use Unicode codepoint that xterm.js will never return. */
  static readonly CONTINUATION_ID = 2;

  private strings: string[] = [' ', '', '\uE000']; // 0=space, 1=empty, 2=continuation (PUA)
  private map = new Map<string, number>([
    [' ', 0],
    ['', 1],
    ['\uE000', 2],
  ]);
  private ascii = new Int32Array(128).fill(-1);

  constructor() {
    // Pre-intern space and empty
    this.ascii[32] = 0; // space
  }

  intern(char: string): number {
    // ASCII fast-path
    if (char.length === 1) {
      const code = char.charCodeAt(0);
      if (code < 128) {
        const cached = this.ascii[code]!;
        if (cached !== -1) return cached;
        const id = this.strings.length;
        this.strings.push(char);
        this.ascii[code] = id;
        return id;
      }
    }
    const existing = this.map.get(char);
    if (existing !== undefined) return existing;
    const id = this.strings.length;
    this.strings.push(char);
    this.map.set(char, id);
    return id;
  }

  get(id: number): string {
    return this.strings[id] ?? ' ';
  }
}

// ---------------------------------------------------------------------------
// StylePool — intern terminal cell styles to integer IDs
// ---------------------------------------------------------------------------

/**
 * CellWidth — classifies cell display width for correct rendering of wide characters.
 * Note: numeric values differ from Ink's screen.ts (Ink: Narrow=0, Wide=1, SpacerTail=2).
 * Our values match xterm.js IBufferCell.getWidth() return values (0=continuation, 2=wide).
 */
export const enum CellWidth {
  /** Continuation cell — second column of a wide character. Skip during rendering. */
  CONTINUATION = 0,
  /** Normal single-width character. */
  NARROW = 1,
  /** Wide character (CJK, emoji) — occupies 2 columns. */
  WIDE = 2,
}

/** Flags packed into a single byte */
export const enum StyleFlags {
  NONE       = 0,
  BOLD       = 1 << 0,
  ITALIC     = 1 << 1,
  DIM        = 1 << 2,
  UNDERLINE  = 1 << 3,
  BLINK      = 1 << 4,
  INVERSE    = 1 << 5,
  INVISIBLE  = 1 << 6,
  STRIKETHROUGH = 1 << 7,
}

/** Color mode constants matching xterm.js */
export const enum ColorMode {
  DEFAULT = 0,
  PALETTE = 1,
  RGB     = 2,
}

export interface CellStyle {
  fgMode: ColorMode;
  fgColor: number;
  bgMode: ColorMode;
  bgColor: number;
  flags: number; // StyleFlags bitmask
}

export class StylePool {
  private styles: CellStyle[] = [];
  private map = new Map<string, number>();
  readonly defaultStyleId: number;

  constructor() {
    // Pre-intern the default style
    this.defaultStyleId = this.intern({
      fgMode: ColorMode.DEFAULT,
      fgColor: 0,
      bgMode: ColorMode.DEFAULT,
      bgColor: 0,
      flags: StyleFlags.NONE,
    });
  }

  intern(style: CellStyle): number {
    const key = `${style.fgMode}:${style.fgColor}:${style.bgMode}:${style.bgColor}:${style.flags}`;
    const existing = this.map.get(key);
    if (existing !== undefined) return existing;
    const id = this.styles.length;
    this.styles.push({ ...style });
    this.map.set(key, id);
    return id;
  }

  get(id: number): CellStyle {
    return this.styles[id] ?? this.styles[0]!;
  }

  /** Intern a style from an xterm.js IBufferCell */
  internFromCell(cell: IBufferCell): number {
    let flags = StyleFlags.NONE;
    if (cell.isBold()) flags |= StyleFlags.BOLD;
    if (cell.isItalic()) flags |= StyleFlags.ITALIC;
    if (cell.isDim()) flags |= StyleFlags.DIM;
    if (cell.isUnderline()) flags |= StyleFlags.UNDERLINE;
    if (cell.isBlink()) flags |= StyleFlags.BLINK;
    if (cell.isInverse()) flags |= StyleFlags.INVERSE;
    if (cell.isInvisible()) flags |= StyleFlags.INVISIBLE;
    if (cell.isStrikethrough()) flags |= StyleFlags.STRIKETHROUGH;

    let fgMode = ColorMode.DEFAULT;
    if (cell.isFgRGB()) fgMode = ColorMode.RGB;
    else if (cell.isFgPalette()) fgMode = ColorMode.PALETTE;

    let bgMode = ColorMode.DEFAULT;
    if (cell.isBgRGB()) bgMode = ColorMode.RGB;
    else if (cell.isBgPalette()) bgMode = ColorMode.PALETTE;

    return this.intern({
      fgMode,
      fgColor: cell.getFgColor(),
      bgMode,
      bgColor: cell.getBgColor(),
      flags,
    });
  }
}

// ---------------------------------------------------------------------------
// ScreenBuffer — packed cell grid with row-level diffing
// ---------------------------------------------------------------------------

const WORDS_PER_CELL = 2; // word0 = charId, word1 = styleId

export class ScreenBuffer {
  cols: number;
  rows: number;
  /** Packed cells: [charId, styleId, charId, styleId, ...] */
  cells: Int32Array;
  /** Per-row hash for fast diff (sum of all cell words) */
  private rowHashes: Int32Array;

  readonly charPool: CharPool;
  readonly stylePool: StylePool;

  constructor(cols: number, rows: number, charPool: CharPool, stylePool: StylePool) {
    this.cols = cols;
    this.rows = rows;
    this.charPool = charPool;
    this.stylePool = stylePool;
    this.cells = new Int32Array(cols * rows * WORDS_PER_CELL);
    this.rowHashes = new Int32Array(rows);
  }

  /** Resize the buffer, clearing all cells */
  resize(cols: number, rows: number): void {
    const totalWords = cols * rows * WORDS_PER_CELL;
    if (this.cells.length !== totalWords) {
      this.cells = new Int32Array(totalWords);
    } else {
      this.cells.fill(0);
    }
    // Always resize rowHashes — cols/rows can change even when total words stays same
    this.rowHashes = new Int32Array(rows);
    this.cols = cols;
    this.rows = rows;
  }

  /** Get the charId at (x, y) */
  getCharId(x: number, y: number): number {
    const offset = (y * this.cols + x) * WORDS_PER_CELL;
    return this.cells[offset]!;
  }

  /** Get the styleId at (x, y) */
  getStyleId(x: number, y: number): number {
    const offset = (y * this.cols + x) * WORDS_PER_CELL + 1;
    return this.cells[offset]!;
  }

  /** Set a cell at (x, y) */
  setCell(x: number, y: number, charId: number, styleId: number): void {
    const offset = (y * this.cols + x) * WORDS_PER_CELL;
    this.cells[offset] = charId;
    this.cells[offset + 1] = styleId;
  }

  /**
   * Read the visible viewport from an xterm.js buffer into this ScreenBuffer.
   * Uses a reusable IBufferCell to avoid per-cell allocations.
   *
   * @param buffer    xterm.js active buffer
   * @param cols      terminal column count
   * @param rows      terminal row count (lines to read)
   * @param startLine Optional override for the first buffer line to read.
   *                  When omitted, uses `buffer.viewportY` (xterm's native scroll position).
   *                  Pass this from VirtualScroller.getViewportRange().startLine to render
   *                  any slice of the scrollback buffer without modifying xterm's scroll state.
   */
  readFromXTermBuffer(buffer: IBuffer, cols: number, rows: number, startLine?: number): void {
    // Resize if needed
    if (this.cols !== cols || this.rows !== rows) {
      this.resize(cols, rows);
    }

    const reusableCell = buffer.getNullCell();
    const viewportY = startLine !== undefined ? startLine : buffer.viewportY;

    for (let y = 0; y < rows; y++) {
      const line: IBufferLine | undefined = buffer.getLine(viewportY + y);
      const rowOffset = y * cols * WORDS_PER_CELL;
      let rowHash = 0;

      if (!line) {
        // Empty line — fill with space + default style
        for (let x = 0; x < cols; x++) {
          const offset = rowOffset + x * WORDS_PER_CELL;
          this.cells[offset] = 0; // space charId
          this.cells[offset + 1] = this.stylePool.defaultStyleId;
        }
        this.rowHashes[y] = 0;
        continue;
      }

      for (let x = 0; x < cols; x++) {
        const cell = line.getCell(x, reusableCell);
        let charId: number;
        let styleId: number;

        if (cell) {
          const chars = cell.getChars();
          const cellWidth = cell.getWidth() as CellWidth;

          if (cellWidth === CellWidth.CONTINUATION) {
            // Continuation cell of a wide char — DomRenderer skips these
            charId = CharPool.CONTINUATION_ID;
            styleId = this.stylePool.defaultStyleId;
          } else {
            charId = this.charPool.intern(chars || ' ');
            styleId = cell.isAttributeDefault()
              ? this.stylePool.defaultStyleId
              : this.stylePool.internFromCell(cell);
          }
        } else {
          charId = 0; // space
          styleId = this.stylePool.defaultStyleId;
        }

        const offset = rowOffset + x * WORDS_PER_CELL;
        this.cells[offset] = charId;
        this.cells[offset + 1] = styleId;
        rowHash = (Math.imul(rowHash, 0x9e3779b9) ^ Math.imul(charId, 0x517cc1b7) ^ styleId) | 0;
      }

      this.rowHashes[y] = rowHash;
    }
  }

  /**
   * Diff this buffer against a previous buffer and return dirty row indices.
   * Uses row hashes for fast rejection, then falls back to word-by-word comparison.
   *
   * If startRow/endRow are provided (from xterm's onRender event), only those
   * rows are checked.
   */
  diff(prev: ScreenBuffer, startRow?: number, endRow?: number): Set<number> {
    const dirty = new Set<number>();
    const from = startRow ?? 0;
    const to = Math.min(endRow ?? (this.rows - 1), this.rows - 1, prev.rows - 1);

    // If dimensions changed, everything is dirty
    if (this.cols !== prev.cols || this.rows !== prev.rows) {
      for (let y = 0; y < this.rows; y++) dirty.add(y);
      return dirty;
    }

    for (let y = from; y <= to; y++) {
      // Fast path: row hash comparison
      if (this.rowHashes[y] !== prev.rowHashes[y]) {
        dirty.add(y);
        continue;
      }

      // Slow path: word-by-word comparison (hash collision check)
      const rowOffset = y * this.cols * WORDS_PER_CELL;
      const rowWords = this.cols * WORDS_PER_CELL;
      let match = true;
      for (let i = 0; i < rowWords; i++) {
        if (this.cells[rowOffset + i] !== prev.cells[rowOffset + i]) {
          match = false;
          break;
        }
      }
      if (!match) dirty.add(y);
    }

    return dirty;
  }

  /** Clone this buffer (for double-buffering) */
  clone(): ScreenBuffer {
    const copy = new ScreenBuffer(this.cols, this.rows, this.charPool, this.stylePool);
    copy.cells.set(this.cells);
    copy.rowHashes.set(this.rowHashes);
    return copy;
  }

  /** Copy contents from another buffer into this one */
  copyFrom(src: ScreenBuffer): void {
    if (this.cols !== src.cols || this.rows !== src.rows) {
      this.resize(src.cols, src.rows);
    }
    this.cells.set(src.cells);
    this.rowHashes.set(src.rowHashes);
  }
}
