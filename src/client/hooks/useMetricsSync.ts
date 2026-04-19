import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  WindowMetrics,
  MetricsSyncMessage,
  MetricsUpdateMessage,
} from '../../shared/contextProtocol';

interface UseMetricsSyncResult {
  metrics: WindowMetrics | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Subscribes to real-time window metrics updates via WebSocket.
 * Mirrors the pattern of useContextSync but for metrics:subscribe/update/sync messages.
 */
export function useMetricsSync(
  ws: WebSocket | null,
  windowId: string | null,
  enabled: boolean = true,
): UseMetricsSyncResult {
  const [metrics, setMetrics] = useState<WindowMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousWindowIdRef = useRef<string | null>(null);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data as string);

        if (message.type === 'metrics:sync' || message.type === 'metrics:update') {
          const metricsMessage = message as MetricsSyncMessage | MetricsUpdateMessage;
          if (metricsMessage.windowId === windowId) {
            setMetrics(metricsMessage.metrics);
            setIsLoading(false);
            setError(null);
          }
        }
      } catch {
        // Ignore non-JSON or parse errors
      }
    },
    [windowId],
  );

  // Subscribe / re-subscribe when windowId changes
  useEffect(() => {
    if (!enabled) {
      setMetrics(null);
      setIsLoading(false);
      return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Unsubscribe from previous window when it changes
    if (previousWindowIdRef.current && previousWindowIdRef.current !== windowId) {
      try {
        ws.send(
          JSON.stringify({
            type: 'metrics:unsubscribe',
            windowId: previousWindowIdRef.current,
          }),
        );
      } catch {
        // Ignore send errors
      }
    }

    if (windowId) {
      setIsLoading(true);
      setError(null);
      try {
        ws.send(
          JSON.stringify({
            type: 'metrics:subscribe',
            windowId,
          }),
        );
      } catch {
        setError('Failed to subscribe to metrics updates');
        setIsLoading(false);
      }
    } else {
      setMetrics(null);
      setIsLoading(false);
    }

    previousWindowIdRef.current = windowId;

    ws.addEventListener('message', handleMessage);

    return () => {
      ws.removeEventListener('message', handleMessage);

      // Unsubscribe on cleanup
      if (windowId && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(
            JSON.stringify({
              type: 'metrics:unsubscribe',
              windowId,
            }),
          );
        } catch {
          // Ignore send errors on cleanup
        }
      }
    };
  }, [windowId, ws, enabled, handleMessage]);

  // Handle WebSocket reconnection
  useEffect(() => {
    if (!ws || !enabled) return;

    const handleOpen = () => {
      if (windowId) {
        setIsLoading(true);
        try {
          ws.send(
            JSON.stringify({
              type: 'metrics:subscribe',
              windowId,
            }),
          );
        } catch {
          setError('Failed to reconnect to metrics updates');
          setIsLoading(false);
        }
      }
    };

    const handleError = () => {
      setError('WebSocket connection error');
      setIsLoading(false);
    };

    const handleClose = () => {
      setIsLoading(false);
    };

    ws.addEventListener('open', handleOpen);
    ws.addEventListener('error', handleError);
    ws.addEventListener('close', handleClose);

    return () => {
      ws.removeEventListener('open', handleOpen);
      ws.removeEventListener('error', handleError);
      ws.removeEventListener('close', handleClose);
    };
  }, [windowId, ws, enabled]);

  return { metrics, isLoading, error };
}

export default useMetricsSync;
