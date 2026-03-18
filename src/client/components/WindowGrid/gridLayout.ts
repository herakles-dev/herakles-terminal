/**
 * GridLayout - CSS Grid layout model with fraction-to-grid conversion
 *
 * Converts between the existing fractional coordinate system (x, y, width, height in 0-1)
 * and CSS Grid track definitions (grid-template-columns/rows).
 *
 * Design: Grid uses `fr` units for pane tracks and fixed `6px` for drag handles.
 * Example: two side-by-side panes → "1fr 6px 1fr"
 */

export const HANDLE_SIZE_PX = 6;

export interface GridPaneInfo {
  id: string;
  type: 'terminal' | 'media' | 'agent';
  gridArea: string;
  /** Original fractional coords for backward compat */
  fraction: { x: number; y: number; width: number; height: number };
}

export interface HorizontalHandleCell {
  /** Row gap index (0-based) */
  handleIndex: number;
  /** Pane column index (0-based) */
  paneCol: number;
  /** CSS grid-area name for this cell */
  areaName: string;
}

export interface GridLayout {
  /** CSS grid-template-columns value, e.g. "1fr 6px 2fr" */
  columns: string;
  /** CSS grid-template-rows value, e.g. "1fr 6px 1fr" */
  rows: string;
  /** grid-template-areas strings, e.g. ['"w1 handle-v w2"', '"w1 handle-v w2"'] */
  areas: string[];
  /** Map of windowId → pane metadata */
  panes: Map<string, GridPaneInfo>;
  /** Column track widths as fr values (excluding handles) */
  columnFractions: number[];
  /** Row track heights as fr values (excluding handles) */
  rowFractions: number[];
  /** Individual horizontal handle cells (unique per cell, not spanning) */
  horizontalHandleCells: HorizontalHandleCell[];
}

