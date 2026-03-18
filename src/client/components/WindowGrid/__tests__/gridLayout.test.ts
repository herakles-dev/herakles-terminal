import { describe, it, expect } from 'vitest';
import {
  fractionsToGrid,
  gridToFractions,
  updateColumnFraction,
  updateRowFraction,
  fractionsToTemplate,
  syncFractionsFromGrid,
  defaultGridLayout,
  HANDLE_SIZE_PX,
} from '../gridLayout';

describe('gridLayout', () => {
  describe('fractionsToGrid', () => {
    it('should handle empty windows', () => {
      const layout = fractionsToGrid([]);
      expect(layout.columns).toBe('1fr');
      expect(layout.rows).toBe('1fr');
      expect(layout.panes.size).toBe(0);
    });

    it('should handle single window', () => {
      const layout = fractionsToGrid([
        { id: 'w1', type: 'terminal', x: 0, y: 0, width: 1, height: 1 },
      ]);
      expect(layout.columns).toBe('1fr');
      expect(layout.rows).toBe('1fr');
      expect(layout.panes.size).toBe(1);
      expect(layout.panes.get('w1')?.gridArea).toBe('pane-w1');
    });

    it('should handle two side-by-side windows', () => {
      const layout = fractionsToGrid([
        { id: 'w1', type: 'terminal', x: 0, y: 0, width: 0.5, height: 1 },
        { id: 'w2', type: 'terminal', x: 0.5, y: 0, width: 0.5, height: 1 },
      ]);

      expect(layout.columnFractions).toHaveLength(2);
      expect(layout.rowFractions).toHaveLength(1);
      expect(layout.panes.size).toBe(2);
      expect(layout.columns).toContain('fr');
      expect(layout.columns).toContain(`${HANDLE_SIZE_PX}px`);
    });

    it('should handle two stacked windows', () => {
      const layout = fractionsToGrid([
        { id: 'w1', type: 'terminal', x: 0, y: 0, width: 1, height: 0.5 },
        { id: 'w2', type: 'terminal', x: 0, y: 0.5, width: 1, height: 0.5 },
      ]);

      expect(layout.columnFractions).toHaveLength(1);
      expect(layout.rowFractions).toHaveLength(2);
      expect(layout.rows).toContain(`${HANDLE_SIZE_PX}px`);
    });

    it('should handle 4-window grid', () => {
      const layout = fractionsToGrid([
        { id: 'w1', type: 'terminal', x: 0, y: 0, width: 0.5, height: 0.5 },
        { id: 'w2', type: 'terminal', x: 0.5, y: 0, width: 0.5, height: 0.5 },
        { id: 'w3', type: 'terminal', x: 0, y: 0.5, width: 0.5, height: 0.5 },
        { id: 'w4', type: 'media', x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
      ]);

      expect(layout.columnFractions).toHaveLength(2);
      expect(layout.rowFractions).toHaveLength(2);
      expect(layout.panes.size).toBe(4);
      expect(layout.panes.get('w4')?.type).toBe('media');
    });

    it('should generate valid grid-template-areas', () => {
      const layout = fractionsToGrid([
        { id: 'w1', type: 'terminal', x: 0, y: 0, width: 0.5, height: 1 },
        { id: 'w2', type: 'terminal', x: 0.5, y: 0, width: 0.5, height: 1 },
      ]);

      expect(layout.areas.length).toBeGreaterThan(0);
      layout.areas.forEach(area => {
        expect(area).toMatch(/^"[a-zA-Z0-9\s\-.]+"$/);
      });
    });

    it('should handle agent window type', () => {
      const layout = fractionsToGrid([
        { id: 'a1', type: 'agent', x: 0, y: 0, width: 1, height: 1 },
      ]);
      expect(layout.panes.get('a1')?.type).toBe('agent');
    });

    // CSS grid-template-areas requires every named area to form a rectangle.
    // This test catches the critical non-rectangular handle bug that broke 3+ window layouts.
    it.each([
      {
        label: '3 windows (main + 2 stacked)',
        windows: [
          { id: 'w1', type: 'terminal' as const, x: 0, y: 0, width: 0.3, height: 1 },
          { id: 'w2', type: 'terminal' as const, x: 0.3, y: 0, width: 0.7, height: 0.5 },
          { id: 'w3', type: 'terminal' as const, x: 0.3, y: 0.5, width: 0.7, height: 0.5 },
        ],
      },
      {
        label: '4 windows (main + 2x2 grid)',
        windows: [
          { id: 'w1', type: 'terminal' as const, x: 0, y: 0, width: 0.3, height: 1 },
          { id: 'w2', type: 'terminal' as const, x: 0.3, y: 0, width: 0.7, height: 0.5 },
          { id: 'w3', type: 'terminal' as const, x: 0.3, y: 0.5, width: 0.35, height: 0.5 },
          { id: 'w4', type: 'terminal' as const, x: 0.65, y: 0.5, width: 0.35, height: 0.5 },
        ],
      },
      {
        label: '5 windows (main + 2x2)',
        windows: [
          { id: 'w1', type: 'terminal' as const, x: 0, y: 0, width: 0.3, height: 1 },
          { id: 'w2', type: 'terminal' as const, x: 0.3, y: 0, width: 0.35, height: 0.5 },
          { id: 'w3', type: 'terminal' as const, x: 0.65, y: 0, width: 0.35, height: 0.5 },
          { id: 'w4', type: 'terminal' as const, x: 0.3, y: 0.5, width: 0.35, height: 0.5 },
          { id: 'w5', type: 'terminal' as const, x: 0.65, y: 0.5, width: 0.35, height: 0.5 },
        ],
      },
      {
        label: '6 windows (main + 3x2)',
        windows: [
          { id: 'w1', type: 'terminal' as const, x: 0, y: 0, width: 0.3, height: 1 },
          { id: 'w2', type: 'terminal' as const, x: 0.3, y: 0, width: 0.7, height: 0.333 },
          { id: 'w3', type: 'terminal' as const, x: 0.3, y: 0.333, width: 0.35, height: 0.333 },
          { id: 'w4', type: 'terminal' as const, x: 0.65, y: 0.333, width: 0.35, height: 0.333 },
          { id: 'w5', type: 'terminal' as const, x: 0.3, y: 0.666, width: 0.35, height: 0.334 },
          { id: 'w6', type: 'terminal' as const, x: 0.65, y: 0.666, width: 0.35, height: 0.334 },
        ],
      },
      {
        label: '4 windows (2x2 even grid)',
        windows: [
          { id: 'w1', type: 'terminal' as const, x: 0, y: 0, width: 0.5, height: 0.5 },
          { id: 'w2', type: 'terminal' as const, x: 0.5, y: 0, width: 0.5, height: 0.5 },
          { id: 'w3', type: 'terminal' as const, x: 0, y: 0.5, width: 0.5, height: 0.5 },
          { id: 'w4', type: 'terminal' as const, x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
        ],
      },
    ])('should produce rectangular CSS grid areas for $label', ({ windows }) => {
      const layout = fractionsToGrid(windows);

      // Parse areas into a 2D grid of names
      const areaRows = layout.areas.map(a =>
        a.replace(/^"|"$/g, '').split(/\s+/)
      );

      // Collect positions for each named area
      const namePositions: Record<string, { r: number; c: number }[]> = {};
      for (let r = 0; r < areaRows.length; r++) {
        for (let c = 0; c < areaRows[r].length; c++) {
          const name = areaRows[r][c];
          if (name === '.') continue;
          if (!namePositions[name]) namePositions[name] = [];
          namePositions[name].push({ r, c });
        }
      }

      // Verify each named area forms a rectangle
      for (const [_name, positions] of Object.entries(namePositions)) {
        const minR = Math.min(...positions.map(p => p.r));
        const maxR = Math.max(...positions.map(p => p.r));
        const minC = Math.min(...positions.map(p => p.c));
        const maxC = Math.max(...positions.map(p => p.c));
        const expectedCount = (maxR - minR + 1) * (maxC - minC + 1);
        expect(positions.length).toBe(expectedCount);
      }
    });

    it('should include horizontalHandleCells for multi-row layouts', () => {
      const layout = fractionsToGrid([
        { id: 'w1', type: 'terminal', x: 0, y: 0, width: 0.3, height: 1 },
        { id: 'w2', type: 'terminal', x: 0.3, y: 0, width: 0.35, height: 0.5 },
        { id: 'w3', type: 'terminal', x: 0.65, y: 0, width: 0.35, height: 0.5 },
        { id: 'w4', type: 'terminal', x: 0.3, y: 0.5, width: 0.35, height: 0.5 },
        { id: 'w5', type: 'terminal', x: 0.65, y: 0.5, width: 0.35, height: 0.5 },
      ]);

      // Should have horizontal handle cells for the row gap between non-spanning columns
      expect(layout.horizontalHandleCells.length).toBeGreaterThan(0);
      // Each cell should have a unique area name matching hh-{row}-{col} pattern
      for (const cell of layout.horizontalHandleCells) {
        expect(cell.areaName).toMatch(/^hh-\d+-\d+$/);
      }
    });
  });

  describe('gridToFractions', () => {
    it('should round-trip fractional coordinates', () => {
      const original = [
        { id: 'w1', type: 'terminal' as const, x: 0, y: 0, width: 0.5, height: 1 },
        { id: 'w2', type: 'terminal' as const, x: 0.5, y: 0, width: 0.5, height: 1 },
      ];
      const grid = fractionsToGrid(original);
      const recovered = gridToFractions(grid);

      expect(recovered).toHaveLength(2);
      for (const r of recovered) {
        const orig = original.find(o => o.id === r.id)!;
        expect(r.x).toBeCloseTo(orig.x, 2);
        expect(r.y).toBeCloseTo(orig.y, 2);
        expect(r.width).toBeCloseTo(orig.width, 2);
        expect(r.height).toBeCloseTo(orig.height, 2);
      }
    });
  });

  describe('updateColumnFraction', () => {
    it('should adjust adjacent columns', () => {
      const fractions = [0.5, 0.5];
      const result = updateColumnFraction(fractions, 0, 100, 1000);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeGreaterThan(0.5);
      expect(result[1]).toBeLessThan(0.5);
      expect(result[0] + result[1]).toBeCloseTo(1, 5);
    });

    it('should enforce minimum fraction', () => {
      const fractions = [0.9, 0.1];
      const result = updateColumnFraction(fractions, 0, 500, 1000);

      expect(result[1]).toBeGreaterThanOrEqual(0.05);
    });

    it('should handle negative delta', () => {
      const fractions = [0.5, 0.5];
      const result = updateColumnFraction(fractions, 0, -100, 1000);

      expect(result[0]).toBeLessThan(0.5);
      expect(result[1]).toBeGreaterThan(0.5);
    });
  });

  describe('updateRowFraction', () => {
    it('should adjust adjacent rows', () => {
      const fractions = [0.5, 0.5];
      const result = updateRowFraction(fractions, 0, 50, 800);

      expect(result[0]).toBeGreaterThan(0.5);
      expect(result[1]).toBeLessThan(0.5);
    });
  });

  describe('fractionsToTemplate', () => {
    it('should produce valid CSS grid-template', () => {
      const result = fractionsToTemplate([0.3, 0.7]);
      expect(result).toMatch(/\d+fr\s+6px\s+\d+fr/);
    });

    it('should handle single fraction', () => {
      const result = fractionsToTemplate([1]);
      expect(result).toMatch(/^\d+fr$/);
    });
  });

  describe('syncFractionsFromGrid', () => {
    it('should update pane fractions when columns change', () => {
      const layout = fractionsToGrid([
        { id: 'w1', type: 'terminal', x: 0, y: 0, width: 0.5, height: 1 },
        { id: 'w2', type: 'terminal', x: 0.5, y: 0, width: 0.5, height: 1 },
      ]);

      const newColFractions = [0.6, 0.4];
      const synced = syncFractionsFromGrid(layout, newColFractions, layout.rowFractions);

      const w1 = synced.panes.get('w1')!;
      const w2 = synced.panes.get('w2')!;

      expect(w1.fraction.width).toBeCloseTo(0.6, 1);
      expect(w2.fraction.width).toBeCloseTo(0.4, 1);
    });
  });

  describe('defaultGridLayout', () => {
    it('should return empty for no windows', () => {
      expect(defaultGridLayout([])).toHaveLength(0);
    });

    it('should fill entire space for 1 window', () => {
      const result = defaultGridLayout([{ id: 'w1', type: 'terminal' }]);
      expect(result[0].width).toBe(1);
      expect(result[0].height).toBe(1);
    });

    it('should split horizontally for 2 windows', () => {
      const result = defaultGridLayout([
        { id: 'w1', type: 'terminal' },
        { id: 'w2', type: 'terminal' },
      ]);
      expect(result[0].width).toBe(0.5);
      expect(result[1].width).toBe(0.5);
      expect(result[0].x).toBe(0);
      expect(result[1].x).toBe(0.5);
    });

    it('should handle 3 windows (L-shape)', () => {
      const result = defaultGridLayout([
        { id: 'w1', type: 'terminal' },
        { id: 'w2', type: 'terminal' },
        { id: 'w3', type: 'agent' },
      ]);
      expect(result).toHaveLength(3);
      expect(result[2].type).toBe('agent');
    });

    it('should handle 4+ windows in grid', () => {
      const result = defaultGridLayout([
        { id: 'w1', type: 'terminal' },
        { id: 'w2', type: 'terminal' },
        { id: 'w3', type: 'terminal' },
        { id: 'w4', type: 'terminal' },
      ]);
      expect(result).toHaveLength(4);
      // 2x2 grid
      expect(result[0].width).toBe(0.5);
      expect(result[0].height).toBe(0.5);
    });
  });
});
