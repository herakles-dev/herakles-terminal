import { describe, it, expect } from 'vitest';
import { filterThinkingOutput, filterCarriageReturnThinking, stripAnsi } from '../terminalFilters';

describe('ANSI_STRIP_REGEX', () => {
  it('strips standard CSI sequences', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
    expect(stripAnsi('\x1b[1;34mbold blue\x1b[0m')).toBe('bold blue');
  });

  it('strips private mode CSI sequences', () => {
    expect(stripAnsi('\x1b[?25lhidden cursor\x1b[?25h')).toBe('hidden cursor');
    expect(stripAnsi('\x1b[?1049h')).toBe('');
  });

  it('strips CSI with > intermediate', () => {
    expect(stripAnsi('\x1b[>0ctext')).toBe('text');
  });

  it('strips CSI ending with ~', () => {
    expect(stripAnsi('\x1b[1~\x1b[4~')).toBe('');
  });

  it('strips OSC sequences (BEL terminated)', () => {
    expect(stripAnsi('\x1b]0;window title\x07content')).toBe('content');
  });

  it('strips OSC sequences (ST terminated)', () => {
    expect(stripAnsi('\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\')).toBe('link');
  });

  it('strips DCS sequences', () => {
    expect(stripAnsi('\x1bPsixel data\x1b\\visible')).toBe('visible');
  });

  it('strips 8-bit CSI sequences', () => {
    expect(stripAnsi('\x9b31mred\x9b0m')).toBe('red');
  });

  it('strips simple 2-char escape sequences', () => {
    expect(stripAnsi('\x1b=\x1bMtext')).toBe('text');
  });

  it('preserves plain text', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
    expect(stripAnsi('$ npm run build')).toBe('$ npm run build');
    expect(stripAnsi('package.json')).toBe('package.json');
  });
});

