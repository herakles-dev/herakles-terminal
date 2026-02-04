import { Router, Request, Response } from 'express';
import * as YouTubeSR from 'youtube-sr';
import type { MusicPlayerStore } from './MusicPlayerStore.js';
import type { AutheliaUser } from '../middleware/autheliaAuth.js';

// youtube-sr exports the YouTube class directly
const YouTube = YouTubeSR.YouTube;

interface SearchResult {
  videoId: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  duration?: string;
}

interface OEmbedResponse {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

interface AuthenticatedRequest extends Request {
  user?: AutheliaUser;
}

// Search via youtube-sr (scraping, no API key needed)
async function searchYouTube(query: string): Promise<SearchResult[]> {
  const videos = await YouTube.search(query, { type: 'video', limit: 8 });

  return videos.map((video: YouTubeSR.Video) => ({
    videoId: video.id || '',
    title: video.title || 'Unknown',
    thumbnail: video.thumbnail?.url || `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`,
    channelTitle: video.channel?.name || 'Unknown',
    duration: video.durationFormatted || undefined,
  })).filter((v: SearchResult) => v.videoId);
}

export function createMusicRoutes(musicStore: MusicPlayerStore): Router {
  const router = Router();

  // Get current player state
  router.get('/state', (req: AuthenticatedRequest, res: Response) => {
    try {
      const userEmail = req.user?.email || 'anonymous';
      console.log('[MusicAPI] GET /state for user:', userEmail);
      const state = musicStore.getState(userEmail);
      console.log('[MusicAPI] Returning state:', JSON.stringify({ videoId: state.videoId, currentTime: state.currentTime, mode: state.mode }));
      res.json({ data: state });
    } catch (error) {
      console.error('[MusicAPI] Failed to get music state:', error);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get state' } });
    }
  });

  // Update player state
  router.put('/state', (req: AuthenticatedRequest, res: Response) => {
    try {
      const userEmail = req.user?.email || 'anonymous';
      console.log('[MusicAPI] PUT /state for user:', userEmail, 'body:', JSON.stringify(req.body));
      musicStore.saveState(userEmail, req.body);
      res.json({ data: { success: true } });
    } catch (error) {
      console.error('[MusicAPI] Failed to save music state:', error);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to save state' } });
    }
  });

  // Clear player state
  router.delete('/state', (req: AuthenticatedRequest, res: Response) => {
    try {
      const userEmail = req.user?.email || 'anonymous';
      musicStore.clearState(userEmail);
      res.json({ data: { success: true } });
    } catch (error) {
      console.error('Failed to clear music state:', error);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to clear state' } });
    }
  });

  // Search via youtube-sr (scraping, no API key needed)
  router.post('/search', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { query } = req.body;

      if (!query || typeof query !== 'string' || query.trim().length < 2) {
        return res.status(400).json({
          error: { code: 'INVALID_QUERY', message: 'Search query must be at least 2 characters' }
        });
      }

      const searchQuery = query.trim();
      const results = await searchYouTube(searchQuery);
      return res.json({ data: results });
    } catch (error) {
      console.error('Search failed:', error);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Search failed' } });
    }
  });

  // ============================================
  // Starred Videos Endpoints
  // ============================================

  // Get starred videos
  router.get('/starred', (req: AuthenticatedRequest, res: Response) => {
    try {
      const userEmail = req.user?.email || 'anonymous';
      const starred = musicStore.getStarredVideos(userEmail);
      res.json({ data: starred });
    } catch (error) {
      console.error('Failed to get starred videos:', error);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get starred videos' } });
    }
  });

  // Add starred video
  router.post('/starred', (req: AuthenticatedRequest, res: Response) => {
    try {
      const userEmail = req.user?.email || 'anonymous';
      const { videoId, videoTitle, thumbnailUrl } = req.body;

      if (!videoId || typeof videoId !== 'string') {
        return res.status(400).json({
          error: { code: 'INVALID_VIDEO_ID', message: 'Video ID is required' }
        });
      }

      const starred = musicStore.addStarredVideo(userEmail, {
        videoId,
        videoTitle: videoTitle || 'Unknown',
        thumbnailUrl: thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      });
      return res.json({ data: starred });
    } catch (error) {
      console.error('Failed to add starred video:', error);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to add starred video' } });
    }
  });

  // Remove starred video
  router.delete('/starred/:videoId', (req: AuthenticatedRequest, res: Response) => {
    try {
      const userEmail = req.user?.email || 'anonymous';
      const { videoId } = req.params;

      if (!videoId) {
        return res.status(400).json({
          error: { code: 'INVALID_VIDEO_ID', message: 'Video ID is required' }
        });
      }

      const starred = musicStore.removeStarredVideo(userEmail, videoId);
      return res.json({ data: starred });
    } catch (error) {
      console.error('Failed to remove starred video:', error);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to remove starred video' } });
    }
  });

  // Check if video is starred
  router.get('/starred/:videoId', (req: AuthenticatedRequest, res: Response) => {
    try {
      const userEmail = req.user?.email || 'anonymous';
      const { videoId } = req.params;
      const isStarred = musicStore.isVideoStarred(userEmail, videoId);
      res.json({ data: { isStarred } });
    } catch (error) {
      console.error('Failed to check starred status:', error);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to check starred status' } });
    }
  });

  // Get video info (using oEmbed - no API key needed)
  router.get('/info/:videoId', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { videoId } = req.params;

      if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return res.status(400).json({
          error: { code: 'INVALID_VIDEO_ID', message: 'Invalid video ID format' }
        });
      }

      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      const response = await fetch(oembedUrl);

      if (!response.ok) {
        return res.status(404).json({
          error: { code: 'VIDEO_NOT_FOUND', message: 'Video not found' }
        });
      }

      const data = await response.json() as OEmbedResponse;
      res.json({
        data: {
          videoId,
          title: data.title || 'Unknown',
          author: data.author_name || 'Unknown',
          thumbnailUrl: data.thumbnail_url || null,
        }
      });
    } catch (error) {
      console.error('Failed to get video info:', error);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get video info' } });
    }
  });

  return router;
}

export default createMusicRoutes;
