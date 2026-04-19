import { useState, useEffect, useCallback, useRef } from 'react';
import AutomationPanel from './AutomationPanel';
import CommandBuilder from './CommandBuilder';
import TemplatePanel from './TemplatePanel';
import SessionPanel from './SessionPanel';
import SettingsPanel from './SettingsPanel';
import UploadPanel from './UploadPanel';
import CanvasPanel from './CanvasPanel';
import { MetricsPanel } from './MetricsPanel';
import type { Artifact } from '../../types/canvas';
import type { ContextUsage } from '../../../shared/contextProtocol';

interface SidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  onExecuteCommand: (command: string) => void;
  sessionId?: string;
  onSwitchSession?: (sessionId: string) => void;
  onPreferencesChange?: (prefs: { fontSize: number }) => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  canvasArtifacts?: Artifact[];
  canvasActiveId?: string | null;
  canvasViewMode?: 'code' | 'preview';
  canvasUnreadCount?: number;
  onCanvasSelectArtifact?: (id: string) => void;
  onCanvasClear?: () => void;
  onCanvasToggleViewMode?: () => void;
  onCanvasTabOpened?: () => void;
  onCanvasRemoveArtifact?: (id: string) => void;
  onCanvasToggleStar?: (id: string) => void;
  onCanvasSendToTerminal?: (content: string) => void;
  showLightning?: boolean;
  onLightningChange?: (enabled: boolean) => void;
  // Metrics tab props — wired in App.tsx (Task 10)
  metricsWs?: WebSocket | null;
  metricsActiveWindowId?: string | null;
  metricsActiveWindowName?: string | null;
  /** Full window list for the per-window picker inside the Metrics tab. */
  metricsWindows?: Array<{ id: string; name: string; isMain: boolean }>;
  /** Per-window context usage map — drives picker badges and tint. */
  metricsContextUsage?: Map<string, ContextUsage>;
}

type TabId = 'automations' | 'commands' | 'templates' | 'sessions' | 'settings' | 'uploads' | 'canvas' | 'metrics';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  {
    id: 'commands',
    label: 'CMD',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="square" d="M7 8l4 4-4 4M13 16h4" />
      </svg>
    ),
  },
  {
    id: 'templates',
    label: 'TPL',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="square" d="M4 6h16M4 12h8M4 18h16" />
      </svg>
    ),
  },
  {
    id: 'automations',
    label: 'AUTO',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="square" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    id: 'sessions',
    label: 'SESS',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="square" d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
      </svg>
    ),
  },
  {
    id: 'uploads',
    label: 'FILES',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="square" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3v-8" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'CONF',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="square" d="M12 6V4m0 16v-2m6-6h2M4 12h2m12.5-4.5l1.4-1.4M4.1 19.9l1.4-1.4m12.5 1.4l1.4 1.4M4.1 4.1l1.4 1.4M12 8a4 4 0 100 8 4 4 0 000-8z" />
      </svg>
    ),
  },
  {
    id: 'canvas',
    label: 'CANVAS',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="square" d="M4 5h16v14H4zM8 9h8M8 13h5" />
      </svg>
    ),
  },
  {
    id: 'metrics',
    label: 'METRICS',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="square" d="M3 3v18h18M7 16l4-4 4 4 4-6" />
      </svg>
    ),
  },
];

