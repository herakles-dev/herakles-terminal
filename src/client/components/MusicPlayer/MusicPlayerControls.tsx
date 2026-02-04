import React, { useCallback, useRef, useState } from 'react';
import { formatTime } from '../../../shared/musicProtocol.js';

interface MusicPlayerControlsProps {
  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  currentTime: number;
  duration: number;
  onTogglePlay: () => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onSeek: (time: number) => void;
  disabled?: boolean;
}

export const MusicPlayerControls: React.FC<MusicPlayerControlsProps> = ({
  isPlaying,
  volume,
  isMuted,
  currentTime,
  duration,
  onTogglePlay,
  onVolumeChange,
  onToggleMute,
  onSeek,
  disabled = false,
}) => {
  const progressRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const [showVolume, setShowVolume] = useState(false);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const effectiveVolume = isMuted ? 0 : volume;

  // Progress bar seeking
  const handleProgressClick = useCallback((e: React.MouseEvent) => {
    if (!progressRef.current || disabled || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(percent * duration);
  }, [duration, onSeek, disabled]);

  const handleProgressDrag = useCallback((e: MouseEvent) => {
    if (!progressRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(percent * duration);
  }, [duration, onSeek]);

  const handleProgressMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled || !duration) return;
    setIsDraggingProgress(true);
    handleProgressClick(e);

    const handleMouseMove = (e: MouseEvent) => handleProgressDrag(e);
    const handleMouseUp = () => {
      setIsDraggingProgress(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [disabled, duration, handleProgressClick, handleProgressDrag]);

  // Volume slider
  const handleVolumeClick = useCallback((e: React.MouseEvent) => {
    if (!volumeRef.current) return;
    const rect = volumeRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onVolumeChange(Math.round(percent * 100));
  }, [onVolumeChange]);

  const handleVolumeDrag = useCallback((e: MouseEvent) => {
    if (!volumeRef.current) return;
    const rect = volumeRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onVolumeChange(Math.round(percent * 100));
  }, [onVolumeChange]);

  const handleVolumeMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDraggingVolume(true);
    handleVolumeClick(e);

    const handleMouseMove = (e: MouseEvent) => handleVolumeDrag(e);
    const handleMouseUp = () => {
      setIsDraggingVolume(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [handleVolumeClick, handleVolumeDrag]);

  const VolumeIcon = () => {
    if (isMuted || effectiveVolume === 0) {
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
        </svg>
      );
    }
    if (effectiveVolume < 50) {
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
      </svg>
    );
  };

  return (
    <div className="music-player-controls">
      {/* Play/Pause button */}
      <button
        className="music-player-play-btn"
        onClick={onTogglePlay}
        disabled={disabled}
        title={isPlaying ? 'Pause' : 'Play'}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? (
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Progress bar */}
      <div
        ref={progressRef}
        className={`music-player-progress ${isDraggingProgress ? 'is-dragging' : ''}`}
        onMouseDown={handleProgressMouseDown}
      >
        <div className="music-player-progress-track">
          <div
            className="music-player-progress-fill"
            style={{ width: `${progress}%` }}
          />
          <div
            className="music-player-progress-handle"
            style={{ left: `${progress}%` }}
          />
        </div>
      </div>

      {/* Time display */}
      <div className="music-player-time">
        {formatTime(currentTime)} / {formatTime(duration)}
      </div>

      {/* Volume control */}
      <div
        className="music-player-volume"
        onMouseEnter={() => setShowVolume(true)}
        onMouseLeave={() => !isDraggingVolume && setShowVolume(false)}
      >
        <button
          className="music-player-volume-btn"
          onClick={onToggleMute}
          title={isMuted ? 'Unmute' : 'Mute'}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
        >
          <VolumeIcon />
        </button>
        <div className={`music-player-volume-slider ${showVolume || isDraggingVolume ? 'visible' : ''}`}>
          <div
            ref={volumeRef}
            className="music-player-volume-track"
            onMouseDown={handleVolumeMouseDown}
          >
            <div
              className="music-player-volume-fill"
              style={{ width: `${effectiveVolume}%` }}
            />
            <div
              className="music-player-volume-handle"
              style={{ left: `${effectiveVolume}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MusicPlayerControls;
