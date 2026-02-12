import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { enableConsoleLoopback } from './utils/consoleLoopback';

// Enable console loopback for server-side debugging
enableConsoleLoopback();
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import QuickKeyBar from './components/QuickKeyBar/QuickKeyBar';
import ConnectionStatus from './components/ConnectionStatus';
import { SidePanel } from './components/SidePanel';
import { SplitView } from './components/SplitView';
import LoadingOverlay from './components/LoadingOverlay';
import TerminalMinimap from './components/TerminalMinimap';
import ContextMenu from './components/ContextMenu';
import { LayoutSelector, LAYOUT_PRESETS } from './components/LayoutSelector';
import { TerminalCore } from './components/TerminalCore';
import type { TerminalCoreHandle } from './components/TerminalCore';
import { MobileInputHandler } from './components/MobileInputHandler';
import { LightningOverlay } from './components/LightningOverlay';
import { ProjectNavigator } from './components/ProjectNavigator';
import { FileDropZone } from './components/FileDropZone';
import { UploadProgress } from './components/UploadProgress';
import { TodoPanel } from './components/TodoPanel';
import { MusicPlayer } from './components/MusicPlayer';
import type { SessionTodos } from '@shared/todoProtocol';
import type { MusicPlayerState } from '@shared/musicProtocol';
import type { ContextUsage, ContextSyncMessage, ContextUpdateMessage } from '@shared/contextProtocol';

import { useWebSocket, ConnectionState } from './hooks/useWebSocket';
import { useKeyboardHeight } from './hooks/useKeyboardHeight';
import { useMobileDetect } from './hooks/useMobileDetect';
import { useResizeCoordinator } from './hooks/useResizeCoordinator';
import { useCanvasArtifacts } from './hooks/useCanvasArtifacts';
import { useClipboardUpload } from './hooks/useClipboardUpload';
import { useHealthActions } from './hooks/useHealthActions';
import { useToast } from './components/Toast/Toast';
import { uploadService } from './services/uploadService';
import { OutputPipelineManager } from './services/OutputPipelineManager';
import { WebGLHealthMonitor, exposeMetricsToWindow } from './services/WebGLHealthMonitor';

import { ResizeCoordinatorContext } from './contexts/ResizeCoordinatorContext';


import { TERMINAL_DEFAULTS } from '@shared/constants';

interface WindowConfig {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  isMain: boolean;
  isMinimized: boolean;
}

type WindowLayout = { x: number; y: number; width: number; height: number };

function calculateWindowLayouts(windowCount: number): WindowLayout[] {
  const MAIN_WIDTH = 0.30;
  const RIGHT_START = 0.30;
  const RIGHT_WIDTH = 0.70;
  const HALF_RIGHT = RIGHT_WIDTH / 2;
  
  const layouts: WindowLayout[][] = [
    [{ x: 0, y: 0, width: 1, height: 1 }],
    
    [
      { x: 0, y: 0, width: MAIN_WIDTH, height: 1 },
      { x: RIGHT_START, y: 0, width: RIGHT_WIDTH, height: 1 },
    ],
    
    [
      { x: 0, y: 0, width: MAIN_WIDTH, height: 1 },
      { x: RIGHT_START, y: 0, width: RIGHT_WIDTH, height: 0.5 },
      { x: RIGHT_START, y: 0.5, width: RIGHT_WIDTH, height: 0.5 },
    ],
    
    [
      { x: 0, y: 0, width: MAIN_WIDTH, height: 1 },
      { x: RIGHT_START, y: 0, width: RIGHT_WIDTH, height: 0.5 },
      { x: RIGHT_START, y: 0.5, width: HALF_RIGHT, height: 0.5 },
      { x: RIGHT_START + HALF_RIGHT, y: 0.5, width: HALF_RIGHT, height: 0.5 },
    ],
    
    [
      { x: 0, y: 0, width: MAIN_WIDTH, height: 1 },
      { x: RIGHT_START, y: 0, width: HALF_RIGHT, height: 0.5 },
      { x: RIGHT_START + HALF_RIGHT, y: 0, width: HALF_RIGHT, height: 0.5 },
      { x: RIGHT_START, y: 0.5, width: HALF_RIGHT, height: 0.5 },
      { x: RIGHT_START + HALF_RIGHT, y: 0.5, width: HALF_RIGHT, height: 0.5 },
    ],
    
    [
      { x: 0, y: 0, width: MAIN_WIDTH, height: 1 },
      { x: RIGHT_START, y: 0, width: RIGHT_WIDTH, height: 0.333 },
      { x: RIGHT_START, y: 0.333, width: HALF_RIGHT, height: 0.333 },
      { x: RIGHT_START + HALF_RIGHT, y: 0.333, width: HALF_RIGHT, height: 0.333 },
      { x: RIGHT_START, y: 0.666, width: HALF_RIGHT, height: 0.334 },
      { x: RIGHT_START + HALF_RIGHT, y: 0.666, width: HALF_RIGHT, height: 0.334 },
    ],
  ];
  
  const idx = Math.min(windowCount, layouts.length) - 1;
  return idx >= 0 ? layouts[idx] : layouts[0];
}

function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-[#050510] to-black flex items-center justify-center p-4 sm:p-8 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(0,212,255,0.08)_0%,transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(139,92,246,0.06)_0%,transparent_50%)]" />
      
      <div className="max-w-2xl w-full relative z-10">
        <div className="text-center mb-10 sm:mb-14">
          <div className="inline-block mb-6 sm:mb-8">
            <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br from-[#111118] to-[#0c0c14] border border-white/[0.08] flex items-center justify-center shadow-[0_0_60px_rgba(0,212,255,0.15),0_20px_40px_rgba(0,0,0,0.4)] group">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#00d4ff]/10 to-[#8b5cf6]/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <svg className="w-10 h-10 sm:w-12 sm:h-12 text-[#00d4ff] drop-shadow-[0_0_12px_rgba(0,212,255,0.5)] relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
          </div>
          <h1 className="text-4xl sm:text-6xl font-bold text-white mb-3 sm:mb-4 tracking-tight">
            <span className="bg-gradient-to-r from-white via-white to-[#a1a1aa] bg-clip-text text-transparent">Zeus Terminal</span>
          </h1>
          <p className="text-lg sm:text-xl text-[#a1a1aa]">Claude Code CLI with orchestration superpowers</p>
        </div>

        <div className="relative bg-gradient-to-b from-[#0c0c14]/80 to-[#07070c]/80 backdrop-blur-xl rounded-2xl p-6 sm:p-8 border border-white/[0.06] mb-8 sm:mb-10 shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#00d4ff]/30 to-transparent" />
          <h2 className="text-base sm:text-lg font-semibold text-[#00d4ff] mb-4 sm:mb-5 flex items-center gap-3">
            <span className="relative w-2.5 h-2.5 bg-[#00d4ff] rounded-full shadow-[0_0_12px_rgba(0,212,255,0.6)]">
              <span className="absolute inset-0 bg-[#00d4ff] rounded-full animate-ping opacity-50" />
            </span>
            Multi-Window Terminal
          </h2>
          <div className="space-y-3 sm:space-y-4 text-base sm:text-lg text-[#d4d4d8]">
            <div className="flex items-center gap-4 group">
              <span className="w-6 h-6 rounded-full bg-[#22c55e]/15 flex items-center justify-center text-[#4ade80] text-xs font-bold shadow-[0_0_8px_rgba(34,197,94,0.2)]">✓</span>
              <span className="group-hover:text-white transition-colors">Up to 6 flexible tile windows per session</span>
            </div>
            <div className="flex items-center gap-4 group">
              <span className="w-6 h-6 rounded-full bg-[#22c55e]/15 flex items-center justify-center text-[#4ade80] text-xs font-bold shadow-[0_0_8px_rgba(34,197,94,0.2)]">✓</span>
              <span className="group-hover:text-white transition-colors">Drag, resize, minimize windows</span>
            </div>
            <div className="flex items-center gap-4 group">
              <span className="w-6 h-6 rounded-full bg-[#22c55e]/15 flex items-center justify-center text-[#4ade80] text-xs font-bold shadow-[0_0_8px_rgba(34,197,94,0.2)]">✓</span>
              <span className="group-hover:text-white transition-colors">Command templates and automations</span>
            </div>
            <div className="flex items-center gap-4 group">
              <span className="w-6 h-6 rounded-full bg-[#22c55e]/15 flex items-center justify-center text-[#4ade80] text-xs font-bold shadow-[0_0_8px_rgba(34,197,94,0.2)]">✓</span>
              <span className="group-hover:text-white transition-colors">Persistent tmux sessions</span>
            </div>
          </div>
        </div>

        <button
          onClick={onStart}
          className="relative w-full py-4 sm:py-5 px-6 sm:px-8 bg-gradient-to-r from-[#0c0c14] to-[#111118] text-[#00d4ff] font-semibold rounded-xl border border-[#00d4ff]/25 hover:border-[#00d4ff]/50 shadow-[0_8px_32px_rgba(0,0,0,0.3)] hover:shadow-[0_8px_40px_rgba(0,212,255,0.15)] transition-all duration-300 active:scale-[0.98] text-lg sm:text-xl group overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-[#00d4ff]/0 via-[#00d4ff]/10 to-[#8b5cf6]/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <span className="relative z-10 flex items-center justify-center gap-2">
            Enter Terminal
            <svg className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </span>
        </button>

        <p className="text-center text-[#71717a] text-xs sm:text-sm mt-6 sm:mt-8 font-medium tracking-wide">terminal.herakles.dev</p>
      </div>
    </div>
  );
}

