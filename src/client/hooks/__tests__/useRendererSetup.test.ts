import { renderHook } from '@testing-library/react';
import { useRendererSetup } from '../useRendererSetup';
import { Terminal as XTerm } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { vi } from 'vitest';

vi.mock('@xterm/addon-webgl', () => {
  const WebglAddon = vi.fn();
  return { WebglAddon };
});

// Mock requestAnimationFrame to resolve immediately for tests
const mockRAF = vi.fn((cb: FrameRequestCallback) => {
  cb(0);
  return 0;
});

describe('useRendererSetup', () => {
  let mockTerminal: Partial<XTerm>;
  let mockElement: HTMLDivElement;

  // Mock WebGL2 context object
  const mockWebGL2Context = { drawingBufferWidth: 100 };

  beforeEach(() => {
    mockElement = document.createElement('div');
    // Add a canvas element to simulate WebGL addon creating its canvas
    // Must mock getContext to return WebGL2 context for the verification check
    const canvas = document.createElement('canvas');
    const originalGetContext = canvas.getContext.bind(canvas);
    canvas.getContext = vi.fn((contextType: string) => {
      if (contextType === 'webgl2') {
        return mockWebGL2Context as unknown as WebGL2RenderingContext;
      }
      return originalGetContext(contextType as '2d');
    }) as typeof canvas.getContext;
    mockElement.appendChild(canvas);

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

    // Mock requestAnimationFrame to resolve immediately
    vi.stubGlobal('requestAnimationFrame', mockRAF);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

    it('should accept custom terminalId', async () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const { result } = renderHook(() =>
        useRendererSetup({ terminalId: 'CustomTerminal' })
      );

      await result.current.setupRenderer(mockTerminal as XTerm);

      expect(consoleSpy).toHaveBeenCalledWith('[CustomTerminal] WebGL renderer ACTIVE');

      consoleSpy.mockRestore();
    });
  });

  describe('WebGL renderer', () => {
    it('should try WebGL by default', () => {
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
      expect(addonInstance.onContextLoss).toHaveBeenCalled();
    });

    it('should set active state after successful load', async () => {
      const onStateChange = vi.fn();
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const { result } = renderHook(() =>
        useRendererSetup({ onStateChange })
      );

      await result.current.setupRenderer(mockTerminal as XTerm);

      expect(onStateChange).toHaveBeenCalledWith({ status: 'loading' });
      expect(onStateChange).toHaveBeenCalledWith({ status: 'active', type: 'webgl' });

      consoleSpy.mockRestore();
    });

    it('should fail when WebGL is disabled', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onStateChange = vi.fn();

      const { result } = renderHook(() =>
        useRendererSetup({ enableWebGL: false, onStateChange })
      );

      result.current.setupRenderer(mockTerminal as XTerm);

      expect(WebglAddon).not.toHaveBeenCalled();
      expect(onStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', lastError: 'WebGL disabled' })
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('WebGL disabled - no renderer available')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('WebGL-only behavior', () => {
    it('should fail when WebGL addon throws error', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onStateChange = vi.fn();

      (WebglAddon as any).mockImplementation(() => {
        throw new Error('WebGL2 not supported');
      });

      const { result } = renderHook(() =>
        useRendererSetup({ onStateChange })
      );

      result.current.setupRenderer(mockTerminal as XTerm);

      expect(onStateChange).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          lastError: expect.stringContaining('WebGL init failed')
        })
      );

      consoleSpy.mockRestore();
    });

    it('should fail when loadAddon throws', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onStateChange = vi.fn();

      mockTerminal.loadAddon = vi.fn().mockImplementation(() => {
        throw new Error('WebGL2 not supported');
      });

      const { result } = renderHook(() =>
        useRendererSetup({ onStateChange })
      );

      result.current.setupRenderer(mockTerminal as XTerm);

      expect(onStateChange).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          lastError: expect.stringContaining('WebGL init failed')
        })
      );

      consoleSpy.mockRestore();
    });

    it('should fail if no WebGL2 context found (silent addon failure)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onStateChange = vi.fn();

      // Create a mock element with only 2D canvases (simulates XTerm's default canvases)
      // This simulates WebGL addon failing silently while XTerm's 2D canvases exist
      const mockElementWithout2DOnly = document.createElement('div');
      const canvas2D = document.createElement('canvas');
      // Mock getContext to return null for webgl2 (like a 2D canvas would)
      canvas2D.getContext = vi.fn(() => null) as unknown as typeof canvas2D.getContext;
      mockElementWithout2DOnly.appendChild(canvas2D);

      const mockTermWithout2DOnly = {
        element: mockElementWithout2DOnly,
        loadAddon: vi.fn(),
      };

      const { result } = renderHook(() =>
        useRendererSetup({ onStateChange })
      );

      const setupResult = await result.current.setupRenderer(mockTermWithout2DOnly as unknown as XTerm);

      expect(setupResult.success).toBe(false);
      expect(setupResult.error).toContain('WebGL2 context not found');
      expect(onStateChange).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          lastError: expect.stringContaining('WebGL2 context not found')
        })
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('WebGL addon loaded but no WebGL2 context found')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('error handling', () => {
    it('should handle missing term.element', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { result } = renderHook(() => useRendererSetup());

      const termWithoutElement = { element: null } as unknown as XTerm;

      result.current.setupRenderer(termWithoutElement);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot setup renderer')
      );

      consoleSpy.mockRestore();
    });

    it('should handle WebGL context loss', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const { result } = renderHook(() => useRendererSetup());

      result.current.setupRenderer(mockTerminal as XTerm);

      expect(WebglAddon).toHaveBeenCalled();
      const addonInstance = (WebglAddon as any).mock.results[0].value;

      if (addonInstance.onContextLoss.mock.calls.length > 0) {
        const callback = addonInstance.onContextLoss.mock.calls[0][0];
        callback();
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('WebGL context lost')
        );
      }

      consoleSpy.mockRestore();
      infoSpy.mockRestore();
    });

    it('should attempt recovery on context loss', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const onStateChange = vi.fn();

      const { result } = renderHook(() =>
        useRendererSetup({ onStateChange })
      );

      result.current.setupRenderer(mockTerminal as XTerm);

      const addonInstance = (WebglAddon as any).mock.results[0].value;

      if (addonInstance.onContextLoss.mock.calls.length > 0) {
        const callback = addonInstance.onContextLoss.mock.calls[0][0];
        callback();

        // Should enter recovering state
        expect(onStateChange).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'recovering', attempts: 1 })
        );
      }

      consoleSpy.mockRestore();
      infoSpy.mockRestore();
    });
  });

  describe('logging', () => {
    it('should log WebGL activation', async () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const { result } = renderHook(() => useRendererSetup());

      await result.current.setupRenderer(mockTerminal as XTerm);

      expect(consoleSpy).toHaveBeenCalledWith('[Terminal] WebGL renderer ACTIVE');

      consoleSpy.mockRestore();
    });

    it('should log error when WebGL disabled', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() =>
        useRendererSetup({ enableWebGL: false })
      );

      result.current.setupRenderer(mockTerminal as XTerm);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('WebGL disabled')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('SetupResult return value', () => {
    it('should return success result when WebGL loads', async () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const { result } = renderHook(() => useRendererSetup());

      const setupResult = await result.current.setupRenderer(mockTerminal as XTerm);

      expect(setupResult.success).toBe(true);
      expect(setupResult.rendererType).toBe('webgl');
      expect(setupResult.error).toBeUndefined();

      consoleSpy.mockRestore();
    });

    it('should return failure result when WebGL disabled', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() =>
        useRendererSetup({ enableWebGL: false })
      );

      const setupResult = await result.current.setupRenderer(mockTerminal as XTerm);

      expect(setupResult.success).toBe(false);
      expect(setupResult.rendererType).toBeNull();
      expect(setupResult.error).toBe('WebGL disabled');

      consoleSpy.mockRestore();
    });

    it('should return failure result when term.element is null', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { result } = renderHook(() => useRendererSetup());

      const termWithoutElement = { element: null } as unknown as XTerm;
      const setupResult = await result.current.setupRenderer(termWithoutElement);

      expect(setupResult.success).toBe(false);
      expect(setupResult.rendererType).toBeNull();
      expect(setupResult.error).toBe('term.element is null');

      consoleSpy.mockRestore();
    });

    it('should return failure result when WebGL addon throws', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      (WebglAddon as any).mockImplementation(() => {
        throw new Error('WebGL2 not supported');
      });

      const { result } = renderHook(() => useRendererSetup());

      const setupResult = await result.current.setupRenderer(mockTerminal as XTerm);

      expect(setupResult.success).toBe(false);
      expect(setupResult.rendererType).toBeNull();
      expect(setupResult.error).toContain('WebGL init failed');

      consoleSpy.mockRestore();
    });
  });

  describe('dispose', () => {
    it('should dispose WebGL addon', () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const { result } = renderHook(() => useRendererSetup());

      result.current.setupRenderer(mockTerminal as XTerm);

      const addonInstance = (WebglAddon as any).mock.results[0].value;

      result.current.dispose();

      expect(addonInstance.dispose).toHaveBeenCalled();

      infoSpy.mockRestore();
    });

    it('should reset state to idle on dispose', () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const onStateChange = vi.fn();

      const { result } = renderHook(() =>
        useRendererSetup({ onStateChange })
      );

      result.current.setupRenderer(mockTerminal as XTerm);
      result.current.dispose();

      expect(onStateChange).toHaveBeenCalledWith({ status: 'idle' });

      infoSpy.mockRestore();
    });
  });
});
