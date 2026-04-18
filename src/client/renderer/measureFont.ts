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
    // contain:strict includes size containment which can cause offsetWidth
    // sub-pixel rounding differences at fractional DPR. Use layout+style only
    // to match the viewport's containment model (contain: layout paint on viewport,
    // but we skip paint here since the element is off-screen).
    measureContainer.style.cssText =
      'position:fixed;visibility:hidden;top:-9999px;left:-9999px;pointer-events:none;contain:layout style;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeSpeed';
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

  // Math.round matches xterm.js CharSizeService — ensures integer charWidth
  // to prevent sub-pixel drift across columns (e.g. cursor at col 80 off by 1px)
  const charWidth = Math.round(span.offsetWidth / MEASURE_REPEAT);
  const lineHeight = span.offsetHeight;

  container.removeChild(span);

  // Guard: if measurement failed (element not in live layout, CSS not loaded),
  // return safe defaults without caching to prevent division-by-zero downstream
  if (charWidth <= 0 || lineHeight <= 0) {
    return { charWidth: 8, lineHeight: 16 };
  }

  const dims = { charWidth, lineHeight };
  dimensionCache.set(key, dims);
  return dims;
}

/**
 * Calculate terminal dimensions from explicit width/height values.
 * Accepts pre-measured dimensions (e.g. from ResizeObserver contentBoxSize)
 * to avoid reading getBoundingClientRect() which can return stale values
 * during deep flex layout resolution.
 */
export function calculateTerminalDimensionsFromSize(
  width: number,
  height: number,
  fontFamily: string,
  fontSize: number,
  padding = 4,
): { cols: number; rows: number } {
  const { charWidth, lineHeight } = measureCharDimensions(fontFamily, fontSize);

  const availableWidth = width - padding * 2;
  const availableHeight = height - padding * 2;

  const cols = Math.max(2, Math.floor(availableWidth / charWidth));
  const rows = Math.max(1, Math.floor(availableHeight / lineHeight));

  return { cols, rows };
}

/**
 * Calculate terminal dimensions (cols, rows) from a container element.
 * Convenience wrapper — reads getBoundingClientRect() and delegates.
 */
export function calculateTerminalDimensions(
  container: HTMLElement,
  fontFamily: string,
  fontSize: number,
  padding = 4,
): { cols: number; rows: number } {
  const rect = container.getBoundingClientRect();
  return calculateTerminalDimensionsFromSize(rect.width, rect.height, fontFamily, fontSize, padding);
}

/**
 * Invalidate cached font measurements.
 */
export function invalidateFontCache(): void {
  dimensionCache.clear();
}
