import type { Database } from 'better-sqlite3';
import type { MusicPlayerState, MusicPlayerMode, StarredVideo, MusicDockState } from '../../shared/musicProtocol.js';
import { DEFAULT_MUSIC_PLAYER_STATE, DEFAULT_DOCK_STATE } from '../../shared/musicProtocol.js';

interface MusicPlayerRow {
  user_email: string;
  mode: string;
  position_x: number;
  position_y: number;
  video_id: string | null;
  video_title: string | null;
  thumbnail_url: string | null;
  is_playing: number;
  volume: number;
  current_time: number;
  is_muted: number;
  starred_videos: string; // JSON array of StarredVideo
  updated_at: string;
}

export class MusicPlayerStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS music_player_state (
        user_email TEXT PRIMARY KEY,
        mode TEXT DEFAULT 'hidden',
        position_x INTEGER DEFAULT 100,
        position_y INTEGER DEFAULT 100,
        video_id TEXT,
        video_title TEXT,
        thumbnail_url TEXT,
        is_playing INTEGER DEFAULT 0,
        volume INTEGER DEFAULT 80,
        current_time REAL DEFAULT 0,
        is_muted INTEGER DEFAULT 0,
        starred_videos TEXT DEFAULT '[]',
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migration: Add starred_videos column if it doesn't exist
    const tableInfo = this.db.prepare("PRAGMA table_info(music_player_state)").all() as { name: string }[];
    const hasStarredVideos = tableInfo.some(col => col.name === 'starred_videos');
    if (!hasStarredVideos) {
      this.db.exec("ALTER TABLE music_player_state ADD COLUMN starred_videos TEXT DEFAULT '[]'");
    }

    // Migration: Add dock_state column if it doesn't exist
    const hasDockState = tableInfo.some(col => col.name === 'dock_state');
    if (!hasDockState) {
      this.db.exec(`ALTER TABLE music_player_state ADD COLUMN dock_state TEXT DEFAULT '${JSON.stringify(DEFAULT_DOCK_STATE)}'`);
    }
  }

  getState(userEmail: string): MusicPlayerState {
    const row = this.db.prepare(`
      SELECT * FROM music_player_state WHERE user_email = ?
    `).get(userEmail) as MusicPlayerRow | undefined;

    if (!row) {
      return { ...DEFAULT_MUSIC_PLAYER_STATE };
    }

    return {
      mode: row.mode as MusicPlayerMode,
      position: { x: row.position_x, y: row.position_y },
      videoId: row.video_id,
      videoTitle: row.video_title,
      thumbnailUrl: row.thumbnail_url,
      isPlaying: row.is_playing === 1,
      volume: row.volume,
      currentTime: row.current_time,
      duration: 0, // Duration is not persisted, loaded from player
      isMuted: row.is_muted === 1,
    };
  }

  saveState(userEmail: string, state: Partial<MusicPlayerState>): void {
    const existing = this.db.prepare(`
      SELECT user_email FROM music_player_state WHERE user_email = ?
    `).get(userEmail);

    if (existing) {
      // Build dynamic update query
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (state.mode !== undefined) {
        updates.push('mode = ?');
        values.push(state.mode);
      }
      if (state.position !== undefined) {
        updates.push('position_x = ?, position_y = ?');
        values.push(state.position.x, state.position.y);
      }
      if (state.videoId !== undefined) {
        updates.push('video_id = ?');
        values.push(state.videoId);
      }
      if (state.videoTitle !== undefined) {
        updates.push('video_title = ?');
        values.push(state.videoTitle);
      }
      if (state.thumbnailUrl !== undefined) {
        updates.push('thumbnail_url = ?');
        values.push(state.thumbnailUrl);
      }
      if (state.isPlaying !== undefined) {
        updates.push('is_playing = ?');
        values.push(state.isPlaying ? 1 : 0);
      }
      if (state.volume !== undefined) {
        updates.push('volume = ?');
        values.push(state.volume);
      }
      if (state.currentTime !== undefined) {
        updates.push('current_time = ?');
        values.push(state.currentTime);
      }
      if (state.isMuted !== undefined) {
        updates.push('is_muted = ?');
        values.push(state.isMuted ? 1 : 0);
      }

      if (updates.length > 0) {
        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(userEmail);

        this.db.prepare(`
          UPDATE music_player_state
          SET ${updates.join(', ')}
          WHERE user_email = ?
        `).run(...values);
      }
    } else {
      // Insert new row
      this.db.prepare(`
        INSERT INTO music_player_state (
          user_email, mode, position_x, position_y, video_id, video_title,
          thumbnail_url, is_playing, volume, current_time, is_muted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userEmail,
        state.mode ?? DEFAULT_MUSIC_PLAYER_STATE.mode,
        state.position?.x ?? DEFAULT_MUSIC_PLAYER_STATE.position.x,
        state.position?.y ?? DEFAULT_MUSIC_PLAYER_STATE.position.y,
        state.videoId ?? null,
        state.videoTitle ?? null,
        state.thumbnailUrl ?? null,
        state.isPlaying ? 1 : 0,
        state.volume ?? DEFAULT_MUSIC_PLAYER_STATE.volume,
        state.currentTime ?? 0,
        state.isMuted ? 1 : 0
      );
    }
  }

  // ============================================
  // Dock State CRUD
  // ============================================

  getDockState(userEmail: string): MusicDockState {
    const row = this.db.prepare(`
      SELECT dock_state FROM music_player_state WHERE user_email = ?
    `).get(userEmail) as { dock_state: string | null } | undefined;

    if (!row?.dock_state) {
      return { ...DEFAULT_DOCK_STATE };
    }

    try {
      const parsed = JSON.parse(row.dock_state) as MusicDockState;
      return {
        position: parsed.position || DEFAULT_DOCK_STATE.position,
        size: parsed.size || DEFAULT_DOCK_STATE.size,
        collapsed: parsed.collapsed ?? DEFAULT_DOCK_STATE.collapsed,
      };
    } catch {
      return { ...DEFAULT_DOCK_STATE };
    }
  }

  saveDockState(userEmail: string, state: MusicDockState): void {
    const json = JSON.stringify(state);

    const existing = this.db.prepare(`
      SELECT user_email FROM music_player_state WHERE user_email = ?
    `).get(userEmail);

    if (existing) {
      this.db.prepare(`
        UPDATE music_player_state
        SET dock_state = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_email = ?
      `).run(json, userEmail);
    } else {
      this.db.prepare(`
        INSERT INTO music_player_state (user_email, dock_state)
        VALUES (?, ?)
      `).run(userEmail, json);
    }
  }

  clearState(userEmail: string): void {
    this.db.prepare(`
      DELETE FROM music_player_state WHERE user_email = ?
    `).run(userEmail);
  }

  // ============================================
  // Starred Videos CRUD
  // ============================================

  getStarredVideos(userEmail: string): StarredVideo[] {
    const row = this.db.prepare(`
      SELECT starred_videos FROM music_player_state WHERE user_email = ?
    `).get(userEmail) as { starred_videos: string } | undefined;

    if (!row || !row.starred_videos) {
      return [];
    }

    try {
      return JSON.parse(row.starred_videos) as StarredVideo[];
    } catch {
      return [];
    }
  }

  addStarredVideo(userEmail: string, video: Omit<StarredVideo, 'starredAt'>): StarredVideo[] {
    const existing = this.getStarredVideos(userEmail);

    // Don't add duplicates
    if (existing.some(v => v.videoId === video.videoId)) {
      return existing;
    }

    const newVideo: StarredVideo = {
      ...video,
      starredAt: Date.now(),
    };

    const updated = [newVideo, ...existing];
    this.saveStarredVideos(userEmail, updated);
    return updated;
  }

  removeStarredVideo(userEmail: string, videoId: string): StarredVideo[] {
    const existing = this.getStarredVideos(userEmail);
    const updated = existing.filter(v => v.videoId !== videoId);
    this.saveStarredVideos(userEmail, updated);
    return updated;
  }

  isVideoStarred(userEmail: string, videoId: string): boolean {
    const starred = this.getStarredVideos(userEmail);
    return starred.some(v => v.videoId === videoId);
  }

  private saveStarredVideos(userEmail: string, videos: StarredVideo[]): void {
    const json = JSON.stringify(videos);

    const existing = this.db.prepare(`
      SELECT user_email FROM music_player_state WHERE user_email = ?
    `).get(userEmail);

    if (existing) {
      this.db.prepare(`
        UPDATE music_player_state
        SET starred_videos = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_email = ?
      `).run(json, userEmail);
    } else {
      this.db.prepare(`
        INSERT INTO music_player_state (user_email, starred_videos)
        VALUES (?, ?)
      `).run(userEmail, json);
    }
  }
}

export default MusicPlayerStore;
