import { describe, it, expect } from 'vitest';
import {
  extractVideoId,
  getYouTubeThumbnail,
  formatTime,
  DEFAULT_MUSIC_PLAYER_STATE,
  DEFAULT_DOCK_STATE,
} from '../musicProtocol';

describe('musicProtocol', () => {
  describe('extractVideoId', () => {
    it('extracts from full YouTube URL', () => {
      expect(extractVideoId('https://youtube.com/watch?v=dQw4w9WgXcB')).toBe('dQw4w9WgXcB');
    });

    it('extracts from youtu.be short URL', () => {
      expect(extractVideoId('https://youtu.be/dQw4w9WgXcB')).toBe('dQw4w9WgXcB');
    });

    it('extracts from embed URL', () => {
      expect(extractVideoId('https://youtube.com/embed/dQw4w9WgXcB')).toBe('dQw4w9WgXcB');
    });

    it('extracts raw 11-char video ID', () => {
      expect(extractVideoId('dQw4w9WgXcB')).toBe('dQw4w9WgXcB');
    });

    it('returns null for invalid input', () => {
      expect(extractVideoId('not-a-url')).toBeNull();
      expect(extractVideoId('')).toBeNull();
      expect(extractVideoId('https://example.com')).toBeNull();
    });

    it('trims whitespace', () => {
      expect(extractVideoId('  dQw4w9WgXcB  ')).toBe('dQw4w9WgXcB');
    });
  });

  describe('getYouTubeThumbnail', () => {
    it('returns medium quality URL by default', () => {
      expect(getYouTubeThumbnail('abc123_-XYZ')).toBe(
        'https://img.youtube.com/vi/abc123_-XYZ/mqdefault.jpg'
      );
    });

    it('returns correct URL for each quality level', () => {
      expect(getYouTubeThumbnail('id', 'default')).toContain('/default.jpg');
      expect(getYouTubeThumbnail('id', 'medium')).toContain('/mqdefault.jpg');
      expect(getYouTubeThumbnail('id', 'high')).toContain('/hqdefault.jpg');
      expect(getYouTubeThumbnail('id', 'maxres')).toContain('/maxresdefault.jpg');
    });
  });

  describe('formatTime', () => {
    it('formats seconds to mm:ss', () => {
      expect(formatTime(0)).toBe('0:00');
      expect(formatTime(65)).toBe('1:05');
      expect(formatTime(3600)).toBe('60:00');
      expect(formatTime(125)).toBe('2:05');
    });

    it('handles NaN and Infinity', () => {
      expect(formatTime(NaN)).toBe('0:00');
      expect(formatTime(Infinity)).toBe('0:00');
    });

    it('pads seconds with leading zero', () => {
      expect(formatTime(5)).toBe('0:05');
      expect(formatTime(9)).toBe('0:09');
    });
  });

  describe('defaults', () => {
    it('has correct default player state', () => {
      expect(DEFAULT_MUSIC_PLAYER_STATE.mode).toBe('hidden');
      expect(DEFAULT_MUSIC_PLAYER_STATE.volume).toBe(80);
      expect(DEFAULT_MUSIC_PLAYER_STATE.isPlaying).toBe(false);
      expect(DEFAULT_MUSIC_PLAYER_STATE.isMuted).toBe(false);
      expect(DEFAULT_MUSIC_PLAYER_STATE.videoId).toBeNull();
    });

    it('has correct default dock state', () => {
      expect(DEFAULT_DOCK_STATE.position).toBe('bottom-right');
      expect(DEFAULT_DOCK_STATE.size).toEqual({ width: 320, height: 180 });
      expect(DEFAULT_DOCK_STATE.collapsed).toBe(false);
    });
  });
});
