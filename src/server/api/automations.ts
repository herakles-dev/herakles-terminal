import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { SessionStore } from '../session/SessionStore.js';
import { AutomationEngine } from '../automation/AutomationEngine.js';
import { WindowManager } from '../window/WindowManager.js';
import { ConnectionManager } from '../websocket/ConnectionManager.js';
import { AutheliaUser } from '../middleware/autheliaAuth.js';

interface AuthenticatedRequest extends Request {
  user?: AutheliaUser;
}

export function automationRoutes(
  store: SessionStore, 
  automationEngine?: AutomationEngine,
  windowManager?: WindowManager,
  connectionManager?: ConnectionManager
): Router {
  const router = Router();

  router.get('/', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const automations = store.getAutomations(req.user.email);
    
    res.json({
      data: automations.map(a => ({
        id: a.id,
        sessionId: a.session_id,
        name: a.name,
        trigger: a.trigger_type,
        triggerConfig: JSON.parse(a.trigger_config || '{}'),
        command: a.command,
        steps: a.steps ? JSON.parse(a.steps) : null,
        createWindow: a.create_window === 1,
        windowName: a.window_name,
        enabled: a.enabled === 1,
        createdAt: new Date(a.created_at).toISOString(),
      })),
    });
  });

  router.get('/session/:sessionId', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const session = store.getSession(req.params.sessionId, req.user.email);
    if (!session) {
      return res.status(404).json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } });
    }

    const automations = store.getAutomationsBySession(req.params.sessionId, req.user.email);
    
    res.json({
      data: automations.map(a => ({
        id: a.id,
        sessionId: a.session_id,
        name: a.name,
        trigger: a.trigger_type,
        triggerConfig: JSON.parse(a.trigger_config || '{}'),
        command: a.command,
        steps: a.steps ? JSON.parse(a.steps) : null,
        createWindow: a.create_window === 1,
        windowName: a.window_name,
        enabled: a.enabled === 1,
        createdAt: new Date(a.created_at).toISOString(),
      })),
    });
  });

  router.post('/', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const { sessionId, name, trigger, triggerConfig, command, steps, createWindow, windowName } = req.body || {};

    if (!sessionId || !name || !trigger) {
      return res.status(400).json({ 
        error: { code: 'INVALID_INPUT', message: 'sessionId, name, and trigger are required' } 
      });
    }

    if (!command && (!steps || !Array.isArray(steps) || steps.length === 0)) {
      return res.status(400).json({ 
        error: { code: 'INVALID_INPUT', message: 'Either command or steps array is required' } 
      });
    }

    const validTriggers = ['on_connect', 'on_disconnect', 'on_resume', 'on_idle', 'on_output_match', 'scheduled'];
    if (!validTriggers.includes(trigger)) {
      return res.status(400).json({ 
        error: { code: 'INVALID_TRIGGER', message: `Invalid trigger. Must be one of: ${validTriggers.join(', ')}` } 
      });
    }

    const session = store.getSession(sessionId, req.user.email);
    if (!session) {
      return res.status(404).json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } });
    }

    const existingAutomations = store.getAutomationsBySession(sessionId, req.user.email);
    if (existingAutomations.length >= 20) {
      return res.status(400).json({ 
        error: { code: 'MAX_AUTOMATIONS', message: 'Maximum 20 automations per session' } 
      });
    }

    const automation = store.createAutomation({
      id: randomUUID(),
      session_id: sessionId,
      user_email: req.user.email,
      name,
      trigger_type: trigger,
      trigger_config: JSON.stringify(triggerConfig || {}),
      command: command || (steps && steps.length > 0 ? steps[0].command : ''),
      steps: steps ? JSON.stringify(steps) : null,
      create_window: createWindow ? 1 : 0,
      window_name: windowName || null,
      enabled: 1,
      run_count: 0,
    });

    if (trigger === 'scheduled' && automationEngine) {
      automationEngine.registerCronJob({
        id: automation.id,
        sessionId: automation.session_id,
        userEmail: req.user.email,
        name: automation.name,
        triggerType: 'scheduled',
        triggerConfig: triggerConfig || {},
        command: automation.command,
        steps: automation.steps ? JSON.parse(automation.steps) : undefined,
        createWindow: automation.create_window === 1,
        windowName: automation.window_name || undefined,
        enabled: true,
        createdAt: new Date(automation.created_at),
      });
    }

    res.status(201).json({
      data: {
        id: automation.id,
        sessionId: automation.session_id,
        name: automation.name,
        trigger: automation.trigger_type,
        triggerConfig: JSON.parse(automation.trigger_config || '{}'),
        command: automation.command,
        steps: automation.steps ? JSON.parse(automation.steps) : null,
        createWindow: automation.create_window === 1,
        windowName: automation.window_name,
        enabled: automation.enabled === 1,
        createdAt: new Date(automation.created_at).toISOString(),
      },
    });
  });

  router.put('/:id', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const automation = store.getAutomation(req.params.id, req.user.email);
    if (!automation) {
      return res.status(404).json({ error: { code: 'AUTOMATION_NOT_FOUND', message: 'Automation not found' } });
    }

    const { name, trigger, triggerConfig, command, steps, createWindow, windowName, enabled } = req.body || {};

    if (trigger) {
      const validTriggers = ['on_connect', 'on_disconnect', 'on_resume', 'on_idle', 'on_output_match', 'scheduled'];
      if (!validTriggers.includes(trigger)) {
        return res.status(400).json({ 
          error: { code: 'INVALID_TRIGGER', message: `Invalid trigger. Must be one of: ${validTriggers.join(', ')}` } 
        });
      }
    }

    store.updateAutomation(req.params.id, req.user.email, {
      name: name ?? automation.name,
      trigger_type: trigger ?? automation.trigger_type,
      trigger_config: triggerConfig ? JSON.stringify(triggerConfig) : automation.trigger_config,
      command: command ?? automation.command,
      steps: steps !== undefined ? (steps ? JSON.stringify(steps) : null) : automation.steps,
      create_window: createWindow !== undefined ? (createWindow ? 1 : 0) : automation.create_window,
      window_name: windowName !== undefined ? windowName : automation.window_name,
      enabled: enabled !== undefined ? (enabled ? 1 : 0) : automation.enabled,
    });

    const updated = store.getAutomation(req.params.id, req.user.email);
    
    res.json({
      data: {
        id: updated!.id,
        sessionId: updated!.session_id,
        name: updated!.name,
        trigger: updated!.trigger_type,
        triggerConfig: JSON.parse(updated!.trigger_config || '{}'),
        command: updated!.command,
        steps: updated!.steps ? JSON.parse(updated!.steps) : null,
        createWindow: updated!.create_window === 1,
        windowName: updated!.window_name,
        enabled: updated!.enabled === 1,
      },
    });
  });

  router.delete('/:id', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const automation = store.getAutomation(req.params.id, req.user.email);
    if (!automation) {
      return res.status(404).json({ error: { code: 'AUTOMATION_NOT_FOUND', message: 'Automation not found' } });
    }

    store.deleteAutomation(req.params.id, req.user.email);
    res.json({ data: { success: true } });
  });

  router.post('/:id/toggle', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const automation = store.getAutomation(req.params.id, req.user.email);
    if (!automation) {
      return res.status(404).json({ error: { code: 'AUTOMATION_NOT_FOUND', message: 'Automation not found' } });
    }

    store.toggleAutomation(req.params.id, req.user.email);
    const updated = store.getAutomation(req.params.id, req.user.email);

    res.json({
      data: {
        id: updated!.id,
        enabled: updated!.enabled === 1,
      },
    });
  });

  router.post('/:id/run', async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    if (!automationEngine) {
      return res.status(500).json({ error: { code: 'ENGINE_UNAVAILABLE', message: 'Automation engine not available' } });
    }

    const automation = store.getAutomation(req.params.id, req.user.email);
    if (!automation) {
      return res.status(404).json({ error: { code: 'AUTOMATION_NOT_FOUND', message: 'Automation not found' } });
    }

    try {
      const result = await automationEngine.executeAutomation(
        {
          id: automation.id,
          sessionId: automation.session_id,
          userEmail: automation.user_email,
          name: automation.name,
          triggerType: automation.trigger_type as any,
          triggerConfig: automation.trigger_config ? JSON.parse(automation.trigger_config) : undefined,
          command: automation.command,
          steps: automation.steps ? JSON.parse(automation.steps) : undefined,
          createWindow: automation.create_window === 1,
          windowName: automation.window_name || undefined,
          enabled: true,
          createdAt: new Date(automation.created_at),
        },
        automation.session_id,
        'Manual run'
      );

      if (result.success && result.windowId && connectionManager && windowManager) {
        const window = await windowManager.getWindow(result.windowId, req.user.email);
        if (window) {
          connectionManager.broadcastToSession(automation.session_id, {
            type: 'window:created',
            window: {
              id: window.id,
              sessionId: window.sessionId,
              name: window.name,
              autoName: window.autoName,
              positionX: window.layout.x,
              positionY: window.layout.y,
              width: window.layout.width,
              height: window.layout.height,
              zIndex: window.zIndex,
              isMain: window.isMain,
              createdAt: window.createdAt,
            },
          });
        }
      }

      res.json({ data: result });
    } catch (error) {
      res.status(500).json({ 
        error: { code: 'EXECUTION_FAILED', message: (error as Error).message } 
      });
    }
  });

  return router;
}
