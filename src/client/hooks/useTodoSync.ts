import { useState, useEffect, useCallback, useRef } from 'react';
import type { TodoItem, TodoUpdateMessage, TodoSyncMessage } from '../../shared/todoProtocol';

interface UseTodoSyncOptions {
  windowId: string | null;
  wsRef: React.RefObject<WebSocket | null>;
}

interface UseTodoSyncResult {
  todos: TodoItem[];
  isLoading: boolean;
  error: string | null;
  pendingCount: number;
  inProgressCount: number;
  completedCount: number;
}

export function useTodoSync({ windowId, wsRef }: UseTodoSyncOptions): UseTodoSyncResult {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousWindowIdRef = useRef<string | null>(null);

  // Calculate counts
  const pendingCount = todos.filter(t => t.status === 'pending').length;
  const inProgressCount = todos.filter(t => t.status === 'in_progress').length;
  const completedCount = todos.filter(t => t.status === 'completed').length;

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data);

      if (message.type === 'todo:update' || message.type === 'todo:sync') {
        const todoMessage = message as TodoUpdateMessage | TodoSyncMessage;

        // Only update if this is for the current window
        if (todoMessage.windowId === windowId) {
          setTodos(todoMessage.todos);
          setIsLoading(false);
          setError(null);
        }
      } else if (message.type === 'todo:clear' && message.windowId === windowId) {
        setTodos([]);
        setIsLoading(false);
      } else if (message.type === 'todo:error' && message.windowId === windowId) {
        setError(message.message || 'Unknown error');
        setIsLoading(false);
      }
    } catch {
      // Ignore non-JSON messages or parse errors
    }
  }, [windowId]);

  // Subscribe to todo updates when windowId changes
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Unsubscribe from previous window if there was one
    if (previousWindowIdRef.current && previousWindowIdRef.current !== windowId) {
      try {
        ws.send(JSON.stringify({
          type: 'todo:unsubscribe',
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
          type: 'todo:subscribe',
          windowId,
        }));
      } catch (e) {
        setError('Failed to subscribe to todo updates');
        setIsLoading(false);
      }
    } else {
      // No window selected, clear todos
      setTodos([]);
      setIsLoading(false);
    }

    previousWindowIdRef.current = windowId;

    // Add message listener
    ws.addEventListener('message', handleMessage);

    return () => {
      ws.removeEventListener('message', handleMessage);

      // Unsubscribe on cleanup
      if (windowId && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({
            type: 'todo:unsubscribe',
            windowId,
          }));
        } catch {
          // Ignore send errors on cleanup
        }
      }
    };
  }, [windowId, wsRef, handleMessage]);

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
            type: 'todo:subscribe',
            windowId,
          }));
        } catch {
          setError('Failed to reconnect to todo updates');
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
  }, [windowId, wsRef]);

  return {
    todos,
    isLoading,
    error,
    pendingCount,
    inProgressCount,
    completedCount,
  };
}

export default useTodoSync;
