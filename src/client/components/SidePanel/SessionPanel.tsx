import { useState, useEffect } from 'react';
import { apiClient } from '../../services/api';

interface Session {
  id: string;
  name: string;
  autoName: string | null;
  state: string;
  createdAt: string;
  lastActiveAt: string;
  timeoutHours: number;
  workingDirectory: string;
}

interface SessionPanelProps {
  currentSessionId?: string;
  onSwitchSession: (sessionId: string) => void;
}

export default function SessionPanel({ currentSessionId, onSwitchSession }: SessionPanelProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const response = await apiClient.get<Session[]>('/sessions');
      setSessions(response.data || []);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoading(false);
    }
  };

  const createSession = async () => {
    setCreating(true);
    try {
      const response = await apiClient.post<Session>('/sessions', { name: `Session ${sessions.length + 1}` });
      if (response.data) {
        setSessions(prev => [...prev, response.data!]);
      }
    } catch (err) {
      console.error('Failed to create session:', err);
    } finally {
      setCreating(false);
    }
  };

  const updateSession = async (id: string, name: string) => {
    try {
      await apiClient.put(`/sessions/${id}`, { name });
      setSessions(prev => prev.map(s => s.id === id ? { ...s, name } : s));
    } catch (err) {
      console.error('Failed to update session:', err);
    }
  };

  const deleteSession = async (id: string) => {
    if (sessions.length <= 1) return;
    if (!confirm('Delete this session? This cannot be undone.')) return;
    
    try {
      await apiClient.delete(`/sessions/${id}`);
      setSessions(prev => prev.filter(s => s.id !== id));
      if (currentSessionId === id && sessions.length > 1) {
        const remaining = sessions.filter(s => s.id !== id);
        if (remaining.length > 0) {
          onSwitchSession(remaining[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00d4ff]"></div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 bg-gradient-to-b from-[#00d4ff] to-[#00d4ff]/20 rounded-full" />
          <h3 className="text-sm font-semibold text-[#e0e0e8] uppercase tracking-wider">Sessions</h3>
        </div>
        <button
          onClick={createSession}
          disabled={creating || sessions.length >= 50}
          className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold bg-[#00d4ff]/10 text-[#00d4ff] rounded-lg border border-[#00d4ff]/20 hover:bg-[#00d4ff]/15 hover:shadow-[0_0_12px_rgba(0,212,255,0.2)] transition-all duration-200 disabled:opacity-30"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`px-4 py-3 rounded-lg transition-all duration-200 cursor-pointer ${
              currentSessionId === session.id
                ? 'bg-[#00d4ff]/5 border border-[#00d4ff]/20 shadow-[0_0_12px_rgba(0,212,255,0.1)]'
                : 'bg-[#08080e] border border-[#00d4ff]/5 hover:border-[#00d4ff]/15 hover:bg-[#0c0c14]'
            }`}
            onClick={() => onSwitchSession(session.id)}
          >
            <div className="flex items-center justify-between">
              {editingId === session.id ? (
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => {
                    if (editingName.trim()) {
                      updateSession(session.id, editingName.trim());
                    }
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (editingName.trim()) {
                        updateSession(session.id, editingName.trim());
                      }
                      setEditingId(null);
                    } else if (e.key === 'Escape') {
                      setEditingId(null);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                  className="bg-[#14141a] border border-[#00b8db]/40 rounded px-2 py-1 text-[13px] text-white outline-none w-32"
                />
              ) : (
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${session.state === 'active' ? 'bg-[#22c55e] shadow-[0_0_6px_rgba(34,197,94,0.5)]' : 'bg-[#71717a]'}`} />
                  <span
                    className="text-sm text-[#e0e0e8] font-medium cursor-text"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingId(session.id);
                      setEditingName(session.name);
                    }}
                  >
                    {session.name}
                  </span>
                  {currentSessionId === session.id && (
                    <span className="text-[10px] text-[#00d4ff] bg-[#00d4ff]/10 px-2 py-0.5 rounded-md font-semibold tracking-wide">ACTIVE</span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-0.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(session.id);
                    setEditingName(session.name);
                  }}
                  className="p-1 text-[#71717a] hover:text-[#a1a1aa] rounded transition-colors"
                  title="Rename"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                {sessions.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(session.id);
                    }}
                    className="p-1 text-[#71717a] hover:text-[#c04040] rounded transition-colors"
                    title="Delete"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-[#8a8a92]">
              <span>{formatTimeAgo(session.lastActiveAt)}</span>
              <div className="w-px h-3 bg-[#00d4ff]/10" />
              <span>{session.timeoutHours}h timeout</span>
            </div>
            {session.autoName && (
              <div className="mt-1.5 text-[11px] text-[#8a8a92] italic truncate">
                {session.autoName}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-[#00d4ff]/5">
        <div className="text-[11px] text-[#8a8a92] flex items-center justify-between">
          <span>{sessions.length}/50 sessions</span>
          <span className="text-[#00d4ff]/40 font-mono text-[10px]">{Math.round((sessions.length / 50) * 100)}%</span>
        </div>
      </div>
    </div>
  );
}
