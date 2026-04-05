/**
 * measureFont — Measures monospace character dimensions from the DOM.
 *
 * Uses offsetWidth/offsetHeight (integer, matches xterm.js CharSizeService)
 * to avoid sub-pixel drift across rows. Cache keyed by (fontFamily, fontSize)
 * to support multi-instance scenarios with different font sizes.
 */

export interface CharDimensions {
  charWidth: number;
  lineHeight: number;
}

const MEASURE_CHAR = 'W';
const MEASURE_REPEAT = 10;

// Cache keyed by "fontFamily|fontSize" for multi-instance support
const dimensionCache = new Map<string, CharDimensions>();

// Fixed-position container that doesn't trigger page reflow
let measureContainer: HTMLElement | null = null;

function getMeasureContainer(): HTMLElement {
  if (!measureContainer) {
    measureContainer = document.createElement('div');
    // Match the rendering environment of .dom-term-viewport so that measured
    // lineHeight matches actual rendered row height. Without -webkit-font-smoothing
    // and text-rendering, the measurement span can report a lineHeight that differs
    // by 1-2px from the actual row, causing aspect-ratio-dependent row gaps.
    measureContainer.style.cssText =
      'position:fixed;visibility:hidden;top:-9999px;left:-9999px;pointer-events:none;contain:strict;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeSpeed';
    document.body.appendChild(measureContainer);
  }
  return measureContainer;
}

/**
 * Measure the character width and line height for a monospace font.
 * Uses offsetWidth/offsetHeight (integer) to match xterm.js measurement.
 * Results are cached per (fontFamily, fontSize) pair.
 */
export function measureCharDimensions(
  fontFamily: string,
  fontSize: number,
): CharDimensions {
  const key = `${fontFamily}|${fontSize}`;
  const cached = dimensionCache.get(key);
  if (cached) return cached;

  const container = getMeasureContainer();
  const span = document.createElement('span');
  span.style.fontFamily = fontFamily;
  span.style.fontSize = `${fontSize}px`;
  span.style.lineHeight = 'normal';
  span.style.whiteSpace = 'pre';
  span.style.fontFeatureSettings = '"liga" 0';
  span.style.fontVariantLigatures = 'none';
  span.style.display = 'inline-block';
  span.textContent = MEASURE_CHAR.repeat(MEASURE_REPEAT);

  container.appendChild(span);

  // Use offsetWidth/offsetHeight (integer) to match xterm.js CharSizeService
  const charWidth = span.offsetWidth / MEASURE_REPEAT;
  const lineHeight = span.offsetHeight;

  container.removeChild(span);

  const dims = { charWidth, lineHeight };
  dimensionCache.set(key, dims);
  return dims;
}

/**
 * Calculate terminal dimensions (cols, rows) from a container element.
 */
export function calculateTerminalDimensions(
  container: HTMLElement,
  fontFamily: string,
  fontSize: number,
  padding = 4,
): { cols: number; rows: number } {
  const { charWidth, lineHeight } = measureCharDimensions(fontFamily, fontSize);
  const rect = container.getBoundingClientRect();

  const availableWidth = rect.width - padding * 2;
  const availableHeight = rect.height - padding * 2;

  const cols = Math.max(2, Math.floor(availableWidth / charWidth));
  const rows = Math.max(1, Math.floor(availableHeight / lineHeight));

  return { cols, rows };
}

/**
 * Invalidate cached font measurements.
 */
export function invalidateFontCache(): void {
  dimensionCache.clear();
}
