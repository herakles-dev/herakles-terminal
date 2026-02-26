import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { SessionStore } from '../session/SessionStore.js';
import { AutheliaUser } from '../middleware/autheliaAuth.js';

interface AuthenticatedRequest extends Request {
  user?: AutheliaUser;
}

export function apiRoutes(store: SessionStore): Router {
  const router = Router();

  router.get('/sessions', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const sessions = store.getSessionsByUser(req.user.email);
    
    res.json({
      data: sessions.map(s => ({
        id: s.id,
        name: s.name,
        autoName: s.auto_name,
        state: s.state,
        createdAt: new Date(s.created_at).toISOString(),
        lastActiveAt: new Date(s.last_active_at).toISOString(),
        timeoutHours: s.timeout_hours,
        workingDirectory: s.working_directory,
      })),
    });
  });

  router.post('/sessions', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const existingSessions = store.getSessionsByUser(req.user.email);
    if (existingSessions.length >= 50) {
      return res.status(400).json({ 
        error: { code: 'MAX_SESSIONS', message: 'Maximum 50 sessions reached' } 
      });
    }

    const { name } = req.body || {};
    const sessionId = randomUUID();
    
    const session = store.createSession({
      id: sessionId,
      name: name || `Session ${existingSessions.length + 1}`,
      user_email: req.user.email,
      auto_name: null,
      timeout_hours: 168,
      working_directory: process.env.HOME || '/home/hercules',
    });

    res.status(201).json({
      data: {
        id: session.id,
        name: session.name,
        state: session.state,
        createdAt: new Date(session.created_at).toISOString(),
        lastActiveAt: new Date(session.last_active_at).toISOString(),
        timeoutHours: session.timeout_hours,
        workingDirectory: session.working_directory,
      },
    });
  });

  router.get('/sessions/:id', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const session = store.getSession(req.params.id, req.user.email);
    
    if (!session) {
      return res.status(404).json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } });
    }

    res.json({
      data: {
        id: session.id,
        name: session.name,
        autoName: session.auto_name,
        state: session.state,
        createdAt: new Date(session.created_at).toISOString(),
        lastActiveAt: new Date(session.last_active_at).toISOString(),
        timeoutHours: session.timeout_hours,
        workingDirectory: session.working_directory,
      },
    });
  });

  router.put('/sessions/:id', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const session = store.getSession(req.params.id, req.user.email);
    if (!session) {
      return res.status(404).json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } });
    }

    const { name, timeoutHours } = req.body || {};
    
    if (name) {
      const db = store.getDatabase();
      db.prepare('UPDATE sessions SET name = ? WHERE id = ? AND user_email = ?')
        .run(name, req.params.id, req.user.email);
    }
    
    if (timeoutHours) {
      store.updateTimeout(req.params.id, timeoutHours, req.user.email);
    }

    const updated = store.getSession(req.params.id, req.user.email);
    
    res.json({
      data: {
        id: updated!.id,
        name: updated!.name,
        state: updated!.state,
        timeoutHours: updated!.timeout_hours,
      },
    });
  });

  router.delete('/sessions/:id', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const session = store.getSession(req.params.id, req.user.email);
    if (!session) {
      return res.status(404).json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } });
    }

    store.deleteSession(req.params.id, req.user.email);
    res.json({ data: { success: true } });
  });

  router.get('/sessions/:sessionId/windows', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const windows = store.getWindows(req.params.sessionId, req.user.email);
    
    res.json({
      data: windows.map(w => ({
        id: w.id,
        sessionId: w.session_id,
        name: w.name,
        autoName: w.auto_name,
        x: w.position_x,
        y: w.position_y,
        width: w.width,
        height: w.height,
        zIndex: w.z_index,
        isMain: w.is_main === 1,
        createdAt: new Date(w.created_at).toISOString(),
      })),
    });
  });

  router.get('/artifacts/starred', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const artifacts = store.getStarredArtifacts(req.user.email);
    
    res.json({
      data: artifacts.map(a => ({
        id: a.id,
        type: a.type,
        content: a.content,
        language: a.language,
        title: a.title,
        sourceWindow: a.source_window,
        timestamp: a.created_at,
        starred: true,
      })),
    });
  });

  router.post('/artifacts/starred', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const { id, type, content, language, title, sourceWindow } = req.body || {};
    
    if (!id || !type || !content) {
      return res.status(400).json({ 
        error: { code: 'INVALID_INPUT', message: 'id, type, and content are required' } 
      });
    }

    const artifact = store.starArtifact({
      id,
      user_email: req.user.email,
      type,
      content,
      language: language || null,
      title: title || null,
      source_window: sourceWindow || 'unknown',
    });

    res.status(201).json({
      data: {
        id: artifact.id,
        type: artifact.type,
        content: artifact.content,
        language: artifact.language,
        title: artifact.title,
        sourceWindow: artifact.source_window,
        timestamp: artifact.created_at,
        starred: true,
      },
    });
  });

  router.delete('/artifacts/starred/:id', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    store.unstarArtifact(req.params.id, req.user.email);
    res.json({ data: { success: true } });
  });

  router.get('/artifacts/temp', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const artifacts = store.getTempArtifacts(req.user.email);
    
    res.json({
      data: artifacts.map(a => ({
        id: a.id,
        type: a.type,
        content: a.content,
        language: a.language,
        title: a.title,
        sourceWindow: a.source_window,
        timestamp: a.created_at,
        expiresAt: a.expires_at,
        starred: false,
      })),
    });
  });

  router.delete('/artifacts/temp/:id', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    store.deleteTempArtifact(req.params.id, req.user.email);
    res.json({ data: { success: true } });
  });

  router.get('/preferences', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const prefs = store.getPreferences(req.user.email);
    
    res.json({
      data: {
        fontSize: prefs.font_size,
        sessionTimeoutHours: prefs.session_timeout_hours,
        timezone: prefs.timezone,
        quickKeyBarVisible: prefs.quick_key_bar_visible === 1,
        sidePanelDefaultTab: prefs.side_panel_default_tab,
      },
    });
  });

  router.put('/preferences', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const { fontSize, sessionTimeoutHours, timezone, quickKeyBarVisible, sidePanelDefaultTab } = req.body || {};
    
    store.updatePreferences(req.user.email, {
      font_size: fontSize,
      session_timeout_hours: sessionTimeoutHours,
      timezone,
      quick_key_bar_visible: quickKeyBarVisible ? 1 : 0,
      side_panel_default_tab: sidePanelDefaultTab,
    });

    const prefs = store.getPreferences(req.user.email);
    
    res.json({
      data: {
        fontSize: prefs.font_size,
        sessionTimeoutHours: prefs.session_timeout_hours,
        timezone: prefs.timezone,
        quickKeyBarVisible: prefs.quick_key_bar_visible === 1,
        sidePanelDefaultTab: prefs.side_panel_default_tab,
      },
    });
  });

  // Layout presets
  router.get('/layouts', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const layouts = store.getUserLayouts(req.user.email);

    res.json({
      data: layouts.map(l => ({
        id: l.id,
        name: l.name,
        windowCount: l.window_count,
        layoutData: JSON.parse(l.layout_data),
        isFavorite: l.is_favorite === 1,
        createdAt: l.created_at,
      })),
    });
  });

  router.post('/layouts', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const { name, windowCount, layoutData, isFavorite } = req.body || {};

    if (!name || !windowCount || !layoutData || !Array.isArray(layoutData)) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'name, windowCount, and layoutData array are required' },
      });
    }

    const existing = store.getUserLayouts(req.user.email);
    if (existing.length >= 50) {
      return res.status(400).json({
        error: { code: 'MAX_LAYOUTS', message: 'Maximum 50 saved layouts reached' },
      });
    }

    const layout = store.createUserLayout({
      id: randomUUID(),
      user_email: req.user.email,
      name,
      window_count: windowCount,
      layout_data: JSON.stringify(layoutData),
      is_favorite: isFavorite ? 1 : 0,
    });

    res.status(201).json({
      data: {
        id: layout.id,
        name: layout.name,
        windowCount: layout.window_count,
        layoutData: JSON.parse(layout.layout_data),
        isFavorite: layout.is_favorite === 1,
        createdAt: layout.created_at,
      },
    });
  });

  router.delete('/layouts/:id', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    store.deleteUserLayout(req.params.id, req.user.email);
    res.json({ data: { success: true } });
  });

  // Debug endpoint for minimap classification
  router.post('/debug/minimap', (req: Request, res: Response) => {
    const { lines, classifications } = req.body || {};
    const debugPath = '/tmp/minimap-debug.txt';
    const content = JSON.stringify({ lines, classifications, timestamp: new Date().toISOString() }, null, 2);
    writeFileSync(debugPath, content);
    console.log(`[DEBUG] Minimap data written to ${debugPath}`);
    res.json({ success: true, path: debugPath });
  });

  // Browser console log loopback - receives frontend logs for debugging
  router.post('/debug/console', (req: Request, res: Response) => {
    const { level, message, data, component, timestamp } = req.body || {};
    const logLine = `[${timestamp || new Date().toISOString()}] [${level?.toUpperCase() || 'LOG'}] [${component || 'unknown'}] ${message} ${data ? JSON.stringify(data) : ''}`;

    // Write to console (server log)
    console.log(`[BROWSER] ${logLine}`);

    // Append to debug file
    const fs = require('fs');
    fs.appendFileSync('/tmp/browser-console.log', logLine + '\n');

    res.json({ success: true });
  });

  // Get recent browser logs
  router.get('/debug/console', (_req: Request, res: Response) => {
    const fs = require('fs');
    try {
      const logs = fs.readFileSync('/tmp/browser-console.log', 'utf-8');
      const lines = logs.split('\n').filter(Boolean).slice(-100); // Last 100 lines
      res.json({ data: lines });
    } catch {
      res.json({ data: [] });
    }
  });

  // Clear browser logs
  router.delete('/debug/console', (_req: Request, res: Response) => {
    const fs = require('fs');
    fs.writeFileSync('/tmp/browser-console.log', '');
    res.json({ success: true });
  });

  return router;
}
