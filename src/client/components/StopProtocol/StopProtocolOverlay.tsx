import { useMemo } from 'react';
import type { StopProtocolPhase } from '@shared/stopProtocol';
import { LOCKOUT_DURATION_MS } from '@shared/stopProtocol';

interface StopProtocolOverlayProps {
  phase: StopProtocolPhase;
  youtubeUrl?: string;
  message?: string;
  graceRemaining: number;
  lockoutRemaining: number;
  showWarning: boolean;
  onDismissWarning: () => void;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function YouTubeEmbed({ videoId, size = 'large' }: { videoId: string; size?: 'large' | 'medium' }) {
  const maxW = size === 'large' ? '640px' : '480px';
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        width: '100%',
        maxWidth: maxW,
        aspectRatio: '16/9',
        marginBottom: '24px',
        borderRadius: '8px',
        overflow: 'hidden',
        boxShadow: '0 0 40px rgba(255, 0, 0, 0.3)',
        position: 'relative',
        zIndex: 1,
      }}>
      <iframe
        width="100%"
        height="100%"
        src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&loop=1&playlist=${videoId}`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        style={{ border: 'none' }}
      />
    </div>
  );
}

export function StopProtocolOverlay({
  phase,
  youtubeUrl,
  message,
  graceRemaining,
  lockoutRemaining,
  showWarning,
  onDismissWarning,
}: StopProtocolOverlayProps) {
  const videoId = useMemo(() => youtubeUrl ? extractYouTubeId(youtubeUrl) : null, [youtubeUrl]);

  if (phase === 'idle') return null;

  // -- Full-screen warning popup (first 8 seconds after activation) --
  if (showWarning && phase === 'grace') {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(0, 0, 0, 0.95)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        cursor: 'pointer',
      }} onClick={onDismissWarning}>

        {/* Flashing title */}
        <div style={{
          fontSize: '48px',
          fontWeight: 900,
          letterSpacing: '8px',
          textTransform: 'uppercase',
          animation: 'rizFlash 0.5s ease-in-out infinite',
          marginBottom: '30px',
          textAlign: 'center',
          padding: '0 20px',
        }}>
          RIZ STOP PROTOCOL
        </div>

        {/* YouTube embed */}
        {videoId && <YouTubeEmbed videoId={videoId} size="large" />}

        {/* Custom message */}
        {message && (
          <div style={{
            fontSize: '20px',
            color: '#ffaa00',
            maxWidth: '600px',
            textAlign: 'center',
            lineHeight: 1.6,
            marginBottom: '24px',
            padding: '0 20px',
          }}>
            {message}
          </div>
        )}

        {/* Grace countdown */}
        <div style={{
          fontSize: '16px',
          color: '#888',
          marginTop: '20px',
        }}>
          You have <span style={{ color: '#ffaa00', fontWeight: 700 }}>{formatTime(graceRemaining)}</span> to wrap up
        </div>

        <div style={{
          fontSize: '11px',
          color: '#444',
          marginTop: '16px',
        }}>
          click anywhere to dismiss
        </div>

        <style>{`
          @keyframes rizFlash {
            0%, 100% { color: #ff0000; text-shadow: 0 0 40px rgba(255, 0, 0, 0.8); }
            50% { color: #ffffff; text-shadow: 0 0 40px rgba(255, 255, 255, 0.8); }
          }
        `}</style>
      </div>
    );
  }

  // -- Grace period banner (terminal still usable) --
  if (phase === 'grace') {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99998,
        background: 'linear-gradient(180deg, rgba(255, 170, 0, 0.15) 0%, transparent 100%)',
        borderBottom: '1px solid rgba(255, 170, 0, 0.3)',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        backdropFilter: 'blur(4px)',
      }}>
        <span style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: '#ffaa00',
          animation: 'graceBlink 1s ease-in-out infinite',
        }} />
        <span style={{ color: '#ffaa00', fontSize: '13px', fontWeight: 600 }}>
          STOP PROTOCOL
        </span>
        <span style={{ color: '#ccc', fontSize: '13px' }}>
          {formatTime(graceRemaining)} remaining — save your work
        </span>

        <style>{`
          @keyframes graceBlink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
        `}</style>
      </div>
    );
  }

  // -- Lockout overlay (blocks all interaction, plays video) --
  if (phase === 'lockout') {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(0, 0, 0, 0.95)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        pointerEvents: 'all',
        userSelect: 'none',
      }}>
        <div style={{
          fontSize: '20px',
          fontWeight: 700,
          color: '#ff4444',
          letterSpacing: '8px',
          textTransform: 'uppercase',
          marginBottom: '24px',
        }}>
          LOCKED
        </div>

        {/* YouTube video plays during lockout */}
        {videoId && <YouTubeEmbed videoId={videoId} size="medium" />}

        {/* Countdown */}
        <div style={{
          fontSize: '56px',
          fontWeight: 700,
          color: '#fff',
          marginBottom: '16px',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '4px',
        }}>
          {formatTime(lockoutRemaining)}
        </div>

        <div style={{
          fontSize: '16px',
          color: '#666',
          maxWidth: '400px',
          textAlign: 'center',
          lineHeight: 1.6,
        }}>
          Zeus is sleeping. Go to bed.
        </div>

        {/* Progress bar */}
        <div style={{
          position: 'absolute',
          bottom: '40px',
          width: '300px',
          height: '2px',
          background: '#1a1a1a',
          borderRadius: '1px',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            background: '#ff4444',
            width: `${Math.max(0, (1 - lockoutRemaining / LOCKOUT_DURATION_MS) * 100)}%`,
            transition: 'width 1s linear',
          }} />
        </div>
      </div>
    );
  }

  return null;
}
