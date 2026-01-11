import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../../services/api';

interface CommandBuilderProps {
  onExecute: (command: string) => void;
}

interface HistoryEntry {
  command: string;
  count: number;
  lastUsed: string;
}

interface Suggestion {
  command: string;
  description?: string;
  category?: string;
  score?: number;
  source?: 'template' | 'history' | 'system';
  templateId?: string;
  variables?: { name: string; default?: string; required?: boolean; description?: string }[];
  contextBoosts?: string[];
  count: number;
  lastUsed: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  git: '#f97316',
  docker: '#3b82f6',
  npm: '#ef4444',
  system: '#8b5cf6',
  ssh: '#10b981',
  claude: '#00d4ff',
  'claude-meta': '#06b6d4',
  'claude-automation': '#a855f7',
  'claude-session': '#ec4899',
  history: '#6b7280',
  custom: '#eab308',
};

export default function CommandBuilder({ onExecute }: CommandBuilderProps) {
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
  const [validation, setValidation] = useState<{ valid: boolean; warnings: string[]; errors: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const response = await apiClient.get<HistoryEntry[]>('/commands/history?limit=20');
      setHistory(response.data || []);
    } catch (err) {
      console.error('Failed to load command history:', err);
    }
  };

  const fetchSuggestions = useCallback(async (prefix: string) => {
    if (prefix.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      const response = await apiClient.get<Suggestion[]>(`/commands/suggestions?prefix=${encodeURIComponent(prefix)}&limit=15`);
      setSuggestions(response.data || []);
      setShowSuggestions(true);
      setSelectedSuggestion(-1);
    } catch (err) {
      console.error('Failed to fetch suggestions:', err);
    }
  }, []);

  const validateCommand = useCallback(async (cmd: string) => {
    if (!cmd.trim()) {
      setValidation(null);
      return;
    }

    try {
      const response = await apiClient.post<{ valid: boolean; warnings: string[]; errors: string[] }>('/commands/validate', { command: cmd });
      setValidation(response.data || null);
    } catch (err) {
      console.error('Failed to validate command:', err);
    }
  }, []);

  const handleInputChange = (value: string) => {
    setCommand(value);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value);
      validateCommand(value);
    }, 150);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Enter' && command.trim()) {
        e.preventDefault();
        handleExecute();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedSuggestion((prev) => Math.min(prev + 1, suggestions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedSuggestion((prev) => Math.max(prev - 1, -1));
        break;
      case 'Tab':
      case 'Enter':
        e.preventDefault();
        if (selectedSuggestion >= 0) {
          setCommand(suggestions[selectedSuggestion].command);
          setShowSuggestions(false);
        } else if (e.key === 'Enter' && command.trim()) {
          handleExecute();
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
    }
  };

  const handleExecute = () => {
    if (!command.trim()) return;
    
    if (validation && validation.errors.length > 0) {
      return;
    }

    onExecute(command);
    setTimeout(() => onExecute('\r'), 50);
    setCommand('');
    setShowSuggestions(false);
    setValidation(null);
    loadHistory();
  };

  const handleHistoryClick = (cmd: string) => {
    setCommand(cmd);
    inputRef.current?.focus();
    validateCommand(cmd);
  };

  const handleHistorySend = (cmd: string) => {
    onExecute(cmd);
    setTimeout(() => {
      onExecute('\r');
    }, 50);
  };

  const getCategoryColor = (category?: string) => {
    return CATEGORY_COLORS[category || 'history'] || CATEGORY_COLORS.history;
  };

  return (
    <div className="h-full flex flex-col p-4">
      <div className="relative mb-4">
        <div className="flex items-center gap-3 bg-[#08080e] border border-[#00d4ff]/10 rounded-lg px-3 py-2 focus-within:border-[#00d4ff]/30 focus-within:shadow-[0_0_12px_rgba(0,212,255,0.1)] transition-all duration-200">
          <span className="text-[#00d4ff] font-mono text-base drop-shadow-[0_0_4px_rgba(0,212,255,0.5)]">&gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => command.length >= 2 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-[#f0f0f4] font-mono text-base outline-none placeholder:text-[#3a3a42]"
          />
          <button
            onClick={handleExecute}
            disabled={!command.trim() || (validation?.errors?.length ?? 0) > 0}
            className="px-4 py-1.5 bg-[#00d4ff]/10 text-[#00d4ff] text-sm font-semibold tracking-wide rounded-md hover:bg-[#00d4ff]/20 hover:shadow-[0_0_12px_rgba(0,212,255,0.2)] border border-[#00d4ff]/20 transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:shadow-none"
          >
            RUN
          </button>
        </div>

        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-[#06060c] border border-[#00d4ff]/10 rounded-lg shadow-xl shadow-black/50 z-10 max-h-64 overflow-y-auto">
            {suggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.templateId || index}-${suggestion.command}`}
                onClick={() => {
                  setCommand(suggestion.command);
                  setShowSuggestions(false);
                }}
                className={`w-full text-left px-3 py-2.5 border-b border-[#ffffff]/[0.02] last:border-0 ${
                  index === selectedSuggestion
                    ? 'bg-[#00d4ff]/10'
                    : 'hover:bg-[#ffffff]/[0.02]'
                } transition-colors`}
              >
                <div className="flex items-start gap-2">
                  <div
                    className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0"
                    style={{ backgroundColor: getCategoryColor(suggestion.category) }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-sm truncate ${
                        index === selectedSuggestion ? 'text-[#00d4ff]' : 'text-[#e0e0e4]'
                      }`}>
                        {suggestion.command}
                      </span>
                      {suggestion.contextBoosts && suggestion.contextBoosts.length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-[#10b981]/20 text-[#10b981] rounded font-medium">
                          context
                        </span>
                      )}
                    </div>
                    {suggestion.description && (
                      <div className="text-[11px] text-[#6b6b73] mt-0.5 truncate">
                        {suggestion.description}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {suggestion.category && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-medium opacity-80"
                        style={{
                          backgroundColor: `${getCategoryColor(suggestion.category)}20`,
                          color: getCategoryColor(suggestion.category),
                        }}
                      >
                        {suggestion.category}
                      </span>
                    )}
                    {suggestion.source === 'history' && suggestion.count > 0 && (
                      <span className="text-[10px] text-[#8a8a92] font-mono">
                        x{suggestion.count}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {validation && (
        <div className="mb-4 space-y-1">
          {validation.errors.map((error, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 bg-[#ef4444]/5 border border-[#ef4444]/20 rounded-lg text-[13px] text-[#ef4444]">
              <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span>{error}</span>
            </div>
          ))}
          {validation.warnings.map((warning, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 bg-[#eab308]/5 border border-[#eab308]/20 rounded-lg text-[13px] text-[#eab308]">
              <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-4 bg-gradient-to-b from-[#00d4ff]/60 to-transparent rounded-full" />
          <h3 className="text-[12px] font-semibold text-[#a1a1aa] uppercase tracking-wider">Recent Commands</h3>
        </div>
        <div className="space-y-1 overflow-y-auto max-h-full">
          {history.length === 0 ? (
            <p className="text-xs text-[#3a3a42] italic px-3 py-4 text-center">No command history yet</p>
          ) : (
            history.map((entry, index) => (
              <div
                key={index}
                className="flex items-center gap-2 px-3 py-2 bg-[#08080e] hover:bg-[#0c0c14] border border-transparent hover:border-[#00d4ff]/10 rounded-lg transition-all duration-150 group"
              >
                <button
                  onClick={() => handleHistoryClick(entry.command)}
                  className="flex-1 text-left min-w-0"
                >
                  <span className="font-mono text-sm text-[#a1a1aa] truncate block group-hover:text-[#c0c0c8] transition-colors">
                    {entry.command}
                  </span>
                </button>
                <span className="text-[12px] text-[#8a8a92] shrink-0 font-medium">
                  {new Date(entry.lastUsed).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                <button
                  onClick={() => handleHistorySend(entry.command)}
                  className="px-2 py-1 bg-[#00d4ff]/10 text-[#00d4ff] text-[12px] font-semibold rounded hover:bg-[#00d4ff]/20 border border-[#00d4ff]/20 transition-all opacity-0 group-hover:opacity-100"
                  title="Send command"
                >
                  SEND
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
