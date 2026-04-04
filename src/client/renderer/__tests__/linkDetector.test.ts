import { describe, it, expect } from 'vitest';
import { detectLinks } from '../linkDetector';

describe('detectLinks', () => {
  // ---------------------------------------------------------------------------
  // Basic positive detection
  // ---------------------------------------------------------------------------

  it('detects a plain https URL', () => {
    const result = detectLinks('Visit https://example.com for more');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      startCol: 6,
      endCol: 6 + 'https://example.com'.length,
      url: 'https://example.com',
    });
  });

  it('detects a plain http URL', () => {
    const result = detectLinks('http://example.com');
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('http://example.com');
  });

  it('detects a www. URL and prefixes https://', () => {
    const result = detectLinks('go to www.example.com today');
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('https://www.example.com');
  });

  it('detects a file:/// URL', () => {
    const result = detectLinks('open file:///home/user/readme.md');
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('file:///home/user/readme.md');
  });

  it('detects URL with path, query, and fragment', () => {
    const url = 'https://api.example.com/v2/search?q=hello+world&page=2#results';
    const result = detectLinks(`GET ${url}`);
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe(url);
  });

  // ---------------------------------------------------------------------------
  // Trailing punctuation trimming
  // ---------------------------------------------------------------------------

  it('strips trailing period', () => {
    const result = detectLinks('See https://example.com.');
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('https://example.com');
  });

  it('strips trailing comma', () => {
    const result = detectLinks('Docs: https://example.com/docs, and more');
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('https://example.com/docs');
  });

  it('strips trailing closing paren that is unmatched', () => {
    const result = detectLinks('(see https://example.com)');
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('https://example.com');
  });

  it('preserves balanced parens in URL (Wikipedia-style)', () => {
    const url = 'https://en.wikipedia.org/wiki/Lisp_(programming_language)';
    const result = detectLinks(`Read ${url} for details.`);
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe(url);
  });

  it('strips trailing colon', () => {
    const result = detectLinks('URL: https://example.com:');
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('https://example.com');
  });

  it('strips trailing exclamation mark', () => {
    const result = detectLinks('Check https://example.com!');
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('https://example.com');
  });

  it('strips trailing semicolon', () => {
    const result = detectLinks('Visit https://example.com;');
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('https://example.com');
  });

  // ---------------------------------------------------------------------------
  // No false positives
  // ---------------------------------------------------------------------------

  it('returns empty array for plain text', () => {
    expect(detectLinks('hello world')).toHaveLength(0);
  });

  it('returns empty array for empty string', () => {
    expect(detectLinks('')).toHaveLength(0);
  });

  it('does not match bare domain without scheme or www.', () => {
    // "example.com" alone should not be detected
    expect(detectLinks('go to example.com')).toHaveLength(0);
  });

  it('does not match partial protocol string', () => {
    expect(detectLinks('using http alone')).toHaveLength(0);
    expect(detectLinks('https without slashes')).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Column positions
  // ---------------------------------------------------------------------------

  it('reports correct startCol and endCol', () => {
    const text = '   https://x.com   ';
    const result = detectLinks(text);
    expect(result).toHaveLength(1);
    expect(result[0]!.startCol).toBe(3);
    expect(result[0]!.endCol).toBe(3 + 'https://x.com'.length);
  });

  it('endCol equals startCol + trimmed url length', () => {
    const url = 'https://example.com/path';
    const text = `foo ${url} bar`;
    const result = detectLinks(text);
    expect(result[0]!.endCol - result[0]!.startCol).toBe(url.length);
  });

  // ---------------------------------------------------------------------------
  // Multiple URLs on one row
  // ---------------------------------------------------------------------------

  it('detects multiple URLs on the same line', () => {
    const text = 'https://alpha.com and https://beta.org are different';
    const result = detectLinks(text);
    expect(result).toHaveLength(2);
    expect(result[0]!.url).toBe('https://alpha.com');
    expect(result[1]!.url).toBe('https://beta.org');
  });

  it('returns URLs in left-to-right column order', () => {
    const text = 'a https://first.com b https://second.com';
    const result = detectLinks(text);
    expect(result[0]!.startCol).toBeLessThan(result[1]!.startCol);
  });

  // ---------------------------------------------------------------------------
  // Complex real-world patterns
  // ---------------------------------------------------------------------------

  it('handles URL with port number', () => {
    const result = detectLinks('curl http://localhost:3000/api/health');
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('http://localhost:3000/api/health');
  });

  it('handles URL with auth credentials (uncommon but valid)', () => {
    const result = detectLinks('https://user:pass@example.com/path');
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('https://user:pass@example.com/path');
  });

  it('handles URL at very start of string', () => {
    const result = detectLinks('https://start.example.com');
    expect(result).toHaveLength(1);
    expect(result[0]!.startCol).toBe(0);
  });

  it('handles URL at very end of string without punctuation', () => {
    const result = detectLinks('go to https://end.example.com');
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('https://end.example.com');
  });

  it('handles github compare URL with multiple slashes', () => {
    const url = 'https://github.com/org/repo/compare/main...feature';
    const result = detectLinks(url);
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe(url);
  });

  it('handles deeply nested path and query string', () => {
    const url = 'https://example.com/a/b/c?x=1&y=2&z=3#section-4';
    const result = detectLinks(`See ${url}.`);
    expect(result[0]!.url).toBe(url);
  });

  // ---------------------------------------------------------------------------
  // www. edge cases
  // ---------------------------------------------------------------------------

  it('detects www. with path', () => {
    const result = detectLinks('www.example.com/path?q=1');
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('https://www.example.com/path?q=1');
  });

  it('strips trailing dot from www. URL', () => {
    const result = detectLinks('see www.example.com.');
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('https://www.example.com');
  });
});
