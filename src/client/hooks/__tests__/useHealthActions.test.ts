import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHealthActions } from '../useHealthActions';
import type { WebGLHealthMetrics } from '../../services/WebGLHealthMonitor';
import type { OutputPipelineManager } from '../../services/OutputPipelineManager';
import type { TerminalCoreHandle } from '../../components/TerminalCore/TerminalCore';
import type { Terminal } from '@xterm/xterm';

// Mock toast context value
const createMockToast = () => ({
  showToast: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
});

// Mock terminal handle
const createMockTerminalHandle = (scrollback = 5000): TerminalCoreHandle => ({
  terminal: {
    options: { scrollback },
  } as Terminal,
  fitAddon: null,
  renderError: null,
  write: vi.fn(),
  fit: vi.fn(),
  focus: vi.fn(),
  clear: vi.fn(),
  setTheme: vi.fn(),
});

// Mock output pipeline manager
const createMockOutputPipeline = (): OutputPipelineManager => ({
  setForcedThrottleMode: vi.fn(),
}) as unknown as OutputPipelineManager;

// Create mock metrics with defaults
const createMockMetrics = (overrides: Partial<WebGLHealthMetrics> = {}): WebGLHealthMetrics => ({
  healthScore: 100,
  recommendation: 'normal',
  contextLossCount: 0,
  lastContextLossTime: null,
  sessionStartTime: Date.now(),
  recentContextLosses: 0,
  sessionDurationMinutes: 5,
  averageFlushRate: 10,
  averageBytesRate: 1000,
  currentScrollback: 5000,
  totalBytesProcessed: 10000,
  peakFlushRate: 20,
  peakBytesRate: 2000,
  ...overrides,
});

