import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { SessionStore } from '../session/SessionStore.js';
import { AutheliaUser } from '../middleware/autheliaAuth.js';

interface AuthenticatedRequest extends Request {
  user?: AutheliaUser;
}

interface BuiltInVariable {
  name: string;
  required?: boolean;
  default?: string;
  description?: string;
}

interface BuiltInTemplate {
  id: string;
  name: string;
  category: string;
  command: string;
  description: string;
  variables?: BuiltInVariable[];
  isBuiltIn: boolean;
}

export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  // --- Orchestrate ---
  {
    id: 'orch-v11',
    name: 'Start V11 Session',
    category: 'orchestrate',
    command: '/v11',
    description: 'Start a V11 orchestrated development session',
    isBuiltIn: true,
  },
  {
    id: 'orch-feature',
    name: 'Build Feature',
    category: 'orchestrate',
    command: 'Build the {{feature}} feature.',
    description: 'Build a feature with agent team orchestration',
    variables: [{ name: 'feature', required: true, description: 'Feature to build' }],
    isBuiltIn: true,
  },
  {
    id: 'orch-bug',
    name: 'Investigate Bug',
    category: 'orchestrate',
    command: 'Something is broken in {{area}}, investigate.',
    description: 'Investigate a bug with parallel hypothesis testing',
    variables: [{ name: 'area', required: true, description: 'Area that is broken' }],
    isBuiltIn: true,
  },
  {
    id: 'orch-security',
    name: 'Security Review',
    category: 'orchestrate',
    command: 'Run a security review on {{module}}.',
    description: 'Run threat modeling + security scan on a module',
    variables: [{ name: 'module', required: true, description: 'Module to review' }],
    isBuiltIn: true,
  },
  {
    id: 'orch-continue',
    name: 'Continue Project',
    category: 'orchestrate',
    command: 'Continue {{project}}.',
    description: 'Resume work on an existing project',
    variables: [{ name: 'project', required: true, description: 'Project name' }],
    isBuiltIn: true,
  },
  {
    id: 'orch-plan',
    name: 'Plan First',
    category: 'orchestrate',
    command: 'Plan the implementation of {{feature}} before coding.',
    description: 'Enter plan mode before implementation',
    variables: [{ name: 'feature', required: true, description: 'Feature to plan' }],
    isBuiltIn: true,
  },
  // --- Observe ---
  {
    id: 'obs-status',
    name: 'Session Status',
    category: 'observe',
    command: '/status',
    description: 'Show current session progress and task list',
    isBuiltIn: true,
  },
  {
    id: 'obs-health',
    name: 'Platform Health',
    category: 'observe',
    command: '/health',
    description: 'Platform-wide health dashboard',
    isBuiltIn: true,
  },
  {
    id: 'obs-check',
    name: 'Check Service',
    category: 'observe',
    command: '/check-service {{service}}',
    description: 'Health diagnostics for a specific service',
    variables: [{ name: 'service', required: true, description: 'Service name' }],
    isBuiltIn: true,
  },
  {
    id: 'obs-dashboard',
    name: 'Dashboard',
    category: 'observe',
    command: '/dashboard',
    description: 'Real-time platform overview',
    isBuiltIn: true,
  },
  {
    id: 'obs-logs',
    name: 'Analyze Logs',
    category: 'observe',
    command: 'Check the logs for {{service}}.',
    description: 'Investigate logs for a service',
    variables: [{ name: 'service', required: true, description: 'Service name' }],
    isBuiltIn: true,
  },
  // --- Develop ---
  {
    id: 'dev-test',
    name: 'Run Tests',
    category: 'develop',
    command: '/test',
    description: 'Run tests with coverage reporting',
    isBuiltIn: true,
  },
  {
    id: 'dev-test-file',
    name: 'Test File',
    category: 'develop',
    command: '/test {{path}}',
    description: 'Run tests for a specific file',
    variables: [{ name: 'path', required: true, description: 'File path to test' }],
    isBuiltIn: true,
  },
  {
    id: 'dev-debug',
    name: 'Debug Error',
    category: 'develop',
    command: '/debug {{service}}',
    description: 'Debug-first error resolution with auto-fix',
    variables: [{ name: 'service', required: true, description: 'Service to debug' }],
    isBuiltIn: true,
  },
  {
    id: 'dev-discover',
    name: 'Discover Codebase',
    category: 'develop',
    command: '/discover',
    description: 'Scan codebase for tech stack, patterns, and entry points',
    isBuiltIn: true,
  },
  {
    id: 'dev-scaffold',
    name: 'Scaffold Project',
    category: 'develop',
    command: '/scaffold {{name}}',
    description: 'Scaffold a new project with hot reload and domain config',
    variables: [{ name: 'name', required: true, description: 'Project name' }],
    isBuiltIn: true,
  },
  {
    id: 'dev-review',
    name: 'Code Review',
    category: 'develop',
    command: 'Review the code in {{path}}.',
    description: 'Focused code review on a file or directory',
    variables: [{ name: 'path', required: true, description: 'File or directory path' }],
    isBuiltIn: true,
  },
  {
    id: 'dev-explore',
    name: 'Explore Project',
    category: 'develop',
    command: "I'm new to this project. Give me a tour.",
    description: 'Get a guided tour of the current project',
    isBuiltIn: true,
  },
  // --- Ship ---
  {
    id: 'ship-deploy',
    name: 'Deploy Service',
    category: 'ship',
    command: '/deploy {{service}}',
    description: 'Deploy with pre-flight checks and health monitoring',
    variables: [{ name: 'service', required: true, description: 'Service to deploy' }],
    isBuiltIn: true,
  },
  {
    id: 'ship-rollback',
    name: 'Rollback',
    category: 'ship',
    command: '/rollback {{service}}',
    description: 'Rollback a service to previous state',
    variables: [{ name: 'service', required: true, description: 'Service to rollback' }],
    isBuiltIn: true,
  },
  {
    id: 'ship-migrate',
    name: 'Run Migrations',
    category: 'ship',
    command: '/migrate',
    description: 'Run database migrations',
    isBuiltIn: true,
  },
  {
    id: 'ship-preflight',
    name: 'Preflight Check',
    category: 'ship',
    command: '/preflight',
    description: 'System readiness check before deployment',
    isBuiltIn: true,
  },
  {
    id: 'ship-status',
    name: 'Deploy Status',
    category: 'ship',
    command: '~/scripts/deploy-enhanced.sh status',
    description: 'Check deployment status across all services',
    isBuiltIn: true,
  },
  // --- Session ---
  {
    id: 'sess-opus',
    name: 'Switch to Opus',
    category: 'session',
    command: '/model opus',
    description: 'Opus 4.6 for complex reasoning',
    isBuiltIn: true,
  },
  {
    id: 'sess-sonnet',
    name: 'Switch to Sonnet',
    category: 'session',
    command: '/model sonnet',
    description: 'Sonnet 4.5 for daily coding',
    isBuiltIn: true,
  },
  {
    id: 'sess-haiku',
    name: 'Switch to Haiku',
    category: 'session',
    command: '/model haiku',
    description: 'Haiku 4.5 for fast, simple tasks',
    isBuiltIn: true,
  },
  {
    id: 'sess-extended',
    name: 'Extended Context',
    category: 'session',
    command: '/model sonnet[1m]',
    description: 'Sonnet with 1M token context for long sessions',
    isBuiltIn: true,
  },
  {
    id: 'sess-handoff',
    name: 'Session Handoff',
    category: 'session',
    command: '/handoff',
    description: 'Generate context for session continuation',
    isBuiltIn: true,
  },
  {
    id: 'sess-gemini',
    name: 'Ask Gemini',
    category: 'session',
    command: '/gemini {{task}}',
    description: 'Route task to Gemini co-processor',
    variables: [{ name: 'task', required: true, description: 'Task for Gemini' }],
    isBuiltIn: true,
  },
  {
    id: 'sess-slow',
    name: 'Slow Down',
    category: 'session',
    command: 'Slow down.',
    description: 'Reset to confirm-everything mode',
    isBuiltIn: true,
  },
];