export default function SidePanel({
  isOpen,
  onClose,
  onExecuteCommand,
  sessionId,
  onSwitchSession,
  onPreferencesChange,
  isExpanded = false,
  onToggleExpand,
  canvasArtifacts,
  canvasActiveId,
  canvasViewMode,
  canvasUnreadCount,
  onCanvasSelectArtifact,
  onCanvasClear,
  onCanvasToggleViewMode,
  onCanvasTabOpened,
  onCanvasRemoveArtifact,
  onCanvasToggleStar,
  onCanvasSendToTerminal,
  showLightning,
  onLightningChange,
  metricsWs = null,
  metricsActiveWindowId = null,
  metricsActiveWindowName = null,
  metricsWindows,
  metricsContextUsage,
}: SidePanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('commands');
  const [isClosing, setIsClosing] = useState(false);
  const [expandHover, setExpandHover] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const panelWidth = isExpanded ? '55vw' : '380px';

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 200);
  }, [onClose]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose();
    }
  }, [handleClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now(),
    };
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const deltaY = Math.abs(e.changedTouches[0].clientY - touchStartRef.current.y);
    const deltaTime = Date.now() - touchStartRef.current.time;
    
    if (deltaX > 80 && deltaY < 100 && deltaTime < 500) {
      handleClose();
    }
    
    touchStartRef.current = null;
  }, [handleClose]);

  if (!isOpen) return null;

  return (
    <>
      <div 
        className={`fixed inset-0 bg-black/70 backdrop-blur-md z-40 sm:hidden transition-opacity duration-200 ${
          isClosing ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={handleClose}
      />
      <div 
        ref={panelRef}
        className={`fixed inset-y-0 w-full bg-gradient-to-b from-[#07070c] to-[#050508] border-l border-white/[0.04] shadow-[-8px_0_40px_rgba(0,0,0,0.5)] z-50 flex flex-col transition-all duration-300 ease-out ${
          isClosing ? 'translate-x-full' : 'translate-x-0'
        } ${!isClosing ? 'animate-slide-in-right sm:animate-none' : ''}`}
        style={{ right: '0px', width: typeof window !== 'undefined' && window.innerWidth >= 640 ? panelWidth : '100%' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseEnter={() => setExpandHover(true)}
        onMouseLeave={() => setExpandHover(false)}
      >
        {onToggleExpand && (
          <button
            onClick={onToggleExpand}
            className={`hidden sm:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full items-center justify-center w-5 h-20 bg-gradient-to-l from-[#0c0c14] to-[#07070c] border border-white/[0.06] border-r-0 rounded-l-lg text-[#4a4a52] hover:text-[#00d4ff] transition-all duration-200 z-50 shadow-[-4px_0_12px_rgba(0,0,0,0.3)] ${
              expandHover ? 'opacity-100' : 'opacity-0 hover:opacity-100'
            }`}
            title={isExpanded ? 'Collapse panel' : 'Expand panel'}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              {isExpanded ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
              )}
            </svg>
          </button>
        )}
        <div className="relative flex items-center justify-between px-4 py-3.5 border-b border-white/[0.04] bg-gradient-to-r from-[#07070c] via-[#0c0c14] to-[#07070c] safe-area-top">
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#00d4ff]/15 to-transparent" />
          <div className="flex items-center gap-3">
            <div className="w-1 h-5 bg-gradient-to-b from-[#00d4ff] via-[#8b5cf6] to-transparent rounded-full shadow-[0_0_8px_rgba(0,212,255,0.4)]" />
            <span className="text-sm font-semibold tracking-wider text-[#e0e0e8] uppercase">Tools</span>
            <span className="text-[11px] text-[#71717a] sm:hidden">← swipe</span>
          </div>
          <button
            onClick={handleClose}
            className="w-9 h-9 flex items-center justify-center text-[#8a8a92] hover:text-[#f87171] hover:bg-[#ef4444]/10 border border-transparent hover:border-[#ef4444]/20 transition-all duration-200 rounded-lg focus-ring"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="bg-gradient-to-b from-[#08080d] to-[#050508] border-b border-white/[0.04] px-4 py-4">
          <div className="flex flex-wrap gap-1.5 justify-center">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === 'canvas' && onCanvasTabOpened) {
                    onCanvasTabOpened();
                  }
                }}
                title={tab.label}
                className={`relative flex items-center gap-2 py-2.5 px-4 rounded-lg text-[12px] font-medium tracking-wide transition-all duration-200 focus-ring ${
                  activeTab === tab.id
                    ? 'text-[#00d4ff] bg-gradient-to-br from-[#00d4ff]/12 via-[#00d4ff]/8 to-[#8b5cf6]/5 border border-[#00d4ff]/25 shadow-[0_0_20px_rgba(0,212,255,0.12),inset_0_1px_0_rgba(255,255,255,0.06)]'
                    : 'text-[#a1a1aa] hover:text-[#b0b0b8] hover:bg-white/[0.04] border border-transparent hover:border-white/[0.06]'
                }`}
              >
                <span className={`transition-all duration-200 ${activeTab === tab.id ? 'text-[#00d4ff] drop-shadow-[0_0_8px_rgba(0,212,255,0.5)]' : ''}`}>{tab.icon}</span>
                <span className="hidden sm:inline">{tab.label}</span>
                {tab.id === 'canvas' && canvasUnreadCount && canvasUnreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] flex items-center justify-center text-[11px] font-bold bg-gradient-to-r from-[#00d4ff] to-[#8b5cf6] text-black rounded-full px-1.5 shadow-[0_0_10px_rgba(0,212,255,0.5)]">
                    {canvasUnreadCount > 9 ? '9+' : canvasUnreadCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-hidden bg-[#050508] safe-area-bottom">
          {activeTab === 'commands' && (
            <CommandBuilder onExecute={onExecuteCommand} />
          )}
          {activeTab === 'templates' && (
            <TemplatePanel onExecute={onExecuteCommand} />
          )}
          {activeTab === 'automations' && (
            <AutomationPanel sessionId={sessionId} onExecute={onExecuteCommand} />
          )}
          {activeTab === 'sessions' && (
            <SessionPanel currentSessionId={sessionId} onSwitchSession={onSwitchSession || (() => {})} />
          )}
          {activeTab === 'uploads' && (
            <UploadPanel />
          )}
          {activeTab === 'settings' && (
            <SettingsPanel
              onPreferencesChange={onPreferencesChange}
              showLightning={showLightning}
              onLightningChange={onLightningChange}
            />
          )}
          {activeTab === 'canvas' && (
            <CanvasPanel
              artifacts={canvasArtifacts || []}
              activeArtifactId={canvasActiveId || null}
              viewMode={canvasViewMode || 'preview'}
              onSelectArtifact={onCanvasSelectArtifact || (() => {})}
              onClear={onCanvasClear || (() => {})}
              onToggleViewMode={onCanvasToggleViewMode || (() => {})}
              onRemoveArtifact={onCanvasRemoveArtifact}
              onToggleStar={onCanvasToggleStar}
              onSendToTerminal={onCanvasSendToTerminal}
              isExpanded={isExpanded}
              onExpandPanel={onToggleExpand}
            />
          )}
          {activeTab === 'metrics' && (
            <MetricsPanel
              ws={metricsWs}
              activeWindowId={metricsActiveWindowId}
              activeWindowName={metricsActiveWindowName}
              windows={metricsWindows}
              contextUsage={metricsContextUsage}
            />
          )}
        </div>
      </div>
    </>
  );
}