describe('useHealthActions', () => {
  let mockToast: ReturnType<typeof createMockToast>;
  let terminalRefs: Map<string, TerminalCoreHandle>;
  let mockOutputPipeline: OutputPipelineManager;

  beforeEach(() => {
    mockToast = createMockToast();
    terminalRefs = new Map();
    mockOutputPipeline = createMockOutputPipeline();
    vi.clearAllMocks();
  });

  describe('scrollback adjustment', () => {
    it('should set 5000 lines for health score >= 80', () => {
      terminalRefs.set('win1', createMockTerminalHandle(3000));

      const { result } = renderHook(() =>
        useHealthActions({
          healthMonitor: { current: null },
          terminalRefs: { current: terminalRefs },
          outputPipelineRef: { current: mockOutputPipeline },
          toast: mockToast,
        })
      );

      const metrics = createMockMetrics({
        healthScore: 85,
        recommendation: 'normal',
      });

      result.current.applyHealthActions(metrics);

      const terminal = terminalRefs.get('win1')?.terminal;
      expect(terminal?.options.scrollback).toBe(5000);
    });

    it('should set 3000 lines for health score 60-79', () => {
      terminalRefs.set('win1', createMockTerminalHandle(5000));

      const { result } = renderHook(() =>
        useHealthActions({
          healthMonitor: { current: null },
          terminalRefs: { current: terminalRefs },
          outputPipelineRef: { current: mockOutputPipeline },
          toast: mockToast,
        })
      );

      const metrics = createMockMetrics({
        healthScore: 65,
        recommendation: 'light_throttle',
        contextLossCount: 0,
        currentScrollback: 5000,
      });

      result.current.applyHealthActions(metrics);

      const terminal = terminalRefs.get('win1')?.terminal;
      expect(terminal?.options.scrollback).toBe(3000);
    });

    it('should set 1500 lines for health score 40-59', () => {
      terminalRefs.set('win1', createMockTerminalHandle(5000));

      const { result } = renderHook(() =>
        useHealthActions({
          healthMonitor: { current: null },
          terminalRefs: { current: terminalRefs },
          outputPipelineRef: { current: mockOutputPipeline },
          toast: mockToast,
        })
      );

      const metrics = createMockMetrics({
        healthScore: 50,
        recommendation: 'reduce_quality',
        contextLossCount: 1,
        currentScrollback: 5000,
      });

      result.current.applyHealthActions(metrics);

      const terminal = terminalRefs.get('win1')?.terminal;
      expect(terminal?.options.scrollback).toBe(1500);
    });

    it('should set 500 lines for health score < 40', () => {
      terminalRefs.set('win1', createMockTerminalHandle(5000));

      const { result } = renderHook(() =>
        useHealthActions({
          healthMonitor: { current: null },
          terminalRefs: { current: terminalRefs },
          outputPipelineRef: { current: mockOutputPipeline },
          toast: mockToast,
        })
      );

      const metrics = createMockMetrics({
        healthScore: 30,
        recommendation: 'warn_user',
        contextLossCount: 2,
        currentScrollback: 5000,
      });

      result.current.applyHealthActions(metrics);

      const terminal = terminalRefs.get('win1')?.terminal;
      expect(terminal?.options.scrollback).toBe(500);
    });

    it('should adjust scrollback for multiple terminals', () => {
      terminalRefs.set('win1', createMockTerminalHandle(5000));
      terminalRefs.set('win2', createMockTerminalHandle(5000));
      terminalRefs.set('win3', createMockTerminalHandle(5000));

      const { result } = renderHook(() =>
        useHealthActions({
          healthMonitor: { current: null },
          terminalRefs: { current: terminalRefs },
          outputPipelineRef: { current: mockOutputPipeline },
          toast: mockToast,
        })
      );

      const metrics = createMockMetrics({
        healthScore: 65,
        recommendation: 'light_throttle',
        contextLossCount: 0,
        currentScrollback: 3000,
      });

      result.current.applyHealthActions(metrics);

      expect(terminalRefs.get('win1')?.terminal?.options.scrollback).toBe(3000);
      expect(terminalRefs.get('win2')?.terminal?.options.scrollback).toBe(3000);
      expect(terminalRefs.get('win3')?.terminal?.options.scrollback).toBe(3000);
    });
  });

  describe('toast notifications', () => {
    it('should show warning toast for warn_user recommendation', () => {
      const { result } = renderHook(() =>
        useHealthActions({
          healthMonitor: { current: null },
          terminalRefs: { current: terminalRefs },
          outputPipelineRef: { current: mockOutputPipeline },
          toast: mockToast,
        })
      );

      const metrics = createMockMetrics({
        healthScore: 55,
        recommendation: 'warn_user',
        contextLossCount: 1,
        currentScrollback: 1500,
      });

      result.current.applyHealthActions(metrics);

      expect(mockToast.warning).toHaveBeenCalledWith(
        'Terminal performance degraded (health: 55). Consider refreshing if issues persist.',
        { duration: 8000 }
      );
    });

    it('should show error toast for reinit_required recommendation', () => {
      const { result } = renderHook(() =>
        useHealthActions({
          healthMonitor: { current: null },
          terminalRefs: { current: terminalRefs },
          outputPipelineRef: { current: mockOutputPipeline },
          toast: mockToast,
        })
      );

      const metrics = createMockMetrics({
        healthScore: 25,
        recommendation: 'reinit_required',
        contextLossCount: 3,
        currentScrollback: 500,
      });

      result.current.applyHealthActions(metrics);

      expect(mockToast.error).toHaveBeenCalledWith(
        'Terminal stability critical (health: 25). Please refresh to continue.',
        { duration: 10000 }
      );
    });

    it('should debounce warning toasts (60 second window)', () => {
      vi.useFakeTimers();

      const { result } = renderHook(() =>
        useHealthActions({
          healthMonitor: { current: null },
          terminalRefs: { current: terminalRefs },
          outputPipelineRef: { current: mockOutputPipeline },
          toast: mockToast,
        })
      );

      const metrics = createMockMetrics({
        healthScore: 55,
        recommendation: 'warn_user',
        contextLossCount: 1,
        currentScrollback: 1500,
      });

      // First call - should show toast
      result.current.applyHealthActions(metrics);
      expect(mockToast.warning).toHaveBeenCalledTimes(1);

      // Second call immediately - should NOT show toast (debounced)
      result.current.applyHealthActions(metrics);
      expect(mockToast.warning).toHaveBeenCalledTimes(1);

      // Advance 30 seconds - still debounced
      vi.advanceTimersByTime(30000);
      result.current.applyHealthActions(metrics);
      expect(mockToast.warning).toHaveBeenCalledTimes(1);

      // Advance another 31 seconds (total 61s) - should show toast again
      vi.advanceTimersByTime(31000);
      result.current.applyHealthActions(metrics);
      expect(mockToast.warning).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should not show toast for normal recommendation', () => {
      const { result } = renderHook(() =>
        useHealthActions({
          healthMonitor: { current: null },
          terminalRefs: { current: terminalRefs },
          outputPipelineRef: { current: mockOutputPipeline },
          toast: mockToast,
        })
      );

      const metrics = createMockMetrics({
        healthScore: 90,
        recommendation: 'normal',
        contextLossCount: 0,
        currentScrollback: 5000,
      });

      result.current.applyHealthActions(metrics);

      expect(mockToast.warning).not.toHaveBeenCalled();
      expect(mockToast.error).not.toHaveBeenCalled();
    });
  });

  describe('throttle mode override', () => {
    it('should set critical mode for health score < 40', () => {
      const { result } = renderHook(() =>
        useHealthActions({
          healthMonitor: { current: null },
          terminalRefs: { current: terminalRefs },
          outputPipelineRef: { current: mockOutputPipeline },
          toast: mockToast,
        })
      );

      const metrics = createMockMetrics({
        healthScore: 30,
        recommendation: 'warn_user',
        contextLossCount: 2,
        currentScrollback: 500,
      });

      result.current.applyHealthActions(metrics);

      expect(mockOutputPipeline.setForcedThrottleMode).toHaveBeenCalledWith('critical');
    });

    it('should set heavy mode for health score 40-59', () => {
      const { result } = renderHook(() =>
        useHealthActions({
          healthMonitor: { current: null },
          terminalRefs: { current: terminalRefs },
          outputPipelineRef: { current: mockOutputPipeline },
          toast: mockToast,
        })
      );

      const metrics = createMockMetrics({
        healthScore: 50,
        recommendation: 'reduce_quality',
        contextLossCount: 1,
        currentScrollback: 1500,
      });

      result.current.applyHealthActions(metrics);

      expect(mockOutputPipeline.setForcedThrottleMode).toHaveBeenCalledWith('heavy');
    });

    it('should set light mode for health score 60-79', () => {
      const { result } = renderHook(() =>
        useHealthActions({
          healthMonitor: { current: null },
          terminalRefs: { current: terminalRefs },
          outputPipelineRef: { current: mockOutputPipeline },
          toast: mockToast,
        })
      );

      const metrics = createMockMetrics({
        healthScore: 65,
        recommendation: 'light_throttle',
        contextLossCount: 0,
        currentScrollback: 3000,
      });

      result.current.applyHealthActions(metrics);

      expect(mockOutputPipeline.setForcedThrottleMode).toHaveBeenCalledWith('light');
    });

    it('should clear forced mode for health score >= 80', () => {
      const { result } = renderHook(() =>
        useHealthActions({
          healthMonitor: { current: null },
          terminalRefs: { current: terminalRefs },
          outputPipelineRef: { current: mockOutputPipeline },
          toast: mockToast,
        })
      );

      const metrics = createMockMetrics({
        healthScore: 90,
        recommendation: 'normal',
        contextLossCount: 0,
        currentScrollback: 5000,
      });

      result.current.applyHealthActions(metrics);

      expect(mockOutputPipeline.setForcedThrottleMode).toHaveBeenCalledWith(undefined);
    });
  });
});
