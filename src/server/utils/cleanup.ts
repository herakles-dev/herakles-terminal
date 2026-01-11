import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { logger } from './logger.js';

const UPLOAD_ROOT = config.uploads.path;
const RETENTION_DAYS = config.uploads.retentionDays;

export async function cleanupOldUploads(): Promise<void> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    const users = await fs.readdir(UPLOAD_ROOT);
    let deletedFiles = 0;
    let deletedBytes = 0;
    
    for (const user of users) {
      if (user.startsWith('.')) continue;
      
      const userPath = path.join(UPLOAD_ROOT, user);
      const stat = await fs.stat(userPath);
      
      if (!stat.isDirectory()) continue;
      
      const days = await fs.readdir(userPath);
      
      for (const day of days) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        
        const dayDate = new Date(day);
        if (dayDate < cutoffDate) {
          const dayPath = path.join(userPath, day);
          
          const files = await fs.readdir(dayPath);
          for (const file of files) {
            const filePath = path.join(dayPath, file);
            const fileStats = await fs.stat(filePath);
            deletedBytes += fileStats.size;
            deletedFiles++;
          }
          
          await fs.rm(dayPath, { recursive: true });
          logger.info('Deleted old upload directory', { user, day, files: files.length });
        }
      }
    }
    
    if (deletedFiles > 0) {
      logger.info('Upload cleanup completed', { 
        deletedFiles, 
        deletedMB: (deletedBytes / 1024 / 1024).toFixed(2),
        retentionDays: RETENTION_DAYS 
      });
    }
  } catch (err) {
    logger.error('Upload cleanup failed', { error: err });
  }
}
