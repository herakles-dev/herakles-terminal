import { useState, useEffect } from 'react';
import { apiClient } from '../../services/api';

interface Session {
  id: string;
  name: string;
  autoName?: string;
  state: string;
  createdAt: string;
  lastActiveAt: string;
  timeoutHours: number;
  workingDirectory: string;
}

interface SessionPickerProps {
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
}

export default function SessionPicker({ onSelect, onCreate }: SessionPickerProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<{ data: Session[] }>('/sessions');
      setSessions(response.data?.data || []);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this session? This cannot be undone.')) return;

    try {
      await apiClient.delete(`/sessions/${sessionId}`);
      setSessions(sessions.filter(s => s.id !== sessionId));
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const filteredSessions = sessions.filter(s => {
    const query = searchQuery.toLowerCase();
    return s.name.toLowerCase().includes(query) ||
           (s.autoName?.toLowerCase().includes(query)) ||
           s.id.toLowerCase().includes(query);
  });

  const getStateColor = (state: string) => {
    switch (state) {
      case 'active': return 'bg-[#22c55e]';
      case 'dormant': return 'bg-[#f59e0b]';
      default: return 'bg-[#71717a]';
    }
  };

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-2xl bg-[#0a0a0f] border border-[#27272a] rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-[#27272a]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">Sessions</h2>
            <button
              onClick={onCreate}
              className="flex items-center gap-2 px-4 py-2 bg-[#00d4ff]/10 text-[#00d4ff] rounded-lg hover:bg-[#00d4ff]/20 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Session
            </button>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sessions..."
            className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-4 py-2 text-white placeholder:text-[#52525b] focus:border-[#00d4ff]/50 focus:outline-none"
          />
        </div>

        <div className="max-h-96 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-2 border-[#00d4ff] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-[#71717a]">
                {sessions.length === 0 ? 'No sessions yet' : 'No matching sessions'}
              </p>
              {sessions.length === 0 && (
                <button
                  onClick={onCreate}
                  className="mt-4 text-[#00d4ff] hover:underline"
                >
                  Create your first session
                </button>
              )}
            </div>
          ) : (
            filteredSessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSelect(session.id)}
                className="w-full text-left p-4 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] hover:border-[#00d4ff]/30 rounded-xl transition-all group"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${getStateColor(session.state)}`} />
                    <span className="font-medium text-white group-hover:text-[#00d4ff]">
                      {session.autoName || session.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#52525b]">
                      {formatRelativeTime(session.lastActiveAt)}
                    </span>
                    <button
                      onClick={(e) => handleDelete(session.id, e)}
                      className="p-1 text-[#52525b] hover:text-[#ef4444] opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-[#71717a]">
                  <span className="font-mono">{session.workingDirectory}</span>
                  <span className="px-2 py-0.5 bg-[#27272a] rounded capitalize">{session.state}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
