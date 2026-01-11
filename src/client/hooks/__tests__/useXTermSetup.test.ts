import { renderHook } from '@testing-library/react';
import { useXTermSetup } from '../useXTermSetup';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { vi } from 'vitest';

vi.mock('@xterm/xterm', () => {
  const Terminal = vi.fn();
  return { Terminal };
});

vi.mock('@xterm/addon-fit', () => {
  const FitAddon = vi.fn();
  return { FitAddon };
});

vi.mock('@xterm/addon-web-links', () => {
  const WebLinksAddon = vi.fn();
  return { WebLinksAddon };
});

vi.mock('@xterm/addon-search', () => {
  const SearchAddon = vi.fn();
  return { SearchAddon };
});

describe('useXTermSetup', () => {
  let mockContainer: HTMLDivElement;
  let mockTerminal: any;

  beforeEach(() => {
    mockContainer = document.createElement('div');
    mockTerminal = {
      loadAddon: vi.fn(),
      open: vi.fn(),
      dispose: vi.fn(),
    };
    
    (XTerm as any).mockClear();
    (XTerm as any).mockImplementation(function(this: any) {
      return mockTerminal;
    });
    
    (FitAddon as any).mockClear();
    (FitAddon as any).mockImplementation(function(this: any) {
      return {};
    });
    
    (WebLinksAddon as any).mockClear();
    (WebLinksAddon as any).mockImplementation(function(this: any) {
      return {};
    });
    
    (SearchAddon as any).mockClear();
    (SearchAddon as any).mockImplementation(function(this: any) {
      return {};
    });
  });

  describe('initialization', () => {
    it('should return initializeTerminal function', () => {
      const { result } = renderHook(() => useXTermSetup());
      
      expect(result.current.initializeTerminal).toBeDefined();
      expect(typeof result.current.initializeTerminal).toBe('function');
    });

    it('should create terminal with default options', () => {
      const { result } = renderHook(() => useXTermSetup());
      
      result.current.initializeTerminal(mockContainer);
      
      expect(XTerm).toHaveBeenCalledWith(
        expect.objectContaining({
          cursorStyle: 'block',
          cursorBlink: true,
          allowTransparency: true,
          macOptionIsMeta: true,
          convertEol: true,
          scrollOnUserInput: true,
        })
      );
    });

    it('should apply dark theme by default', () => {
      const { result } = renderHook(() => useXTermSetup());
      
      result.current.initializeTerminal(mockContainer);
      
      expect(XTerm).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: expect.objectContaining({
            background: expect.any(String),
            foreground: expect.any(String),
          }),
        })
      );
    });

    it('should merge additional options', () => {
      const { result } = renderHook(() => 
        useXTermSetup({
          additionalOptions: {
            cursorBlink: false,
            scrollback: 5000,
          },
        })
      );
      
      result.current.initializeTerminal(mockContainer);
      
      expect(XTerm).toHaveBeenCalledWith(
        expect.objectContaining({
          cursorBlink: false,
          scrollback: 5000,
        })
      );
    });

    it('should use custom font size', () => {
      const { result } = renderHook(() => 
        useXTermSetup({ fontSize: 16 })
      );
      
      result.current.initializeTerminal(mockContainer);
      
      expect(XTerm).toHaveBeenCalledWith(
        expect.objectContaining({
          fontSize: 16,
        })
      );
    });

    it('should use custom font family', () => {
      const { result } = renderHook(() => 
        useXTermSetup({ fontFamily: 'Courier New' })
      );
      
      result.current.initializeTerminal(mockContainer);
      
      expect(XTerm).toHaveBeenCalledWith(
        expect.objectContaining({
          fontFamily: 'Courier New',
        })
      );
    });
  });

  describe('addon loading', () => {
    it('should open terminal before loading addons', () => {
      const { result } = renderHook(() => useXTermSetup());
      const callOrder: string[] = [];
      
      mockTerminal.open.mockImplementation(() => callOrder.push('open'));
      mockTerminal.loadAddon.mockImplementation(() => callOrder.push('loadAddon'));
      
      result.current.initializeTerminal(mockContainer);
      
      expect(callOrder[0]).toBe('open');
      expect(callOrder.slice(1)).toEqual(['loadAddon', 'loadAddon', 'loadAddon']);
    });

    it('should load FitAddon', () => {
      const { result } = renderHook(() => useXTermSetup());
      
      result.current.initializeTerminal(mockContainer);
      
      expect(FitAddon).toHaveBeenCalled();
      expect(mockTerminal.loadAddon).toHaveBeenCalledWith(expect.any(Object));
    });

    it('should load WebLinksAddon', () => {
      const { result } = renderHook(() => useXTermSetup());
      
      result.current.initializeTerminal(mockContainer);
      
      expect(WebLinksAddon).toHaveBeenCalled();
      expect(mockTerminal.loadAddon).toHaveBeenCalledWith(expect.any(Object));
    });

    it('should load SearchAddon', () => {
      const { result } = renderHook(() => useXTermSetup());
      
      result.current.initializeTerminal(mockContainer);
      
      expect(SearchAddon).toHaveBeenCalled();
      expect(mockTerminal.loadAddon).toHaveBeenCalledWith(expect.any(Object));
    });

    it('should load all 3 addons in correct order', () => {
      const { result } = renderHook(() => useXTermSetup());
      
      result.current.initializeTerminal(mockContainer);
      
      expect(mockTerminal.loadAddon).toHaveBeenCalledTimes(3);
    });
  });

  describe('return value', () => {
    it('should return terminal instance', () => {
      const { result } = renderHook(() => useXTermSetup());
      
      const { term } = result.current.initializeTerminal(mockContainer);
      
      expect(term).toBe(mockTerminal);
    });

    it('should return FitAddon instance', () => {
      const { result } = renderHook(() => useXTermSetup());
      
      const { fitAddon } = result.current.initializeTerminal(mockContainer);
      
      expect(fitAddon).toBeDefined();
    });

    it('should open terminal with provided container', () => {
      const { result } = renderHook(() => useXTermSetup());
      
      result.current.initializeTerminal(mockContainer);
      
      expect(mockTerminal.open).toHaveBeenCalledWith(mockContainer);
    });
  });

  describe('theme support', () => {
    it('should support light theme', () => {
      const { result } = renderHook(() => 
        useXTermSetup({ theme: 'light' })
      );
      
      expect(result.current.initializeTerminal).toBeDefined();
    });

    it('should support dracula theme', () => {
      const { result } = renderHook(() => 
        useXTermSetup({ theme: 'dracula' })
      );
      
      result.current.initializeTerminal(mockContainer);
      
      expect(XTerm).toHaveBeenCalled();
    });
  });
});
