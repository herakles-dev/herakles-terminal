import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextProgressBar } from '../ContextProgressBar';
import type { ContextUsage } from '@shared/contextProtocol';

function makeUsage(percentage: number, overrides: Partial<ContextUsage> = {}): ContextUsage {
  // By default align usedTokens with percentage against a 200K maxTokens. Tests
  // that care about color bands (which are absolute-token driven: green <200K,
  // yellow 200–300K, red >300K) should pass explicit `usedTokens` overrides.
  return {
    percentage,
    usedTokens: Math.round((percentage / 100) * 200000),
    maxTokens: 200000,
    model: 'claude-opus-4-7',
    sessionId: 'test-session-id',
    lastUpdated: Date.now(),
    ...overrides,
  };
}

describe('ContextProgressBar', () => {
  it('renders without crashing when usage is null', () => {
    const { container } = render(<ContextProgressBar usage={null} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders no progressbar role when usage is null', () => {
    render(<ContextProgressBar usage={null} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('applies green fill color below the yellow threshold (<200K tokens)', () => {
    const { container } = render(
      <ContextProgressBar usage={makeUsage(30, { usedTokens: 60_000 })} />
    );
    // outer div = container.firstChild; fill div = its firstChild
    const fill = (container.firstChild as HTMLElement).firstChild as HTMLElement;
    expect(fill.style.backgroundColor).toBe('rgb(34, 197, 94)'); // #22c55e
  });

  it('applies yellow fill color in the handoff-soon zone (200K–300K tokens)', () => {
    const { container } = render(
      <ContextProgressBar usage={makeUsage(25, { usedTokens: 250_000, maxTokens: 1_000_000 })} />
    );
    const fill = (container.firstChild as HTMLElement).firstChild as HTMLElement;
    expect(fill.style.backgroundColor).toBe('rgb(234, 179, 8)'); // #eab308
  });

  it('applies red fill color in the handoff-now zone (>=300K tokens)', () => {
    const { container } = render(
      <ContextProgressBar usage={makeUsage(32, { usedTokens: 320_000, maxTokens: 1_000_000 })} />
    );
    const fill = (container.firstChild as HTMLElement).firstChild as HTMLElement;
    expect(fill.style.backgroundColor).toBe('rgb(239, 68, 68)'); // #ef4444
  });

  it('adds pulse class only in the critical zone (>=350K tokens)', () => {
    const { container } = render(
      <ContextProgressBar usage={makeUsage(36, { usedTokens: 360_000, maxTokens: 1_000_000 })} />
    );
    const outer = container.firstChild as HTMLElement;
    expect(outer.className).toContain('context-pulse');
  });

  it('does not add pulse class below the critical zone', () => {
    const { container } = render(
      <ContextProgressBar usage={makeUsage(50, { usedTokens: 100_000 })} />
    );
    const outer = container.firstChild as HTMLElement;
    expect(outer.className).not.toContain('context-pulse');
  });

  it('tooltip contains model name', () => {
    const { container } = render(
      <ContextProgressBar usage={makeUsage(40, { model: 'claude-sonnet-4-6' })} />
    );
    const outer = container.firstChild as HTMLElement;
    expect(outer.title).toContain('claude-sonnet-4-6');
  });

  it('tooltip contains token counts', () => {
    const usage = makeUsage(50);
    const { container } = render(<ContextProgressBar usage={usage} />);
    const outer = container.firstChild as HTMLElement;
    expect(outer.title).toContain(usage.usedTokens.toLocaleString());
    expect(outer.title).toContain(usage.maxTokens.toLocaleString());
  });

  it('has no tooltip when usage is null', () => {
    const { container } = render(<ContextProgressBar usage={null} />);
    const outer = container.firstChild as HTMLElement;
    expect(outer.title).toBe('');
  });

  it('fill width does not exceed 100% even when percentage > 100', () => {
    const { container } = render(<ContextProgressBar usage={makeUsage(120)} />);
    const fill = (container.firstChild as HTMLElement).firstChild as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('sets progressbar aria attributes when usage provided', () => {
    render(<ContextProgressBar usage={makeUsage(42)} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toBeTruthy();
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('respects custom height prop', () => {
    const { container } = render(<ContextProgressBar usage={null} height={8} />);
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.height).toBe('8px');
  });
});
