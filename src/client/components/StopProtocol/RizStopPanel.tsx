import { useState, useEffect, useRef, useCallback } from 'react';
import type { StopProtocolPhase } from '@shared/stopProtocol';

interface RizStopPanelProps {
  phase: StopProtocolPhase;
  graceRemaining: number;
  lockoutRemaining: number;
  onActivate: (youtubeUrl?: string, message?: string) => void;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatClock(date: Date, tz: string): string {
  try {
    return date.toLocaleTimeString('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return date.toLocaleTimeString('en-US');
  }
}

const TIMEZONES = [
  { label: 'CST', value: 'America/Chicago' },
  { label: 'EST', value: 'America/New_York' },
  { label: 'MST', value: 'America/Denver' },
  { label: 'PST', value: 'America/Los_Angeles' },
  { label: 'UTC', value: 'UTC' },
];

export function RizStopPanel({ phase, graceRemaining, lockoutRemaining, onActivate }: RizStopPanelProps) {
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [message, setMessage] = useState('');
  const [timezone, setTimezone] = useState('America/Chicago');
  const [clock, setClock] = useState('');
  const [confirming, setConfirming] = useState(false);
  const clockRef = useRef<NodeJS.Timeout | null>(null);

  // Live clock
  useEffect(() => {
    const tick = () => setClock(formatClock(new Date(), timezone));
    tick();
    clockRef.current = setInterval(tick, 1000);
    return () => { if (clockRef.current) clearInterval(clockRef.current); };
  }, [timezone]);

  const handleActivate = useCallback(() => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    onActivate(youtubeUrl || undefined, message || undefined);
    setConfirming(false);
    setYoutubeUrl('');
    setMessage('');
  }, [confirming, youtubeUrl, message, onActivate]);

  const handleCancel = useCallback(() => {
    setConfirming(false);
  }, []);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#0a0a0a',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      color: '#fff',
      zIndex: 10000,
      padding: '20px',
    }}>
      {/* Clock */}
      <div style={{
        fontSize: '64px',
        fontWeight: 700,
        color: '#ff4444',
        marginBottom: '8px',
        textShadow: '0 0 30px rgba(255, 68, 68, 0.5)',
        letterSpacing: '4px',
      }}>
        {clock}
      </div>

      {/* Timezone selector */}
      <div style={{ marginBottom: '40px', display: 'flex', gap: '8px' }}>
        {TIMEZONES.map(tz => (
          <button
            key={tz.value}
            onClick={() => setTimezone(tz.value)}
            style={{
              padding: '4px 12px',
              background: timezone === tz.value ? '#ff4444' : '#1a1a1a',
              border: `1px solid ${timezone === tz.value ? '#ff4444' : '#333'}`,
              color: timezone === tz.value ? '#fff' : '#888',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontFamily: 'inherit',
            }}
          >
            {tz.label}
          </button>
        ))}
      </div>

      {/* Status */}
      {phase !== 'idle' && (
        <div style={{
          marginBottom: '30px',
          padding: '16px 32px',
          borderRadius: '8px',
          background: phase === 'grace' ? 'rgba(255, 170, 0, 0.15)' : 'rgba(255, 68, 68, 0.15)',
          border: `1px solid ${phase === 'grace' ? '#ffaa00' : '#ff4444'}`,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '14px', color: phase === 'grace' ? '#ffaa00' : '#ff4444', marginBottom: '4px' }}>
            {phase === 'grace' ? 'GRACE PERIOD ACTIVE' : 'LOCKOUT ACTIVE'}
          </div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#fff' }}>
            {phase === 'grace' ? formatTime(graceRemaining) : formatTime(lockoutRemaining)}
          </div>
        </div>
      )}

      {/* Input fields */}
      {phase === 'idle' && (
        <>
          <input
            type="text"
            value={youtubeUrl}
            onChange={e => setYoutubeUrl(e.target.value)}
            placeholder="YouTube link (optional)"
            style={{
              width: '100%',
              maxWidth: '500px',
              padding: '12px 16px',
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '14px',
              fontFamily: 'inherit',
              marginBottom: '12px',
              outline: 'none',
            }}
          />
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Message to display (optional)"
            rows={2}
            style={{
              width: '100%',
              maxWidth: '500px',
              padding: '12px 16px',
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '14px',
              fontFamily: 'inherit',
              marginBottom: '30px',
              outline: 'none',
              resize: 'none',
            }}
          />
        </>
      )}

      {/* STOP Button */}
      {phase === 'idle' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={handleActivate}
            style={{
              width: '200px',
              height: '200px',
              borderRadius: '50%',
              background: confirming
                ? 'radial-gradient(circle, #ff0000 0%, #990000 100%)'
                : 'radial-gradient(circle, #cc0000 0%, #660000 100%)',
              border: `4px solid ${confirming ? '#ff4444' : '#880000'}`,
              color: '#fff',
              fontSize: confirming ? '18px' : '32px',
              fontWeight: 900,
              fontFamily: 'inherit',
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '4px',
              boxShadow: confirming
                ? '0 0 60px rgba(255, 0, 0, 0.8), inset 0 0 30px rgba(0,0,0,0.3)'
                : '0 0 40px rgba(255, 0, 0, 0.4), inset 0 0 20px rgba(0,0,0,0.3)',
              animation: confirming ? 'stopPulse 0.5s ease-in-out infinite' : 'stopPulse 2s ease-in-out infinite',
              transition: 'all 0.3s ease',
            }}
          >
            {confirming ? 'CONFIRM?' : 'STOP'}
          </button>

          {confirming && (
            <button
              onClick={handleCancel}
              style={{
                padding: '8px 24px',
                background: 'transparent',
                border: '1px solid #555',
                color: '#888',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Title */}
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: '11px',
        color: '#444',
        letterSpacing: '6px',
        textTransform: 'uppercase',
      }}>
        Zeus Stop Protocol
      </div>

      <style>{`
        @keyframes stopPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}
