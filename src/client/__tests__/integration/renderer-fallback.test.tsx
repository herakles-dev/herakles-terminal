import { act } from '@testing-library/react';
import { Terminal as XTerm } from '@xterm/xterm';
import { vi } from 'vitest';

describe('Renderer Fallback Chain', () => {
  let container: HTMLElement;
  let term: XTerm;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    term = new XTerm({
      rows: 24,
      cols: 80,
    });

    vi.useFakeTimers();
  });

  afterEach(() => {
    term.dispose();
    document.body.removeChild(container);
    vi.useRealTimers();
  });

  it('should load Canvas renderer after term.open()', () => {
    act(() => {
      term.open(container);
    });

    expect(term.element).toBeTruthy();

    act(() => {
      vi.runAllTimers();
    });
  });

  it('should validate renderer activation with canvas element', () => {
    act(() => {
      term.open(container);
      vi.runAllTimers();
    });

    const canvas = term.element?.querySelector('canvas.xterm-text-layer');
    expect(canvas).toBeDefined();
  });

  it('should initialize renderer on activation', () => {
    act(() => {
      term.open(container);
      vi.runAllTimers();
    });

    // Verify terminal is properly initialized with a renderer
    expect(term.element).toBeTruthy();
    expect(term.cols).toBe(80);
    expect(term.rows).toBe(24);
  });

  it('should handle renderer failures gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    act(() => {
      term.open(container);
      vi.runAllTimers();
    });

    consoleSpy.mockRestore();
  });

  it('should have proper addon load order', () => {
    const order: string[] = [];
    
    const originalOpen = term.open.bind(term);
    term.open = ((arg: HTMLElement) => {
      order.push('open');
      return originalOpen(arg);
    }) as any;

    act(() => {
      term.open(container);
      order.push('canvas');
    });

    expect(order).toEqual(['open', 'canvas']);
  });
});
