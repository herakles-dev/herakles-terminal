/**
 * Music Player Protocol - WebSocket message types and state interfaces
 */

// Player display modes
export type MusicPlayerMode = 'hidden' | 'mini' | 'audio' | 'video';

// Dock position presets
export type DockPosition = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right' | 'floating';

// Dock layout state (persisted independently from player state)
export interface MusicDockState {
  position: DockPosition;
  size: { width: number; height: number };
  collapsed: boolean;
}

export const DEFAULT_DOCK_STATE: MusicDockState = {
  position: 'bottom-right',
  size: { width: 320, height: 180 },
  collapsed: false,
};

// Starred video entry for playlist
export interface StarredVideo {
  videoId: string;
  videoTitle: string;
  thumbnailUrl: string;
  starredAt: number; // Unix timestamp
}

// Full player state
export interface MusicPlayerState {
  mode: MusicPlayerMode;
  position: { x: number; y: number };
  videoId: string | null;
  videoTitle: string | null;
  thumbnailUrl: string | null;
  isPlaying: boolean;
  volume: number; // 0-100
  currentTime: number; // seconds
  duration: number; // seconds
  isMuted: boolean;
}

// Default initial state
export const DEFAULT_MUSIC_PLAYER_STATE: MusicPlayerState = {
  mode: 'hidden',
  position: { x: 100, y: 100 },
  videoId: null,
  videoTitle: null,
  thumbnailUrl: null,
  isPlaying: false,
  volume: 80,
  currentTime: 0,
  duration: 0,
  isMuted: false,
};

// ============================================
// Client → Server Messages
// ============================================

export interface MusicSyncMessage {
  type: 'music:sync';
  state: Partial<MusicPlayerState>;
}

export interface MusicLoadMessage {
  type: 'music:load';
  videoId: string;
  videoTitle?: string;
  thumbnailUrl?: string;
}

export interface MusicSubscribeMessage {
  type: 'music:subscribe';
}

export interface MusicUnsubscribeMessage {
  type: 'music:unsubscribe';
}

export interface MusicDockUpdateMessage {
  type: 'music:dock:update';
  state: MusicDockState;
}

export type MusicClientMessage =
  | MusicSyncMessage
  | MusicLoadMessage
  | MusicSubscribeMessage
  | MusicUnsubscribeMessage
  | MusicDockUpdateMessage;

// ============================================
// Server → Client Messages
// ============================================

export interface MusicStateMessage {
  type: 'music:state';
  state: MusicPlayerState;
}

export interface MusicErrorMessage {
  type: 'music:error';
  code: string;
  message: string;
}

export interface MusicDockRestoreMessage {
  type: 'music:dock:restore';
  state: MusicDockState;
}

export type MusicServerMessage = MusicStateMessage | MusicErrorMessage | MusicDockRestoreMessage;

// ============================================
// YouTube URL Parsing Utilities
// ============================================

const YOUTUBE_URL_PATTERNS = [
  /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  /^([a-zA-Z0-9_-]{11})$/, // Raw video ID
];

export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  for (const pattern of YOUTUBE_URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

export function getYouTubeThumbnail(videoId: string, quality: 'default' | 'medium' | 'high' | 'maxres' = 'medium'): string {
  const qualityMap = {
    default: 'default',
    medium: 'mqdefault',
    high: 'hqdefault',
    maxres: 'maxresdefault',
  };
  return `https://img.youtube.com/vi/${videoId}/${qualityMap[quality]}.jpg`;
}

export function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