interface WindowRect {
  id: string;
  type: 'terminal' | 'media' | 'agent';
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Detect unique column boundaries from window positions.
 * Returns sorted array of boundary x-positions.
 */
function detectColumnBoundaries(windows: WindowRect[]): number[] {
  const boundaries = new Set<number>();
  for (const w of windows) {
    boundaries.add(round(w.x));
    boundaries.add(round(w.x + w.width));
  }
  return [...boundaries].sort((a, b) => a - b);
}

/**
 * Detect unique row boundaries from window positions.
 */
function detectRowBoundaries(windows: WindowRect[]): number[] {
  const boundaries = new Set<number>();
  for (const w of windows) {
    boundaries.add(round(w.y));
    boundaries.add(round(w.y + w.height));
  }
  return [...boundaries].sort((a, b) => a - b);
}

/** Round to 4 decimals to avoid floating point noise */
function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/**
 * Convert an array of fractional-coordinate windows into a CSS Grid layout.
 *
 * Algorithm:
 * 1. Detect column and row boundaries from window rects
 * 2. Build grid tracks: each boundary gap becomes a pane column/row (in fr)
 * 3. Insert 6px handle tracks between adjacent pane tracks
 * 4. Assign grid-area names based on which window occupies each cell
 */
export function fractionsToGrid(windows: WindowRect[]): GridLayout {
  if (windows.length === 0) {
    return {
      columns: '1fr',
      rows: '1fr',
      areas: ['"empty"'],
      panes: new Map(),
      columnFractions: [1],
      rowFractions: [1],
      horizontalHandleCells: [],
    };
  }

  if (windows.length === 1) {
    const w = windows[0];
    const panes = new Map<string, GridPaneInfo>();
    panes.set(w.id, {
      id: w.id,
      type: w.type,
      gridArea: `pane-${sanitizeId(w.id)}`,
      fraction: { x: w.x, y: w.y, width: w.width, height: w.height },
    });
    return {
      columns: '1fr',
      rows: '1fr',
      areas: [`"pane-${sanitizeId(w.id)}"`],
      panes,
      columnFractions: [1],
      rowFractions: [1],
      horizontalHandleCells: [],
    };
  }

  const colBounds = detectColumnBoundaries(windows);
  const rowBounds = detectRowBoundaries(windows);

  // Pane column widths (fractional differences between boundaries)
  const colWidths = [];
  for (let i = 0; i < colBounds.length - 1; i++) {
    colWidths.push(round(colBounds[i + 1] - colBounds[i]));
  }
  const rowHeights = [];
  for (let i = 0; i < rowBounds.length - 1; i++) {
    rowHeights.push(round(rowBounds[i + 1] - rowBounds[i]));
  }

  // Build grid-template-columns: interleave pane tracks with handle tracks
  const columnParts: string[] = [];
  const columnFractions: number[] = [];
  for (let i = 0; i < colWidths.length; i++) {
    if (i > 0) columnParts.push(`${HANDLE_SIZE_PX}px`);
    // Convert fraction to fr (multiply by 1000 for precision, then simplify)
    const fr = Math.max(1, Math.round(colWidths[i] * 1000));
    columnParts.push(`${fr}fr`);
    columnFractions.push(colWidths[i]);
  }

  const rowParts: string[] = [];
  const rowFractions: number[] = [];
  for (let i = 0; i < rowHeights.length; i++) {
    if (i > 0) rowParts.push(`${HANDLE_SIZE_PX}px`);
    const fr = Math.max(1, Math.round(rowHeights[i] * 1000));
    rowParts.push(`${fr}fr`);
    rowFractions.push(rowHeights[i]);
  }

  // Build grid cell assignments
  // Total grid columns = colWidths.length (pane) + (colWidths.length - 1) (handles)
  const totalCols = colWidths.length + Math.max(0, colWidths.length - 1);
  const totalRows = rowHeights.length + Math.max(0, rowHeights.length - 1);

  // Initialize area grid
  const areaGrid: string[][] = Array.from({ length: totalRows }, () =>
    Array.from({ length: totalCols }, () => '.')
  );

  const panes = new Map<string, GridPaneInfo>();

  for (const w of windows) {
    const areaName = `pane-${sanitizeId(w.id)}`;
    panes.set(w.id, {
      id: w.id,
      type: w.type,
      gridArea: areaName,
      fraction: { x: w.x, y: w.y, width: w.width, height: w.height },
    });

    // Find which pane-column indices this window spans
    const startCol = colBounds.indexOf(round(w.x));
    const endCol = colBounds.indexOf(round(w.x + w.width));
    const startRow = rowBounds.indexOf(round(w.y));
    const endRow = rowBounds.indexOf(round(w.y + w.height));

    if (startCol === -1 || endCol === -1 || startRow === -1 || endRow === -1) continue;

    // Fill area grid cells (skip handle tracks)
    for (let paneRow = startRow; paneRow < endRow; paneRow++) {
      for (let paneCol = startCol; paneCol < endCol; paneCol++) {
        // Map pane index to grid index (pane i → grid 2*i)
        const gridRow = paneRow * 2;
        const gridCol = paneCol * 2;
        if (gridRow < totalRows && gridCol < totalCols) {
          areaGrid[gridRow][gridCol] = areaName;
        }
      }
    }

    // Fill handle cells between spanned panes
    for (let paneRow = startRow; paneRow < endRow; paneRow++) {
      for (let paneCol = startCol; paneCol < endCol - 1; paneCol++) {
        const gridRow = paneRow * 2;
        const gridCol = paneCol * 2 + 1; // handle column
        if (gridRow < totalRows && gridCol < totalCols) {
          areaGrid[gridRow][gridCol] = areaName;
        }
      }
    }
    for (let paneRow = startRow; paneRow < endRow - 1; paneRow++) {
      for (let paneCol = startCol; paneCol < endCol; paneCol++) {
        const gridRow = paneRow * 2 + 1; // handle row
        const gridCol = paneCol * 2;
        if (gridRow < totalRows && gridCol < totalCols) {
          areaGrid[gridRow][gridCol] = areaName;
        }
      }
    }
  }

  // Name handle tracks.
  // CRITICAL: CSS grid-template-areas requires every named area to form a rectangle.
  // Strategy: vertical handles (odd columns) get priority and span ALL rows in their column.
  // Horizontal handle cells get unique names per cell (hh-{rowIdx}-{paneColIdx}).
  // This eliminates non-rectangular areas that previously broke 3+ window layouts.
  const horizontalHandleCells: HorizontalHandleCell[] = [];

  // Pass 1: Vertical handles claim all cells in their column (odd columns)
  for (let c = 0; c < totalCols; c++) {
    if (c % 2 !== 1) continue; // Only odd columns are handle columns
    const handleIndex = Math.floor(c / 2);
    for (let r = 0; r < totalRows; r++) {
      if (areaGrid[r][c] === '.') {
        areaGrid[r][c] = `hv-${handleIndex}`;
      }
    }
  }

  // Pass 2: Horizontal handle cells claim remaining dots in odd rows (even columns only)
  for (let r = 0; r < totalRows; r++) {
    if (r % 2 !== 1) continue; // Only odd rows are handle rows
    const handleIndex = Math.floor(r / 2);
    for (let c = 0; c < totalCols; c++) {
      if (c % 2 !== 0) continue; // Skip odd columns (already claimed by vertical handles)
      if (areaGrid[r][c] === '.') {
        const paneCol = Math.floor(c / 2);
        const areaName = `hh-${handleIndex}-${paneCol}`;
        areaGrid[r][c] = areaName;
        horizontalHandleCells.push({ handleIndex, paneCol, areaName });
      }
    }
  }

  const areas = areaGrid.map(row => `"${row.join(' ')}"`);

  return {
    columns: columnParts.join(' '),
    rows: rowParts.join(' '),
    areas,
    panes,
    columnFractions,
    rowFractions,
    horizontalHandleCells,
  };
}

/**
 * Convert a GridLayout back to fractional coordinates for server storage.
 */
export function gridToFractions(layout: GridLayout): WindowRect[] {
  const results: WindowRect[] = [];
  for (const [, pane] of layout.panes) {
    results.push({
      id: pane.id,
      type: pane.type,
      ...pane.fraction,
    });
  }
  return results;
}

/**
 * Update grid column fractions when a vertical handle is dragged.
 * Returns new column fr values.
 */
export function updateColumnFraction(
  fractions: number[],
  handleIndex: number,
  deltaPx: number,
  containerWidthPx: number
): number[] {
  const totalHandlesPx = (fractions.length - 1) * HANDLE_SIZE_PX;
  const availablePx = containerWidthPx - totalHandlesPx;
  if (availablePx <= 0) return fractions;

  const totalFr = fractions.reduce((s, f) => s + f, 0);
  const deltaFr = (deltaPx / availablePx) * totalFr;

  const newFractions = [...fractions];
  const leftIdx = handleIndex;
  const rightIdx = handleIndex + 1;

  const minFr = 0.05 * totalFr; // 5% minimum

  newFractions[leftIdx] = Math.max(minFr, fractions[leftIdx] + deltaFr);
  newFractions[rightIdx] = Math.max(minFr, fractions[rightIdx] - deltaFr);

  return newFractions;
}

/**
 * Update grid row fractions when a horizontal handle is dragged.
 */
export function updateRowFraction(
  fractions: number[],
  handleIndex: number,
  deltaPx: number,
  containerHeightPx: number
): number[] {
  const totalHandlesPx = (fractions.length - 1) * HANDLE_SIZE_PX;
  const availablePx = containerHeightPx - totalHandlesPx;
  if (availablePx <= 0) return fractions;

  const totalFr = fractions.reduce((s, f) => s + f, 0);
  const deltaFr = (deltaPx / availablePx) * totalFr;

  const newFractions = [...fractions];
  const topIdx = handleIndex;
  const bottomIdx = handleIndex + 1;

  const minFr = 0.05 * totalFr;

  newFractions[topIdx] = Math.max(minFr, fractions[topIdx] + deltaFr);
  newFractions[bottomIdx] = Math.max(minFr, fractions[bottomIdx] - deltaFr);

  return newFractions;
}

/**
 * Rebuild grid-template-columns string from updated fractions.
 */
export function fractionsToTemplate(fractions: number[]): string {
  return fractions
    .map((f, i) => {
      const fr = Math.max(1, Math.round(f * 1000));
      return i > 0 ? `${HANDLE_SIZE_PX}px ${fr}fr` : `${fr}fr`;
    })
    .join(' ');
}

/**
 * Compute fractional window coordinates from updated grid fractions.
 * Used to sync back to server after drag.
 */
export function syncFractionsFromGrid(
  layout: GridLayout,
  newColumnFractions: number[],
  newRowFractions: number[]
): GridLayout {
  const totalColFr = newColumnFractions.reduce((s, f) => s + f, 0);
  const totalRowFr = newRowFractions.reduce((s, f) => s + f, 0);

  // Build boundary arrays from fractions
  const colBounds = [0];
  for (const f of newColumnFractions) {
    colBounds.push(round(colBounds[colBounds.length - 1] + f / totalColFr));
  }
  const rowBounds = [0];
  for (const f of newRowFractions) {
    rowBounds.push(round(rowBounds[rowBounds.length - 1] + f / totalRowFr));
  }

  // Update each pane's fraction from its grid position
  const newPanes = new Map(layout.panes);
  for (const [id, pane] of newPanes) {
    // Find which column/row indices this pane occupies by checking grid areas
    const origX = pane.fraction.x;
    const origY = pane.fraction.y;

    // Determine pane indices from original position
    const oldTotalColFr = layout.columnFractions.reduce((s, f) => s + f, 0);
    const oldTotalRowFr = layout.rowFractions.reduce((s, f) => s + f, 0);

    let cumX = 0;
    let startCol = 0;
    for (let i = 0; i < layout.columnFractions.length; i++) {
      if (round(cumX / oldTotalColFr) >= round(origX)) { startCol = i; break; }
      cumX += layout.columnFractions[i];
    }

    let cumEndX = 0;
    let endCol = layout.columnFractions.length;
    for (let i = 0; i < layout.columnFractions.length; i++) {
      cumEndX += layout.columnFractions[i];
      if (round(cumEndX / oldTotalColFr) >= round(origX + pane.fraction.width)) { endCol = i + 1; break; }
    }

    let cumY = 0;
    let startRow = 0;
    for (let i = 0; i < layout.rowFractions.length; i++) {
      if (round(cumY / oldTotalRowFr) >= round(origY)) { startRow = i; break; }
      cumY += layout.rowFractions[i];
    }

    let cumEndY = 0;
    let endRow = layout.rowFractions.length;
    for (let i = 0; i < layout.rowFractions.length; i++) {
      cumEndY += layout.rowFractions[i];
      if (round(cumEndY / oldTotalRowFr) >= round(origY + pane.fraction.height)) { endRow = i + 1; break; }
    }

    newPanes.set(id, {
      ...pane,
      fraction: {
        x: colBounds[startCol],
        y: rowBounds[startRow],
        width: round(colBounds[endCol] - colBounds[startCol]),
        height: round(rowBounds[endRow] - rowBounds[startRow]),
      },
    });
  }

  return {
    ...layout,
    columns: fractionsToTemplate(newColumnFractions),
    rows: fractionsToTemplate(newRowFractions),
    panes: newPanes,
    columnFractions: newColumnFractions,
    rowFractions: newRowFractions,
  };
}

/** Sanitize window ID for use as CSS grid-area name */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 20);
}

