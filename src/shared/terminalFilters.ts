/**
 * Shared terminal output filtering utilities.
 * Used by both client (OutputPipelineManager, App.tsx) and server (TmuxManager)
 * to filter Claude Code thinking/spinner output from terminal data.
 */

/**
 * Comprehensive ANSI/terminal escape sequence regex.
 * Matches all standard terminal escape sequences for stripping during analysis.
 *
 * Uses ECMA-48 byte ranges:
 * - CSI: ESC [ (parameter bytes 0x30-0x3F)* (intermediate bytes 0x20-0x2F)* (final byte 0x40-0x7E)
 * - 8-bit CSI: 0x9B followed by same parameter/intermediate/final structure
 * - OSC: ESC ] ... (BEL | ST)  — lazy match to avoid eating content on unterminated sequences
 * - DCS/APC/PM: ESC P/_ /^ ... ST — with 4KB cap to prevent runaway on unterminated sequences
 * - Simple 2-char: ESC + any single byte
 */
export const ANSI_STRIP_REGEX = /(?:\x1b(?:\[[\x20-\x3f]*[\x40-\x7e]|\][\s\S]*?(?:\x07|\x1b\\)|[P_^][\s\S]{0,4096}?\x1b\\|.)|\x9b[\x20-\x3f]*[\x40-\x7e])/g;

/**
 * Strip all ANSI escape sequences from a string.
 */
export function stripAnsi(str: string): string {
  return str.replace(ANSI_STRIP_REGEX, '');
}

/**
 * Returns true if the stripped line should be filtered out as
 * Claude Code thinking/spinner output.
 */
function isThinkingLine(stripped: string): boolean {
  if (stripped.length === 0) return false;

  // Filter lines that are ONLY dots (ASCII period, middle dot, bullet, ellipsis) and whitespace.
  // Intentionally EXCLUDES: U+22EE (⋮), U+22EF (⋯), U+2219 (∙), U+2027 (‧)
  // — those are legitimate chars in exa/eza tree output, math CLIs, and hyphenation tools.
  if (/^[.\s\u00B7\u2022\u2026]+$/.test(stripped)) return true;

  // Filter consecutive dots (20+) — tmux SIGWINCH resize artifact.
  // Threshold is 20 (not 10) to avoid false positives on:
  //   ../../../../../../path (12 dots), pytest output, npm/pip progress bars.
  if (/\.{20,}/.test(stripped)) return true;

  // Filter braille spinner lines (pure braille or braille-prefixed like "⠋ Thinking...")
  if (/^[\u2800-\u28FF]/.test(stripped)) return true;

  // Defense-in-depth: filter lines predominantly composed of dots
  // (catches cases where a few unstripped control chars remain).
  // Exempt lines containing path separators, URLs, or structured content.
  if (/[/\\:[\]#@]/.test(stripped)) return false;
  const dotCount = (stripped.match(/\./g) || []).length;
  const totalNonWhitespace = stripped.replace(/\s/g, '').length;
  if (totalNonWhitespace > 0 && dotCount / totalNonWhitespace >= 0.8 && dotCount >= 3) return true;

  return false;
}

/**
 * Regex to detect cursor positioning sequences used as split delimiters.
 */
const CURSOR_POSITION_REGEX = /^\x1b\[\d*(?:;\d*)?[Hf]$/;

/**
 * Filter Claude Code thinking output from terminal data.
 * Removes dots, spinner characters, and braille lines.
 *
 * Splits on BOTH newlines AND cursor positioning sequences so that
 * tmux SIGWINCH re-render output is filtered per-row.
 */
export function filterThinkingOutput(data: string): string {
  const parts = data.split(/(\r\n|\r|\n|\x1b\[\d*(?:;\d*)?[Hf])/);
  const result: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '\r\n' || part === '\r' || part === '\n') {
      result.push(part);
      continue;
    }
    if (CURSOR_POSITION_REGEX.test(part)) {
      result.push(part);
      continue;
    }
    const stripped = part.replace(ANSI_STRIP_REGEX, '').trim();
    if (stripped.length === 0) { result.push(part); continue; }
    if (isThinkingLine(stripped)) {
      // Preserve DEC 2026 sync brackets to prevent dangling sync state
      const hasSyncBegin = part.includes('\x1b[?2026h');
      const hasSyncEnd = part.includes('\x1b[?2026l');
      const syncPrefix = hasSyncBegin ? '\x1b[?2026h' : '';
      const syncSuffix = hasSyncEnd ? '\x1b[?2026l' : '';

      if (i > 0 && CURSOR_POSITION_REGEX.test(parts[i - 1])) {
        result.push(syncPrefix + '\x1b[K' + syncSuffix);
      } else if (syncPrefix || syncSuffix) {
        result.push(syncPrefix + syncSuffix);
      }
      continue;
    }
    result.push(part);
  }
  return result.join('');
}

/**
 * Carriage-return-based thinking filter.
 * Claude Code spinner uses \r to overwrite the same line.
 * Filters out \r-delimited thinking segments, keeping the last non-thinking segment.
 *
 * Shell readline history cycling sends `\r\x1b[K` — preserved with leading \r.
 */
export function filterCarriageReturnThinking(data: string): string {
  if (!data.includes('\r')) return data;

  const lines = data.split(/(\r\n|\n)/);
  const result: string[] = [];

  for (const line of lines) {
    if (line === '\r\n' || line === '\n') {
      result.push(line);
      continue;
    }

    // Preserve bare \r (cursor positioning) — don't drop it
    if (line === '\r') {
      result.push(line);
      continue;
    }

    const segments = line.split('\r');
    if (segments.length <= 1) {
      result.push(line);
      continue;
    }

    let kept: string | null = null;
    let keptNeedsLeadingCR = false;
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      const stripped = seg.replace(ANSI_STRIP_REGEX, '').trim();
      if (stripped.length > 0 && isThinkingLine(stripped)) continue;
      if (seg.length === 0) continue;
      kept = seg;
      keptNeedsLeadingCR = i > 0;
      break;
    }

    if (kept !== null) {
      result.push(keptNeedsLeadingCR ? '\r' + kept : kept);
    }
  }

  return result.join('');
}

/**
 * Two-stage filter: CR filter first, then line-based filter.
 * Use this everywhere terminal output needs filtering (live, restore, replay).
 */
export function filterAllThinkingOutput(data: string): string {
  return filterThinkingOutput(filterCarriageReturnThinking(data));
}
