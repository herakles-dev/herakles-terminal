import { useState, useRef, useCallback, useEffect } from 'react';

interface WebSocketConfig {
  url: string;
  onMessage: (data: any) => void;
  onStateChange: (state: ConnectionState) => void;
  reconnectAttempts?: number;
  initialBackoff?: number;
  maxBackoff?: number;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

interface WebSocketHook {
  send: (message: object) => void;
  state: ConnectionState;
  reconnectIn: number | null;
  reconnectNow: () => void;
  queuedMessages: number;
  latency: number | null;
}

export function useWebSocket({
  url,
  onMessage,
  onStateChange,
  reconnectAttempts = 50,
  initialBackoff = 500,
  maxBackoff = 30000,
}: WebSocketConfig): WebSocketHook {
  const [state, setState] = useState<ConnectionState>('disconnected');
  const [reconnectIn, setReconnectIn] = useState<number | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [queueLength, setQueueLength] = useState(0);
  
  const wsRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const messageQueueRef = useRef<object[]>([]);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastPingRef = useRef<number>(0);
  const urlRef = useRef(url);
  const isConnectingRef = useRef(false);
  const onMessageRef = useRef(onMessage);
  const onStateChangeRef = useRef(onStateChange);

  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  const updateState = useCallback((newState: ConnectionState) => {
    setState(newState);
    onStateChangeRef.current(newState);
  }, []);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    setReconnectIn(null);
  }, []);

  const flushQueue = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      while (messageQueueRef.current.length > 0) {
        const msg = messageQueueRef.current.shift();
        if (msg) {
          try {
            wsRef.current.send(JSON.stringify(msg));
          } catch (e) {
            messageQueueRef.current.unshift(msg);
            break;
          }
        }
      }
      setQueueLength(messageQueueRef.current.length);
    }
  }, []);

  const connect = useCallback(() => {
    const currentUrl = urlRef.current;
    if (!currentUrl || currentUrl === 'ws://localhost' || isConnectingRef.current) {
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    clearTimers();
    isConnectingRef.current = true;
    updateState('connecting');

    try {
      const ws = new WebSocket(currentUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        isConnectingRef.current = false;
        attemptsRef.current = 0;
        updateState('connected');
        flushQueue();

        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            lastPingRef.current = Date.now();
            try {
              ws.send(JSON.stringify({ type: 'ping' }));
            } catch (e) {
              console.warn('Failed to send ping:', e);
            }
          }
        }, 15000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'pong') {
            const rtt = Date.now() - lastPingRef.current;
            setLatency(rtt);
            return;
          }
          
          if (data.type === 'ping') {
            try {
              ws.send(JSON.stringify({ type: 'pong' }));
            } catch (e) {
              console.warn('Failed to send pong:', e);
            }
            return;
          }
          
          onMessageRef.current(data);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      ws.onclose = (event) => {
        isConnectingRef.current = false;
        clearTimers();
        wsRef.current = null;
        
        if (event.code === 4001) {
          updateState('disconnected');
          return;
        }
        
        if (attemptsRef.current >= reconnectAttempts) {
          updateState('disconnected');
          return;
        }

        if (!urlRef.current || urlRef.current === 'ws://localhost') {
          updateState('disconnected');
          return;
        }

        updateState('reconnecting');
        attemptsRef.current += 1;

        const backoff = Math.min(
          initialBackoff * Math.pow(1.5, attemptsRef.current - 1),
          maxBackoff
        );
        
        let countdown = Math.ceil(backoff / 1000);
        setReconnectIn(countdown);
        
        countdownTimerRef.current = setInterval(() => {
          countdown -= 1;
          setReconnectIn(countdown > 0 ? countdown : null);
        }, 1000);

        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, backoff);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        isConnectingRef.current = false;
      };
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      isConnectingRef.current = false;
      updateState('disconnected');
    }
  }, [clearTimers, flushQueue, initialBackoff, maxBackoff, reconnectAttempts, updateState]);

  const MAX_QUEUE_SIZE = 100;

  const send = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(message));
      } catch (e) {
        if (messageQueueRef.current.length >= MAX_QUEUE_SIZE) {
          messageQueueRef.current.shift();
        }
        messageQueueRef.current.push(message);
        setQueueLength(messageQueueRef.current.length);
      }
    } else {
      if (messageQueueRef.current.length >= MAX_QUEUE_SIZE) {
        messageQueueRef.current.shift();
      }
      messageQueueRef.current.push(message);
      setQueueLength(messageQueueRef.current.length);
    }
  }, []);

  const reconnectNow = useCallback(() => {
    attemptsRef.current = 0;
    clearTimers();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    connect();
  }, [clearTimers, connect]);

  useEffect(() => {
    if (url && url !== 'ws://localhost') {
      connect();
    }
    
    return () => {
      clearTimers();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [url]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          if (urlRef.current && urlRef.current !== 'ws://localhost') {
            attemptsRef.current = 0;
            connect();
          }
        }
      }
    };

    const handleOnline = () => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        if (urlRef.current && urlRef.current !== 'ws://localhost') {
          attemptsRef.current = 0;
          connect();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [connect]);

  return {
    send,
    state,
    reconnectIn,
    reconnectNow,
    queuedMessages: queueLength,
    latency,
  };
}
