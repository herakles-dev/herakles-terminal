import { useState, useEffect, useCallback, useRef } from 'react';
import type { ContextUsage, ContextUpdateMessage, ContextSyncMessage } from '../../shared/contextProtocol';

interface UseContextSyncOptions {
  windowId: string | null;
  projectPath: string | null;
  wsRef: React.RefObject<WebSocket | null>;
}

interface UseContextSyncResult {
  usage: ContextUsage | null;
  isLoading: boolean;
  error: string | null;
}

export function useContextSync({ windowId, projectPath, wsRef }: UseContextSyncOptions): UseContextSyncResult {
  const [usage, setUsage] = useState<ContextUsage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousWindowIdRef = useRef<string | null>(null);
  const previousProjectPathRef = useRef<string | null>(null);

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data);

      if (message.type === 'context:update' || message.type === 'context:sync') {
        const contextMessage = message as ContextUpdateMessage | ContextSyncMessage;

        // Only update if this is for the current window
        if (contextMessage.windowId === windowId) {
          setUsage(contextMessage.usage);
          setIsLoading(false);
          setError(null);
        }
      }
    } catch {
      // Ignore non-JSON messages or parse errors
    }
  }, [windowId]);

  // Subscribe to context updates when windowId or projectPath changes
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Unsubscribe from previous window if there was one
    if (previousWindowIdRef.current && previousWindowIdRef.current !== windowId) {
      try {
        ws.send(JSON.stringify({
          type: 'context:unsubscribe',
          windowId: previousWindowIdRef.current,
        }));
      } catch {
        // Ignore send errors
      }
    }

    // Subscribe to new window
    if (windowId) {
      setIsLoading(true);
      setError(null);

      try {
        ws.send(JSON.stringify({
          type: 'context:subscribe',
          windowId,
          projectPath: projectPath || undefined,
        }));
      } catch (e) {
        setError('Failed to subscribe to context updates');
        setIsLoading(false);
      }
    } else {
      // No window selected, clear usage
      setUsage(null);
      setIsLoading(false);
    }

    previousWindowIdRef.current = windowId;
    previousProjectPathRef.current = projectPath;

    // Add message listener
    ws.addEventListener('message', handleMessage);

    return () => {
      ws.removeEventListener('message', handleMessage);

      // Unsubscribe on cleanup
      if (windowId && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({
            type: 'context:unsubscribe',
            windowId,
          }));
        } catch {
          // Ignore send errors on cleanup
        }
      }
    };
  }, [windowId, projectPath, wsRef, handleMessage]);

  // Handle WebSocket reconnection
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;

    const handleOpen = () => {
      // Re-subscribe after reconnection
      if (windowId) {
        setIsLoading(true);
        try {
          ws.send(JSON.stringify({
            type: 'context:subscribe',
            windowId,
            projectPath: projectPath || undefined,
          }));
        } catch {
          setError('Failed to reconnect to context updates');
          setIsLoading(false);
        }
      }
    };

    const handleError = () => {
      setError('WebSocket connection error');
      setIsLoading(false);
    };

    const handleClose = () => {
      // Don't set error on close, just stop loading
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
  }, [windowId, projectPath, wsRef]);

  return {
    usage,
    isLoading,
    error,
  };
}

export default useContextSync;
