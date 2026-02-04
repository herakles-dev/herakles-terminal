import { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '../../services/api';

interface Preferences {
  fontSize: number;
  sessionTimeoutHours: number;
  timezone: string;
  quickKeyBarVisible: boolean;
  sidePanelDefaultTab: string;
  showLightning: boolean;
}

interface SettingsPanelProps {
  onPreferencesChange?: (prefs: Preferences) => void;
  showLightning?: boolean;
  onLightningChange?: (enabled: boolean) => void;
}

const TIMEOUT_OPTIONS = [1, 6, 12, 24, 48, 72, 168, 336, 720];

export default function SettingsPanel({ onPreferencesChange, showLightning = true, onLightningChange }: SettingsPanelProps) {
  const [preferences, setPreferences] = useState<Preferences>({
    fontSize: 14,
    sessionTimeoutHours: 168,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    quickKeyBarVisible: true,
    sidePanelDefaultTab: 'commands',
    showLightning: true,
  });
  const [localFontSize, setLocalFontSize] = useState(14);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadPreferences();
  }, []);

  useEffect(() => {
    setLocalFontSize(preferences.fontSize);
  }, [preferences.fontSize]);

  const loadPreferences = async () => {
    try {
      const response = await apiClient.get<Preferences>('/preferences');
      if (response.data) {
        setPreferences(response.data);
      }
    } catch (err) {
      console.error('Failed to load preferences:', err);
    } finally {
      setLoading(false);
    }
  };

  const savePreferences = useCallback(async (newPrefs: Partial<Preferences>) => {
    setSaving(true);
    try {
      const updated = { ...preferences, ...newPrefs };
      await apiClient.put('/preferences', updated);
      setPreferences(updated);
      onPreferencesChange?.(updated);
    } catch (err) {
      console.error('Failed to save preferences:', err);
    } finally {
      setSaving(false);
    }
  }, [preferences, onPreferencesChange]);

  const debouncedSaveFontSize = useCallback((size: number) => {
    setLocalFontSize(size);
    onPreferencesChange?.({ ...preferences, fontSize: size });
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      savePreferences({ fontSize: size });
    }, 500);
  }, [preferences, onPreferencesChange, savePreferences]);

  const formatTimeout = (hours: number): string => {
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''}`;
    const days = hours / 24;
    if (days < 7) return `${days} day${days > 1 ? 's' : ''}`;
    const weeks = days / 7;
    return `${weeks} week${weeks > 1 ? 's' : ''}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00d4ff]"></div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 overflow-y-auto">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-4 bg-gradient-to-b from-[#00d4ff] to-[#00d4ff]/20 rounded-full" />
        <h3 className="text-sm font-semibold text-[#e0e0e8] uppercase tracking-wider">Settings</h3>
      </div>

      <div className="space-y-4">
        <div className="bg-[#08080e] border border-[#00d4ff]/5 rounded-lg p-3">
          <label className="block text-[13px] font-semibold text-[#a0a0a8] mb-2">Font Size</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="10"
              max="20"
              value={localFontSize}
              onChange={(e) => debouncedSaveFontSize(parseInt(e.target.value))}
              className="flex-1 accent-[#00d4ff] h-1 cursor-pointer"
            />
            <span className="text-sm text-[#00d4ff] w-12 text-right font-mono font-semibold">{localFontSize}px</span>
          </div>
          <div className="flex justify-between mt-2 gap-2">
            {[10, 14, 20].map(size => (
              <button
                key={size}
                onClick={() => debouncedSaveFontSize(size)}
                className={`flex-1 text-[12px] py-1.5 rounded-md font-semibold transition-all duration-200 ${
                  localFontSize === size
                    ? 'bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/20'
                    : 'text-[#8a8a92] hover:text-[#a1a1aa] border border-transparent hover:border-[#00d4ff]/10'
                }`}
              >
                {size === 10 ? 'Small' : size === 14 ? 'Medium' : 'Large'}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-[#08080e] border border-[#00d4ff]/5 rounded-lg p-3">
          <label className="block text-[13px] font-semibold text-[#a0a0a8] mb-2">Session Timeout</label>
          <select
            value={preferences.sessionTimeoutHours}
            onChange={(e) => savePreferences({ sessionTimeoutHours: parseInt(e.target.value) })}
            className="w-full bg-[#06060c] border border-[#00d4ff]/10 rounded-lg px-3 py-2 text-sm text-[#e0e0e8] focus:border-[#00d4ff]/30 focus:shadow-[0_0_8px_rgba(0,212,255,0.1)] outline-none transition-all duration-200 cursor-pointer"
          >
            {TIMEOUT_OPTIONS.map(hours => (
              <option key={hours} value={hours}>{formatTimeout(hours)}</option>
            ))}
          </select>
          <p className="mt-2 text-[13px] text-[#8a8a92]">Automatically close inactive sessions</p>
        </div>

        <div className="bg-[#08080e] border border-[#00d4ff]/5 rounded-lg p-3">
          <label className="block text-[13px] font-semibold text-[#a0a0a8] mb-2">Default Tab</label>
          <select
            value={preferences.sidePanelDefaultTab}
            onChange={(e) => savePreferences({ sidePanelDefaultTab: e.target.value })}
            className="w-full bg-[#06060c] border border-[#00d4ff]/10 rounded-lg px-3 py-2 text-sm text-[#e0e0e8] focus:border-[#00d4ff]/30 focus:shadow-[0_0_8px_rgba(0,212,255,0.1)] outline-none transition-all duration-200 cursor-pointer"
          >
            <option value="commands">Commands</option>
            <option value="templates">Templates</option>
            <option value="automations">Automations</option>
            <option value="sessions">Sessions</option>
            <option value="settings">Settings</option>
          </select>
        </div>

        <div className="flex items-center justify-between bg-[#08080e] border border-[#00d4ff]/5 rounded-lg p-3">
          <div>
            <label className="text-[13px] font-semibold text-[#a0a0a8]">Quick Keys Bar</label>
            <p className="text-[13px] text-[#8a8a92] mt-0.5">Show keyboard shortcuts</p>
          </div>
          <button
            onClick={() => savePreferences({ quickKeyBarVisible: !preferences.quickKeyBarVisible })}
            className={`relative w-10 h-5 rounded-full transition-all duration-300 ${
              preferences.quickKeyBarVisible ? 'bg-[#00d4ff] shadow-[0_0_10px_rgba(0,212,255,0.4)]' : 'bg-[#1a1a20]'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-300 ${
                preferences.quickKeyBarVisible ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between bg-[#08080e] border border-[#00d4ff]/5 rounded-lg p-3">
          <div>
            <label className="text-[13px] font-semibold text-[#a0a0a8]">Lightning Effect</label>
            <p className="text-[13px] text-[#8a8a92] mt-0.5">Animated header accent</p>
          </div>
          <button
            onClick={() => onLightningChange?.(!showLightning)}
            className={`relative w-10 h-5 rounded-full transition-all duration-300 ${
              showLightning ? 'bg-[#00d4ff] shadow-[0_0_10px_rgba(0,212,255,0.4)]' : 'bg-[#1a1a20]'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-300 ${
                showLightning ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="pt-4 border-t border-[#00d4ff]/5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-3 bg-gradient-to-b from-[#00d4ff]/60 to-transparent rounded-full" />
            <h4 className="text-[12px] font-semibold text-[#a1a1aa] uppercase tracking-wider">Keyboard Shortcuts</h4>
          </div>
          <div className="space-y-2">
            {[
              { keys: ['⌘', '⇧', 'T'], action: 'New window' },
              { keys: ['⌘', 'B'], action: 'Toggle panel' },
              { keys: ['⌘', '1-6'], action: 'Switch window' },
              { keys: ['Esc'], action: 'Close panel' },
            ].map(({ keys, action }) => (
              <div key={action} className="flex items-center justify-between py-1">
                <span className="text-[13px] text-[#a1a1aa]">{action}</span>
                <div className="flex items-center gap-1">
                  {keys.map((key, i) => (
                    <kbd key={i} className="px-2 py-1 bg-[#08080e] border border-[#00d4ff]/10 rounded text-[11px] text-[#00d4ff]/70 font-mono">{key}</kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-[#00d4ff]/5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-3 bg-gradient-to-b from-[#00d4ff]/60 to-transparent rounded-full" />
            <h4 className="text-[12px] font-semibold text-[#a1a1aa] uppercase tracking-wider">About</h4>
          </div>
          <div className="bg-[#08080e] border border-[#00d4ff]/5 rounded-lg p-3 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-[13px] text-[#a1a1aa]">Version</span>
              <span className="text-[13px] text-[#00d4ff] font-mono">0.1.0</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[13px] text-[#a1a1aa]">Timezone</span>
              <span className="text-[12px] text-[#a1a1aa] font-mono truncate ml-2 max-w-[140px]">{preferences.timezone}</span>
            </div>
          </div>
        </div>
      </div>

      {saving && (
        <div className="fixed bottom-4 right-4 bg-[#08080e] border border-[#00d4ff]/20 rounded-lg px-3 py-2 text-[12px] text-[#00d4ff] shadow-lg shadow-[#00d4ff]/10 flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-[#00d4ff] border-t-transparent rounded-full animate-spin" />
          Saving...
        </div>
      )}
    </div>
  );
}
