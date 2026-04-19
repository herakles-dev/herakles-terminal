import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMetricsSync } from '../useMetricsSync';
import type { WindowMetrics } from '@shared/contextProtocol';

// ── Mock WebSocket helpers ─────────────────────────────────────────────────────

type MockWsListeners = Record<string, Set<(event?: any) => void>>;

interface MockWebSocket {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  _listeners: MockWsListeners;
  _emit: (type: string, event?: any) => void;
}

function makeMockWs(readyState: number = WebSocket.OPEN): MockWebSocket {
  const listeners: MockWsListeners = {};

  const mock: MockWebSocket = {
    readyState,
    send: vi.fn(),
    addEventListener: vi.fn((type: string, fn: (event?: any) => void) => {
      if (!listeners[type]) listeners[type] = new Set();
      listeners[type].add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: (event?: any) => void) => {
      listeners[type]?.delete(fn);
    }),
    _listeners: listeners,
    _emit(type: string, event?: any) {
      listeners[type]?.forEach(fn => fn(event));
    },
  };

  return mock;
}

function makeWindowMetrics(windowId: string): WindowMetrics {
  return {
    windowId,
    mainSession: null,
    agentSessions: [],
    aggregated: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      aggregateCacheHitRate: 0,
      agentCount: 0,
      activeAgents: 0,
    },
    lastUpdated: Date.now(),
  };
}

describe('useMetricsSync', () => {
  let mockWs: MockWebSocket;

  beforeEach(() => {
    mockWs = makeMockWs();
    vi.clearAllMocks();
  });

  it('sends metrics:subscribe on mount when ws is open and windowId provided', () => {
    renderHook(() =>
      useMetricsSync(mockWs as unknown as WebSocket, 'window-1', true)
    );

    expect(mockWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'metrics:subscribe', windowId: 'window-1' })
    );
  });

  it('sends metrics:unsubscribe on unmount', () => {
    const { unmount } = renderHook(() =>
      useMetricsSync(mockWs as unknown as WebSocket, 'window-1', true)
    );

    unmount();

    expect(mockWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'metrics:unsubscribe', windowId: 'window-1' })
    );
  });

  it('does not subscribe when ws is null', () => {
    renderHook(() => useMetricsSync(null, 'window-1', true));
    // No calls because ws is null
    expect(mockWs.send).not.toHaveBeenCalled();
  });

  it('does not subscribe when enabled=false', () => {
    renderHook(() =>
      useMetricsSync(mockWs as unknown as WebSocket, 'window-1', false)
    );
    expect(mockWs.send).not.toHaveBeenCalled();
  });

  it('does not subscribe when windowId is null', () => {
    renderHook(() =>
      useMetricsSync(mockWs as unknown as WebSocket, null, true)
    );
    expect(mockWs.send).not.toHaveBeenCalled();
  });

  it('updates state on metrics:sync message for matching windowId', () => {
    const { result } = renderHook(() =>
      useMetricsSync(mockWs as unknown as WebSocket, 'window-1', true)
    );

    expect(result.current.metrics).toBeNull();

    const metrics = makeWindowMetrics('window-1');

    act(() => {
      mockWs._emit('message', {
        data: JSON.stringify({ type: 'metrics:sync', windowId: 'window-1', metrics }),
      });
    });

    expect(result.current.metrics).toEqual(metrics);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('updates state on metrics:update message for matching windowId', () => {
    const { result } = renderHook(() =>
      useMetricsSync(mockWs as unknown as WebSocket, 'window-1', true)
    );

    const metrics = makeWindowMetrics('window-1');

    act(() => {
      mockWs._emit('message', {
        data: JSON.stringify({ type: 'metrics:update', windowId: 'window-1', metrics }),
      });
    });

    expect(result.current.metrics).toEqual(metrics);
  });

  it('ignores metrics messages for a different windowId', () => {
    const { result } = renderHook(() =>
      useMetricsSync(mockWs as unknown as WebSocket, 'window-1', true)
    );

    const metrics = makeWindowMetrics('window-OTHER');

    act(() => {
      mockWs._emit('message', {
        data: JSON.stringify({ type: 'metrics:sync', windowId: 'window-OTHER', metrics }),
      });
    });

    expect(result.current.metrics).toBeNull();
  });

  it('ignores non-JSON message data without throwing', () => {
    const { result } = renderHook(() =>
      useMetricsSync(mockWs as unknown as WebSocket, 'window-1', true)
    );

    expect(() => {
      act(() => {
        mockWs._emit('message', { data: 'not-json{{{{' });
      });
    }).not.toThrow();

    expect(result.current.metrics).toBeNull();
  });

  it('sends metrics:unsubscribe for old windowId when windowId changes', () => {
    const { rerender } = renderHook(
      ({ windowId }: { windowId: string }) =>
        useMetricsSync(mockWs as unknown as WebSocket, windowId, true),
      { initialProps: { windowId: 'window-1' } }
    );

    vi.clearAllMocks();

    rerender({ windowId: 'window-2' });

    expect(mockWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'metrics:unsubscribe', windowId: 'window-1' })
    );
    expect(mockWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'metrics:subscribe', windowId: 'window-2' })
    );
  });

  it('returns isLoading=true after subscribe and before first message', () => {
    const { result } = renderHook(() =>
      useMetricsSync(mockWs as unknown as WebSocket, 'window-1', true)
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('registers message listener on ws', () => {
    renderHook(() =>
      useMetricsSync(mockWs as unknown as WebSocket, 'window-1', true)
    );

    expect(mockWs.addEventListener).toHaveBeenCalledWith(
      'message',
      expect.any(Function)
    );
  });

  it('removes message listener on unmount', () => {
    const { unmount } = renderHook(() =>
      useMetricsSync(mockWs as unknown as WebSocket, 'window-1', true)
    );

    unmount();

    expect(mockWs.removeEventListener).toHaveBeenCalledWith(
      'message',
      expect.any(Function)
    );
  });
});
