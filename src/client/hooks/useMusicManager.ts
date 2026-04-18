/**
 * useMusicManager — Extracted from App.tsx to manage all music player state,
 * YouTube button, starred videos, CSRF tokens, and media window lifecycle.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { apiUrl } from '../services/api';
import type { MusicPlayerState, MusicDockState, StarredVideo } from '@shared/musicProtocol';
import { DEFAULT_DOCK_STATE, getYouTubeThumbnail, extractVideoId } from '@shared/musicProtocol';

interface UseMusicManagerOptions {
  sendMessage: (msg: object) => void;
  sessionId: string | undefined;
  windows: Array<{ id: string; type: string }>;
}

export function useMusicManager({ sendMessage, sessionId, windows }: UseMusicManagerOptions) {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [musicPlayerVisible, setMusicPlayerVisible] = useState(false);
  const [musicPlayerState, setMusicPlayerState] = useState<Partial<MusicPlayerState>>({});
  const [musicDockState, setMusicDockState] = useState<MusicDockState>(DEFAULT_DOCK_STATE);
  const [starredVideos, setStarredVideos] = useState<StarredVideo[]>([]);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [youtubeButtonPos, setYoutubeButtonPos] = useState(() => ({
    x: 16, y: typeof window !== 'undefined' ? window.innerHeight - 80 : 500,
  }));
  const [isDraggingYoutubeBtn, setIsDraggingYoutubeBtn] = useState(false);
  const youtubeDragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number }>();
  const csrfTokenRef = useRef<string | null>(null);
  const musicSyncTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // ---------------------------------------------------------------------------
  // Memoized state change callback (prevents infinite render loop)
  // ---------------------------------------------------------------------------
  const handleMusicPlayerStateChange = useCallback((state: MusicPlayerState) => {
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
    }));
  }, []);

  // ---------------------------------------------------------------------------
  // Mount effects: CSRF token, starred videos, persisted state
  // ---------------------------------------------------------------------------
  useEffect(() => {
    fetch(apiUrl('/csrf-token'), { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.data?.token) {
          csrfTokenRef.current = data.data.token;
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(apiUrl('/music/starred'), { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.data) {
          setStarredVideos(data.data);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(apiUrl('/music/state'), { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.data?.videoId) {
          setMusicPlayerState({
            videoId: data.data.videoId,
            videoTitle: data.data.videoTitle,
            thumbnailUrl: data.data.thumbnailUrl,
            volume: data.data.volume,
            currentTime: data.data.currentTime,
            isMuted: data.data.isMuted,
            position: data.data.position,
            isPlaying: false,
          });
          if (data.data.mode !== 'hidden') {
            setMusicPlayerVisible(true);
          }
        }
      })
      .catch(() => {});
  }, []);

  // ---------------------------------------------------------------------------
  // Debounced sync for music player state persistence
  // ---------------------------------------------------------------------------
  const handleMusicPlayerSync = useCallback((state: Partial<MusicPlayerState>) => {
    const immediate = state.videoId !== undefined || state.mode !== undefined;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (csrfTokenRef.current) {
      headers['x-csrf-token'] = csrfTokenRef.current;
    }

    if (immediate) {
      fetch(apiUrl('/music/state'), {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify(state),
      }).catch(() => {});
    } else {
      clearTimeout(musicSyncTimeoutRef.current);
      musicSyncTimeoutRef.current = setTimeout(() => {
        const timeoutHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (csrfTokenRef.current) {
          timeoutHeaders['x-csrf-token'] = csrfTokenRef.current;
        }
        fetch(apiUrl('/music/state'), {
          method: 'PUT',
          headers: timeoutHeaders,
          credentials: 'include',
          body: JSON.stringify(state),
        }).catch(() => {});
      }, 2000);
    }
  }, []);

  // Cleanup sync timeout on unmount
  useEffect(() => {
    return () => {
      if (musicSyncTimeoutRef.current) clearTimeout(musicSyncTimeoutRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // YouTube button drag
  // ---------------------------------------------------------------------------
  const handleYoutubeButtonDragStart = useCallback((e: React.MouseEvent) => {
    setIsDraggingYoutubeBtn(true);
    youtubeDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: youtubeButtonPos.x,
      startPosY: youtubeButtonPos.y,
    };
  }, [youtubeButtonPos]);

  useEffect(() => {
    if (!isDraggingYoutubeBtn) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!youtubeDragRef.current) return;
      const deltaX = e.clientX - youtubeDragRef.current.startX;
      const deltaY = e.clientY - youtubeDragRef.current.startY;
      const newX = Math.max(0, Math.min(window.innerWidth - 48, youtubeDragRef.current.startPosX + deltaX));
      const newY = Math.max(0, Math.min(window.innerHeight - 48, youtubeDragRef.current.startPosY + deltaY));
      setYoutubeButtonPos({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDraggingYoutubeBtn(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingYoutubeBtn]);

  // ---------------------------------------------------------------------------
  // Playback control callbacks
  // ---------------------------------------------------------------------------
  const handleTogglePlay = useCallback(() => {
    setMusicPlayerState(prev => ({ ...prev, isPlaying: !prev.isPlaying }));
  }, []);

  const handleVolumeChange = useCallback((volume: number) => {
    setMusicPlayerState(prev => ({ ...prev, volume }));
  }, []);

  const handleToggleMute = useCallback(() => {
    setMusicPlayerState(prev => ({ ...prev, isMuted: !prev.isMuted }));
  }, []);

  const handleSeek = useCallback((time: number) => {
    setMusicPlayerState(prev => ({ ...prev, currentTime: time }));
  }, []);

  const handleLoadVideo = useCallback((url: string) => {
    const videoId = extractVideoId(url);
    if (videoId) {
      setMusicPlayerState(prev => ({
        ...prev,
        videoId,
        thumbnailUrl: getYouTubeThumbnail(videoId, 'medium'),
        isPlaying: false,
      }));
    }
  }, []);

  const handlePlaybackUpdate = useCallback((currentTime: number, duration: number) => {
    setMusicPlayerState(prev => ({ ...prev, currentTime, duration }));
  }, []);

  const handleVideoTitleChange = useCallback((title: string) => {
    setMusicPlayerState(prev => ({ ...prev, videoTitle: title }));
  }, []);

  // ---------------------------------------------------------------------------
  // Starred videos CRUD
  // ---------------------------------------------------------------------------
  const handleToggleStar = useCallback(async () => {
    if (!musicPlayerState.videoId) return;

    const video = {
      videoId: musicPlayerState.videoId,
      videoTitle: musicPlayerState.videoTitle || 'Unknown',
      thumbnailUrl: musicPlayerState.thumbnailUrl || getYouTubeThumbnail(musicPlayerState.videoId, 'medium'),
    };

    const isStarred = starredVideos.some(v => v.videoId === musicPlayerState.videoId);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (csrfTokenRef.current) {
      headers['x-csrf-token'] = csrfTokenRef.current;
    }

    if (isStarred) {
      setStarredVideos(prev => prev.filter(v => v.videoId !== musicPlayerState.videoId));
      try {
        const res = await fetch(apiUrl(`/music/starred/${musicPlayerState.videoId}`), {
          method: 'DELETE',
          headers,
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setStarredVideos(data.data);
        }
      } catch {
        // Optimistic update already applied
      }
    } else {
      setStarredVideos(prev => [{ ...video, starredAt: Date.now() }, ...prev]);
      try {
        const res = await fetch(apiUrl('/music/starred'), {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify(video),
        });
        if (res.ok) {
          const data = await res.json();
          setStarredVideos(data.data);
        }
      } catch {
        setStarredVideos(prev => prev.filter(v => v.videoId !== musicPlayerState.videoId));
      }
    }
  }, [musicPlayerState.videoId, musicPlayerState.videoTitle, musicPlayerState.thumbnailUrl, starredVideos]);

  const handleRemoveStarred = useCallback(async (videoId: string) => {
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
    } catch {
      // Silent failure
    }
  }, []);

  const handlePlayFromPlaylist = useCallback((video: StarredVideo) => {
    setMusicPlayerState(prev => ({
      ...prev,
      videoId: video.videoId,
      videoTitle: video.videoTitle,
      thumbnailUrl: video.thumbnailUrl,
      isPlaying: true,
    }));
  }, []);

  // ---------------------------------------------------------------------------
  // Computed values
  // ---------------------------------------------------------------------------
  const isCurrentVideoStarred = musicPlayerState.videoId
    ? starredVideos.some(v => v.videoId === musicPlayerState.videoId)
    : false;

  // ---------------------------------------------------------------------------
  // Refs for renderWindow (avoids re-render cascades during playback)
  // ---------------------------------------------------------------------------
  const musicPlayerStateRef = useRef(musicPlayerState);
  musicPlayerStateRef.current = musicPlayerState;
  const starredVideosRef = useRef(starredVideos);
  starredVideosRef.current = starredVideos;
  const isCurrentVideoStarredRef = useRef(isCurrentVideoStarred);
  isCurrentVideoStarredRef.current = isCurrentVideoStarred;
  const showPlaylistRef = useRef(showPlaylist);
  showPlaylistRef.current = showPlaylist;

  // ---------------------------------------------------------------------------
  // Media window mode toggle
  // ---------------------------------------------------------------------------
  const handleDockToWindow = useCallback(() => {
    if (!sessionId) return;
    const existingMediaWindow = windows.find(w => w.type === 'media');
    if (existingMediaWindow) {
      sendMessage({ type: 'window:focus', windowId: existingMediaWindow.id });
      setMusicPlayerVisible(false);
      return;
    }
    sendMessage({ type: 'window:create', sessionId, windowType: 'media' });
    setMusicPlayerVisible(false);
  }, [sessionId, sendMessage, windows]);

  const handleUndockToFloat = useCallback((windowId: string) => {
    sendMessage({ type: 'window:close', windowId });
    setMusicPlayerVisible(true);
  }, [sendMessage]);

  // ---------------------------------------------------------------------------
  // WebSocket message handler for music dock state updates
  // ---------------------------------------------------------------------------
  const handleMusicMessage = useCallback((msg: { type: string; state?: MusicDockState }) => {
    if (msg.type === 'music:dock:restore' && msg.state) {
      setMusicDockState(msg.state);
    }
  }, []);

  return {
    // State
    musicPlayerVisible,
    setMusicPlayerVisible,
    musicPlayerState,
    setMusicPlayerState,
    musicDockState,
    starredVideos,
    showPlaylist,
    setShowPlaylist,
    youtubeButtonPos,
    isCurrentVideoStarred,

    // Handlers
    handleMusicPlayerStateChange,
    handleMusicPlayerSync,
    handleTogglePlay,
    handleVolumeChange,
    handleToggleMute,
    handleSeek,
    handleLoadVideo,
    handlePlaybackUpdate,
    handleVideoTitleChange,
    handleToggleStar,
    handleRemoveStarred,
    handlePlayFromPlaylist,
    handleDockToWindow,
    handleUndockToFloat,
    handleYoutubeButtonDragStart,
    handleMusicMessage,

    // Refs for renderWindow (avoid re-render cascades)
    musicPlayerStateRef,
    starredVideosRef,
    isCurrentVideoStarredRef,
    showPlaylistRef,
  };
}
