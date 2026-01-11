import { Router, Request, Response } from 'express';
import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { logger } from '../utils/logger.js';

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
}

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
  
  const registryByPath = new Map<string, AppsRegistryApp>();
  for (const app of registry.apps) {
    if (app.path) {
      registryByPath.set(app.path, app);
    }
  }
  
  return projects.map(project => {
    const registryApp = registryByPath.get(project.path);
    if (registryApp) {
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
      const mergedProjects = mergeWithRegistry(filesystemProjects, registry);
      
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

  return router;
}
