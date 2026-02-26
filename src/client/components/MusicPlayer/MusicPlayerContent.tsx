import React, { useRef, useEffect, useCallback, useState } from 'react';
import { MusicPlayerMode, StarredVideo } from '../../../shared/musicProtocol.js';
import { MusicPlayerControls } from './MusicPlayerControls.js';
import { MusicPlayerSearch } from './MusicPlayerSearch.js';

// YouTube IFrame Player API types
declare global {
  interface Window {
    YT: {
      Player: new (
        elementId: string | HTMLElement,
        options: {
          videoId?: string;
          width?: number | string;
          height?: number | string;
          playerVars?: Record<string, number | string>;
          events?: {
            onReady?: (event: { target: YTPlayer }) => void;
            onStateChange?: (event: { data: number; target: YTPlayer }) => void;
            onError?: (event: { data: number }) => void;
          };
        }
      ) => YTPlayer;
      PlayerState: {
        UNSTARTED: -1;
        ENDED: 0;
        PLAYING: 1;
        PAUSED: 2;
        BUFFERING: 3;
        CUED: 5;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getVolume(): number;
  getCurrentTime(): number;
  getDuration(): number;
  getVideoData(): { title?: string; video_id?: string };
  destroy(): void;
  loadVideoById(videoId: string, startSeconds?: number): void;
  cueVideoById(videoId: string, startSeconds?: number): void;
}

interface MusicPlayerContentProps {
  mode: MusicPlayerMode;
  videoId: string | null;
  videoTitle: string | null;
  thumbnailUrl: string | null;
  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  currentTime: number;
  duration: number;
  onDragStart: (e: React.MouseEvent) => void;
  onTogglePlay: () => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onSeek: (time: number) => void;
  onLoadVideo: (url: string) => void;
  onToggleMode: () => void;
  onMinimize: () => void;
  onClose: () => void;
  onPlaybackUpdate: (currentTime: number, duration: number) => void;
  onTitleChange: (title: string) => void;
  // Starred videos props
  starredVideos: StarredVideo[];
  isCurrentVideoStarred: boolean;
  showPlaylist: boolean;
  onToggleStar: () => void;
  onTogglePlaylist: () => void;
  onPlayFromPlaylist: (video: StarredVideo) => void;
  onRemoveStarred: (videoId: string) => void;
  // Fullscreen props
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  // Resize props
  onResizeStart: (e: React.MouseEvent, direction: string) => void;
  // Dock to window prop
  onDockToWindow?: () => void;
}

let ytApiLoaded = false;
let ytApiLoading = false;
const ytApiCallbacks: (() => void)[] = [];

const loadYouTubeAPI = (): Promise<void> => {
  return new Promise((resolve) => {
    if (ytApiLoaded) {
      resolve();
      return;
    }

    ytApiCallbacks.push(resolve);

    if (ytApiLoading) return;
    ytApiLoading = true;

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;

    window.onYouTubeIframeAPIReady = () => {
      ytApiLoaded = true;
      ytApiCallbacks.forEach(cb => cb());
      ytApiCallbacks.length = 0;
    };

    document.head.appendChild(script);
  });
};

export const MusicPlayerContent: React.FC<MusicPlayerContentProps> = ({
  mode,
  videoId,
  videoTitle,
  thumbnailUrl,
  isPlaying,
  volume,
  isMuted,
  currentTime,
  duration,
  onDragStart,
  onTogglePlay,
  onVolumeChange,
  onToggleMute,
  onSeek,
  onLoadVideo,
  onToggleMode,
  onMinimize,
  onClose,
  onPlaybackUpdate,
  onTitleChange,
  starredVideos,
  isCurrentVideoStarred,
  showPlaylist,
  onToggleStar,
  onTogglePlaylist,
  onPlayFromPlaylist,
  onRemoveStarred,
  isFullscreen,
  onToggleFullscreen,
  onResizeStart,
  onDockToWindow,
}) => {
  const playerRef = useRef<YTPlayer | null>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const updateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadedVideoRef = useRef<string | null>(null); // Track which videoId is loaded
  const resumedAtTimeRef = useRef<number>(0); // Track the time we resumed to (0 = hasn't resumed yet)
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isApiLoaded, setIsApiLoaded] = useState(ytApiLoaded);

  // Load YouTube API
  useEffect(() => {
    loadYouTubeAPI().then(() => setIsApiLoaded(true));
  }, []);

  // Initialize player
  useEffect(() => {
    if (!isApiLoaded || !playerContainerRef.current) return;

    const initPlayer = () => {
      if (playerRef.current) return;

      // Use ID string so YouTube creates iframe INSIDE the target div, not replacing it
      playerRef.current = new window.YT.Player('youtube-player-target', {
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            setIsPlayerReady(true);
            if (videoId) {
              playerRef.current?.cueVideoById(videoId);
            }
          },
          onStateChange: () => {
            const data = playerRef.current?.getVideoData();
            if (data?.title && data.title !== videoTitle) {
              onTitleChange(data.title);
            }
          },
          onError: (event) => {
            console.error('YouTube player error:', event.data);
          },
        },
      });
    };

    // Small delay to ensure DOM is ready
    const timeoutId = setTimeout(initPlayer, 100);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [isApiLoaded]);

  // Handle video changes - load video when videoId changes
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current || !videoId) return;

    // Only load if this is a different video
    if (loadedVideoRef.current === videoId) return;

    console.log('[MusicResume] Loading video:', videoId, 'currentTime prop:', currentTime);

    // Load the video - we'll handle resume separately
    const startTime = currentTime > 0 ? currentTime : 0;
    playerRef.current.loadVideoById(videoId, startTime);
    loadedVideoRef.current = videoId;
    resumedAtTimeRef.current = startTime; // Track what time we started at

    if (isPlaying) {
      playerRef.current.playVideo();
    }
  }, [videoId, isPlayerReady, currentTime, isPlaying]);

  // Handle resume when currentTime prop updates after video is loaded
  // This catches the case where currentTime arrives from API after video already loaded at 0
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current || !videoId) return;
    if (loadedVideoRef.current !== videoId) return; // Video not loaded yet
    if (resumedAtTimeRef.current > 0) return; // Already resumed to a non-zero time
    if (currentTime <= 0) return; // No saved time to resume to

    console.log('[MusicResume] Late resume - seeking to:', currentTime);
    playerRef.current.seekTo(currentTime, true);
    resumedAtTimeRef.current = currentTime;
  }, [currentTime, isPlayerReady, videoId]);

  // Handle play/pause
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current) return;

    if (isPlaying) {
      playerRef.current.playVideo();
    } else {
      playerRef.current.pauseVideo();
    }
  }, [isPlaying, isPlayerReady]);

  // Handle volume
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current) return;

    playerRef.current.setVolume(volume);
  }, [volume, isPlayerReady]);

  // Handle mute
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current) return;

    if (isMuted) {
      playerRef.current.mute();
    } else {
      playerRef.current.unMute();
    }
  }, [isMuted, isPlayerReady]);

  // Playback time update
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current) return;

    if (isPlaying) {
      updateIntervalRef.current = setInterval(() => {
        if (playerRef.current) {
          const currentTime = playerRef.current.getCurrentTime();
          const duration = playerRef.current.getDuration();
          onPlaybackUpdate(currentTime, duration);
        }
      }, 500);
    }

    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
        updateIntervalRef.current = null;
      }
    };
  }, [isPlaying, isPlayerReady, onPlaybackUpdate]);

  // Handle seek
  const handleSeek = useCallback((time: number) => {
    if (playerRef.current && isPlayerReady) {
      playerRef.current.seekTo(time, true);
    }
    onSeek(time);
  }, [onSeek, isPlayerReady]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
      }
    };
  }, []);

  const displayTitle = videoTitle || (videoId ? 'Loading...' : 'No video loaded');

  return (
    <>
      {/* Header with drag handle - hidden in fullscreen */}
      {!isFullscreen && (
        <div className="music-player-header" onMouseDown={onDragStart}>
          <div className="music-player-drag-handle">
            <span className="drag-dots" />
          </div>
          <div className="music-player-title" title={displayTitle}>
            {displayTitle}
          </div>
          <div className="music-player-actions">
            <button
              className="music-player-action-btn"
              onClick={onToggleMode}
              title={mode === 'audio' ? 'Expand to video' : 'Collapse to audio'}
              aria-label={mode === 'audio' ? 'Expand to video' : 'Collapse to audio'}
            >
              {mode === 'audio' ? (
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                  <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
                </svg>
              )}
            </button>
            {onDockToWindow && (
              <button
                className="music-player-action-btn"
                onClick={onDockToWindow}
                title="Dock to Window"
                aria-label="Dock to Window"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                  <path d="M4 4h16v16H4V4zm2 2v12h12V6H6z"/>
                </svg>
              </button>
            )}
            <button
              className="music-player-action-btn"
              onClick={onMinimize}
              title="Minimize"
              aria-label="Minimize"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M19 13H5v-2h14v2z"/>
              </svg>
            </button>
            <button
              className="music-player-action-btn music-player-close-btn"
              onClick={onClose}
              title="Close"
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Video container - draggable in fullscreen mode */}
      <div
        className={`music-player-video-area ${mode === 'video' || isFullscreen ? 'visible' : ''} ${isFullscreen ? 'fullscreen-drag' : ''}`}
        onMouseDown={isFullscreen ? onDragStart : undefined}
      >
        {!videoId && (
          <div className="music-player-placeholder">
            <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48" opacity="0.3">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
            <span>Paste a YouTube URL to start</span>
          </div>
        )}
        {videoId && !isPlayerReady && thumbnailUrl && (
          <div
            className="music-player-thumbnail"
            style={{ backgroundImage: `url(${thumbnailUrl})` }}
          >
            <div className="music-player-loading">
              <div className="spinner" />
            </div>
          </div>
        )}
        <div
          ref={playerContainerRef}
          className="music-player-iframe"
          style={{ opacity: mode === 'video' ? 1 : 0 }}
        >
          <div id="youtube-player-target" />
        </div>

        {/* Star overlay - appears on hover */}
        {videoId && !isFullscreen && (
          <div className="music-player-star-overlay">
            <button
              className={`music-player-star-btn ${isCurrentVideoStarred ? 'starred' : ''}`}
              onClick={onToggleStar}
              title={isCurrentVideoStarred ? 'Remove from playlist' : 'Add to playlist'}
              aria-label={isCurrentVideoStarred ? 'Remove from playlist' : 'Add to playlist'}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
              </svg>
            </button>
          </div>
        )}

        {/* Fullscreen toggle - appears on hover in video mode */}
        {videoId && mode === 'video' && !isFullscreen && (
          <button
            className="music-player-fullscreen-btn"
            onClick={onToggleFullscreen}
            title="Borderless mode"
            aria-label="Enter borderless mode"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z"/>
            </svg>
          </button>
        )}

        {/* Exit fullscreen overlay - appears on hover in fullscreen mode */}
        {isFullscreen && (
          <div className="music-player-fullscreen-overlay">
            <button
              className="music-player-exit-fullscreen-btn"
              onClick={onToggleFullscreen}
              title="Exit borderless mode"
              aria-label="Exit borderless mode"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
              </svg>
            </button>
          </div>
        )}

        {/* Playlist toggle - appears on hover (hidden in fullscreen) */}
        {!isFullscreen && (
          <button
            className={`music-player-playlist-toggle ${showPlaylist ? 'active' : ''}`}
            onClick={onTogglePlaylist}
            title="Starred videos"
            aria-label="Starred videos"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
            </svg>
            {starredVideos.length > 0 && (
              <span className="playlist-badge">{starredVideos.length}</span>
            )}
          </button>
        )}

        {/* Playlist panel overlay - hidden in fullscreen */}
        {showPlaylist && !isFullscreen && (
          <div className="music-player-playlist-overlay">
            <div className="music-player-playlist-header">
              <span className="music-player-playlist-title">
                Starred
                <span className="music-player-playlist-count">{starredVideos.length}</span>
              </span>
              <button
                className="music-player-playlist-close"
                onClick={onTogglePlaylist}
                title="Close"
                aria-label="Close playlist"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
            <div className="music-player-playlist-items">
              {starredVideos.length === 0 ? (
                <div className="music-player-playlist-empty">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32" opacity="0.3">
                    <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                  </svg>
                  <span>No starred videos yet</span>
                  <span style={{ fontSize: '10px', opacity: 0.6 }}>Click the star to save videos</span>
                </div>
              ) : (
                starredVideos.map(video => (
                  <div
                    key={video.videoId}
                    className={`music-player-playlist-item ${video.videoId === videoId ? 'now-playing' : ''}`}
                    onClick={() => onPlayFromPlaylist(video)}
                  >
                    <img
                      src={video.thumbnailUrl}
                      alt=""
                      className="music-player-playlist-item-thumb"
                    />
                    <div className="music-player-playlist-item-info">
                      <span className="music-player-playlist-item-title" title={video.videoTitle}>
                        {video.videoTitle}
                      </span>
                    </div>
                    <button
                      className="music-player-playlist-item-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveStarred(video.videoId);
                      }}
                      title="Remove"
                      aria-label="Remove from playlist"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Controls - hidden in fullscreen */}
      {!isFullscreen && (
        <MusicPlayerControls
          isPlaying={isPlaying}
          volume={volume}
          isMuted={isMuted}
          currentTime={currentTime}
          duration={duration}
          onTogglePlay={onTogglePlay}
          onVolumeChange={onVolumeChange}
          onToggleMute={onToggleMute}
          onSeek={handleSeek}
          disabled={!videoId}
        />
      )}

      {/* Search/URL input - hidden in fullscreen */}
      {!isFullscreen && <MusicPlayerSearch onLoadVideo={onLoadVideo} />}

      {/* Resize handles - visible in video mode and fullscreen */}
      {(mode === 'video' || isFullscreen) && (
        <>
          {/* Corner handles */}
          <div
            className="music-player-resize-handle resize-nw"
            onMouseDown={(e) => onResizeStart(e, 'nw')}
          />
          <div
            className="music-player-resize-handle resize-ne"
            onMouseDown={(e) => onResizeStart(e, 'ne')}
          />
          <div
            className="music-player-resize-handle resize-sw"
            onMouseDown={(e) => onResizeStart(e, 'sw')}
          />
          <div
            className="music-player-resize-handle resize-se"
            onMouseDown={(e) => onResizeStart(e, 'se')}
          />
          {/* Edge handles */}
          <div
            className="music-player-resize-handle resize-n"
            onMouseDown={(e) => onResizeStart(e, 'n')}
          />
          <div
            className="music-player-resize-handle resize-s"
            onMouseDown={(e) => onResizeStart(e, 's')}
          />
          <div
            className="music-player-resize-handle resize-w"
            onMouseDown={(e) => onResizeStart(e, 'w')}
          />
          <div
            className="music-player-resize-handle resize-e"
            onMouseDown={(e) => onResizeStart(e, 'e')}
          />
        </>
      )}
    </>
  );
};

export default MusicPlayerContent;
