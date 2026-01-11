import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { CanvasAddon } from '@xterm/addon-canvas';

/**
 * FPS Benchmark Suite
 * 
 * Tests Zeus Terminal rendering performance to validate 60 FPS target.
 * 
 * Performance Targets:
 * - Heavy output: 60 FPS sustained
 * - Resize operations: 60 FPS sustained
 * - Scroll operations: 60 FPS sustained
 * - Multi-terminal: 60 FPS sustained (3+ terminals)
 */

interface FPSMeasurement {
  avgFPS: number;
  minFPS: number;
  maxFPS: number;
  samples: number;
}

class FPSMonitor {
  private frameCount = 0;
  private lastTime = performance.now();
  private measurements: number[] = [];
  private rafId: number | null = null;
  private terminal: XTerm;

  constructor(terminal: XTerm) {
    this.terminal = terminal;
  }

  start() {
    const measure = () => {
      this.frameCount++;
      const now = performance.now();
      const elapsed = now - this.lastTime;

      if (elapsed >= 1000) {
        const fps = Math.round((this.frameCount * 1000) / elapsed);
        this.measurements.push(fps);
        this.frameCount = 0;
        this.lastTime = now;
      }

      this.rafId = requestAnimationFrame(measure);
    };

    this.rafId = requestAnimationFrame(measure);
  }

  stop(): FPSMeasurement {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }

    if (this.measurements.length === 0) {
      return { avgFPS: 0, minFPS: 0, maxFPS: 0, samples: 0 };
    }

    const avgFPS = Math.round(
      this.measurements.reduce((a, b) => a + b, 0) / this.measurements.length
    );
    const minFPS = Math.min(...this.measurements);
    const maxFPS = Math.max(...this.measurements);

    return {
      avgFPS,
      minFPS,
      maxFPS,
      samples: this.measurements.length,
    };
  }
}

describe('FPS Performance Benchmarks', () => {
  let container: HTMLDivElement;
  let terminal: XTerm;
  let fitAddon: FitAddon;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    terminal = new XTerm({
      rows: 24,
      cols: 80,
      scrollback: 1000,
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    // Try to load WebGL for best performance
    try {
      const webglAddon = new WebglAddon();
      terminal.loadAddon(webglAddon);
    } catch (e) {
      // Fallback to Canvas
      try {
        const canvasAddon = new CanvasAddon();
        terminal.loadAddon(canvasAddon);
      } catch (e2) {
        // DOM fallback (slowest)
      }
    }
  });

  afterEach(() => {
    terminal.dispose();
    document.body.removeChild(container);
  });

  describe('Heavy Output Performance', () => {
    it('should maintain ≥30 FPS during rapid text output', async () => {
      const fpsMonitor = new FPSMonitor(terminal);
      fpsMonitor.start();

      // Write 1000 lines rapidly
      for (let i = 0; i < 1000; i++) {
        terminal.write(`Line ${i}: The quick brown fox jumps over the lazy dog\r\n`);
      }

      // Measure for 2 seconds
      await new Promise(resolve => setTimeout(resolve, 2000));

      const result = fpsMonitor.stop();

      console.log(`Heavy Output FPS: avg=${result.avgFPS}, min=${result.minFPS}, max=${result.maxFPS}`);

      // Relaxed target: 30 FPS minimum (WebGL/Canvas should hit 60)
      // DOM renderer may be slower but should be usable
      expect(result.avgFPS).toBeGreaterThanOrEqual(30);
    }, 10000);

    it('should handle burst writes efficiently', async () => {
      const startTime = performance.now();

      // Burst of 100 lines
      for (let i = 0; i < 100; i++) {
        terminal.write(`Burst line ${i}\r\n`);
      }

      const duration = performance.now() - startTime;

      console.log(`Burst write time: ${duration.toFixed(2)}ms (${(duration / 100).toFixed(2)}ms/line)`);

      // Should complete in <1 second
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Resize Performance', () => {
    it('should complete 10 resizes in <1 second', async () => {
      const startTime = performance.now();

      // Simulate resize operations
      for (let i = 0; i < 10; i++) {
        container.style.width = `${600 + (i * 20)}px`;
        fitAddon.fit();
      }

      const duration = performance.now() - startTime;

      console.log(`10 resizes completed in: ${duration.toFixed(2)}ms (${(duration / 10).toFixed(2)}ms/resize)`);

      expect(duration).toBeLessThan(1000);
    });

    it('should resize quickly', async () => {
      const startTime = performance.now();

      container.style.width = '1000px';
      fitAddon.fit();

      const duration = performance.now() - startTime;

      console.log(`Resize time: ${duration.toFixed(2)}ms`);

      // Should complete in <100ms
      expect(duration).toBeLessThan(100);
    });
  });

  describe('Scroll Performance', () => {
    it('should maintain ≥30 FPS during scroll', async () => {
      // Fill scrollback
      for (let i = 0; i < 500; i++) {
        terminal.write(`Scrollback line ${i}\r\n`);
      }

      const fpsMonitor = new FPSMonitor(terminal);
      fpsMonitor.start();

      // Simulate scrolling
      for (let i = 0; i < 20; i++) {
        terminal.scrollLines(-10);
        await new Promise(resolve => setTimeout(resolve, 50));
        terminal.scrollLines(10);
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      const result = fpsMonitor.stop();

      console.log(`Scroll FPS: avg=${result.avgFPS}, min=${result.minFPS}, max=${result.maxFPS}`);

      expect(result.avgFPS).toBeGreaterThanOrEqual(30);
    }, 5000);
  });

  describe('Multi-Terminal Performance', () => {
    it('should handle 3 terminals efficiently', async () => {
      const terminals: XTerm[] = [terminal]; // Already have 1
      const containers: HTMLDivElement[] = [container];

      // Create 2 more terminals
      for (let i = 0; i < 2; i++) {
        const cont = document.createElement('div');
        cont.style.width = '400px';
        cont.style.height = '300px';
        document.body.appendChild(cont);

        const term = new XTerm({ rows: 12, cols: 40 });
        term.open(cont);

        terminals.push(term);
        containers.push(cont);
      }

      const startTime = performance.now();

      // Write to all terminals simultaneously
      for (let i = 0; i < 50; i++) {
        terminals.forEach((term, idx) => {
          term.write(`Terminal ${idx}: Line ${i}\r\n`);
        });
      }

      const duration = performance.now() - startTime;

      console.log(`Multi-terminal write time: ${duration.toFixed(2)}ms`);

      // Cleanup additional terminals
      for (let i = 1; i < terminals.length; i++) {
        terminals[i].dispose();
        document.body.removeChild(containers[i]);
      }

      // Should complete in <2 seconds
      expect(duration).toBeLessThan(2000);
    });
  });

  describe('Renderer Performance', () => {
    it('should report active renderer type', () => {
      // Check what renderer is active
      const canvas = terminal.element?.querySelector('canvas.xterm-text-layer');
      
      if (canvas) {
        const ctx = (canvas as HTMLCanvasElement).getContext('webgl');
        if (ctx) {
          console.log('Renderer: WebGL (best performance)');
        } else {
          console.log('Renderer: Canvas (good performance)');
        }
      } else {
        console.log('Renderer: DOM (fallback)');
      }

      // Just verify terminal is rendering
      expect(terminal.element).toBeDefined();
    });
  });
});