/**
 * Generate a default grid layout for N windows.
 * Arranges windows in a responsive grid pattern.
 */
export function defaultGridLayout(
  windowIds: { id: string; type: 'terminal' | 'media' | 'agent' }[]
): WindowRect[] {
  const n = windowIds.length;
  if (n === 0) return [];

  if (n === 1) {
    return [{ id: windowIds[0].id, type: windowIds[0].type, x: 0, y: 0, width: 1, height: 1 }];
  }

  if (n === 2) {
    return [
      { id: windowIds[0].id, type: windowIds[0].type, x: 0, y: 0, width: 0.5, height: 1 },
      { id: windowIds[1].id, type: windowIds[1].type, x: 0.5, y: 0, width: 0.5, height: 1 },
    ];
  }

  if (n === 3) {
    return [
      { id: windowIds[0].id, type: windowIds[0].type, x: 0, y: 0, width: 0.5, height: 1 },
      { id: windowIds[1].id, type: windowIds[1].type, x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { id: windowIds[2].id, type: windowIds[2].type, x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ];
  }

  // 4+ windows: 2-column grid, equal distribution
  const cols = 2;
  const rows = Math.ceil(n / cols);
  const results: WindowRect[] = [];

  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    results.push({
      id: windowIds[i].id,
      type: windowIds[i].type,
      x: col / cols,
      y: row / rows,
      width: 1 / cols,
      height: 1 / rows,
    });
  }

  return results;
}