export function templateRoutes(store: SessionStore): Router {
  const router = Router();

  router.get('/', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const userTemplates = store.getTemplates(req.user.email);
    const hiddenIds = new Set(store.getHiddenTemplateIds(req.user.email));

    res.json({
      data: {
        builtIn: BUILT_IN_TEMPLATES.filter(t => !hiddenIds.has(t.id)),
        hidden: BUILT_IN_TEMPLATES.filter(t => hiddenIds.has(t.id)).map(t => ({ id: t.id, name: t.name, category: t.category })),
        custom: userTemplates.map(t => ({
          id: t.id,
          name: t.name,
          category: t.category,
          command: t.command,
          description: t.description,
          variables: JSON.parse(t.variables || '[]'),
          isBuiltIn: false,
          createdAt: new Date(t.created_at).toISOString(),
        })),
      },
    });
  });

  router.get('/categories', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const builtInCategories = [...new Set(BUILT_IN_TEMPLATES.map(t => t.category))];
    const userTemplates = store.getTemplates(req.user.email);
    const userCategories = [...new Set(userTemplates.map(t => t.category))];
    const allCategories = [...new Set([...builtInCategories, ...userCategories])];

    res.json({
      data: allCategories.sort(),
    });
  });

  router.post('/', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const { name, category, command, description, variables } = req.body || {};

    if (!name || !command) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'name and command are required' }
      });
    }

    const existingTemplates = store.getTemplates(req.user.email);
    if (existingTemplates.length >= 100) {
      return res.status(400).json({
        error: { code: 'MAX_TEMPLATES', message: 'Maximum 100 custom templates' }
      });
    }

    const template = store.createTemplate({
      id: randomUUID(),
      user_email: req.user.email,
      name,
      category: category || 'custom',
      command,
      description: description || '',
      variables: JSON.stringify(variables || []),
    });

    res.status(201).json({
      data: {
        id: template.id,
        name: template.name,
        category: template.category,
        command: template.command,
        description: template.description,
        variables: JSON.parse(template.variables || '[]'),
        isBuiltIn: false,
        createdAt: new Date(template.created_at).toISOString(),
      },
    });
  });

  router.put('/:id', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const template = store.getTemplate(req.params.id, req.user.email);
    if (!template) {
      return res.status(404).json({ error: { code: 'TEMPLATE_NOT_FOUND', message: 'Template not found' } });
    }

    const { name, category, command, description, variables } = req.body || {};

    store.updateTemplate(req.params.id, req.user.email, {
      name: name ?? template.name,
      category: category ?? template.category,
      command: command ?? template.command,
      description: description ?? template.description,
      variables: variables ? JSON.stringify(variables) : template.variables,
    });

    const updated = store.getTemplate(req.params.id, req.user.email);

    res.json({
      data: {
        id: updated!.id,
        name: updated!.name,
        category: updated!.category,
        command: updated!.command,
        description: updated!.description,
        variables: JSON.parse(updated!.variables || '[]'),
        isBuiltIn: false,
      },
    });
  });

  router.delete('/:id', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const template = store.getTemplate(req.params.id, req.user.email);
    if (!template) {
      return res.status(404).json({ error: { code: 'TEMPLATE_NOT_FOUND', message: 'Template not found' } });
    }

    store.deleteTemplate(req.params.id, req.user.email);
    res.json({ data: { success: true } });
  });

  // --- Group Management ---

  router.get('/groups', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const builtInGroups = new Map<string, number>();
    for (const t of BUILT_IN_TEMPLATES) {
      builtInGroups.set(t.category, (builtInGroups.get(t.category) || 0) + 1);
    }

    const userGroups = store.getTemplateCategories(req.user.email);
    const groups: { name: string; count: number; isBuiltIn: boolean }[] = [];

    for (const [name, count] of builtInGroups) {
      const userCount = userGroups.find(g => g.category === name)?.count || 0;
      groups.push({ name, count: count + userCount, isBuiltIn: true });
    }

    for (const g of userGroups) {
      if (!builtInGroups.has(g.category)) {
        groups.push({ name: g.category, count: g.count, isBuiltIn: false });
      }
    }

    groups.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ data: groups });
  });

  router.put('/groups/:name', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const oldName = req.params.name;
    const { newName } = req.body || {};

    if (!newName || typeof newName !== 'string' || !newName.trim()) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'newName is required' } });
    }

    const builtInCategories = new Set(BUILT_IN_TEMPLATES.map(t => t.category));
    if (builtInCategories.has(oldName)) {
      return res.status(400).json({ error: { code: 'CANNOT_RENAME_BUILTIN', message: 'Cannot rename built-in categories' } });
    }

    const changed = store.renameTemplateCategory(req.user.email, oldName, newName.trim());
    res.json({ data: { changed, oldName, newName: newName.trim() } });
  });

  router.delete('/groups/:name', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const category = req.params.name;
    const { action } = req.query;

    const builtInCategories = new Set(BUILT_IN_TEMPLATES.map(t => t.category));
    if (builtInCategories.has(category)) {
      return res.status(400).json({ error: { code: 'CANNOT_DELETE_BUILTIN', message: 'Cannot delete built-in categories' } });
    }

    if (action === 'move') {
      const changed = store.renameTemplateCategory(req.user.email, category, 'custom');
      return res.json({ data: { action: 'moved', changed } });
    }

    const deleted = store.deleteTemplatesByCategory(req.user.email, category);
    res.json({ data: { action: 'deleted', deleted } });
  });

  // --- Batch Operations ---

  router.post('/batch-delete', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const { templateIds } = req.body || {};
    if (!Array.isArray(templateIds) || templateIds.length === 0) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'templateIds array required' } });
    }

    const deleted = store.deleteTemplates(req.user.email, templateIds);
    res.json({ data: { deleted } });
  });

  router.post('/batch-move', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const { templateIds, category } = req.body || {};
    if (!Array.isArray(templateIds) || templateIds.length === 0) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'templateIds array required' } });
    }
    if (!category || typeof category !== 'string') {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'category is required' } });
    }

    const moved = store.moveTemplatesToCategory(req.user.email, templateIds, category);
    res.json({ data: { moved, category } });
  });

  // --- Hide/Unhide Built-in Templates ---

  router.post('/hide/:id', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }
    store.hideTemplate(req.user.email, req.params.id);
    res.json({ data: { hidden: true, templateId: req.params.id } });
  });

  router.post('/unhide/:id', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }
    store.unhideTemplate(req.user.email, req.params.id);
    res.json({ data: { hidden: false, templateId: req.params.id } });
  });

  router.post('/batch-hide', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }
    const { templateIds } = req.body || {};
    if (!Array.isArray(templateIds) || templateIds.length === 0) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'templateIds array required' } });
    }
    let count = 0;
    for (const id of templateIds) {
      if (typeof id === 'string') {
        store.hideTemplate(req.user.email, id);
        count++;
      }
    }
    res.json({ data: { hidden: count } });
  });

  router.post('/unhide-all', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }
    const count = store.unhideAllTemplates(req.user.email);
    res.json({ data: { restored: count } });
  });

  router.post('/execute', (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const { templateId, variables } = req.body || {};

    if (!templateId) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'templateId is required' }
      });
    }

    let template = BUILT_IN_TEMPLATES.find(t => t.id === templateId);
    if (!template) {
      const userTemplate = store.getTemplate(templateId, req.user.email);
      if (userTemplate) {
        template = {
          id: userTemplate.id,
          name: userTemplate.name,
          category: userTemplate.category,
          command: userTemplate.command,
          description: userTemplate.description || '',
          variables: JSON.parse(userTemplate.variables || '[]'),
          isBuiltIn: false,
        };
      }
    }

    if (!template) {
      return res.status(404).json({ error: { code: 'TEMPLATE_NOT_FOUND', message: 'Template not found' } });
    }

    let command = template.command;
    const templateVars = template.variables || [];

    for (const varDef of templateVars) {
      const value = variables?.[varDef.name] ?? varDef.default;
      if (varDef.required && !value) {
        return res.status(400).json({
          error: { code: 'MISSING_VARIABLE', message: `Variable '${varDef.name}' is required` }
        });
      }
      command = command.replace(new RegExp(`{{${varDef.name}}}`, 'g'), value || '');
    }

    res.json({
      data: {
        command,
        templateId: template.id,
        templateName: template.name,
      },
    });
  });

  return router;
}
