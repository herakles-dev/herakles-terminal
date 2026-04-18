/**
 * DomRenderer unit tests.
 *
 * jsdom environment — DOM APIs available.
 * Tests inline style generation for terminal cell style flags.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DomRenderer } from '../DomRenderer.js';
import { CharPool, ColorMode, ScreenBuffer, StyleFlags, StylePool } from '../ScreenBuffer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuffer(char: string, flags: number, cols = 4, rows = 1): ScreenBuffer {
  const charPool = new CharPool();
  const stylePool = new StylePool();
  const buf = new ScreenBuffer(cols, rows, charPool, stylePool);

  const styleId = stylePool.intern({
    fgMode: ColorMode.DEFAULT,
    fgColor: 0,
    bgMode: ColorMode.DEFAULT,
    bgColor: 0,
    flags,
  });
  const charId = charPool.intern(char);
  buf.setCell(0, 0, charId, styleId);
  return buf;
}

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

// ---------------------------------------------------------------------------
// I-10: DIM style must use opacity only — no filter:brightness stacking context
// ---------------------------------------------------------------------------

describe('DomRenderer — DIM style flag (I-10)', () => {
  let container: HTMLElement;
  let renderer: DomRenderer;

  beforeEach(() => {
    container = makeContainer();
    renderer = new DomRenderer(container);
  });

  it('renders a DIM cell with opacity:0.5', () => {
    const buf = makeBuffer('A', StyleFlags.DIM);
    renderer.renderAll(buf);
    const row = container.firstElementChild as HTMLElement;
    expect(row.innerHTML).toContain('opacity:0.5');
  });

  it('does NOT render filter:brightness on a DIM cell', () => {
    const buf = makeBuffer('A', StyleFlags.DIM);
    renderer.renderAll(buf);
    const row = container.firstElementChild as HTMLElement;
    expect(row.innerHTML).not.toContain('filter:');
    expect(row.innerHTML).not.toContain('brightness');
  });
});
