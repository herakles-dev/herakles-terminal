import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
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
      working_directory: '/home/hercules',
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

  return router;
}
