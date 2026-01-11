import { useRef, useState, useEffect } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';

/**
 * Return type for the useTerminalCore hook
 */
export interface UseTerminalCoreReturn {
  /**
   * Reference to the XTerm instance
   * - Null until terminal is initialized
   * - Should be set after calling `new XTerm()`
   */
  terminalRef: React.MutableRefObject<XTerm | null>;

  /**
   * Reference to the DOM container element
   * - Used by XTerm.open(container) to attach terminal
   * - Should be assigned to a <div> element's ref prop
   */
  containerRef: React.MutableRefObject<HTMLDivElement | null>;

  /**
   * Tracks whether the terminal has been initialized
   * - False on mount
   * - True after terminal instance is created and opened
   */
  isInitialized: boolean;
}

/**
 * Core hook for managing XTerm instance lifecycle
 * 
 * **Responsibilities:**
 * - Manages XTerm instance reference (terminalRef)
 * - Manages DOM container reference (containerRef)
 * - Tracks initialization state
 * - Provides cleanup on unmount
 * 
 * **Usage:**
 * ```tsx
 * const { terminalRef, containerRef, isInitialized } = useTerminalCore();
 * 
 * useEffect(() => {
 *   if (!containerRef.current) return;
 *   
 *   const term = new XTerm({ ... });
 *   term.open(containerRef.current);
 *   terminalRef.current = term;
 * }, []);
 * 
 * return <div ref={containerRef} />;
 * ```
 * 
 * **Note:** This hook does NOT create the XTerm instance itself.
 * It provides the refs and state management. The consuming component
 * is responsible for creating and initializing the terminal.
 * 
 * @returns {UseTerminalCoreReturn} Terminal refs and initialization state
 */
export function useTerminalCore(): UseTerminalCoreReturn {
  // XTerm instance - null until initialized
  const terminalRef = useRef<XTerm | null>(null);

  // DOM container for XTerm to attach to
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Track whether terminal has been initialized
  const [isInitialized, setIsInitialized] = useState(false);

  // Cleanup on unmount
  useEffect(() => {
    const mountTime = performance.now();
    console.debug('[useTerminalCore] Hook mounted');
    
    return () => {
      const lifetime = performance.now() - mountTime;
      console.debug(`[useTerminalCore] Hook unmounting after ${lifetime.toFixed(2)}ms`);
      
      // Dispose of XTerm instance if it exists
      if (terminalRef.current) {
        try {
          terminalRef.current.dispose();
          console.debug('[useTerminalCore] Terminal disposed successfully');
        } catch (error) {
          console.error('[useTerminalCore] Error disposing terminal:', error);
        }
        terminalRef.current = null;
      }

      // Reset initialization state
      setIsInitialized(false);
    };
  }, []);

  return {
    terminalRef,
    containerRef,
    isInitialized,
  };
}
