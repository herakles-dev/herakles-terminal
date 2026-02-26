import React, { useState, useRef, useCallback, useEffect } from 'react';
import { apiUrl } from '../../services/api';
import { MusicPlayerState, MusicPlayerMode, StarredVideo, DEFAULT_MUSIC_PLAYER_STATE, extractVideoId, getYouTubeThumbnail } from '../../../shared/musicProtocol.js';
import { MusicPlayerMini } from './MusicPlayerMini.js';
import { MusicPlayerContent } from './MusicPlayerContent.js';
import './musicPlayer.css';

interface MusicPlayerProps {
  initialState?: Partial<MusicPlayerState>;
  onStateChange?: (state: MusicPlayerState) => void;
  onSync?: (state: Partial<MusicPlayerState>) => void;
  onDockToWindow?: () => void;
}

export const MusicPlayer: React.FC<MusicPlayerProps> = ({
  initialState,
  onStateChange,
  onSync,
  onDockToWindow,
}) => {
  const [state, setState] = useState<MusicPlayerState>(() => ({
    ...DEFAULT_MUSIC_PLAYER_STATE,
    position: {
      // Position at bottom-left, flush with sidebar
      x: 16,
      y: typeof window !== 'undefined' ? window.innerHeight - 280 : 100,
    },
    ...initialState,
  }));

  const [isDragging, setIsDragging] = useState(false);
  const [starredVideos, setStarredVideos] = useState<StarredVideo[]>([]);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [size, setSize] = useState({ width: 400, height: 225 }); // 16:9 aspect ratio default
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string | null>(null);
  const [nearCorner, setNearCorner] = useState<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);
  const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number; posX: number; posY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const csrfTokenRef = useRef<string | null>(null);

  const SNAP_THRESHOLD = 80; // px from corner to trigger snap
  const DOCK_MARGIN = 16;

  // Fetch CSRF token on mount
  useEffect(() => {
    fetch(apiUrl('/csrf-token'), { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        csrfTokenRef.current = data.data?.token || null;
      })
      .catch(err => console.error('Failed to fetch CSRF token:', err));
  }, []);

  // Fetch starred videos on mount
  useEffect(() => {
    fetch(apiUrl('/music/starred'), { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.data) {
          setStarredVideos(data.data);
        }
      })
      .catch(err => console.error('Failed to fetch starred videos:', err));
  }, []);

  // Check if current video is starred
  const isCurrentVideoStarred = state.videoId
    ? starredVideos.some(v => v.videoId === state.videoId)
    : false;

  // Toggle star for current video
  const toggleStar = useCallback(async () => {
    if (!state.videoId) return;

    const video = {
      videoId: state.videoId,
      videoTitle: state.videoTitle || 'Unknown',
      thumbnailUrl: state.thumbnailUrl || getYouTubeThumbnail(state.videoId, 'medium'),
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (csrfTokenRef.current) {
      headers['x-csrf-token'] = csrfTokenRef.current;
    }

    if (isCurrentVideoStarred) {
      // Optimistic update
      setStarredVideos(prev => prev.filter(v => v.videoId !== state.videoId));
      try {
        const res = await fetch(apiUrl(`/music/starred/${state.videoId}`), {
          method: 'DELETE',
          headers,
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Failed to unstar');
        const data = await res.json();
        setStarredVideos(data.data);
      } catch (err) {
        console.error('Failed to unstar video:', err);
        // Rollback on failure - refetch
        const res = await fetch(apiUrl('/music/starred'), { credentials: 'include' });
        const data = await res.json();
        if (data.data) setStarredVideos(data.data);
      }
    } else {
      // Optimistic update
      setStarredVideos(prev => [{ ...video, starredAt: Date.now() }, ...prev]);
      try {
        const res = await fetch(apiUrl('/music/starred'), {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify(video),
        });
        if (!res.ok) throw new Error('Failed to star');
        const data = await res.json();
        setStarredVideos(data.data);
      } catch (err) {
        console.error('Failed to star video:', err);
        // Rollback on failure
        setStarredVideos(prev => prev.filter(v => v.videoId !== state.videoId));
      }
    }
  }, [state.videoId, state.videoTitle, state.thumbnailUrl, isCurrentVideoStarred]);

  // Remove video from starred list
  const removeStarred = useCallback(async (videoId: string) => {
    setStarredVideos(prev => prev.filter(v => v.videoId !== videoId));
    try {
      const headers: Record<string, string> = {};
      if (csrfTokenRef.current) {
        headers['x-csrf-token'] = csrfTokenRef.current;
      }
      const res = await fetch(apiUrl(`/music/starred/${videoId}`), {
        method: 'DELETE',
        headers,
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setStarredVideos(data.data);
      }
    } catch (err) {
      console.error('Failed to remove starred video:', err);
    }
  }, []);

  // Sync mode from external control (e.g., toggle button)
  // Use a ref to track if this is an external change vs internal change
  const lastExternalModeRef = useRef<MusicPlayerMode | undefined>(initialState?.mode);

  useEffect(() => {
    const externalMode = initialState?.mode;
    // Only update if external mode changed AND is different from internal state
    if (externalMode !== undefined && externalMode !== lastExternalModeRef.current) {
      lastExternalModeRef.current = externalMode;
      setState(prev => {
        if (prev.mode !== externalMode) {
          return { ...prev, mode: externalMode };
        }
        return prev;
      });
    }
  }, [initialState?.mode]);

  // Sync video state from initialState (for resume after page load)
  const lastExternalVideoRef = useRef<string | null | undefined>(initialState?.videoId);

  useEffect(() => {
    const externalVideoId = initialState?.videoId;
    // Only update if videoId changed from external source (e.g., loaded from server)
    if (externalVideoId !== undefined && externalVideoId !== lastExternalVideoRef.current) {
      lastExternalVideoRef.current = externalVideoId;
      setState(prev => {
        // Only update if we don't already have this video loaded
        if (prev.videoId !== externalVideoId) {
          return {
            ...prev,
            videoId: initialState?.videoId ?? null,
            videoTitle: initialState?.videoTitle ?? null,
            thumbnailUrl: initialState?.thumbnailUrl ?? null,
            currentTime: initialState?.currentTime ?? 0,
            volume: initialState?.volume ?? prev.volume,
            isMuted: initialState?.isMuted ?? prev.isMuted,
            position: initialState?.position ?? prev.position,
          };
        }
        return prev;
      });
    }
  }, [initialState?.videoId, initialState?.videoTitle, initialState?.thumbnailUrl, initialState?.currentTime, initialState?.volume, initialState?.isMuted, initialState?.position]);

  // Notify parent of state changes
  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);

  // Sync partial state to server
  const syncState = useCallback((partial: Partial<MusicPlayerState>) => {
    setState(prev => {
      const newState = { ...prev, ...partial };
      onSync?.(partial);
      return newState;
    });
  }, [onSync]);

  // Mode transitions
  const setMode = useCallback((mode: MusicPlayerMode) => {
    syncState({ mode });
  }, [syncState]);

  const toggleMode = useCallback(() => {
    setState(prev => {
      const newMode = prev.mode === 'hidden' ? 'audio' :
                      prev.mode === 'mini' ? 'audio' :
                      prev.mode === 'audio' ? 'video' : 'audio';
      onSync?.({ mode: newMode });
      return { ...prev, mode: newMode };
    });
  }, [onSync]);

  const minimize = useCallback(() => {
    syncState({ mode: 'mini' });
  }, [syncState]);

  const hide = useCallback(() => {
    syncState({ mode: 'hidden' });
  }, [syncState]);

  // Load video by URL or ID
  const loadVideo = useCallback((input: string) => {
    const videoId = extractVideoId(input);
    if (videoId) {
      const thumbnailUrl = getYouTubeThumbnail(videoId, 'medium');
      syncState({
        videoId,
        thumbnailUrl,
        currentTime: 0,
        duration: 0,
        isPlaying: true,
      });
    }
  }, [syncState]);

  // Play video from playlist
  const playFromPlaylist = useCallback((video: StarredVideo) => {
    syncState({
      videoId: video.videoId,
      videoTitle: video.videoTitle,
      thumbnailUrl: video.thumbnailUrl,
      currentTime: 0,
      duration: 0,
      isPlaying: true,
    });
    setShowPlaylist(false);
  }, [syncState]);

  // Playback controls
  const togglePlay = useCallback(() => {
    syncState({ isPlaying: !state.isPlaying });
  }, [state.isPlaying, syncState]);

  const setVolume = useCallback((volume: number) => {
    syncState({ volume: Math.max(0, Math.min(100, volume)) });
  }, [syncState]);

  const toggleMute = useCallback(() => {
    syncState({ isMuted: !state.isMuted });
  }, [state.isMuted, syncState]);

  const seek = useCallback((time: number) => {
    syncState({ currentTime: Math.max(0, Math.min(time, state.duration)) });
  }, [state.duration, syncState]);

  // Track last synced time for debouncing
  const lastSyncedTimeRef = useRef<number>(0);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const updatePlaybackState = useCallback((currentTime: number, duration: number) => {
    setState(prev => ({ ...prev, currentTime, duration }));

    // Debounced sync to server every 3 seconds during playback
    const timeSinceLastSync = Math.abs(currentTime - lastSyncedTimeRef.current);
    if (timeSinceLastSync >= 3) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(() => {
        onSync?.({ currentTime });
        lastSyncedTimeRef.current = currentTime;
      }, 500); // Small delay to batch rapid updates
    }
  }, [onSync]);

  // Cleanup sync timeout on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  const setVideoTitle = useCallback((title: string) => {
    syncState({ videoTitle: title });
  }, [syncState]);

  // Drag handling
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.music-player-controls, .music-player-search, button, input')) {
      return;
    }
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: state.position.x,
      posY: state.position.y,
    };
  }, [state.position]);

  const handleDragMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !dragStartRef.current) return;

    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;

    const newX = Math.max(0, Math.min(
      window.innerWidth - (containerRef.current?.offsetWidth || 320),
      dragStartRef.current.posX + deltaX
    ));
    const newY = Math.max(0, Math.min(
      window.innerHeight - (containerRef.current?.offsetHeight || 80),
      dragStartRef.current.posY + deltaY
    ));

    setState(prev => ({ ...prev, position: { x: newX, y: newY } }));

    // Detect if near bottom-left corner for snap zone
    const playerW = containerRef.current?.offsetWidth || 320;
    const playerH = containerRef.current?.offsetHeight || 80;
    const centerX = newX + playerW / 2;
    const centerY = newY + playerH / 2;

    // Only check bottom-left corner
    const bottomLeftX = 0;
    const bottomLeftY = window.innerHeight;
    const dist = Math.sqrt((centerX - bottomLeftX) ** 2 + (centerY - bottomLeftY) ** 2);

    setNearCorner(dist < SNAP_THRESHOLD * 2 ? 'bottom-left' : null);
  }, [isDragging, SNAP_THRESHOLD]);

  const handleDragEnd = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);

      // Snap to bottom-left if near it
      if (nearCorner === 'bottom-left' && containerRef.current) {
        const playerH = containerRef.current.offsetHeight;
        const snapX = DOCK_MARGIN;
        const snapY = window.innerHeight - playerH - DOCK_MARGIN;

        setState(prev => ({ ...prev, position: { x: snapX, y: snapY } }));
        onSync?.({ position: { x: snapX, y: snapY } });
      } else {
        onSync?.({ position: state.position });
      }

      setNearCorner(null);
      dragStartRef.current = null;
    }
  }, [isDragging, state.position, nearCorner, onSync, DOCK_MARGIN]);

  // Resize handling
  const handleResizeStart = useCallback((e: React.MouseEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
      posX: state.position.x,
      posY: state.position.y,
    };
  }, [size, state.position]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !resizeStartRef.current || !resizeDirection) return;

    const deltaX = e.clientX - resizeStartRef.current.x;
    const deltaY = e.clientY - resizeStartRef.current.y;
    const minWidth = 280;
    const minHeight = 160;
    const maxWidth = 800;
    const maxHeight = 600;

    let newWidth = resizeStartRef.current.width;
    let newHeight = resizeStartRef.current.height;
    let newX = resizeStartRef.current.posX;
    let newY = resizeStartRef.current.posY;

    // Handle horizontal resize
    if (resizeDirection.includes('e')) {
      newWidth = Math.min(maxWidth, Math.max(minWidth, resizeStartRef.current.width + deltaX));
    }
    if (resizeDirection.includes('w')) {
      const potentialWidth = resizeStartRef.current.width - deltaX;
      if (potentialWidth >= minWidth && potentialWidth <= maxWidth) {
        newWidth = potentialWidth;
        newX = resizeStartRef.current.posX + deltaX;
      }
    }

    // Handle vertical resize
    if (resizeDirection.includes('s')) {
      newHeight = Math.min(maxHeight, Math.max(minHeight, resizeStartRef.current.height + deltaY));
    }
    if (resizeDirection.includes('n')) {
      const potentialHeight = resizeStartRef.current.height - deltaY;
      if (potentialHeight >= minHeight && potentialHeight <= maxHeight) {
        newHeight = potentialHeight;
        newY = resizeStartRef.current.posY + deltaY;
      }
    }

    setSize({ width: newWidth, height: newHeight });
    setState(prev => ({ ...prev, position: { x: newX, y: newY } }));
  }, [isResizing, resizeDirection]);

  const handleResizeEnd = useCallback(() => {
    if (isResizing) {
      setIsResizing(false);
      setResizeDirection(null);
      resizeStartRef.current = null;
    }
  }, [isResizing]);

  // Attach global mouse events for dragging
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      return () => {
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
      };
    }
  }, [isDragging, handleDragMove, handleDragEnd]);

  // Attach global mouse events for resizing
  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleResizeMove);
      window.addEventListener('mouseup', handleResizeEnd);
      return () => {
        window.removeEventListener('mousemove', handleResizeMove);
        window.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  // Keyboard shortcuts when player is visible
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if player is visible and not typing in input
      if (state.mode === 'hidden') return;
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      // Escape to minimize
      if (e.key === 'Escape') {
        e.preventDefault();
        minimize();
        return;
      }

      // Other shortcuts only when player is focused or no input focused
      if (document.activeElement?.closest('.music-player')) {
        switch (e.key) {
          case ' ':
            e.preventDefault();
            togglePlay();
            break;
          case 'ArrowLeft':
            e.preventDefault();
            seek(state.currentTime - 10);
            break;
          case 'ArrowRight':
            e.preventDefault();
            seek(state.currentTime + 10);
            break;
          case 'ArrowUp':
            e.preventDefault();
            setVolume(state.volume + 10);
            break;
          case 'ArrowDown':
            e.preventDefault();
            setVolume(state.volume - 10);
            break;
          case 'm':
          case 'M':
            e.preventDefault();
            toggleMute();
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.mode, state.currentTime, state.volume, minimize, togglePlay, seek, setVolume, toggleMute]);

  if (state.mode === 'hidden') {
    return null;
  }

  if (state.mode === 'mini') {
    return (
      <MusicPlayerMini
        isPlaying={state.isPlaying}
        thumbnailUrl={state.thumbnailUrl}
        onClick={() => setMode('audio')}
      />
    );
  }

  return (
    <>
      {/* Snap zone indicator (visible during drag, bottom-left only) */}
      {isDragging && (
        <div className="fixed inset-0 z-[89] pointer-events-none">
          <div
            className={`
              absolute w-24 h-24 bottom-0 left-0 rounded-tr-2xl
              transition-all duration-200
              ${
                nearCorner === 'bottom-left'
                  ? 'bg-[#00d4ff]/20 border-2 border-[#00d4ff]/50 shadow-[0_0_30px_rgba(0,212,255,0.3)]'
                  : 'bg-white/[0.03] border border-white/[0.06]'
              }
            `}
          >
            {nearCorner === 'bottom-left' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-[#00d4ff] shadow-[0_0_12px_rgba(0,212,255,0.6)] animate-pulse" />
              </div>
            )}
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className={`music-player music-player-${state.mode} ${isDragging ? 'is-dragging' : ''} ${isFullscreen ? 'is-fullscreen' : ''} ${isResizing ? 'is-resizing' : ''}`}
        style={{
          left: state.position.x,
          top: state.position.y,
          ...(state.mode === 'video' || isFullscreen ? { width: size.width, height: size.height } : {}),
        }}
        tabIndex={0}
      >
      <MusicPlayerContent
        mode={state.mode}
        videoId={state.videoId}
        videoTitle={state.videoTitle}
        thumbnailUrl={state.thumbnailUrl}
        isPlaying={state.isPlaying}
        volume={state.volume}
        isMuted={state.isMuted}
        currentTime={state.currentTime}
        duration={state.duration}
        onDragStart={handleDragStart}
        onTogglePlay={togglePlay}
        onVolumeChange={setVolume}
        onToggleMute={toggleMute}
        onSeek={seek}
        onLoadVideo={loadVideo}
        onToggleMode={toggleMode}
        onMinimize={minimize}
        onClose={hide}
        onPlaybackUpdate={updatePlaybackState}
        onTitleChange={setVideoTitle}
        starredVideos={starredVideos}
        isCurrentVideoStarred={isCurrentVideoStarred}
        showPlaylist={showPlaylist}
        onToggleStar={toggleStar}
        onTogglePlaylist={() => setShowPlaylist(prev => !prev)}
        onPlayFromPlaylist={playFromPlaylist}
        onRemoveStarred={removeStarred}
        isFullscreen={isFullscreen}
        onToggleFullscreen={() => setIsFullscreen(prev => !prev)}
        onResizeStart={handleResizeStart}
        onDockToWindow={onDockToWindow}
      />
    </div>
    </>
  );
};

export default MusicPlayer;
