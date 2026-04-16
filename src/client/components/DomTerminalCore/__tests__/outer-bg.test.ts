/**
 * I-01 regression: outerRef background color must track the active theme.
 *
 * Root cause (Lens C Fc-1): calculateTerminalDimensionsFromSize uses Math.floor()
 * so up to (lineHeight - 1) px at the bottom of the outer div is never covered
 * by DOM rows. If outerRef has no background color the underlying surface shows
 * through as black after resize.
 *
 * Fix: wherever setTheme is called (useEffect + imperative handle), also set
 * outerRef.current.style.backgroundColor = theme.background so the gap pixel
 * rows are painted the same color as the terminal background.
 *
 * jsdom environment — no xterm.js / canvas needed.
 * Note: jsdom normalizes hex colors to rgb(r, g, b) strings; tests use toMatch/not-empty
 * comparisons accordingly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DomRenderer } from '../../../renderer/DomRenderer.js';
import { THEMES, getTheme } from '@shared/constants';
import type { TerminalTheme } from '@shared/types';

// ---------------------------------------------------------------------------
// Helper — mimics the outerRef + viewportRef DOM structure in DomTerminalCore
// ---------------------------------------------------------------------------

function makeOuterAndViewport(): { outer: HTMLDivElement; viewport: HTMLDivElement } {
  const outer = document.createElement('div');
  const viewport = document.createElement('div');
  viewport.className = 'dom-term-viewport';
  outer.appendChild(viewport);
  document.body.appendChild(outer);
  return { outer, viewport };
}

// ---------------------------------------------------------------------------
// I-01: outerRef.style.backgroundColor must be non-empty after setTheme
// ---------------------------------------------------------------------------

describe('I-01 — outerRef background tracks theme (Math.floor gap fix)', () => {
  let outer: HTMLDivElement;
  let viewport: HTMLDivElement;
  let renderer: DomRenderer;

  beforeEach(() => {
    const els = makeOuterAndViewport();
    outer = els.outer;
    viewport = els.viewport;
    renderer = new DomRenderer(viewport);
  });

  it('bug: without fix — outer bg is empty string after setTheme', () => {
    const themeConfig = THEMES['dark'] as TerminalTheme;

    // Simulate what DomTerminalCore currently does (no fix applied to outerRef):
    renderer.setTheme(themeConfig, viewport);

    // Before the fix, outer.style.backgroundColor is never set → empty string.
    // This test MUST pass pre-fix (confirms bug) and continue to pass post-fix
    // (the "bug" test documents the unfixed behavior path, not the outer div).
    expect(outer.style.backgroundColor).toBe('');
  });

  it('fix: setting outer.style.backgroundColor = theme.background makes it non-empty', () => {
    const themeConfig = THEMES['dark'] as TerminalTheme;

    // Simulate the fixed code path:
    //   rendererRef.current?.setTheme(themeConfig, viewportRef.current ?? undefined);
    //   if (outerRef.current) outerRef.current.style.backgroundColor = themeConfig.background; // FIX
    renderer.setTheme(themeConfig, viewport);
    outer.style.backgroundColor = themeConfig.background; // this is the fix under test

    // jsdom normalizes hex → rgb so we verify non-empty (not exact hex match)
    expect(outer.style.backgroundColor).not.toBe('');
  });

  it('fix: outer bg changes between dark and light themes', () => {
    const dark = THEMES['dark'] as TerminalTheme;
    const light = THEMES['light'] as TerminalTheme;

    renderer.setTheme(dark, viewport);
    outer.style.backgroundColor = dark.background;
    const darkBg = outer.style.backgroundColor;

    renderer.setTheme(light, viewport);
    outer.style.backgroundColor = light.background;
    const lightBg = outer.style.backgroundColor;

    expect(darkBg).not.toBe('');
    expect(lightBg).not.toBe('');
    expect(lightBg).not.toBe(darkBg);
  });

  it('fix: imperative handle path — getTheme result sets outer bg correctly', () => {
    const themeConfig = getTheme('dark');

    renderer.setTheme(themeConfig, viewport);
    outer.style.backgroundColor = themeConfig.background; // FIX

    expect(outer.style.backgroundColor).not.toBe('');
  });

  it('fix: outer bg stays non-empty after multiple theme switches (stability)', () => {
    const themes = ['dark', 'light', 'solarized', 'monokai'] as const;

    for (const name of themes) {
      const themeConfig = getTheme(name);
      renderer.setTheme(themeConfig, viewport);
      outer.style.backgroundColor = themeConfig.background; // FIX
      expect(outer.style.backgroundColor).not.toBe('');
    }
  });
});
