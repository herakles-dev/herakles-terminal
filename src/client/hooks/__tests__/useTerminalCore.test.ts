import { renderHook } from '@testing-library/react';
import { useTerminalCore } from '../useTerminalCore';
import { Terminal as XTerm } from '@xterm/xterm';
import { vi } from 'vitest';

describe('useTerminalCore', () => {
  let mockTerminal: Partial<XTerm>;

  beforeEach(() => {
    mockTerminal = {
      dispose: vi.fn(),
    };
  });

  describe('initialization', () => {
    it('should initialize with null refs', () => {
      const { result } = renderHook(() => useTerminalCore());
      
      expect(result.current.terminalRef.current).toBeNull();
      expect(result.current.containerRef.current).toBeNull();
    });

    it('should initialize with isInitialized as false', () => {
      const { result } = renderHook(() => useTerminalCore());
      
      expect(result.current.isInitialized).toBe(false);
    });

    it('should provide stable ref objects', () => {
      const { result, rerender } = renderHook(() => useTerminalCore());
      
      const terminalRef1 = result.current.terminalRef;
      const containerRef1 = result.current.containerRef;
      
      rerender();
      
      const terminalRef2 = result.current.terminalRef;
      const containerRef2 = result.current.containerRef;
      
      expect(terminalRef1).toBe(terminalRef2);
      expect(containerRef1).toBe(containerRef2);
    });
  });

  describe('cleanup', () => {
    it('should dispose terminal on unmount', () => {
      const { result, unmount } = renderHook(() => useTerminalCore());
      
      result.current.terminalRef.current = mockTerminal as XTerm;
      
      unmount();
      
      expect(mockTerminal.dispose).toHaveBeenCalledTimes(1);
    });

    it('should handle dispose errors gracefully', () => {
      const { result, unmount } = renderHook(() => useTerminalCore());
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      mockTerminal.dispose = vi.fn(() => {
        throw new Error('Dispose failed');
      });
      
      result.current.terminalRef.current = mockTerminal as XTerm;
      
      unmount();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        '[useTerminalCore] Error disposing terminal:',
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });

    it('should set terminalRef to null after disposal', () => {
      const { result, unmount } = renderHook(() => useTerminalCore());
      
      result.current.terminalRef.current = mockTerminal as XTerm;
      
      expect(result.current.terminalRef.current).not.toBeNull();
      
      unmount();
      
      expect(result.current.terminalRef.current).toBeNull();
    });

    it('should not error if terminal is null on unmount', () => {
      const { unmount } = renderHook(() => useTerminalCore());
      
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('ref assignment', () => {
    it('should allow assigning terminal ref', () => {
      const { result } = renderHook(() => useTerminalCore());
      
      result.current.terminalRef.current = mockTerminal as XTerm;
      
      expect(result.current.terminalRef.current).toBe(mockTerminal);
    });

    it('should allow assigning container ref', () => {
      const { result } = renderHook(() => useTerminalCore());
      const mockContainer = document.createElement('div');
      
      result.current.containerRef.current = mockContainer;
      
      expect(result.current.containerRef.current).toBe(mockContainer);
    });
  });
});
