import { describe, it, expect } from 'vitest';
import { filterThinkingOutput, stripAnsi } from '../terminalFilters';

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
});