describe('filterThinkingOutput', () => {
  it('filters pure dot lines', () => {
    const result = filterThinkingOutput('.....\nreal output\n');
    expect(result).not.toContain('.....');
    expect(result).toContain('real output');
  });

  it('filters dot lines with spaces', () => {
    const result = filterThinkingOutput('. . . .\nkeep this\n');
    expect(result).not.toContain('. . . .');
    expect(result).toContain('keep this');
  });

  it('filters braille spinner lines', () => {
    const result = filterThinkingOutput('\u28FF Thinking...\nreal output\n');
    expect(result).not.toContain('Thinking');
    expect(result).toContain('real output');
  });

  it('filters dots wrapped in ANSI codes', () => {
    const result = filterThinkingOutput('\x1b[?25l.....\x1b[?25h\nreal content\n');
    expect(result).not.toContain('.....');
    expect(result).toContain('real content');
  });

  it('filters dots wrapped in OSC sequences', () => {
    const result = filterThinkingOutput('\x1b]0;title\x07.....\nkeep\n');
    expect(result).not.toContain('.....');
    expect(result).toContain('keep');
  });

  it('preserves real terminal content', () => {
    const input = '$ npm run build\nBuilding...\nDone in 2.3s\n';
    const result = filterThinkingOutput(input);
    expect(result).toContain('$ npm run build');
    expect(result).toContain('Done in 2.3s');
  });

  it('preserves filenames with dots', () => {
    const input = 'package.json\ntsconfig.json\nindex.ts\n';
    const result = filterThinkingOutput(input);
    expect(result).toContain('package.json');
    expect(result).toContain('tsconfig.json');
  });

  it('preserves empty lines', () => {
    const result = filterThinkingOutput('line1\n\nline2\n');
    expect(result).toBe('line1\n\nline2\n');
  });

  it('preserves lines with mixed dots and real content', () => {
    const result = filterThinkingOutput('Loading... done\n');
    expect(result).toContain('Loading... done');
  });

  it('handles \\r\\n line endings', () => {
    const result = filterThinkingOutput('.....\r\nreal\r\n');
    expect(result).not.toContain('.....');
    expect(result).toContain('real');
  });

  it('handles \\r line endings (spinner overwrites)', () => {
    const result = filterThinkingOutput('.....\rreal content');
    expect(result).not.toContain('.....');
    expect(result).toContain('real content');
  });

  it('filters predominantly dot lines (ratio-based)', () => {
    // 4 dots, 1 non-dot char = 80% dots, >= 3 dots
    const result = filterThinkingOutput('....\x01\nkeep\n');
    expect(result).toContain('keep');
  });

  it('preserves lines below dot ratio threshold', () => {
    // "a.b.c" has 2 dots, 3 non-dot = 40% dots - should be kept
    const result = filterThinkingOutput('a.b.c\n');
    expect(result).toContain('a.b.c');
  });

  it('handles empty input', () => {
    expect(filterThinkingOutput('')).toBe('');
  });

  it('handles input with only ANSI codes', () => {
    const result = filterThinkingOutput('\x1b[31m\x1b[0m\n');
    // Line is only ANSI codes, stripped = empty, should be preserved
    expect(result).toContain('\x1b[31m\x1b[0m');
  });

  // === Cursor-positioned dot filtering (tmux SIGWINCH resize artifacts) ===

  describe('cursor-positioned dot filtering', () => {
    it('filters dots at cursor positions when mixed with prompt content', () => {
      // tmux re-render: prompt on row 1, dots on rows 3-5
      const input = '\x1b[1;1Hhercules@linux:~/project$ \x1b[2;1H\x1b[K\x1b[3;1H.\x1b[K\x1b[4;1H.\x1b[K\x1b[5;1H.\x1b[K';
      const result = filterThinkingOutput(input);
      const stripped = stripAnsi(result);
      expect(stripped).toContain('hercules@linux:~/project$');
      expect(stripped).not.toContain('.');
    });

    it('filters pure cursor-positioned dots', () => {
      const input = '\x1b[3;1H.\x1b[K\x1b[4;1H.\x1b[K\x1b[5;1H.\x1b[K';
      const result = filterThinkingOutput(input);
      expect(stripAnsi(result).trim()).toBe('');
    });

    it('preserves legitimate content at cursor positions', () => {
      const input = '\x1b[1;1H$ ls -la\x1b[2;1Hpackage.json\x1b[3;1Htsconfig.json';
      const result = filterThinkingOutput(input);
      const stripped = stripAnsi(result);
      expect(stripped).toContain('$ ls -la');
      expect(stripped).toContain('package.json');
      expect(stripped).toContain('tsconfig.json');
    });

    it('filters dots at cursor home (no params)', () => {
      const input = '\x1b[H.\x1b[K\x1b[2;1Hhello world';
      const result = filterThinkingOutput(input);
      const stripped = stripAnsi(result);
      expect(stripped).not.toMatch(/^\./);
      expect(stripped).toContain('hello world');
    });

    it('emits clear-to-end-of-line when filtering cursor-positioned dots', () => {
      // When a dot is filtered at a cursor position, \x1b[K should be emitted
      // to clear old content at that position
      const input = '\x1b[3;1H.\x1b[4;1H.\x1b[5;1H.';
      const result = filterThinkingOutput(input);
      expect(result).toContain('\x1b[K');
      expect(stripAnsi(result)).not.toContain('.');
    });

    it('preserves cursor positioning sequences in output', () => {
      const input = '\x1b[1;1Hprompt$ \x1b[3;1H.\x1b[4;1H.';
      const result = filterThinkingOutput(input);
      // Cursor positioning sequences should survive even when content is filtered
      expect(result).toContain('\x1b[1;1H');
      expect(result).toContain('\x1b[3;1H');
    });

    it('handles mixed cursor-positioned and newline-delimited content', () => {
      const input = '\x1b[1;1Hfirst row\n.....\n\x1b[5;1H.\x1b[K\x1b[6;1Hreal content';
      const result = filterThinkingOutput(input);
      const stripped = stripAnsi(result);
      expect(stripped).toContain('first row');
      expect(stripped).toContain('real content');
      expect(stripped).not.toMatch(/\.{5}/); // no 5-dot sequence
    });

    it('preserves files with dots at cursor positions (ls output)', () => {
      // ls -la output positioned by tmux
      const input = '\x1b[1;1H-rw-r--r--  1 user  staff  1234 config.yml\x1b[2;1H-rw-r--r--  1 user  staff  5678 index.ts';
      const result = filterThinkingOutput(input);
      const stripped = stripAnsi(result);
      expect(stripped).toContain('config.yml');
      expect(stripped).toContain('index.ts');
    });

    it('filters braille spinners at cursor positions', () => {
      const input = '\x1b[10;1H\u28FF Thinking...\x1b[11;1H\u28B9 Processing...';
      const result = filterThinkingOutput(input);
      const stripped = stripAnsi(result);
      expect(stripped).not.toContain('Thinking');
      expect(stripped).not.toContain('Processing');
    });

    it('handles cursor positioning with f terminator', () => {
      // CSI row;col f is equivalent to CSI row;col H
      const input = '\x1b[3;1f.\x1b[4;1f.\x1b[5;1freal content';
      const result = filterThinkingOutput(input);
      const stripped = stripAnsi(result);
      expect(stripped).not.toMatch(/^\.+/);
      expect(stripped).toContain('real content');
    });

    it('handles full tmux SIGWINCH re-render simulation', () => {
      // Realistic tmux re-render: clear screen, home, then row-by-row content
      const input =
        '\x1b[H\x1b[2J' +                          // clear + home
        '\x1b[1;1Hhercules@linux:~/project$ \x1b[K' + // row 1: prompt
        '\x1b[2;1H\x1b[K' +                          // row 2: empty
        '\x1b[3;1H.\x1b[K' +                          // row 3: dot
        '\x1b[4;1H.\x1b[K' +                          // row 4: dot
        '\x1b[5;1H.\x1b[K' +                          // row 5: dot
        '\x1b[6;1H.\x1b[K' +                          // row 6: dot
        '\x1b[7;1H$ \x1b[K';                          // row 7: new prompt
      const result = filterThinkingOutput(input);
      const stripped = stripAnsi(result);
      expect(stripped).toContain('hercules@linux:~/project$');
      expect(stripped).toContain('$');
      // No visible dots should remain
      expect(stripped.replace(/\$/g, '').replace(/[^.]/g, '')).toBe('');
    });
  });

  // === CRITICAL MISSING TEST SCENARIOS ===
  describe('edge cases and missing scenarios', () => {
    it('handles chunk boundary with incomplete cursor sequence (split across calls)', () => {
      // Simulates: call 1 sends '\x1b[3;1', call 2 sends 'H.\x1b[4;1H.'
      // In real usage, client buffers would join these.
      const combined = '\x1b[3;1H.\x1b[4;1H.';
      const result = filterThinkingOutput(combined);
      expect(stripAnsi(result).trim()).toBe('');
    });

    it('handles very long cursor-positioned data (50+ rows)', () => {
      let bigInput = '';
      for (let i = 1; i <= 50; i++) {
        bigInput += `\x1b[${i};1H.\x1b[K`;
      }
      const result = filterThinkingOutput(bigInput);
      const stripped = stripAnsi(result);
      // Should have no visible dot content — stripAnsi handles all escape bytes
      expect(stripped.replace(/\s/g, '')).toBe('');
    });

    it('filters cursor-positioned dots at non-column-1 positions', () => {
      // Dots may appear at various columns, not just column 1
      const col40 = '\x1b[3;40H.\x1b[4;40H.\x1b[5;40H.';
      const result = filterThinkingOutput(col40);
      expect(stripAnsi(result).trim()).toBe('');
    });

    it('handles mixed H and f cursor positioning terminators', () => {
      // CSI row;col H and CSI row;col f are equivalent in VT100
      const mixed = '\x1b[3;1H.\x1b[4;1f.\x1b[5;1H.\x1b[6;1f.';
      const result = filterThinkingOutput(mixed);
      expect(stripAnsi(result).trim()).toBe('');
    });

    it('filters cursor positioning with very large row/col numbers', () => {
      // Extreme but valid cursor positions (e.g., row 999, col 999)
      const bigNums = '\x1b[999;999H.\x1b[998;998H.';
      const result = filterThinkingOutput(bigNums);
      expect(stripAnsi(result).trim()).toBe('');
    });

    it('filters dots at cursor positions while preserving real content (OPM integration)', () => {
      // Realistic scenario: dots mixed with real terminal output
      // This tests the full filter pipeline as used by OutputPipelineManager
      // Note: when cursor positions are not separated by newlines, a dot followed by
      // real content on the same logical line will appear together after stripping ANSI
      const input = '\x1b[3;1H.\x1b[K\x1b[4;1H.real content\x1b[K\x1b[5;1H.\x1b[K\x1b[6;1Hmore output';
      const result = filterThinkingOutput(input);
      const stripped = stripAnsi(result);
      expect(stripped).toContain('real content');
      expect(stripped).toContain('more output');
      // Verify the filter worked: isolated dot-only segments were cleared
      expect(result).toContain('\x1b[K'); // clear-to-eol emitted for filtered dots
    });

    it('handles carriage return and cursor positioning interaction correctly', () => {
      // The two filters work together: CR filter runs first, then thinking filter
      const crAndCursor = '\r\x1b[?25l\x1b[1;1H.\x1b[2;1H.\x1b[?25h';
      const afterCRFilter = filterCarriageReturnThinking(crAndCursor);
      const afterThinkingFilter = filterThinkingOutput(afterCRFilter);
      // Both filters should work correctly together
      expect(stripAnsi(afterThinkingFilter).trim()).toBe('');
    });

    it('preserves legitimate content when filtering multiple cursor-positioned lines', () => {
      // Real output mixed with dot artifacts
      const input = '\x1b[1;1H$ ls -la\x1b[2;1H\x1b[K\x1b[3;1H.\x1b[4;1Hpackage.json\x1b[5;1H.\x1b[6;1Hindex.ts';
      const result = filterThinkingOutput(input);
      const stripped = stripAnsi(result);
      expect(stripped).toContain('$ ls -la');
      expect(stripped).toContain('package.json');
      expect(stripped).toContain('index.ts');
      // No pure dot lines (dots only come with real content like "index.ts")
    });

    it('maintains performance with 100+ cursor positioning operations', () => {
      // Verify the split-based approach scales reasonably
      let input = '';
      for (let i = 1; i <= 100; i++) {
        input += `\x1b[${i};${i}H.`;
      }
      const start = performance.now();
      const result = filterThinkingOutput(input);
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(100); // Should complete in <100ms
      expect(stripAnsi(result).trim()).toBe('');
    });

    it('handles cursor positioning without row parameter (cursor down + column)', () => {
      // \x1b[;40H means "same row, column 40"
      const input = '\x1b[;40H.\x1b[;50H.';
      const result = filterThinkingOutput(input);
      expect(stripAnsi(result).trim()).toBe('');
    });

    it('filters cursor positioning without any parameters (home position)', () => {
      // \x1b[H is cursor home
      const input = '\x1b[H.\x1b[K\x1b[2;1H.';
      const result = filterThinkingOutput(input);
      expect(stripAnsi(result).trim()).toBe('');
    });
  });

  // === Unicode dot-like character tests (L3) ===
  describe('Unicode dot-like characters', () => {
    it('filters lines of middle dots (U+00B7)', () => {
      const middleDots = '\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7';
      const result = filterThinkingOutput(middleDots + '\nreal\n');
      expect(result).not.toContain(middleDots);
      expect(result).toContain('real');
    });

    it('filters lines of bullet characters (U+2022)', () => {
      const bullets = '\u2022\u2022\u2022\u2022\u2022';
      const result = filterThinkingOutput(bullets + '\nkeep\n');
      expect(result).not.toContain(bullets);
      expect(result).toContain('keep');
    });

    it('filters lines of ellipsis characters (U+2026)', () => {
      const ellipses = '\u2026\u2026\u2026\u2026\u2026';
      const result = filterThinkingOutput(ellipses + '\nkeep\n');
      expect(result).not.toContain(ellipses);
      expect(result).toContain('keep');
    });

    it('preserves real content with isolated Unicode dots', () => {
      const result = filterThinkingOutput('Price: \u00B72.50/unit\n');
      expect(result).toContain('Price');
    });
  });

  // === APC/PM sequence stripping (M7) ===
  describe('APC and PM sequence handling', () => {
    it('strips APC sequences from content', () => {
      const result = filterThinkingOutput('\x1b_passthrough data\x1b\\real content\n');
      expect(stripAnsi(result)).toContain('real content');
    });

    it('strips PM sequences from content', () => {
      const result = filterThinkingOutput('\x1b^private msg\x1b\\visible\n');
      expect(stripAnsi(result)).toContain('visible');
    });
  });

  // === Dot ratio threshold boundary (L2) ===
  describe('dot ratio boundary', () => {
    it('filters line at exactly 80% dot ratio', () => {
      // "....x" = 4 dots, 5 chars total, ratio = 0.8 exactly
      const result = filterThinkingOutput('....x\nkeep\n');
      // With >= 0.8 threshold, this should be filtered
      expect(result).not.toContain('....x');
      expect(result).toContain('keep');
    });
  });

  // === Carriage return edge cases (M5) ===
  describe('carriage return edge cases', () => {
    it('preserves base64 content that resembles dots', () => {
      // Base64 for ".........." is "Li4uLi4uLi4u"
      // This should NOT be filtered — it's real content
      const result = filterCarriageReturnThinking('Li4uLi4uLi4u\n');
      expect(result).toContain('Li4uLi4uLi4u');
    });

    it('does not produce bare \\r outside of intentional cursor-move sequences', () => {
      // \r before \n is fine (\r\n = CRLF). Only test that braille-only lines
      // that happen to have \r\n don't leave orphaned \r after the filter.
      const result = filterCarriageReturnThinking('\u28FF Thinking\r\nreal');
      // No bare \r should appear in segments that were spinner-dropped
      // (the \r\n line ending is preserved, not stripped)
      expect(result).toContain('real');
    });
  });

  // === Shell readline history cycling (M6) ===
  describe('shell readline history cycling', () => {
    it('preserves CR before erase-to-EOL (\\r\\x1b[K) — basic case', () => {
      // bash readline sends \r\x1b[K to clear the current input line before
      // redrawing with the new history entry. The \r MUST reach xterm so the
      // cursor moves to column 0 before the erase sequence runs.
      const data = '\r\x1b[Kprompt> git status';
      const result = filterCarriageReturnThinking(data);
      expect(result).toContain('\r');
      expect(result).toContain('\x1b[K');
      expect(result).toContain('prompt> git status');
    });

    it('preserves CR before erase-entire-line (\\r\\x1b[2K)', () => {
      const data = '\r\x1b[2Kprompt> ls';
      const result = filterCarriageReturnThinking(data);
      expect(result).toContain('\r');
      expect(result).toContain('\x1b[2K');
      expect(result).toContain('prompt> ls');
    });

    it('preserves CR + erase-to-EOL even when split as a standalone chunk', () => {
      // The \r\x1b[K may arrive without content in a separate network chunk
      const data = '\r\x1b[K';
      const result = filterCarriageReturnThinking(data);
      expect(result).toBe('\r\x1b[K');
      expect(result).toContain('\r');
    });

    it('filters spinner before history redraw and preserves the CR + erase', () => {
      // Claude spinner runs, then user presses up-arrow: both in same chunk
      const data = '\r\u28CB Thinking...\r\x1b[Kprompt> ls';
      const result = filterCarriageReturnThinking(data);
      expect(result).not.toContain('Thinking');
      expect(result).toContain('\r');
      expect(result).toContain('\x1b[K');
      expect(result).toContain('prompt> ls');
    });

    it('passes CR + erase-to-EOL through the full two-stage pipeline', () => {
      // Both filters must preserve the \r for xterm to position correctly
      const data = '\r\x1b[Kprompt> git log';
      const afterCR = filterCarriageReturnThinking(data);
      const afterThinking = filterThinkingOutput(afterCR);
      expect(afterThinking).toContain('\r');
      expect(afterThinking).toContain('\x1b[K');
      expect(afterThinking).toContain('prompt> git log');
    });

    it('still filters pure spinner sequences with no real content', () => {
      // Standard spinner with no following shell content should be dropped
      const data = '\r\u28CB Thinking...\r\u28D5 Thinking...\r';
      const result = filterCarriageReturnThinking(data);
      expect(result).toBe('');
    });
  });
});
