import { useEffect, useRef } from 'react';
import type { Terminal } from '@xterm/xterm';

export type RendererType = 'webgl' | 'canvas' | 'dom';

export function useRendererValidation(
  terminalRef: React.RefObject<Terminal | null>,
  componentName: string
) {
  const rendererTypeRef = useRef<RendererType>('dom');

  useEffect(() => {
    const term = terminalRef.current;
    if (!term || !term.element) return;

    requestAnimationFrame(() => {
      const canvas = term.element?.querySelector('canvas.xterm-text-layer');
      
      if (canvas) {
        const ctx = (canvas as HTMLCanvasElement).getContext('webgl');
        if (ctx) {
          rendererTypeRef.current = 'webgl';
          console.info(`[${componentName}] WebGL renderer ACTIVE ✓`);
        } else {
          rendererTypeRef.current = 'canvas';
          console.info(`[${componentName}] Canvas renderer ACTIVE ✓`);
        }
      } else {
        rendererTypeRef.current = 'dom';
        console.warn(`[${componentName}] DOM renderer (fallback)`);
      }
    });
  }, [terminalRef, componentName]);

  return rendererTypeRef.current;
}
