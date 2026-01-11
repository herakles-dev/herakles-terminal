import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { SessionStore } from '../session/SessionStore.js';
import { AutheliaUser } from '../middleware/autheliaAuth.js';
import { SearchEngine, ContextDetector, CommandTemplate } from '../search/index.js';
import { BUILT_IN_TEMPLATES } from './templates.js';

interface AuthenticatedRequest extends Request {
  user?: AutheliaUser;
}

const searchEngine = new SearchEngine();
const contextDetector = new ContextDetector();

const templates: CommandTemplate[] = BUILT_IN_TEMPLATES.map(t => ({
  id: t.id,
  name: t.name,
  category: t.category,
  command: t.command,
  description: t.description,
  variables: t.variables,
  isBuiltIn: t.isBuiltIn,
}));
searchEngine.setTemplates(templates);

export function commandRoutes(store: SessionStore): Router {
  const router = Router();

  router.get('/history', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const sessionId = req.query.sessionId as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

    const history = store.getCommandHistory(req.user.email, sessionId, limit);
    
    const aggregated = new Map<string, { count: number; lastUsed: number }>();
    for (const h of history) {
      const existing = aggregated.get(h.command);
      if (existing) {
        existing.count++;
        if (h.executed_at > existing.lastUsed) {
          existing.lastUsed = h.executed_at;
        }
      } else {
        aggregated.set(h.command, { count: 1, lastUsed: h.executed_at });
      }
    }
    
    const result = Array.from(aggregated.entries())
      .map(([command, { count, lastUsed }]) => ({
        command,
        count,
        lastUsed: new Date(lastUsed).toISOString(),
      }))
      .sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime())
      .slice(0, limit);
    
    res.json({ data: result });
  });

  router.get('/suggestions', async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const prefix = req.query.prefix as string || '';
    const limit = Math.min(parseInt(req.query.limit as string) || 15, 50);
    const workingDir = req.query.workingDir as string || '/home/hercules';
    const includeTemplates = req.query.includeTemplates !== 'false';
    const includeHistory = req.query.includeHistory !== 'false';

    if (prefix.length < 2) {
      return res.json({ data: [] });
    }

    const userTemplates = store.getTemplates(req.user.email);
    const allTemplates = [
      ...templates,
      ...userTemplates.map(t => ({
        id: t.id,
        name: t.name,
        category: t.category,
        command: t.command,
        description: t.description || '',
        variables: JSON.parse(t.variables || '[]'),
        isBuiltIn: false,
      })),
    ];
    searchEngine.setTemplates(allTemplates);

    const historySuggestions = store.getCommandSuggestions(req.user.email, '', 100);
    const historyResults = historySuggestions.map(s => ({
      command: s.command,
      count: s.count,
      lastUsed: new Date(s.last_used).toISOString(),
    }));

    let context;
    try {
      context = await contextDetector.detectContext(workingDir);
    } catch {
      context = { workingDirectory: workingDir };
    }

    const results = searchEngine.search(
      prefix,
      historyResults,
      {
        limit,
        includeTemplates,
        includeHistory,
        fuzzyThreshold: 0.35,
        contextBoost: true,
      },
      context
    );

    res.json({
      data: results.map(r => ({
        command: r.command,
        description: r.description,
        category: r.category,
        score: Math.round(r.score * 100) / 100,
        source: r.source,
        templateId: r.templateId,
        variables: r.variables,
        contextBoosts: r.contextBoosts,
        count: r.usageCount || 0,
        lastUsed: r.lastUsed || new Date().toISOString(),
      })),
    });
  });

  router.get('/sequences', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const sequences = store.getCommandSequences(req.user.email);
    
    res.json({
      data: sequences.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        steps: JSON.parse(s.steps || '[]'),
        createdAt: new Date(s.created_at).toISOString(),
      })),
    });
  });

  router.post('/sequences', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const { name, description, steps } = req.body || {};

    if (!name || !steps || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ 
        error: { code: 'INVALID_INPUT', message: 'name and steps array are required' } 
      });
    }

    if (steps.length > 50) {
      return res.status(400).json({ 
        error: { code: 'TOO_MANY_STEPS', message: 'Maximum 50 steps per sequence' } 
      });
    }

    for (const step of steps) {
      if (!['command', 'delay', 'condition'].includes(step.type)) {
        return res.status(400).json({ 
          error: { code: 'INVALID_STEP_TYPE', message: 'Step type must be command, delay, or condition' } 
        });
      }
    }

    const existingSequences = store.getCommandSequences(req.user.email);
    if (existingSequences.length >= 50) {
      return res.status(400).json({ 
        error: { code: 'MAX_SEQUENCES', message: 'Maximum 50 command sequences' } 
      });
    }

    const sequence = store.createCommandSequence({
      id: randomUUID(),
      user_email: req.user.email,
      name,
      description: description || '',
      steps: JSON.stringify(steps),
    });

    res.status(201).json({
      data: {
        id: sequence.id,
        name: sequence.name,
        description: sequence.description,
        steps: JSON.parse(sequence.steps || '[]'),
        createdAt: new Date(sequence.created_at).toISOString(),
      },
    });
  });

  router.put('/sequences/:id', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const sequence = store.getCommandSequence(req.params.id, req.user.email);
    if (!sequence) {
      return res.status(404).json({ error: { code: 'SEQUENCE_NOT_FOUND', message: 'Sequence not found' } });
    }

    const { name, description, steps } = req.body || {};

    if (steps) {
      if (!Array.isArray(steps) || steps.length === 0) {
        return res.status(400).json({ 
          error: { code: 'INVALID_INPUT', message: 'steps must be a non-empty array' } 
        });
      }
      if (steps.length > 50) {
        return res.status(400).json({ 
          error: { code: 'TOO_MANY_STEPS', message: 'Maximum 50 steps per sequence' } 
        });
      }
    }

    store.updateCommandSequence(req.params.id, req.user.email, {
      name: name ?? sequence.name,
      description: description ?? sequence.description,
      steps: steps ? JSON.stringify(steps) : sequence.steps,
    });

    const updated = store.getCommandSequence(req.params.id, req.user.email);
    
    res.json({
      data: {
        id: updated!.id,
        name: updated!.name,
        description: updated!.description,
        steps: JSON.parse(updated!.steps || '[]'),
      },
    });
  });

  router.delete('/sequences/:id', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const sequence = store.getCommandSequence(req.params.id, req.user.email);
    if (!sequence) {
      return res.status(404).json({ error: { code: 'SEQUENCE_NOT_FOUND', message: 'Sequence not found' } });
    }

    store.deleteCommandSequence(req.params.id, req.user.email);
    res.json({ data: { success: true } });
  });

  router.post('/validate', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const { command } = req.body || {};

    if (!command || typeof command !== 'string') {
      return res.status(400).json({ 
        error: { code: 'INVALID_INPUT', message: 'command string is required' } 
      });
    }

    const dangerousPatterns = [
      /rm\s+-rf\s+[\/~]/i,
      />\s*\/dev\/sd[a-z]/i,
      /mkfs\./i,
      /dd\s+if=.*of=\/dev/i,
      /:\(\)\s*{\s*:\|:\s*&\s*}\s*;/,
      /chmod\s+-R\s+777\s+\//i,
      /curl.*\|\s*(ba)?sh/i,
      /wget.*\|\s*(ba)?sh/i,
    ];

    const warnings: string[] = [];
    const errors: string[] = [];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        errors.push(`Potentially dangerous command pattern detected`);
        break;
      }
    }

    if (command.includes('sudo')) {
      warnings.push('Command uses sudo - ensure proper permissions');
    }

    if (command.length > 10000) {
      warnings.push('Command is very long - consider breaking into multiple commands');
    }

    if (command.includes('&') && !command.includes('&&')) {
      warnings.push('Command runs in background - output may not be captured');
    }

    const templateMatches = templates.filter(t => 
      t.command.includes(command.split(' ')[0]) || 
      command.includes(t.command.split(' ')[0])
    ).slice(0, 3);

    res.json({
      data: {
        valid: errors.length === 0,
        warnings,
        errors,
        suggestions: templateMatches.length > 0 ? templateMatches.map(t => ({
          command: t.command,
          description: t.description,
          templateId: t.id,
        })) : undefined,
      },
    });
  });

  return router;
}
