/**
 * CSS audit: I-04 regression test.
 *
 * Asserts that backdrop-filter / -webkit-backdrop-filter are NOT present
 * in the four UI overlay selectors that were identified as causing GPU
 * re-sampling of the terminal DOM during Ink full-screen redraws.
 *
 * These selectors must use solid/opaque backgrounds instead.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve path relative to the project root (two levels up from __tests__). */
const CSS_PATH = resolve(__dirname, '../../styles/terminal.css');

/**
 * Extract the text of the FIRST CSS rule block matching `selector`.
 * Handles both top-level selectors and nested rulesets.
 * Returns null if the selector is not found.
 */
function extractRuleBlock(css: string, selector: string): string | null {
  // Escape special characters in selector for use in a regex.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match: selector { ... } — non-greedy, allows nested content.
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's');
  const match = re.exec(css);
  return match ? match[1] : null;
}

/**
 * Returns true if the rule block contains a `backdrop-filter` or
 * `-webkit-backdrop-filter` declaration (any value).
 */
function hasBackdropFilter(block: string): boolean {
  return /(?:^|;)\s*-?(?:webkit-)?backdrop-filter\s*:/m.test(block);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const SELECTORS_UNDER_TEST = [
  '.quick-key-bar',
  '.connection-status',
  '.terminal-minimap',
  '.todo-drawer',
  '.file-drop-zone-overlay',
] as const;

describe('I-04: no backdrop-filter on UI overlay selectors (terminal.css)', () => {
  const css = readFileSync(CSS_PATH, 'utf-8');

  for (const selector of SELECTORS_UNDER_TEST) {
    it(`${selector} must NOT contain backdrop-filter`, () => {
      const block = extractRuleBlock(css, selector);
      // The selector must exist in the file.
      expect(block, `selector "${selector}" not found in terminal.css`).not.toBeNull();
      // It must not carry a backdrop-filter declaration.
      expect(
        hasBackdropFilter(block!),
        `${selector} still has backdrop-filter — remove it (I-04)`
      ).toBe(false);
    });
  }
});
