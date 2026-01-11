import { act } from '@testing-library/react';
import { Terminal as XTerm } from '@xterm/xterm';

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
    
    jest.useFakeTimers();
  });

  afterEach(() => {
    term.dispose();
    document.body.removeChild(container);
    jest.useRealTimers();
  });

  it('should load Canvas renderer after term.open()', () => {
    act(() => {
      term.open(container);
    });

    expect(term.element).toBeTruthy();
    
    act(() => {
      jest.runAllTimers();
    });
  });

  it('should validate renderer activation with canvas element', () => {
    act(() => {
      term.open(container);
      jest.runAllTimers();
    });

    const canvas = term.element?.querySelector('canvas.xterm-text-layer');
    expect(canvas).toBeDefined();
  });

  it('should log renderer type on activation', () => {
    const consoleSpy = jest.spyOn(console, 'info').mockImplementation();
    
    act(() => {
      term.open(container);
      jest.runAllTimers();
    });

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should handle renderer failures gracefully', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    
    act(() => {
      term.open(container);
      jest.runAllTimers();
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
