import { Router, Request, Response } from 'express';
import { SessionStore } from '../session/SessionStore.js';
import { ConnectionManager } from '../websocket/ConnectionManager.js';
import { uploadMiddleware, validateUploadedFile, generateThumbnail, checkUserQuota } from '../middleware/upload.js';
import { optimizeImage, isImageFile, OptimizationResult } from '../upload/ImageOptimizer.js';
import { AutheliaUser } from '../middleware/autheliaAuth.js';
import fs from 'fs/promises';
import path from 'path';

interface AuthenticatedRequest extends Request {
  user?: AutheliaUser;
}

const UPLOAD_ROOT = '/home/hercules/uploads';

export function uploadRoutes(_store: SessionStore, connectionManager: ConnectionManager): Router {
  const router = Router();

  router.post('/', async (req: AuthenticatedRequest, res: Response, next) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const quota = await checkUserQuota(req.user.email);
    if (!quota.allowed) {
      return res.status(413).json({ 
        error: { 
          code: 'QUOTA_EXCEEDED', 
          message: `Storage quota exceeded. Used ${(quota.used / 1024 / 1024).toFixed(1)}MB of ${(quota.limit / 1024 / 1024).toFixed(0)}MB`,
          details: { used: quota.used, limit: quota.limit }
        } 
      });
    }

    next();
  }, uploadMiddleware.array('files', 10), async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const files = req.files as Express.Multer.File[];
    
    if (!files || files.length === 0) {
      return res.status(400).json({ error: { code: 'NO_FILES', message: 'No files uploaded' } });
    }

    const validatedFiles = [];
    for (const file of files) {
      try {
        const isValid = await validateUploadedFile(file.path, file.mimetype);
        if (!isValid) {
          await fs.unlink(file.path);
          continue;
        }

        let thumbnailPath = null;
        let optimizedPath: string | null = null;
        let optimizationResult: OptimizationResult | null = null;

        // Generate thumbnail for images
        if (file.mimetype.startsWith('image/')) {
          thumbnailPath = await generateThumbnail(file.path);
          
          // Optimize image for Claude token efficiency
          if (isImageFile(file.mimetype)) {
            try {
              optimizationResult = await optimizeImage(file.path);
              // Only set optimizedPath if it's different from original
              if (optimizationResult.optimizedPath !== file.path) {
                optimizedPath = optimizationResult.optimizedPath;
              }
            } catch (optErr) {
              // Log but don't fail - optimization is optional
              console.warn('Image optimization failed:', optErr);
            }
          }
        }

        const relativePath = file.path.replace(UPLOAD_ROOT, '');
        const dateMatch = relativePath.match(/\/([^/]+)\/([^/]+)$/);
        const date = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];

        validatedFiles.push({
          filename: file.filename,
          originalName: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
          path: relativePath,
          date,
          hasThumbnail: !!thumbnailPath,
          hasOptimized: !!optimizedPath,
          optimizedPath: optimizedPath ? `/${file.destination.replace(UPLOAD_ROOT, '').replace(/^\//, '')}/${path.basename(optimizedPath)}` : undefined,
          optimizationStats: optimizationResult ? {
            originalSize: optimizationResult.originalSize,
            optimizedSize: optimizationResult.optimizedSize,
            wasResized: optimizationResult.wasResized,
            wasConverted: optimizationResult.wasConverted,
          } : undefined,
        });
      } catch (err) {
        await fs.unlink(file.path).catch(() => {});
      }
    }

    const quota = await checkUserQuota(req.user.email);

    // Broadcast file upload notifications via WebSocket
    for (const file of validatedFiles) {
      connectionManager.broadcastToUser(req.user.email, {
        type: 'file:uploaded',
        file: {
          id: `${file.date}-${file.filename}`,
          filename: file.filename,
          originalName: file.originalName,
          path: `${UPLOAD_ROOT}${file.path}`,
          size: file.size,
          mimeType: file.mimetype,
          hasThumbnail: file.hasThumbnail,
          hasOptimized: file.hasOptimized,
          optimizedPath: file.optimizedPath,
          optimizationStats: file.optimizationStats,
          uploadedAt: new Date().toISOString(),
        },
      });
    }

    res.status(201).json({ 
      data: { 
        files: validatedFiles,
        quota: {
          used: quota.used,
          limit: quota.limit,
          percentUsed: Math.round((quota.used / quota.limit) * 100),
        }
      } 
    });
  });

  router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const userDir = path.join(UPLOAD_ROOT, req.user.email);
    
    try {
      await fs.access(userDir);
    } catch {
      const quota = await checkUserQuota(req.user.email);
      return res.json({ 
        data: { 
          files: [],
          quota: {
            used: 0,
            limit: quota.limit,
            percentUsed: 0,
          }
        } 
      });
    }

    const days = await fs.readdir(userDir);
    const files = [];

    for (const day of days) {
      const dayPath = path.join(userDir, day);
      const dayFiles = await fs.readdir(dayPath);
      
      for (const file of dayFiles) {
        // Skip thumbnails and optimized versions in listing
        if (file.includes('_thumb') || file.includes('_optimized')) continue;
        
        const filePath = path.join(dayPath, file);
        const stats = await fs.stat(filePath);
        
        const ext = path.extname(file);
        const thumbnailPath = path.join(dayPath, file.replace(ext, `_thumb${ext}`));
        let hasThumbnail = false;
        try {
          await fs.access(thumbnailPath);
          hasThumbnail = true;
        } catch {}

        // Check if optimized version exists
        const optimizedFilename = file.replace(ext, `_optimized${ext}`);
        const optimizedFilePath = path.join(dayPath, optimizedFilename);
        let hasOptimized = false;
        try {
          await fs.access(optimizedFilePath);
          hasOptimized = true;
        } catch {}

        files.push({
          filename: file,
          date: day,
          size: stats.size,
          uploadedAt: stats.birthtime.toISOString(),
          path: `/${req.user.email}/${day}/${file}`,
          hasThumbnail,
          hasOptimized,
          optimizedPath: hasOptimized ? `/${req.user.email}/${day}/${optimizedFilename}` : undefined,
        });
      }
    }

    const quota = await checkUserQuota(req.user.email);

    res.json({ 
      data: { 
        files: files.sort((a, b) => 
          new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
        ),
        quota: {
          used: quota.used,
          limit: quota.limit,
          percentUsed: Math.round((quota.used / quota.limit) * 100),
        }
      } 
    });
  });

  router.get('/:date/:filename', async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const { date, filename } = req.params;
    
    if (filename.includes('..') || date.includes('..') || filename.includes('/') || date.includes('/')) {
      return res.status(400).json({ error: { code: 'INVALID_PATH', message: 'Invalid file path' } });
    }

    const filePath = path.join(UPLOAD_ROOT, req.user.email, date, filename);
    
    const normalizedPath = path.resolve(filePath);
    const allowedBase = path.resolve(UPLOAD_ROOT, req.user.email);
    
    if (!normalizedPath.startsWith(allowedBase)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }
    
    try {
      await fs.access(filePath);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      res.download(filePath);
    } catch {
      res.status(404).json({ error: { code: 'FILE_NOT_FOUND', message: 'File not found' } });
    }
  });

  router.get('/:date/:filename/thumbnail', async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const { date, filename } = req.params;
    
    if (filename.includes('..') || date.includes('..') || filename.includes('/') || date.includes('/')) {
      return res.status(400).json({ error: { code: 'INVALID_PATH', message: 'Invalid file path' } });
    }

    const ext = path.extname(filename);
    const thumbnailFilename = filename.replace(ext, `_thumb${ext}`);
    const thumbnailPath = path.join(UPLOAD_ROOT, req.user.email, date, thumbnailFilename);
    
    const normalizedPath = path.resolve(thumbnailPath);
    const allowedBase = path.resolve(UPLOAD_ROOT, req.user.email);
    
    if (!normalizedPath.startsWith(allowedBase)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }
    
    try {
      await fs.access(thumbnailPath);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'");
      res.sendFile(thumbnailPath);
    } catch {
      res.status(404).json({ error: { code: 'THUMBNAIL_NOT_FOUND', message: 'Thumbnail not found' } });
    }
  });

  router.get('/:date/:filename/optimized', async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const { date, filename } = req.params;
    
    if (filename.includes('..') || date.includes('..') || filename.includes('/') || date.includes('/')) {
      return res.status(400).json({ error: { code: 'INVALID_PATH', message: 'Invalid file path' } });
    }

    const ext = path.extname(filename);
    const optimizedFilename = filename.replace(ext, `_optimized${ext}`);
    const optimizedPath = path.join(UPLOAD_ROOT, req.user.email, date, optimizedFilename);
    
    const normalizedPath = path.resolve(optimizedPath);
    const allowedBase = path.resolve(UPLOAD_ROOT, req.user.email);
    
    if (!normalizedPath.startsWith(allowedBase)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }
    
    try {
      await fs.access(optimizedPath);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'");
      res.sendFile(optimizedPath);
    } catch {
      // Fall back to original if optimized doesn't exist
      const originalPath = path.join(UPLOAD_ROOT, req.user.email, date, filename);
      try {
        await fs.access(originalPath);
        res.sendFile(originalPath);
      } catch {
        res.status(404).json({ error: { code: 'FILE_NOT_FOUND', message: 'File not found' } });
      }
    }
  });

  router.delete('/:date/:filename', async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: 'Not authenticated' } });
    }

    const { date, filename } = req.params;
    
    if (filename.includes('..') || date.includes('..') || filename.includes('/') || date.includes('/')) {
      return res.status(400).json({ error: { code: 'INVALID_PATH', message: 'Invalid file path' } });
    }

    const filePath = path.join(UPLOAD_ROOT, req.user.email, date, filename);
    
    const normalizedPath = path.resolve(filePath);
    const allowedBase = path.resolve(UPLOAD_ROOT, req.user.email);
    
    if (!normalizedPath.startsWith(allowedBase)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }
    
    try {
      await fs.unlink(filePath);
      
      const ext = path.extname(filename);
      const thumbnailPath = path.join(UPLOAD_ROOT, req.user.email, date, filename.replace(ext, `_thumb${ext}`));
      await fs.unlink(thumbnailPath).catch(() => {});
      
      // Also delete optimized version if it exists
      const optimizedPath = path.join(UPLOAD_ROOT, req.user.email, date, filename.replace(ext, `_optimized${ext}`));
      await fs.unlink(optimizedPath).catch(() => {});
      
      // Broadcast file deletion notification via WebSocket
      connectionManager.broadcastToUser(req.user.email, {
        type: 'file:deleted',
        fileId: `${date}-${filename}`,
        filename,
      });

      res.json({ data: { success: true } });
    } catch {
      res.status(404).json({ error: { code: 'FILE_NOT_FOUND', message: 'File not found' } });
    }
  });

  return router;
}
