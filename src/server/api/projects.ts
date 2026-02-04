import { Router, Request, Response } from 'express';
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  category?: string;
  description?: string;
  status?: string;
  hasDocker: boolean;
  hasPackageJson: boolean;
  hasRequirements: boolean;
  hasCargo: boolean;
  hasGoMod: boolean;
  lastModified: string;
  url?: string;
  port?: number;
  thumbnail?: string; // URL path to thumbnail image
}

const THUMBNAILS_DIR = join(__dirname, '../../..', 'public', 'thumbnails');
const THUMBNAILS_URL_BASE = '/thumbnails';

interface AppsRegistryApp {
  id: string;
  name: string;
  description?: string;
  path?: string;
  url?: string;
  port?: number;
  status?: string;
  category?: string;
}

interface AppsRegistry {
  apps: AppsRegistryApp[];
  categories: Record<string, { label: string }>;
}

const HERCULES_HOME = '/home/hercules';
const APPS_REGISTRY_PATH = '/home/hercules/system-apps-config/APPS_REGISTRY.json';

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.cache',
  '.local',
  '.config',
  '.npm',
  '.cargo',
  '.rustup',
  'go',
  'snap',
  '.vscode',
  '.cursor',
]);

function formatProjectName(dirName: string): string {
  return dirName
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}

