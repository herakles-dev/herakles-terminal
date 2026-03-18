/**
 * Shared terminal output filtering utilities.
 * Used by both client (OutputPipelineManager, App.tsx) and server (TmuxManager)
 * to filter Claude Code thinking/spinner output from terminal data.
 */

/**
 * Comprehensive ANSI/terminal escape sequence regex.
 * Matches all standard terminal escape sequences for stripping during analysis.
 *
 * Covers:
 * - CSI sequences: \x1b[...letter/~ (including ?, !, > intermediates)
 * - 8-bit CSI:     \x9b...letter/~
 * - OSC sequences: \x1b]...BEL or \x1b]...\x1b\\
 * - DCS sequences: \x1bP...\x1b\\
 * - Simple 2-char: \x1b followed by any single character
 */
export const ANSI_STRIP_REGEX = /(?:\x1b(?:\[[?!>]?[0-9;]*[a-zA-Z~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|P[^\x1b]*\x1b\\|.)|\x9b[0-9;]*[a-zA-Z~])/g;

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

  // Filter lines that are ONLY dots and whitespace (e.g. "....." or ". . . .")
  if (/^[.\s]+$/.test(stripped)) return true;

  // Filter consecutive dots (20+) — tmux SIGWINCH resize artifact
  // Catches lines like "hello....................world" where dots are embedded in other content
  if (/\.{20,}/.test(stripped)) return true;

  // Filter braille spinner lines (pure braille or braille-prefixed like "⠋ Thinking...")
  if (/^[\u2800-\u28FF]/.test(stripped)) return true;

  // Defense-in-depth: filter lines predominantly composed of dots
  // (catches cases where a few unstripped control chars remain)
  const dotCount = (stripped.match(/\./g) || []).length;
  const totalNonWhitespace = stripped.replace(/\s/g, '').length;
  if (totalNonWhitespace > 0 && dotCount / totalNonWhitespace > 0.8 && dotCount >= 3) return true;

  return false;
}

/**
 * Filter Claude Code thinking output from terminal data.
 * Removes dots, spinner characters, and braille lines.
 *
 * Used by:
 * - OutputPipelineManager (live streaming filter)
 * - App.tsx (restore/replay defense-in-depth filter)
 * - TmuxManager.capturePane (scrollback capture filter)
 */
export function filterThinkingOutput(data: string): string {
  const parts = data.split(/(\r\n|\r|\n)/);
  const result: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '\r\n' || part === '\r' || part === '\n') {
      result.push(part);
      continue;
    }
    const stripped = part.replace(ANSI_STRIP_REGEX, '').trim();
    if (stripped.length === 0) { result.push(part); continue; }
    if (isThinkingLine(stripped)) continue;
    result.push(part);
  }
  return result.join('');
}

/**
 * Carriage-return-based thinking filter.
 * Claude Code spinner uses \r to overwrite the same line: `\r⠋ Thinking...\r⠙ Thinking...`
 * When split by \r, only the LAST segment matters (it's what the user sees).
 * Filters out all \r-delimited segments that are thinking lines, keeping the final
 * non-thinking segment if any.
 */
export function filterCarriageReturnThinking(data: string): string {
  // Only apply if data contains \r (without \n following) — the spinner pattern
  if (!data.includes('\r')) return data;

  // Process each line independently (preserve \n-delimited structure)
  const lines = data.split(/(\r\n|\n)/);
  const result: string[] = [];

  for (const line of lines) {
    if (line === '\r\n' || line === '\n') {
      result.push(line);
      continue;
    }

    // Split on bare \r (not \r\n)
    const segments = line.split('\r');
    if (segments.length <= 1) {
      result.push(line);
      continue;
    }

    // Keep only the last non-thinking segment
    // Claude spinner: \r⠋ Thinking...\r⠙ Thinking...\r (last segment is empty or final state)
    let kept: string | null = null;
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      const stripped = seg.replace(ANSI_STRIP_REGEX, '').trim();
      if (stripped.length === 0) continue;
      if (isThinkingLine(stripped)) continue;
      // Found a non-thinking segment — keep it
      kept = seg;
      break;
    }

    if (kept !== null) {
      result.push(kept);
    }
    // If all segments are thinking lines, drop the entire line
  }

  return result.join('');
}