export default function App() {
  const [showWelcome, setShowWelcome] = useState(true);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [sidePanelExpanded, setSidePanelExpanded] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [windows, setWindows] = useState<WindowConfig[]>([]);
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(TERMINAL_DEFAULTS.fontSize);
  const [isLoading, setIsLoading] = useState(false);
  const [minimapVisible, setMinimapVisible] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; windowId: string; selectedText: string } | null>(null);
  const [quickKeysVisible, setQuickKeysVisible] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [viewportStable, setViewportStable] = useState(false);
  useKeyboardHeight();
  const toast = useToast();
  const { isMobile } = useMobileDetect();
  const resizeCoordinator = useResizeCoordinator();
  const {
    artifacts: canvasArtifacts,
    activeArtifactId,
    viewMode,
    unreadCount: canvasUnreadCount,
    addArtifact,
    setActiveArtifact,
    toggleViewMode,
    clearArtifacts,
    markAsRead,
    removeArtifact,
    toggleStar,
    refetchMissedArtifacts,
  } = useCanvasArtifacts();
  const [showLightning, setShowLightning] = useState(true);
  const [todoPanelExpanded, setTodoPanelExpanded] = useState(true);
  const [todoSessions, setTodoSessions] = useState<SessionTodos[]>([]);
  const [todosLoading, setTodosLoading] = useState(false);

  // Compute todo count for window title badge
  const todoCount = useMemo(() => {
    let count = 0;
    for (const session of todoSessions) {
      for (const todo of session.todos) {
        if (todo.status !== 'completed') count++;
      }
    }
    return count;
  }, [todoSessions]);

  const todoHasActive = useMemo(() => {
    return todoSessions.some(s => s.todos.some(t => t.status === 'in_progress'));
  }, [todoSessions]);
  const [musicPlayerVisible, setMusicPlayerVisible] = useState(false);
  const [musicPlayerState, setMusicPlayerState] = useState<Partial<MusicPlayerState>>({});
  const [contextUsage, setContextUsage] = useState<Map<string, ContextUsage>>(new Map());
  const csrfTokenRef = useRef<string | null>(null);

  // Memoized callback to prevent infinite render loop - must NOT change reference
  const handleMusicPlayerStateChange = useCallback((state: MusicPlayerState) => {
    // Only sync playback state, NOT mode - parent controls mode entirely
    setMusicPlayerState(prev => ({
      ...prev,
      videoId: state.videoId,
      videoTitle: state.videoTitle,
      thumbnailUrl: state.thumbnailUrl,
      isPlaying: state.isPlaying,
      volume: state.volume,
      currentTime: state.currentTime,
      duration: state.duration,
      isMuted: state.isMuted,
      position: state.position,
      // mode is controlled by parent via musicPlayerVisible, don't sync back
    }));
  }, []); // Empty deps - setMusicPlayerState is stable

  // Fetch CSRF token on mount
  useEffect(() => {
    fetch('/api/csrf-token', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.data?.token) {
          csrfTokenRef.current = data.data.token;
          console.log('[MusicSync] CSRF token obtained');
        }
      })
      .catch(err => console.error('[MusicSync] Failed to fetch CSRF token:', err));
  }, []);

  // Fetch persisted music player state on mount (resume functionality)
  useEffect(() => {
    console.log('[MusicResume] Fetching saved state...');
    fetch('/api/music/state', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        console.log('[MusicResume] Got response:', JSON.stringify(data));
        if (data.data?.videoId) {
          console.log('[MusicResume] Restoring video:', data.data.videoId, 'at time:', data.data.currentTime);
          // Restore persisted state
          setMusicPlayerState({
            videoId: data.data.videoId,
            videoTitle: data.data.videoTitle,
            thumbnailUrl: data.data.thumbnailUrl,
            volume: data.data.volume,
            currentTime: data.data.currentTime,
            isMuted: data.data.isMuted,
            position: data.data.position,
            isPlaying: false, // Don't auto-play, let user start
          });
          // Show player if video was previously loaded
          if (data.data.mode !== 'hidden') {
            console.log('[MusicResume] Setting player visible, mode was:', data.data.mode);
            setMusicPlayerVisible(true);
          }
        } else {
          console.log('[MusicResume] No videoId found in response');
        }
      })
      .catch(err => console.error('[MusicResume] Failed to fetch:', err));
  }, []);

  // Debounced sync for music player state persistence
  const musicSyncTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const handleMusicPlayerSync = useCallback((state: Partial<MusicPlayerState>) => {
    // Immediate sync for important changes
    const immediate = state.videoId !== undefined || state.mode !== undefined;
    console.log('[MusicSync] Syncing state:', JSON.stringify(state), 'immediate:', immediate);

    // Build headers with CSRF token
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (csrfTokenRef.current) {
      headers['x-csrf-token'] = csrfTokenRef.current;
    }

    if (immediate) {
      fetch('/api/music/state', {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify(state),
      })
        .then(res => res.json())
        .then(data => console.log('[MusicSync] Save response:', JSON.stringify(data)))
        .catch(err => console.error('[MusicSync] Failed to sync:', err));
    } else {
      // Debounce time-based updates (currentTime, volume)
      clearTimeout(musicSyncTimeoutRef.current);
      musicSyncTimeoutRef.current = setTimeout(() => {
        // Re-build headers in timeout (token might have updated)
        const timeoutHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (csrfTokenRef.current) {
          timeoutHeaders['x-csrf-token'] = csrfTokenRef.current;
        }
        fetch('/api/music/state', {
          method: 'PUT',
          headers: timeoutHeaders,
          credentials: 'include',
          body: JSON.stringify(state),
        }).catch(err => console.error('Failed to sync music state:', err));
      }, 2000);
    }
  }, []);

  const terminalRefs = useRef<Map<string, TerminalCoreHandle>>(new Map());
  const terminalsRef = useRef<Map<string, { term: XTerm; fitAddon: FitAddon }>>(new Map());
  const resizeObserversRef = useRef<Map<string, ResizeObserver>>(new Map());
  const sendMessageRef = useRef<((msg: object) => void) | null>(null);
  const addArtifactRef = useRef(addArtifact);
  addArtifactRef.current = addArtifact;
  const outputPipelineRef = useRef<OutputPipelineManager | null>(null);
  const healthMonitorRef = useRef<WebGLHealthMonitor | null>(null);
  const pendingRestoreRef = useRef<Map<string, string>>(new Map());
  const selectionRefs = useRef<Map<string, string>>(new Map()); // Track selection per window for WebGL
  const restoreNeededAfterRecoveryRef = useRef<Set<string>>(new Set()); // Windows that need restore after WebGL recovery
  const recoveryTerminalSizeRef = useRef<Map<string, { cols: number; rows: number }>>(new Map()); // FIX RS-2: Track terminal size during recovery
  const contextMenuHandlersRef = useRef<Map<string, { element: HTMLElement; handler: (e: MouseEvent) => void }>>(new Map());
  const resizeCoordinatorRef = useRef(resizeCoordinator);
  resizeCoordinatorRef.current = resizeCoordinator;

  const getActiveTerminal = useCallback(() => {
    if (!activeWindowId) return null;
    const handle = terminalRefs.current.get(activeWindowId);
    if (handle?.terminal) return handle.terminal;
    const entry = terminalsRef.current.get(activeWindowId);
    return entry?.term || null;
  }, [activeWindowId]);


  const doDestroyTerminal = (windowId: string) => {
    terminalRefs.current.delete(windowId);
    outputPipelineRef.current?.clear(windowId);
    const terminal = terminalsRef.current.get(windowId);
    if (terminal) {
      terminal.term.dispose();
      terminalsRef.current.delete(windowId);
    }
    const observer = resizeObserversRef.current.get(windowId);
    if (observer) {
      observer.disconnect();
      resizeObserversRef.current.delete(windowId);
    }

    // Clean up fit timeout to prevent memory leak
    const fitTimeout = fitTimeoutRef.current.get(windowId);
    if (fitTimeout) {
      clearTimeout(fitTimeout);
      fitTimeoutRef.current.delete(windowId);
    }

    // Clean up context menu listener to prevent event listener leak
    const contextHandler = contextMenuHandlersRef.current.get(windowId);
    if (contextHandler) {
      contextHandler.element.removeEventListener('contextmenu', contextHandler.handler, true);
      contextMenuHandlersRef.current.delete(windowId);
    }

    // Clean up pending restore content
    pendingRestoreRef.current.delete(windowId);

    // Clean up selection tracking
    selectionRefs.current.delete(windowId);

    // Clean up recovery tracking
    restoreNeededAfterRecoveryRef.current.delete(windowId);
  };

  const handleMessage = useCallback((msg: any) => {
    switch (msg.type) {
      case 'auth-success':
        localStorage.setItem('herakles-reconnect-token', msg.token || '');
        if (msg.sessions && msg.sessions.length > 0) {
          const session = msg.sessions[0];
          localStorage.setItem('herakles-session-id', session.id);
          sendMessageRef.current?.({ type: 'session:resume', sessionId: session.id });
        } else {
          sendMessageRef.current?.({ type: 'session:create', name: 'default' });
        }
        break;

      case 'session:created':
      case 'session:resumed': {
        const sid = msg.session?.id;
        setSessionId(sid);
        localStorage.setItem('herakles-session-id', sid);
        setIsLoading(false);
        
        const rawWindows = msg.windows || [];
        const layouts = calculateWindowLayouts(rawWindows.length);
        
        const windowList: WindowConfig[] = rawWindows.map((w: any, i: number) => ({
          id: w.id,
          name: w.name || w.autoName || (w.isMain ? 'Main' : `Window ${i}`),
          x: layouts[i]?.x ?? 0,
          y: layouts[i]?.y ?? 0,
          width: layouts[i]?.width ?? 1,
          height: layouts[i]?.height ?? 1,
          zIndex: i,
          isMain: w.isMain ?? i === 0,
          isMinimized: false,
        }));
        
        if (windowList.length === 0) {
          sendMessageRef.current?.({ type: 'window:create', sessionId: sid, isMain: true });
        } else {
          setWindows(windowList);
          setActiveWindowId(windowList[0]?.id || null);
        }
        break;
      }

      case 'window:created': {
        const w = msg.window;
        setWindows(prev => {
          const newWindowData = {
            id: w.id,
            name: w.name || w.autoName || `Window ${prev.length + 1}`,
            isMain: w.isMain ?? prev.length === 0,
            isMinimized: false,
          };
          const allWindows = [...prev, newWindowData as WindowConfig];
          const layouts = calculateWindowLayouts(allWindows.length);
          
          return allWindows.map((win, i) => ({
            ...win,
            x: layouts[i]?.x ?? 0,
            y: layouts[i]?.y ?? 0,
            width: layouts[i]?.width ?? 0.5,
            height: layouts[i]?.height ?? 0.5,
            zIndex: i,
          }));
        });
        setActiveWindowId(w.id);
        break;
      }

      case 'window:closed':
        doDestroyTerminal(msg.windowId);
        setWindows(prev => {
          const remaining = prev.filter(w => w.id !== msg.windowId);
          const layouts = calculateWindowLayouts(remaining.length);
          return remaining.map((win, i) => ({
            ...win,
            x: layouts[i]?.x ?? 0,
            y: layouts[i]?.y ?? 0,
            width: layouts[i]?.width ?? 1,
            height: layouts[i]?.height ?? 1,
            zIndex: i,
          }));
        });
        break;

      case 'window:clear': {
        const handle = terminalRefs.current.get(msg.windowId);
        if (handle?.terminal) {
          handle.terminal.reset();
        } else {
          const terminal = terminalsRef.current.get(msg.windowId);
          if (terminal) terminal.term.reset();
        }
        break;
      }

      case 'window:restore': {
        // Step 1: Enter restore mode - clear and block pipeline
        outputPipelineRef.current?.setRestoreInProgress(msg.windowId, true);

        // Track that this window needs restore (for WebGL recovery coordination)
        restoreNeededAfterRecoveryRef.current.add(msg.windowId);

        const handle = terminalRefs.current.get(msg.windowId);
        const terminal = handle?.terminal || terminalsRef.current.get(msg.windowId)?.term;

        if (terminal && msg.data) {
          // Step 2: Single RAF (reduced from 3 nested RAFs)
          requestAnimationFrame(() => {
            terminal.reset();
            terminal.write(msg.data, () => {
              terminal.scrollToBottom();
              // Step 3: Exit restore mode in write callback
              outputPipelineRef.current?.setRestoreInProgress(msg.windowId, false);

              // Clear pending restore ref immediately to prevent accumulation
              pendingRestoreRef.current.delete(msg.windowId);

              // FIX WG-2: Don't clear restore flag here - WebGL context loss can happen AFTER write completes
              // Flag will be cleared in handleRecoveryEnd after re-request is sent
              // This prevents blank terminal when context loss occurs during/after restore
              // restoreNeededAfterRecoveryRef.current.delete(msg.windowId);  // ❌ REMOVED
            });
          });
        } else if (msg.data) {
          // Terminal not ready yet - buffer restore content
          pendingRestoreRef.current.set(msg.windowId, msg.data);
          // Keep restore mode active until terminal flushes pending content

          // Safety timeout - exit restore mode if terminal never initializes
          // Prevents indefinite output blocking if terminal fails to mount
          setTimeout(() => {
            if (pendingRestoreRef.current.has(msg.windowId)) {
              // FIX WG-3: Don't clear if recovery is in progress
              // Recovery might complete and restore the content
              if (!outputPipelineRef.current?.isRecoveryInProgress(msg.windowId)) {
                console.warn(`[${msg.windowId}] Restore timeout - terminal never initialized, clearing pending restore`);
                pendingRestoreRef.current.delete(msg.windowId);
                outputPipelineRef.current?.setRestoreInProgress(msg.windowId, false);
                // Note: restoreNeededAfterRecoveryRef not cleared here per WG-2 fix
              } else {
                console.info(`[${msg.windowId}] Restore timeout but recovery in progress - keeping buffer`);
              }
            }
          }, 5000);
        } else {
          // No data to restore - exit restore mode immediately
          outputPipelineRef.current?.setRestoreInProgress(msg.windowId, false);
          restoreNeededAfterRecoveryRef.current.delete(msg.windowId);
        }
        break;
      }

      case 'window:resized': {
        const { windowId, cols, rows } = msg;
        resizeCoordinatorRef.current.confirmResize(windowId, cols, rows);
        outputPipelineRef.current?.setResizePending(windowId, false);
        break;
      }

      case 'window:output': {
        const windowId = msg.windowId;
        if (resizeCoordinatorRef.current.isResizePending(windowId)) {
          outputPipelineRef.current?.setResizePending(windowId, true);
        }
        outputPipelineRef.current?.enqueue(windowId, msg.data);
        break;
      }

      case 'window:renamed':
        setWindows(prev => prev.map(w => 
          w.id === msg.windowId ? { ...w, name: msg.name || msg.autoName || w.name } : w
        ));
        break;

      case 'canvas:artifact':
        if (msg.artifact) {
          addArtifactRef.current(msg.artifact);
        }
        break;

      case 'file:uploaded':
        // Show toast notification for files uploaded via other means
        toast.success(`File ready: ${msg.file.filename}`);
        break;

      case 'todo:allSessions':
        console.log('[App] Received todo:allSessions:', {
          sessionCount: msg.sessions?.length || 0,
          totalTodos: msg.sessions?.reduce((sum: number, s: SessionTodos) => sum + s.todos.length, 0) || 0,
          sessions: msg.sessions,
        });
        // Filter to only show sessions updated in the last hour (3600000 ms)
        const now = Date.now();
        const oneHourAgo = now - 3600000;
        const recentSessions = (msg.sessions || []).filter(
          (session: SessionTodos) => session.lastModified > oneHourAgo
        );
        console.log('[App] Filtered to recent sessions:', {
          total: msg.sessions?.length || 0,
          recent: recentSessions.length,
          filtered: (msg.sessions?.length || 0) - recentSessions.length,
        });
        setTodoSessions(recentSessions);
        setTodosLoading(false);
        break;

      case 'context:sync':
      case 'context:update': {
        const contextMsg = msg as ContextSyncMessage | ContextUpdateMessage;
        setContextUsage(prev => {
          const newMap = new Map(prev);
          if (contextMsg.usage) {
            newMap.set(contextMsg.windowId, contextMsg.usage);
          } else {
            newMap.delete(contextMsg.windowId);
          }
          return newMap;
        });
        break;
      }

      case 'error':
        console.error('WebSocket error:', msg.code, msg.message);
        if (msg.code === 'SESSION_NOT_FOUND') {
          // Stale session in localStorage - clear and create fresh
          localStorage.removeItem('herakles-session-id');
          sendMessageRef.current?.({ type: 'session:create' });
        } else {
          // Any other error while loading - exit loading state
          setIsLoading(false);
        }
        break;
    }
  }, []);

  const wasConnectedRef = useRef(false);
  const handleStateChange = useCallback((newState: ConnectionState) => {
    if (newState === 'reconnecting' || newState === 'disconnected') {
      // Clear pipeline and pending restores on disconnect/reconnect
      // This prevents stale data from corrupting the terminal after reconnection
      outputPipelineRef.current?.clearAll();
      pendingRestoreRef.current.clear();

      // Reset loading state to prevent stuck loading screen
      // (covers auth failure via close code 4001, network drops, etc.)
      setIsLoading(false);
    }

    if (newState === 'connected') {
      setIsLoading(true);
      if (wasConnectedRef.current) {
        refetchMissedArtifacts();

        // Re-subscribe all existing windows to trigger restore after reconnection
        // This ensures terminal content is restored after network hiccups
        windows.forEach(win => {
          const handle = terminalRefs.current.get(win.id);
          if (handle?.terminal) {
            sendMessageRef.current?.({
              type: 'window:subscribe',
              windowId: win.id,
              cols: handle.terminal.cols,
              rows: handle.terminal.rows,
            });
          }
        });
      }
      wasConnectedRef.current = true;
    }
  }, [refetchMissedArtifacts, windows]);

  // Safety net: force exit loading state after 10 seconds
  useEffect(() => {
    if (!isLoading) return;
    const timeout = setTimeout(() => {
      console.error('[App] Loading timeout - forcing exit from loading state');
      setIsLoading(false);
    }, 10_000);
    return () => clearTimeout(timeout);
  }, [isLoading]);

  const wsUrl = useMemo(() => {
    if (showWelcome) return '';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }, [showWelcome]);

  const { send: wsSend, state: connectionState, reconnectIn, reconnectNow, latency } = useWebSocket({
    url: wsUrl || 'ws://localhost',
    onMessage: handleMessage,
    onStateChange: handleStateChange,
  });

  useEffect(() => {
    sendMessageRef.current = wsSend;
  }, [wsSend]);

  // Track if we're subscribed to todo updates
  const todoSubscribedRef = useRef(false);

  // Reset subscription state when disconnected
  useEffect(() => {
    if (connectionState === 'disconnected' || connectionState === 'connecting') {
      todoSubscribedRef.current = false;
      setTodosLoading(true);
    }
  }, [connectionState]);

  // Subscribe to todo updates once when connected
  useEffect(() => {
    if (!sendMessageRef.current || connectionState !== 'connected') return;

    if (!todoSubscribedRef.current) {
      console.log('[App] Subscribing to todo updates');
      setTodosLoading(true);
      sendMessageRef.current({ type: 'todo:subscribe', windowId: 'global' });
      todoSubscribedRef.current = true;
    }
  }, [connectionState]);

  // Create health actions hook for proactive health management
  const { applyHealthActions } = useHealthActions({
    healthMonitor: healthMonitorRef.current,
    terminalRefs: terminalRefs.current,
    outputPipeline: outputPipelineRef.current,
    toast,
  });

  useEffect(() => {
    const writeToTerminal = (windowId: string, data: string) => {
      const handle = terminalRefs.current.get(windowId);
      if (handle) {
        handle.write(data);
      } else {
        const terminal = terminalsRef.current.get(windowId);
        if (terminal) terminal.term.write(data);
      }
    };

    // Create health monitor with metrics callback
    const healthMonitor = new WebGLHealthMonitor((metrics) => {
      // Apply proactive health actions (Phase 2: Complete)
      applyHealthActions(metrics);

      // Log metrics to console for debugging
      if (metrics.recommendation !== 'normal') {
        console.warn('[WebGLHealth] Recommendation:', metrics.recommendation, 'Score:', metrics.healthScore);
      }
    });
    healthMonitorRef.current = healthMonitor;

    // Start periodic metrics reporting
    healthMonitor.start();

    // Expose to window for debugging (Phase 1 validation)
    exposeMetricsToWindow(healthMonitor);

    // Create output pipeline with health monitor
    outputPipelineRef.current = new OutputPipelineManager(writeToTerminal, {
      healthMonitor,
    });

    return () => {
      healthMonitor.stop();
      healthMonitorRef.current = null;
      outputPipelineRef.current?.clearAll();
      outputPipelineRef.current = null;
    };
  }, [applyHealthActions]);

  const sendMessage = useCallback((message: object) => {
    sendMessageRef.current?.(message);
  }, []);

  const handleWindowFocus = useCallback((id: string) => {
    setActiveWindowId(id);
    sendMessage({ type: 'window:focus', windowId: id });
  }, [sendMessage]);

  const handleWindowClose = useCallback((id: string) => {
    sendMessage({ type: 'window:close', windowId: id });
  }, [sendMessage]);

  const handleWindowMinimize = useCallback((id: string) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, isMinimized: true } : w));
  }, []);

  const handleWindowRestore = useCallback((id: string) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, isMinimized: false } : w));
    setActiveWindowId(id);
  }, []);

  const fitTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const handleLayoutChange = useCallback((id: string, layout: { x: number; y: number; width: number; height: number }, isDragging = false) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, ...layout } : w));
    sendMessage({ type: 'window:layout', windowId: id, ...layout });
    
    if (isDragging) {
      return;
    }
    
    const existingTimeout = fitTimeoutRef.current.get(id);
    if (existingTimeout) clearTimeout(existingTimeout);
    
    const timeout = setTimeout(() => {
      const terminal = terminalsRef.current.get(id);
      if (terminal) {
        try { terminal.fitAddon.fit(); } catch {}
      }
      fitTimeoutRef.current.delete(id);
    }, 350);  // FIX WG-4: 200ms CSS transition + 150ms buffer for slower devices (was 250ms)
    fitTimeoutRef.current.set(id, timeout);
  }, [sendMessage]);

  const handleAddWindow = useCallback(() => {
    if (windows.length >= 6) return;
    sendMessage({ type: 'window:create', sessionId });
  }, [windows.length, sessionId, sendMessage]);


  const renderTerminal = useCallback((windowId: string, isFocused: boolean) => {
    const handleTerminalData = (data: string) => {
      sendMessage({ type: 'input', windowId, data });
    };

    const handleTerminalResize = (cols: number, rows: number) => {
      sendMessage({ type: 'window:resize', windowId, cols, rows });
    };

    // WebGL recovery coordination - notify output pipeline to pause
    const handleRecoveryStart = (terminalId: string) => {
      outputPipelineRef.current?.setRecoveryInProgress(terminalId, true);

      // FIX RS-2: Capture terminal size at start of recovery
      // This allows us to detect if the window was resized during recovery
      const handle = terminalRefs.current.get(terminalId);
      if (handle?.terminal) {
        recoveryTerminalSizeRef.current.set(terminalId, {
          cols: handle.terminal.cols,
          rows: handle.terminal.rows,
        });
      }
    };

    // WebGL recovery coordination - resume output pipeline and re-request restore if needed
    const handleRecoveryEnd = (terminalId: string, success: boolean) => {
      outputPipelineRef.current?.setRecoveryInProgress(terminalId, false);

      if (success) {
        // FIX RS-2: Check if terminal size changed during recovery
        const sizeAtStart = recoveryTerminalSizeRef.current.get(terminalId);
        const handle = terminalRefs.current.get(terminalId);
        const currentSize = handle?.terminal
          ? { cols: handle.terminal.cols, rows: handle.terminal.rows }
          : null;

        const sizeChanged =
          sizeAtStart &&
          currentSize &&
          (sizeAtStart.cols !== currentSize.cols || sizeAtStart.rows !== currentSize.rows);

        if (sizeChanged) {
          console.warn(
            `[${terminalId}] Terminal size changed during recovery: ${sizeAtStart.cols}x${sizeAtStart.rows} → ${currentSize.cols}x${currentSize.rows}`
          );
          // Size changed - re-subscribe with NEW size to get content formatted correctly
          sendMessage({
            type: 'window:subscribe',
            windowId: terminalId,
            cols: currentSize.cols,
            rows: currentSize.rows,
          });
          restoreNeededAfterRecoveryRef.current.delete(terminalId);
        } else if (restoreNeededAfterRecoveryRef.current.has(terminalId)) {
          // Size unchanged - safe to restore with original dimensions
          console.info(`[${terminalId}] Re-requesting restore after successful WebGL recovery`);
          sendMessage({ type: 'window:subscribe', windowId: terminalId });
          restoreNeededAfterRecoveryRef.current.delete(terminalId);
        }

        // Clean up size tracking
        recoveryTerminalSizeRef.current.delete(terminalId);
      } else {
        // Recovery failed - clean up size tracking
        recoveryTerminalSizeRef.current.delete(terminalId);
      }
    };

    const handleTerminalReady = (term: XTerm, _fitAddon: FitAddon) => {
      sendMessage({
        type: 'window:subscribe',
        windowId,
        cols: term.cols,
        rows: term.rows,
      });

      // Subscribe to context usage updates for this window
      sendMessage({ type: 'context:subscribe', windowId });

      term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        const isCtrlOrCmd = event.ctrlKey || event.metaKey;

        if (isCtrlOrCmd && event.key === 'c') {
          const selection = term.getSelection();
          if (selection && selection.length > 0) {
            event.preventDefault();
            navigator.clipboard.writeText(selection)
              .then(() => toast.success('copied to clipboard'))
              .catch(() => toast.error('clipboard: permission denied'));
            return false;
          }
          return true;
        }

        if (isCtrlOrCmd && event.key === 'v') {
          event.preventDefault();
          navigator.clipboard.readText()
            .then((text) => {
              if (text) {
                const lines = text.split('\n');
                if (lines.length > 1) {
                  const confirmPaste = confirm(`paste ${lines.length} lines into terminal?`);
                  if (!confirmPaste) return;
                }
                term.paste(text);
              }
            })
            .catch(() => toast.error('clipboard: permission denied'));
          return false;
        }

        return true;
      });
    };

    const handleTerminalRef = (handle: TerminalCoreHandle | null) => {
      if (handle) {
        terminalRefs.current.set(windowId, handle);

        // Check for render error and notify user
        if (handle.renderError) {
          console.error(`[${windowId}] Terminal render failed:`, handle.renderError);
          toast.error(`Terminal failed: WebGL unavailable`);
          return; // Don't set up event handlers on broken terminal
        }

        // Track selection changes for WebGL (selection clears on right-click mouseup)
        if (handle.terminal) {
          handle.terminal.onSelectionChange(() => {
            const selection = handle.terminal?.getSelection() || '';
            if (selection.length > 0) {
              selectionRefs.current.set(windowId, selection);

              // Clear stale selections after 30 seconds to prevent memory accumulation
              // Selection strings can be 10KB+ and accumulate over extended sessions
              setTimeout(() => {
                if (selectionRefs.current.get(windowId) === selection) {
                  selectionRefs.current.delete(windowId);
                }
              }, 30000);
            }
            // Don't clear on empty - keep last known selection for context menu
          });

          // Attach contextmenu listener in CAPTURE phase to intercept before xterm
          // xterm.js intentionally allows native context menu - we must capture first
          if (handle.terminal.element) {
            const termElement = handle.terminal.element;

            const contextMenuHandler = (e: MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();

              // Use tracked selection (WebGL clears on mouseup)
              const trackedSelection = selectionRefs.current.get(windowId) || '';
              const currentSelection = handle.terminal?.getSelection() || '';
              const selection = currentSelection.length > 0 ? currentSelection : trackedSelection;

              if (selection.length > 0) {
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  windowId,
                  selectedText: selection,
                });
                // Clear tracked selection after showing menu
                selectionRefs.current.delete(windowId);
              }
            };

            // CAPTURE phase (third param = true) runs BEFORE xterm's bubbling handler
            termElement.addEventListener('contextmenu', contextMenuHandler, true);

            // Store for cleanup
            contextMenuHandlersRef.current.set(windowId, { element: termElement, handler: contextMenuHandler });
          }
        }

        // Flush pending restore content if terminal wasn't ready earlier
        const pendingRestore = pendingRestoreRef.current.get(windowId);
        if (pendingRestore && handle.terminal) {
          pendingRestoreRef.current.delete(windowId);
          requestAnimationFrame(() => {
            handle.terminal?.reset();
            handle.terminal?.write(pendingRestore, () => {
              handle.terminal?.scrollToBottom();
              // Exit restore mode now that pending content is flushed
              outputPipelineRef.current?.setRestoreInProgress(windowId, false);
            });
          });
        }
      } else {
        terminalRefs.current.delete(windowId);
        selectionRefs.current.delete(windowId);

        // Clean up capture-phase contextmenu listener
        const stored = contextMenuHandlersRef.current.get(windowId);
        if (stored) {
          stored.element.removeEventListener('contextmenu', stored.handler, true);
          contextMenuHandlersRef.current.delete(windowId);
        }
      }
    };

    return (
      <div
        className={`terminal-container ${isFocused ? '' : 'opacity-90'}`}
        style={{ position: 'relative', width: '100%', height: '100%' }}
      >
        <TerminalCore
          ref={handleTerminalRef}
          onData={handleTerminalData}
          onResize={handleTerminalResize}
          onReady={handleTerminalReady}
          onRecoveryStart={handleRecoveryStart}
          onRecoveryEnd={handleRecoveryEnd}
          isRecovering={() => outputPipelineRef.current?.isRecoveryInProgress(windowId) ?? false}
          healthMonitor={healthMonitorRef.current ?? undefined}
          fontSize={fontSize}
          terminalId={windowId}
        />
        <MobileInputHandler
          onInput={handleTerminalData}
          enabled={isMobile && isFocused}
          windowId={windowId}
        />
      </div>
    );
  }, [fontSize, isMobile, sendMessage, toast]);

  const handleQuickKey = useCallback((value: string) => {
    if (activeWindowId) {
      sendMessage({ type: 'input', windowId: activeWindowId, data: value });
    }
  }, [activeWindowId, sendMessage]);

  const handleClearLine = useCallback(() => {
    if (activeWindowId && sendMessage) {
      sendMessage({ type: 'input', windowId: activeWindowId, data: '\x15' });
    }
  }, [activeWindowId, sendMessage]);

  const handleRefocusTerminal = useCallback(() => {
    if (activeWindowId) {
      const terminal = terminalsRef.current.get(activeWindowId);
      if (terminal) {
        terminal.term.focus();
      }
    }
  }, [activeWindowId]);

  const handleExecuteCommand = useCallback((command: string) => {
    if (activeWindowId) {
      sendMessage({ type: 'input', windowId: activeWindowId, data: command });
    }
  }, [activeWindowId, sendMessage]);

  const handleWindowRename = useCallback((id: string, newName: string) => {
    sendMessage({ type: 'window:rename', windowId: id, name: newName });
    setWindows(prev => prev.map(w => w.id === id ? { ...w, name: newName } : w));
  }, [sendMessage]);

  const handleSwitchSession = useCallback((newSessionId: string) => {
    if (newSessionId === sessionId) return;
    setIsLoading(true);
    terminalsRef.current.forEach(t => t.term.dispose());
    terminalsRef.current.clear();
    setWindows([]);
    setActiveWindowId(null);
    localStorage.setItem('herakles-session-id', newSessionId);
    sendMessage({ type: 'session:resume', sessionId: newSessionId });
  }, [sessionId, sendMessage]);

  const handlePreferencesChange = useCallback((prefs: { fontSize: number }) => {
    setFontSize(prefs.fontSize);
    terminalsRef.current.forEach(({ term }) => {
      term.options.fontSize = prefs.fontSize;
    });
    terminalsRef.current.forEach(({ fitAddon }) => {
      try { fitAddon.fit(); } catch {}
    });
  }, []);

  const handleApplyLayout = useCallback((layouts: { x: number; y: number; width: number; height: number }[]) => {
    setWindows(prev => prev.map((win, i) => ({
      ...win,
      x: layouts[i]?.x ?? 0,
      y: layouts[i]?.y ?? 0,
      width: layouts[i]?.width ?? 1,
      height: layouts[i]?.height ?? 1,
      zIndex: i,
    })));
  }, []);

  const handleSendToWindow = useCallback((targetWindowId: string, text: string) => {
    sendMessage({ type: 'input', windowId: targetWindowId, data: text });
  }, [sendMessage]);

  const handleSendArtifactToTerminal = useCallback((content: string) => {
    if (activeWindowId) {
      sendMessage({ type: 'input', windowId: activeWindowId, data: content });
      toast.success('Sent to terminal');
    } else {
      toast.error('No active terminal window');
    }
  }, [activeWindowId, sendMessage, toast]);

  const handleCopyText = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
      .then(() => toast.success('copied to clipboard'))
      .catch(() => toast.error('clipboard: permission denied'));
  }, [toast]);

  const handleProjectSelect = useCallback((path: string) => {
    if (activeWindowId) {
      sendMessage({ type: 'input', data: `cd ${path}\r`, windowId: activeWindowId });
    }
  }, [activeWindowId, sendMessage]);

  // Handle files dropped onto the terminal
  const handleFilesDropped = useCallback(async (files: File[]) => {
    try {
      const results = await uploadService.uploadFiles(files);
      for (const file of results) {
        toast.success(`Uploaded ${file.filename}`);
        // Insert path reference into terminal for Claude
        if (activeWindowId) {
          const pathRef = file.hasOptimized && file.optimizedPath 
            ? file.optimizedPath 
            : `/home/hercules/uploads${file.path}`;
          sendMessage({ 
            type: 'input', 
            windowId: activeWindowId, 
            data: `# File uploaded: ${pathRef}\n` 
          });
        }
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Upload failed';
      toast.error(errorMessage);
    }
  }, [activeWindowId, sendMessage, toast]);

  // Handle clipboard paste for images
  useClipboardUpload({
    enabled: !showWelcome,  // Only enable after entering terminal
    onUploadStart: () => toast.info('Uploading from clipboard...'),
    onUploadComplete: (file) => {
      toast.success(`Uploaded ${file.filename}`);
      // Insert path into terminal
      if (activeWindowId) {
        const pathRef = (file as { optimizedPath?: string }).optimizedPath || `/home/hercules/uploads${file.path}`;
        sendMessage({ 
          type: 'input', 
          windowId: activeWindowId, 
          data: `# Image from clipboard: ${pathRef}\n` 
        });
      }
    },
    onUploadError: (error) => toast.error(error),
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 't':
            if (e.shiftKey) {
              e.preventDefault();
              handleAddWindow();
            }
            break;
          case 'b':
            e.preventDefault();
            setSidePanelOpen(prev => !prev);
            break;
          case 'w':
            if (e.shiftKey && activeWindowId) {
              e.preventDefault();
              sendMessage({ type: 'window:close', windowId: activeWindowId });
            }
            break;
          case 'm':
            if (e.shiftKey) {
              // Ctrl+Shift+M - toggle music player
              e.preventDefault();
              setMusicPlayerVisible(prev => !prev);
              setMusicPlayerState(prev => ({
                ...prev,
                mode: prev.mode === 'hidden' ? 'audio' : 'hidden',
              }));
            } else if (activeWindowId) {
              // Ctrl+M - minimize window
              e.preventDefault();
              setWindows(prev => prev.map(w => w.id === activeWindowId ? { ...w, isMinimized: true } : w));
            }
            break;
          case 'r':
            if (e.shiftKey) {
              e.preventDefault();
              const count = windows.filter(w => !w.isMinimized).length;
              const presets = LAYOUT_PRESETS[count] || LAYOUT_PRESETS[1];
              if (presets[0]) {
                handleApplyLayout(presets[0].layouts);
              }
            }
            break;
          case 'ArrowRight':
            if (e.shiftKey) {
              e.preventDefault();
              const currentIdx = windows.findIndex(w => w.id === activeWindowId);
              const nextIdx = (currentIdx + 1) % windows.length;
              if (windows[nextIdx]) {
                setActiveWindowId(windows[nextIdx].id);
              }
            }
            break;
          case 'ArrowLeft':
            if (e.shiftKey) {
              e.preventDefault();
              const currentIdx = windows.findIndex(w => w.id === activeWindowId);
              const prevIdx = currentIdx <= 0 ? windows.length - 1 : currentIdx - 1;
              if (windows[prevIdx]) {
                setActiveWindowId(windows[prevIdx].id);
              }
            }
            break;
          case '1': case '2': case '3': case '4': case '5': case '6':
            e.preventDefault();
            const idx = parseInt(e.key) - 1;
            if (windows[idx]) {
              setActiveWindowId(windows[idx].id);
            }
            break;
          case 'l':
          case 'L':
            if (e.shiftKey) {
              // Ctrl+Shift+L - cycle through layout presets
              e.preventDefault();
              const visCount = windows.filter(w => !w.isMinimized).length;
              const availablePresets = LAYOUT_PRESETS[visCount] || LAYOUT_PRESETS[1];
              if (availablePresets.length > 1) {
                // Find current preset by comparing layouts
                const visibleLayouts = windows.filter(w => !w.isMinimized).map(w => ({ x: w.x, y: w.y, width: w.width, height: w.height }));
                let currentPresetIdx = -1;
                for (let pi = 0; pi < availablePresets.length; pi++) {
                  const preset = availablePresets[pi];
                  if (preset.layouts.length === visibleLayouts.length) {
                    const matches = preset.layouts.every((pl, li) =>
                      Math.abs(pl.x - visibleLayouts[li].x) < 0.02 &&
                      Math.abs(pl.y - visibleLayouts[li].y) < 0.02 &&
                      Math.abs(pl.width - visibleLayouts[li].width) < 0.02 &&
                      Math.abs(pl.height - visibleLayouts[li].height) < 0.02
                    );
                    if (matches) { currentPresetIdx = pi; break; }
                  }
                }
                const nextIdx = (currentPresetIdx + 1) % availablePresets.length;
                handleApplyLayout(availablePresets[nextIdx].layouts);
              }
            }
            break;
          case 'i':
            if (e.shiftKey) {
              e.preventDefault();
              setMinimapVisible(prev => !prev);
            }
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAddWindow, windows, activeWindowId, handleApplyLayout, sendMessage]);

  const [viewportHeight, setViewportHeight] = useState('100vh');

  useEffect(() => {
    const updateViewport = () => {
      if (window.visualViewport) {
        const vh = window.visualViewport.height;
        setViewportHeight(`${vh}px`);
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateViewport);
      window.visualViewport.addEventListener('scroll', updateViewport);
      updateViewport();
    }

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateViewport);
        window.visualViewport.removeEventListener('scroll', updateViewport);
      }
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setViewportStable(true);
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  if (showWelcome) {
    return <WelcomeScreen onStart={() => setShowWelcome(false)} />;
  }

  const toolbarContent = (
    <>
      <div className="flex items-center gap-2 sm:gap-3">
        <span className="text-[10px] text-[#52525b] font-mono">v0.2.0</span>
        <ConnectionStatus 
          state={connectionState} 
          sessionId={sessionId} 
          reconnectIn={reconnectIn}
          onReconnectNow={reconnectNow}
          latency={latency}
        />
        <div className="hidden lg:flex items-center gap-2 text-[12px] text-[#a1a1aa]">
          <kbd className="px-2 py-1 bg-[#111118] border border-white/[0.06] rounded text-[#a1a1aa] font-mono">⌘⇧T</kbd>
          <span>new</span>
          <kbd className="px-2 py-1 bg-[#111118] border border-white/[0.06] rounded text-[#a1a1aa] font-mono ml-2">⌘B</kbd>
          <span>panel</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <span className="text-[12px] sm:text-sm text-[#a1a1aa] font-medium tabular-nums px-2.5 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.04]">{windows.length}/6</span>
        <div className="w-px h-5 bg-gradient-to-b from-transparent via-[#27272a] to-transparent" />
        <ProjectNavigator onSelectProject={handleProjectSelect} />
        <button
          onClick={(e) => { e.stopPropagation(); setQuickKeysVisible(!quickKeysVisible); }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className={`p-2 rounded-lg transition-all duration-200 border ${
            quickKeysVisible 
              ? 'bg-gradient-to-br from-[#00d4ff]/20 to-[#8b5cf6]/10 text-[#00d4ff] shadow-[0_0_16px_rgba(0,212,255,0.15)] border-[#00d4ff]/25' 
              : 'text-[#71717a] hover:text-white hover:bg-white/[0.06] border-transparent hover:border-white/[0.06]'
          }`}
          title="Toggle quick keys"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
          </svg>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setMinimapVisible(!minimapVisible); }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className={`hidden sm:flex p-2 rounded-lg transition-all duration-200 border ${
            minimapVisible 
              ? 'bg-gradient-to-br from-[#00d4ff]/20 to-[#8b5cf6]/10 text-[#00d4ff] shadow-[0_0_16px_rgba(0,212,255,0.15)] border-[#00d4ff]/25' 
              : 'text-[#71717a] hover:text-white hover:bg-white/[0.06] border-transparent hover:border-white/[0.06]'
          }`}
          title="Toggle minimap (⌘⇧I)"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
        </button>
        <LayoutSelector
          windowCount={windows.filter(w => !w.isMinimized).length}
          onSelectLayout={handleApplyLayout}
          currentLayouts={windows.filter(w => !w.isMinimized).map(w => ({ x: w.x, y: w.y, width: w.width, height: w.height }))}
        />
      </div>
    </>
  );

  return (
    <ResizeCoordinatorContext.Provider value={resizeCoordinator}>
    <FileDropZone onFilesDropped={handleFilesDropped} enabled={!showWelcome}>
    <div className="flex flex-col bg-black" style={{ height: viewportHeight }} data-viewport-stable={viewportStable ? "true" : "false"}>
      <LightningOverlay intensity={0.3} disabled={!showLightning} />
      {toolbarVisible ? (
        <div className="relative flex items-center justify-between select-none px-4 sm:px-5 py-2.5 border-b border-white/[0.04] bg-gradient-to-r from-[#07070c]/95 via-[#0c0c14]/95 to-[#07070c]/95 backdrop-blur-xl overflow-visible shadow-[0_4px_24px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#00d4ff]/20 to-transparent" />
          {toolbarContent}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSidePanelOpen(!sidePanelOpen)}
              className={`p-2 rounded-lg transition-all duration-200 ${
                sidePanelOpen 
                  ? 'bg-gradient-to-br from-[#00d4ff]/20 to-[#8b5cf6]/10 text-[#00d4ff] shadow-[0_0_16px_rgba(0,212,255,0.2),inset_0_1px_0_rgba(255,255,255,0.1)] border border-[#00d4ff]/30' 
                  : 'text-[#71717a] hover:text-white hover:bg-white/[0.06] border border-transparent hover:border-white/[0.06]'
              }`}
              title="Toggle tools panel (⌘B)"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7" />
              </svg>
            </button>
            <button
              onClick={() => setToolbarVisible(false)}
              className="p-1.5 rounded-lg text-[#3f3f46] hover:text-[#71717a] hover:bg-white/[0.04] transition-all border border-transparent hover:border-white/[0.04]"
              title="Hide toolbar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setToolbarVisible(true)}
          className="absolute top-0 left-1/2 -translate-x-1/2 z-50 px-4 py-1 rounded-b-lg bg-gradient-to-b from-[#111118]/95 to-[#0c0c14]/95 backdrop-blur-xl text-[#a1a1aa] hover:text-[#d4d4d8] border border-t-0 border-white/[0.06] shadow-lg transition-all text-[12px] font-medium hover:shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
          title="Show toolbar"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}
      
      <div className="flex-1 min-h-0 relative">
        <TodoPanel
          expanded={todoPanelExpanded}
          onToggle={() => setTodoPanelExpanded(prev => !prev)}
          sessions={todoSessions}
          isLoading={todosLoading}
        />
        <SplitView
          windows={windows}
          activeWindowId={activeWindowId}
          onWindowFocus={handleWindowFocus}
          onWindowClose={handleWindowClose}
          onWindowMinimize={handleWindowMinimize}
          onWindowRestore={handleWindowRestore}
          onLayoutChange={handleLayoutChange}
          onAddWindow={handleAddWindow}
          onWindowRename={handleWindowRename}
          renderTerminal={renderTerminal}
          sidePanelOpen={sidePanelOpen}
          minimapVisible={minimapVisible}
          leftOffset={todoPanelExpanded ? 280 : 48}
          contextUsage={contextUsage}
          todoCount={todoCount}
          todoHasActive={todoHasActive}
        />
        <SidePanel
          isOpen={sidePanelOpen}
          onClose={() => setSidePanelOpen(false)}
          onExecuteCommand={handleExecuteCommand}
          sessionId={sessionId}
          onSwitchSession={handleSwitchSession}
          onPreferencesChange={handlePreferencesChange}
          isExpanded={sidePanelExpanded}
          onToggleExpand={() => setSidePanelExpanded(prev => !prev)}
          canvasArtifacts={canvasArtifacts}
          canvasActiveId={activeArtifactId}
          canvasViewMode={viewMode}
          canvasUnreadCount={canvasUnreadCount}
          onCanvasSelectArtifact={setActiveArtifact}
          onCanvasClear={clearArtifacts}
          onCanvasToggleViewMode={toggleViewMode}
          onCanvasTabOpened={markAsRead}
          onCanvasRemoveArtifact={removeArtifact}
          onCanvasToggleStar={toggleStar}
          onCanvasSendToTerminal={handleSendArtifactToTerminal}
          showLightning={showLightning}
          onLightningChange={setShowLightning}
        />
        <TerminalMinimap
          terminal={getActiveTerminal()}
          isVisible={minimapVisible}
          onClose={() => setMinimapVisible(false)}
          sidePanelOpen={sidePanelOpen}
        />
      </div>

      {quickKeysVisible && (
        <QuickKeyBar onKey={handleQuickKey} visible={quickKeysVisible} onClose={() => setQuickKeysVisible(false)} onClear={handleClearLine} onRefocus={handleRefocusTerminal} />
      )}
      
      {isLoading && (
        <LoadingOverlay message="Loading session..." fullScreen />
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selectedText={contextMenu.selectedText}
          windows={windows.map(w => ({ id: w.id, name: w.name, isMain: w.isMain }))}
          currentWindowId={contextMenu.windowId}
          onSendToWindow={handleSendToWindow}
          onCopy={handleCopyText}
          onClose={() => setContextMenu(null)}
        />
      )}
      <UploadProgress />
      {/* Music Player Toggle Button - position adjusts based on TodoPanel */}
      <button
        onClick={() => {
          console.log('[App] Toggle button clicked - current musicPlayerVisible:', musicPlayerVisible);
          const newVisible = !musicPlayerVisible;
          console.log('[App] Setting musicPlayerVisible to:', newVisible);
          setMusicPlayerVisible(newVisible);
          setMusicPlayerState(prev => {
            const newMode = newVisible ? 'audio' : 'hidden';
            console.log('[App] Setting musicPlayerState.mode to:', newMode, 'prev:', prev);
            return {
              ...prev,
              mode: newMode,
            };
          });
        }}
        className={`fixed bottom-20 z-[9998] w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ${
          musicPlayerVisible
            ? 'bg-[#00d4ff]/20 text-[#00d4ff] border border-[#00d4ff]/30 shadow-[0_0_12px_rgba(0,212,255,0.3)]'
            : 'bg-[#111118]/90 text-[#71717a] border border-white/10 hover:text-white hover:border-white/20'
        }`}
        style={{ left: todoPanelExpanded ? 296 : 64 }}
        title="Toggle Music Player (Ctrl+Shift+M)"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
        </svg>
      </button>
      <MusicPlayer
        initialState={{
          ...musicPlayerState,
          mode: musicPlayerVisible ? (musicPlayerState.mode === 'hidden' ? 'audio' : musicPlayerState.mode) : 'hidden',
        }}
        onStateChange={handleMusicPlayerStateChange}
        onSync={handleMusicPlayerSync}
      />
    </div>
    </FileDropZone>
    </ResizeCoordinatorContext.Provider>
  );
}