function loadAppsRegistry(): AppsRegistry | null {
  try {
    if (existsSync(APPS_REGISTRY_PATH)) {
      const content = readFileSync(APPS_REGISTRY_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    logger.warn('Failed to load APPS_REGISTRY.json', { error: err });
  }
  return null;
}

function getProjectsFromFilesystem(): ProjectInfo[] {
  const projects: ProjectInfo[] = [];
  
  try {
    const entries = readdirSync(HERCULES_HOME, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      
      const fullPath = join(HERCULES_HOME, entry.name);
      
      try {
        const stats = statSync(fullPath);
        
        const hasDocker = existsSync(join(fullPath, 'docker-compose.yml')) || 
                         existsSync(join(fullPath, 'Dockerfile'));
        const hasPackageJson = existsSync(join(fullPath, 'package.json'));
        const hasRequirements = existsSync(join(fullPath, 'requirements.txt')) ||
                               existsSync(join(fullPath, 'pyproject.toml'));
        const hasCargo = existsSync(join(fullPath, 'Cargo.toml'));
        const hasGoMod = existsSync(join(fullPath, 'go.mod'));
        
        projects.push({
          id: entry.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          name: formatProjectName(entry.name),
          path: fullPath,
          hasDocker,
          hasPackageJson,
          hasRequirements,
          hasCargo,
          hasGoMod,
          lastModified: stats.mtime.toISOString(),
        });
      } catch (statErr) {
        logger.debug('Failed to stat directory', { path: fullPath, error: statErr });
      }
    }
  } catch (err) {
    logger.error('Failed to read hercules home directory', { error: err });
  }
  
  return projects;
}

function mergeWithRegistry(projects: ProjectInfo[], registry: AppsRegistry | null): ProjectInfo[] {
  if (!registry) return projects;

  // Build lookup maps: by path and by id (for projects without explicit path)
  const registryByPath = new Map<string, AppsRegistryApp>();
  const registryById = new Map<string, AppsRegistryApp>();

  for (const app of registry.apps) {
    if (app.path) {
      registryByPath.set(app.path, app);
    }
    // Also index by id for fallback matching
    registryById.set(app.id, app);
  }

  // Track which registry apps have been matched (for adding registry-only entries later)
  const matchedIds = new Set<string>();

  const mergedProjects = projects.map(project => {
    // First try exact path match
    let registryApp = registryByPath.get(project.path);

    // Fallback: try matching directory name to registry id
    if (!registryApp) {
      const dirName = project.path.split('/').pop()?.toLowerCase().replace(/[^a-z0-9-]/g, '-') || '';
      registryApp = registryById.get(dirName);
    }

    if (registryApp) {
      matchedIds.add(registryApp.id);
      return {
        ...project,
        name: registryApp.name || project.name,
        description: registryApp.description,
        category: registryApp.category,
        status: registryApp.status,
        url: registryApp.url || undefined,
        port: registryApp.port,
      };
    }
    return project;
  });

  // Add registry entries that have paths but weren't discovered by filesystem scan
  // (e.g., nested paths like /home/hercules/projects/math-visualization)
  for (const app of registry.apps) {
    if (app.path && !matchedIds.has(app.id)) {
      // Check if the path exists
      try {
        const stats = statSync(app.path);
        if (stats.isDirectory()) {
          mergedProjects.push({
            id: app.id,
            name: app.name || app.id,
            path: app.path,
            category: app.category,
            description: app.description,
            status: app.status,
            hasDocker: existsSync(join(app.path, 'docker-compose.yml')) ||
                       existsSync(join(app.path, 'Dockerfile')),
            hasPackageJson: existsSync(join(app.path, 'package.json')),
            hasRequirements: existsSync(join(app.path, 'requirements.txt')) ||
                            existsSync(join(app.path, 'pyproject.toml')),
            hasCargo: existsSync(join(app.path, 'Cargo.toml')),
            hasGoMod: existsSync(join(app.path, 'go.mod')),
            lastModified: stats.mtime.toISOString(),
            url: app.url || undefined,
            port: app.port,
          });
        }
      } catch {
        // Path doesn't exist, skip
      }
    }
  }

  return mergedProjects;
}

function addThumbnails(projects: ProjectInfo[]): ProjectInfo[] {
  return projects.map(project => {
    // Check for thumbnail files in various formats
    const extensions = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
    for (const ext of extensions) {
      const thumbnailPath = join(THUMBNAILS_DIR, `${project.id}.${ext}`);
      if (existsSync(thumbnailPath)) {
        return {
          ...project,
          thumbnail: `${THUMBNAILS_URL_BASE}/${project.id}.${ext}`,
        };
      }
    }
    return project;
  });
}

export function projectRoutes(): Router {
  const router = Router();
  
  let cachedProjects: ProjectInfo[] | null = null;
  let cacheTimestamp = 0;
  const CACHE_TTL = 60 * 1000;

  router.get('/', (_req: Request, res: Response) => {
    const now = Date.now();
    
    if (cachedProjects && (now - cacheTimestamp) < CACHE_TTL) {
      return res.json({
        data: {
          projects: cachedProjects,
          total: cachedProjects.length,
          lastUpdated: new Date(cacheTimestamp).toISOString(),
          cached: true,
        },
      });
    }
    
    try {
      const filesystemProjects = getProjectsFromFilesystem();
      const registry = loadAppsRegistry();
      let mergedProjects = mergeWithRegistry(filesystemProjects, registry);

      // Add thumbnails to projects that have them
      mergedProjects = addThumbnails(mergedProjects);

      mergedProjects.sort((a, b) => a.name.localeCompare(b.name));

      cachedProjects = mergedProjects;
      cacheTimestamp = now;
      
      res.json({
        data: {
          projects: mergedProjects,
          total: mergedProjects.length,
          lastUpdated: new Date(cacheTimestamp).toISOString(),
          cached: false,
        },
      });
    } catch (err) {
      logger.error('Failed to get projects', { error: err });
      res.status(500).json({
        error: { code: 'PROJECTS_FETCH_FAILED', message: 'Failed to fetch projects' },
      });
    }
  });

  router.get('/categories', (_req: Request, res: Response) => {
    try {
      const registry = loadAppsRegistry();
      
      if (registry?.categories) {
        const categories = Object.entries(registry.categories).map(([key, val]) => ({
          id: key,
          label: val.label,
        }));
        
        return res.json({
          data: { categories },
        });
      }
      
      res.json({
        data: {
          categories: [
            { id: 'portfolio', label: 'Portfolio Apps' },
            { id: 'infrastructure', label: 'Infrastructure' },
            { id: 'research', label: 'Research & Data' },
            { id: 'automation', label: 'Automation' },
            { id: 'other', label: 'Other' },
          ],
        },
      });
    } catch (err) {
      logger.error('Failed to get categories', { error: err });
      res.status(500).json({
        error: { code: 'CATEGORIES_FETCH_FAILED', message: 'Failed to fetch categories' },
      });
    }
  });

  router.post('/refresh', (_req: Request, res: Response) => {
    cachedProjects = null;
    cacheTimestamp = 0;

    res.json({
      data: { success: true, message: 'Cache cleared' },
    });
  });

  // Detect new folders not in registry (for auto-add feature)
  router.get('/unregistered', (_req: Request, res: Response) => {
    try {
      const registry = loadAppsRegistry();
      const registeredPaths = new Set<string>();
      const registeredIds = new Set<string>();

      if (registry) {
        for (const app of registry.apps) {
          if (app.path) registeredPaths.add(app.path);
          registeredIds.add(app.id);
        }
      }

      const unregistered: Array<{
        path: string;
        name: string;
        suggestedId: string;
        hasDocker: boolean;
        hasPackageJson: boolean;
        hasRequirements: boolean;
        hasCargo: boolean;
        hasGoMod: boolean;
      }> = [];

      const entries = readdirSync(HERCULES_HOME, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;
        if (EXCLUDED_DIRS.has(entry.name)) continue;

        const fullPath = join(HERCULES_HOME, entry.name);
        const suggestedId = entry.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

        // Skip if already registered
        if (registeredPaths.has(fullPath) || registeredIds.has(suggestedId)) {
          continue;
        }

        try {
          unregistered.push({
            path: fullPath,
            name: formatProjectName(entry.name),
            suggestedId,
            hasDocker: existsSync(join(fullPath, 'docker-compose.yml')) ||
                       existsSync(join(fullPath, 'Dockerfile')),
            hasPackageJson: existsSync(join(fullPath, 'package.json')),
            hasRequirements: existsSync(join(fullPath, 'requirements.txt')) ||
                            existsSync(join(fullPath, 'pyproject.toml')),
            hasCargo: existsSync(join(fullPath, 'Cargo.toml')),
            hasGoMod: existsSync(join(fullPath, 'go.mod')),
          });
        } catch {
          // Skip inaccessible directories
        }
      }

      res.json({
        data: {
          unregistered,
          total: unregistered.length,
          registeredCount: registry?.apps.length || 0,
        },
      });
    } catch (err) {
      logger.error('Failed to get unregistered projects', { error: err });
      res.status(500).json({
        error: { code: 'UNREGISTERED_FETCH_FAILED', message: 'Failed to fetch unregistered projects' },
      });
    }
  });

  // Add new project to registry
  router.post('/register', (req: Request, res: Response) => {
    try {
      const { path: projectPath, id, name, category, description } = req.body;

      if (!projectPath || !id) {
        return res.status(400).json({
          error: { code: 'INVALID_REQUEST', message: 'Path and id are required' },
        });
      }

      // Verify path exists
      if (!existsSync(projectPath)) {
        return res.status(400).json({
          error: { code: 'PATH_NOT_FOUND', message: 'Project path does not exist' },
        });
      }

      // Load current registry
      const registryContent = readFileSync(APPS_REGISTRY_PATH, 'utf-8');
      const registry = JSON.parse(registryContent);

      // Check if already registered
      const existing = registry.apps.find((app: AppsRegistryApp) =>
        app.id === id || app.path === projectPath
      );

      if (existing) {
        return res.status(400).json({
          error: { code: 'ALREADY_REGISTERED', message: 'Project is already registered' },
        });
      }

      // Detect tech stack
      const hasDocker = existsSync(join(projectPath, 'docker-compose.yml')) ||
                        existsSync(join(projectPath, 'Dockerfile'));
      const hasPackageJson = existsSync(join(projectPath, 'package.json'));
      const hasRequirements = existsSync(join(projectPath, 'requirements.txt')) ||
                             existsSync(join(projectPath, 'pyproject.toml'));
      const hasCargo = existsSync(join(projectPath, 'Cargo.toml'));
      const hasGoMod = existsSync(join(projectPath, 'go.mod'));

      // Determine framework
      let framework = 'unknown';
      if (hasDocker) framework = 'docker';
      if (hasPackageJson) framework = 'nodejs';
      if (hasRequirements) framework = 'python';
      if (hasCargo) framework = 'rust';
      if (hasGoMod) framework = 'go';

      // Create new registry entry
      const newApp = {
        id,
        name: name || formatProjectName(basename(projectPath)),
        description: description || `Project at ${projectPath}`,
        path: projectPath,
        status: 'documentation',
        health: 'n/a',
        visibility: 'private',
        category: category || 'personal',
        framework,
        features: [],
      };

      // Add to registry
      registry.apps.push(newApp);
      registry.summary.total_apps = registry.apps.length;

      // Write back
      writeFileSync(APPS_REGISTRY_PATH, JSON.stringify(registry, null, 2));

      // Clear cache
      cachedProjects = null;
      cacheTimestamp = 0;

      logger.info('Registered new project', { id, path: projectPath });

      res.json({
        data: { success: true, app: newApp },
      });
    } catch (err) {
      logger.error('Failed to register project', { error: err });
      res.status(500).json({
        error: { code: 'REGISTER_FAILED', message: 'Failed to register project' },
      });
    }
  });

  return router;
}
