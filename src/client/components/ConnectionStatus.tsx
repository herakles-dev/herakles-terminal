import { useState, useEffect } from 'react';

interface ConnectionStatusProps {
  state: 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
  sessionId?: string;
  reconnectIn?: number | null;
  onReconnectNow?: () => void;
  latency?: number | null;
}

export default function ConnectionStatus({ 
  state, 
  sessionId, 
  reconnectIn, 
  onReconnectNow,
  latency
}: ConnectionStatusProps) {
  const [showStatus, setShowStatus] = useState(true);

  useEffect(() => {
    if (state === 'connected') {
      const timer = setTimeout(() => setShowStatus(false), 3000);
      return () => clearTimeout(timer);
    } else {
      setShowStatus(true);
    }
  }, [state]);

  const statusConfig = {
    connecting: { text: 'Connecting...', color: 'bg-[#00d4ff]', textColor: 'text-[#00d4ff]', animate: true },
    connected: { text: 'Connected', color: 'bg-[#22c55e]', textColor: 'text-[#22c55e]', animate: false },
    disconnected: { text: 'Disconnected', color: 'bg-[#ef4444]', textColor: 'text-[#ef4444]', animate: false },
    reconnecting: { text: 'Reconnecting', color: 'bg-[#eab308]', textColor: 'text-[#eab308]', animate: true },
  };

  const config = statusConfig[state];

  return (
    <div className="flex items-center gap-3">
      <div className={`flex items-center gap-2 transition-opacity duration-300 ${!showStatus && state === 'connected' ? 'opacity-0' : 'opacity-100'}`}>
        <div className={`w-2.5 h-2.5 rounded-full ${config.color} ${config.animate ? 'animate-pulse' : ''} shadow-[0_0_6px_currentColor]`} />
        <span className={`text-sm font-medium ${config.textColor}`}>
          {state === 'reconnecting' && reconnectIn !== null && reconnectIn !== undefined
            ? `Reconnecting in ${reconnectIn}s`
            : config.text
          }
        </span>
        
        {state === 'reconnecting' && onReconnectNow && (
          <button
            onClick={onReconnectNow}
            className="text-sm text-[#eab308] hover:text-[#fbbf24] underline ml-1"
          >
            Now
          </button>
        )}
        
        {state === 'connected' && latency !== null && latency !== undefined && (
          <span className="text-[12px] text-[#8a8a92]">{latency}ms</span>
        )}
      </div>
      
      {sessionId && showStatus && (
        <div className="flex items-center gap-2 text-sm text-[#8a8a92]">
          <div className="w-px h-4 bg-[#27272a]" />
          <span className="font-mono">{sessionId.slice(0, 8)}</span>
        </div>
      )}
    </div>
  );
}
