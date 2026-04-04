/**
 * linkDetector — Detects URLs in a plain-text terminal row string.
 *
 * Returns an array of non-overlapping { startCol, endCol, url } ranges
 * suitable for wrapping in <a> tags during DOM rendering.
 *
 * Design goals:
 * - Fast: compiled regex, minimal allocation per call
 * - Correct: strips trailing punctuation that is almost never part of a URL
 *   while preserving balanced parentheses (Wikipedia-style URLs)
 * - No false positives: only matches http(s)://, www., and file:/// schemes
 */

export interface DetectedLink {
  /** Inclusive start column (0-based) */
  startCol: number;
  /** Exclusive end column (0-based) — the character at endCol is NOT part of the link */
  endCol: number;
  /** Resolved URL (www. links are prefixed with https://) */
  url: string;
}

// ---------------------------------------------------------------------------
// Core regex
// ---------------------------------------------------------------------------
// Matches three URL classes in one pass:
//   1. http(s):// — standard web URLs
//   2. www.       — implied-https URLs (no scheme)
//   3. file:///   — local file URLs
//
// Character class for allowed URL characters excludes whitespace and the shell
// "special" chars: < > " { } | \ ^ ` [ ]
// We do allow ( ) inside the regex — balanced-paren trimming happens post-match.
const URL_REGEX =
  /\b(https?:\/\/[^\s<>"{}|\\^`[\]]+|www\.[a-zA-Z0-9][^\s<>"{}|\\^`[\]]+|file:\/\/\/[^\s<>"{}|\\^`[\]]+)/g;

// ---------------------------------------------------------------------------
// Trailing-punctuation trimmer
// ---------------------------------------------------------------------------
// These characters frequently appear immediately after a URL in prose but are
// not themselves part of the URL.  Strip them from the right end — but only
// when they leave the URL non-empty.
//
// Two-phase approach:
//   Phase 1 — strip unmatched trailing closing parens (balanced parens are kept)
//   Phase 2 — strip remaining non-paren trailing punctuation: . , ; : ! ? ]
//
// Note: `)` is intentionally EXCLUDED from the Phase 2 regex because Phase 1
// already handles it. Including `)` in Phase 2 would incorrectly strip the
// closing paren from balanced Wikipedia-style URLs like
// "https://en.wikipedia.org/wiki/Lisp_(programming_language)".
const TRAILING_PUNCT_NO_PAREN = /[.,;:!?\]]+$/;

/**
 * Remove trailing punctuation that is unlikely to be part of the URL,
 * while preserving balanced parentheses.
 *
 * Examples:
 *   "https://en.wikipedia.org/wiki/Lisp_(programming_language)"  → unchanged
 *   "https://example.com/path."                                   → strips "."
 *   "(https://example.com/foo)"                                   → strips ")"
 *   "(https://example.com/foo)."                                  → strips ")."
 */
function trimTrailingPunct(raw: string): string {
  // Phase 1: count open vs. closed parens in the raw match.
  let openParens = 0;
  for (const ch of raw) {
    if (ch === '(') openParens++;
    else if (ch === ')') openParens--;
  }

  let url = raw;

  // Strip unmatched closing parens from the right end, one at a time,
  // until parens are balanced (openParens >= 0) or there are none left.
  while (openParens < 0 && url.endsWith(')')) {
    url = url.slice(0, -1);
    openParens++;
  }

  // Phase 2: strip any remaining non-paren trailing punctuation.
  // We deliberately do NOT include ')' here — if parens are now balanced,
  // any trailing ')' is correctly part of the URL.
  const m = TRAILING_PUNCT_NO_PAREN.exec(url);
  if (m) {
    const candidate = url.slice(0, url.length - m[0].length);
    if (candidate.length > 0) url = candidate;
  }

  return url;
}

/**
 * Detect all URLs in a single terminal row string.
 *
 * @param text  Raw row text (no ANSI codes — the renderer has already decoded chars).
 * @returns     Sorted, non-overlapping DetectedLink array.
 */
export function detectLinks(text: string): DetectedLink[] {
  const results: DetectedLink[] = [];

  URL_REGEX.lastIndex = 0; // reset before each use (regex is stateful with /g)

  let m: RegExpExecArray | null;
  while ((m = URL_REGEX.exec(text)) !== null) {
    const rawMatch = m[1]!;
    const trimmed = trimTrailingPunct(rawMatch);
    if (trimmed.length === 0) continue;

    const startCol = m.index;
    const endCol = startCol + trimmed.length;

    // Resolve www. links to https:// so they open correctly in a new tab.
    const url = trimmed.startsWith('www.') ? `https://${trimmed}` : trimmed;

    results.push({ startCol, endCol, url });
  }

  return results;
}
