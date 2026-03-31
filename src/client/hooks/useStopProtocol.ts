import { useState, useEffect, useCallback, useRef } from 'react';
import type { StopProtocolPhase } from '@shared/stopProtocol';

interface StopProtocolState {
  phase: StopProtocolPhase;
  youtubeUrl?: string;
  message?: string;
  graceRemaining: number;   // ms remaining in grace
  lockoutRemaining: number; // ms remaining in lockout
  showWarning: boolean;     // true for first 8 seconds after activation
}

interface UseStopProtocolReturn extends StopProtocolState {
  activate: (youtubeUrl?: string, message?: string) => void;
  dismissWarning: () => void;
  handleStopMessage: (msg: any) => void;
}

export function useStopProtocol(
  sendMessage: ((msg: any) => void) | undefined,
  connected: boolean,
): UseStopProtocolReturn {
  const [phase, setPhase] = useState<StopProtocolPhase>('idle');
  const [youtubeUrl, setYoutubeUrl] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [graceEndsAt, setGraceEndsAt] = useState<number>(0);
  const [lockoutEndsAt, setLockoutEndsAt] = useState<number>(0);
  const [graceRemaining, setGraceRemaining] = useState(0);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const [showWarning, setShowWarning] = useState(false);
  const tickRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Subscribe on connect
  useEffect(() => {
    if (connected && sendMessage) {
      sendMessage({ type: 'stop:subscribe' });
      return () => {
        sendMessage({ type: 'stop:unsubscribe' });
      };
    }
  }, [connected, sendMessage]);

  // Countdown ticker
  useEffect(() => {
    if (phase === 'idle') {
      setGraceRemaining(0);
      setLockoutRemaining(0);
      if (tickRef.current) clearInterval(tickRef.current);
      return;
    }

    const tick = () => {
      const now = Date.now();
      if (phase === 'grace' && graceEndsAt > 0) {
        setGraceRemaining(Math.max(0, graceEndsAt - now));
      } else if (phase === 'lockout' && lockoutEndsAt > 0) {
        setLockoutRemaining(Math.max(0, lockoutEndsAt - now));
      }
    };

    tick(); // immediate
    tickRef.current = setInterval(tick, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [phase, graceEndsAt, lockoutEndsAt]);

  // Message handler — called from App.tsx
  const handleStopMessage = useCallback((msg: any) => {
    switch (msg.type) {
      case 'stop:sync': {
        setPhase(msg.phase);
        setYoutubeUrl(msg.youtubeUrl);
        setMessage(msg.message);
        if (msg.graceEndsAt) setGraceEndsAt(msg.graceEndsAt);
        if (msg.lockoutEndsAt) setLockoutEndsAt(msg.lockoutEndsAt);
        // Show warning if we joined during grace and there's still > 9 min
        if (msg.phase === 'grace' && msg.graceEndsAt) {
          const remaining = msg.graceEndsAt - Date.now();
          if (remaining > 9 * 60 * 1000) {
            setShowWarning(true);
            warningTimerRef.current = setTimeout(() => setShowWarning(false), 8000);
          }
        }
        break;
      }
      case 'stop:warning': {
        setPhase('grace');
        setYoutubeUrl(msg.youtubeUrl);
        setMessage(msg.message);
        setGraceEndsAt(msg.graceEndsAt);
        setShowWarning(true);
        // Auto-shrink warning after 8 seconds
        if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
        warningTimerRef.current = setTimeout(() => setShowWarning(false), 8000);
        break;
      }
      case 'stop:lockout': {
        setPhase('lockout');
        setLockoutEndsAt(msg.lockoutEndsAt);
        setShowWarning(false);
        break;
      }
      case 'stop:clear': {
        setPhase('idle');
        setYoutubeUrl(undefined);
        setMessage(undefined);
        setGraceEndsAt(0);
        setLockoutEndsAt(0);
        setShowWarning(false);
        break;
      }
    }
  }, []);

  const activate = useCallback((url?: string, msg?: string) => {
    sendMessage?.({
      type: 'stop:activate',
      youtubeUrl: url || undefined,
      message: msg || undefined,
    });
  }, [sendMessage]);

  const dismissWarning = useCallback(() => {
    setShowWarning(false);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    };
  }, []);

  return {
    phase,
    youtubeUrl,
    message,
    graceRemaining,
    lockoutRemaining,
    showWarning,
    activate,
    dismissWarning,
    handleStopMessage,
  };
}
