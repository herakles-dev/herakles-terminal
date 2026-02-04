import React from 'react';

interface MusicPlayerMiniProps {
  isPlaying: boolean;
  thumbnailUrl: string | null;
  onClick: () => void;
}

export const MusicPlayerMini: React.FC<MusicPlayerMiniProps> = ({
  isPlaying,
  thumbnailUrl,
  onClick,
}) => {
  return (
    <button
      className={`music-player-mini ${isPlaying ? 'is-playing' : ''}`}
      onClick={onClick}
      title="Expand music player"
      aria-label="Expand music player"
    >
      {thumbnailUrl ? (
        <div
          className="music-player-mini-thumbnail"
          style={{ backgroundImage: `url(${thumbnailUrl})` }}
        />
      ) : null}
      <div className="music-player-mini-icon">
        {isPlaying ? (
          <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </div>
      {isPlaying && (
        <div className="music-player-mini-pulse" />
      )}
    </button>
  );
};

export default MusicPlayerMini;
