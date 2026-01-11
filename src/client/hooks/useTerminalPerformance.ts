import { useEffect, useRef } from 'react';
import type { Terminal } from '@xterm/xterm';

interface PerformanceMetrics {
  fps: number;
  avgFrameTime: number;
  renderer: 'webgl' | 'canvas' | 'dom';
}

export function useTerminalPerformance(
  terminalRef: React.RefObject<Terminal | null>
) {
  const metricsRef = useRef<PerformanceMetrics>({
    fps: 0,
    avgFrameTime: 0,
    renderer: 'dom',
  });

  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;

    let frameCount = 0;
    let lastTime = performance.now();
    let frameId: number;

    function measureFPS() {
      frameCount++;
      const now = performance.now();
      const elapsed = now - lastTime;

      if (elapsed >= 1000) {
        metricsRef.current.fps = Math.round((frameCount * 1000) / elapsed);
        metricsRef.current.avgFrameTime = elapsed / frameCount;
        frameCount = 0;
        lastTime = now;
      }

      frameId = requestAnimationFrame(measureFPS);
    }

    frameId = requestAnimationFrame(measureFPS);

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [terminalRef]);

  return metricsRef.current;
}
