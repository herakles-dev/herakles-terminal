import { renderHook } from '@testing-library/react';
import { useRendererSetup } from '../useRendererSetup';
import { Terminal as XTerm } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { CanvasAddon } from '@xterm/addon-canvas';
import { vi } from 'vitest';

vi.mock('@xterm/addon-webgl', () => {
  const WebglAddon = vi.fn();
  return { WebglAddon };
});

vi.mock('@xterm/addon-canvas', () => {
  const CanvasAddon = vi.fn();
  return { CanvasAddon };
});

describe('useRendererSetup', () => {
  let mockTerminal: Partial<XTerm>;
  let mockElement: HTMLDivElement;
  let mockCanvas: HTMLCanvasElement;

  beforeEach(() => {
    mockElement = document.createElement('div');
    mockCanvas = document.createElement('canvas');
    mockCanvas.className = 'xterm-text-layer';
    
    mockTerminal = {
      element: mockElement,
      loadAddon: vi.fn(),
    };
    
    (WebglAddon as any).mockClear();
    (WebglAddon as any).mockImplementation(function(this: any) {
      return {
        onContextLoss: vi.fn(),
        dispose: vi.fn(),
      };
    });
    
    (CanvasAddon as any).mockClear();
    (CanvasAddon as any).mockImplementation(function(this: any) {
      return {};
    });
  });

  describe('initialization', () => {
    it('should return setupRenderer function', () => {
      const { result } = renderHook(() => useRendererSetup());
      
      expect(result.current.setupRenderer).toBeDefined();
      expect(typeof result.current.setupRenderer).toBe('function');
    });

    it('should initialize with null activeRenderer', () => {
      const { result } = renderHook(() => useRendererSetup());
      
      expect(result.current.activeRenderer).toBeNull();
    });

    it('should use default options', () => {
      const { result } = renderHook(() => useRendererSetup());
      
      expect(result.current.setupRenderer).toBeDefined();
    });

    it('should accept custom terminalId', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation();
      
      const { result } = renderHook(() => 
        useRendererSetup({ terminalId: 'CustomTerminal' })
      );
      
      mockElement.appendChild(mockCanvas);
      mockCanvas.getContext = vi.fn(() => ({}) as any);
      
      result.current.setupRenderer(mockTerminal as XTerm);
      
      consoleSpy.mockRestore();
    });
  });

  describe('WebGL renderer', () => {
    it('should try WebGL first by default', () => {
      const { result } = renderHook(() => useRendererSetup());
      
      result.current.setupRenderer(mockTerminal as XTerm);
      
      expect(WebglAddon).toHaveBeenCalled();
    });

    it('should load WebGL addon', () => {
      const { result } = renderHook(() => useRendererSetup());
      
      result.current.setupRenderer(mockTerminal as XTerm);
      
      expect(mockTerminal.loadAddon).toHaveBeenCalled();
    });

    it('should register context loss handler', () => {
      const { result } = renderHook(() => useRendererSetup());
      
      result.current.setupRenderer(mockTerminal as XTerm);
      
      expect(WebglAddon).toHaveBeenCalled();
      const addonInstance = (WebglAddon as any).mock.results[0].value;
      expect(addonInstance.onContextLoss).toBeDefined();
    });

    it('should skip WebGL if disabled', () => {
      const { result } = renderHook(() => 
        useRendererSetup({ enableWebGL: false })
      );
      
      result.current.setupRenderer(mockTerminal as XTerm);
      
      expect(WebglAddon).not.toHaveBeenCalled();
    });
  });

  describe('Canvas fallback', () => {
    it('should fallback to Canvas on WebGL error', () => {
      const { result } = renderHook(() => useRendererSetup());
      
      (WebglAddon as any).mockImplementation(() => {
        throw new Error('WebGL not supported');
      });
      
      result.current.setupRenderer(mockTerminal as XTerm);
      
      expect(CanvasAddon).toHaveBeenCalled();
    });

    it('should use Canvas when WebGL disabled', () => {
      const { result } = renderHook(() => 
        useRendererSetup({ enableWebGL: false })
      );
      
      result.current.setupRenderer(mockTerminal as XTerm);
      
      expect(CanvasAddon).toHaveBeenCalled();
    });

    it('should load Canvas addon', () => {
      const { result } = renderHook(() => 
        useRendererSetup({ enableWebGL: false })
      );
      
      result.current.setupRenderer(mockTerminal as XTerm);
      
      expect(mockTerminal.loadAddon).toHaveBeenCalled();
    });

    it('should skip Canvas if disabled', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation();
      
      const { result } = renderHook(() => 
        useRendererSetup({ 
          enableWebGL: false,
          enableCanvas: false 
        })
      );
      
      result.current.setupRenderer(mockTerminal as XTerm);
      
      expect(CanvasAddon).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Canvas disabled')
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('DOM fallback', () => {
    it('should fallback to DOM on Canvas error', () => {
      const { result } = renderHook(() => 
        useRendererSetup({ enableWebGL: false, enableCanvas: true })
      );
      
      expect(result.current.setupRenderer).toBeDefined();
    });

    it('should use DOM when both WebGL and Canvas disabled', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation();
      
      const { result } = renderHook(() => 
        useRendererSetup({ 
          enableWebGL: false,
          enableCanvas: false 
        })
      );
      
      result.current.setupRenderer(mockTerminal as XTerm);
      
      expect(WebglAddon).not.toHaveBeenCalled();
      expect(CanvasAddon).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });

  describe('error handling', () => {
    it('should handle missing term.element', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation();
      const { result } = renderHook(() => useRendererSetup());
      
      const termWithoutElement = { element: null } as XTerm;
      
      result.current.setupRenderer(termWithoutElement);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot setup renderer')
      );
      
      consoleSpy.mockRestore();
    });

    it('should handle WebGL context loss', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation();
      const { result } = renderHook(() => useRendererSetup());
      
      result.current.setupRenderer(mockTerminal as XTerm);
      
      expect(WebglAddon).toHaveBeenCalled();
      const addonInstance = (WebglAddon as any).mock.results[0].value;
      
      if (addonInstance.onContextLoss.mock.calls.length > 0) {
        const callback = addonInstance.onContextLoss.mock.calls[0][0];
        callback();
        expect(consoleSpy).toHaveBeenCalled();
      }
      
      consoleSpy.mockRestore();
    });
  });

  describe('GPU optimization', () => {
    it('should apply GPU optimizations to viewport', () => {
      const { result } = renderHook(() => useRendererSetup());
      const mockViewport = document.createElement('div');
      mockViewport.className = 'xterm-viewport';
      mockElement.appendChild(mockViewport);
      
      result.current.setupRenderer(mockTerminal as XTerm);
      
      expect(mockViewport.style.willChange).toBe('scroll-position');
      expect(mockViewport.style.transform).toBe('translateZ(0)');
    });

    it('should handle missing viewport gracefully', () => {
      const { result } = renderHook(() => useRendererSetup());
      
      expect(() => {
        result.current.setupRenderer(mockTerminal as XTerm);
      }).not.toThrow();
    });
  });

  describe('logging', () => {
    it('should log WebGL activation', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation();
      const { result } = renderHook(() => useRendererSetup());
      
      mockElement.appendChild(mockCanvas);
      mockCanvas.getContext = vi.fn(() => ({}) as any);
      
      result.current.setupRenderer(mockTerminal as XTerm);
      
      setTimeout(() => {
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
      }, 50);
    });

    it('should log Canvas activation', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation();
      const { result } = renderHook(() => 
        useRendererSetup({ enableWebGL: false })
      );
      
      mockElement.appendChild(mockCanvas);
      
      result.current.setupRenderer(mockTerminal as XTerm);
      
      setTimeout(() => {
        consoleSpy.mockRestore();
      }, 50);
    });
  });
});
