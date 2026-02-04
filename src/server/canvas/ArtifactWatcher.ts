import { readFile, unlink, readdir } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

const CANVAS_DIR = process.env.CANVAS_DIR || join(process.env.HOME || '/home/hercules', '.canvas', 'artifacts');
const POLL_INTERVAL_MS = 500;

export interface CanvasArtifact {
  id: string;
  type: 'html' | 'markdown' | 'mermaid' | 'svg' | 'code' | 'json';
  content: string;
  language?: string;
  title?: string;
  timestamp: number;
  sourceWindow?: string;
}

export class ArtifactWatcher extends EventEmitter {
  private pollInterval: NodeJS.Timeout | null = null;
  private processedFiles: Set<string> = new Set();
  private isProcessing = false;

  constructor() {
    super();
    if (!existsSync(CANVAS_DIR)) {
      mkdirSync(CANVAS_DIR, { recursive: true });
    }
  }

  async start(): Promise<void> {
    logger.info(`ArtifactWatcher starting with polling, watching: ${CANVAS_DIR}`);
    
    await this.pollForFiles();
    
    this.pollInterval = setInterval(() => {
      this.pollForFiles().catch(err => {
        logger.error('ArtifactWatcher poll error:', err);
      });
    }, POLL_INTERVAL_MS);
  }

  private async pollForFiles(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    
    try {
      const files = await readdir(CANVAS_DIR);
      for (const file of files) {
        if (file.endsWith('.json') && !this.processedFiles.has(file)) {
          const filePath = join(CANVAS_DIR, file);
          await this.processFile(filePath, file);
        }
      }
    } catch (err) {
      logger.error('Error polling for files:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processFile(filePath: string, filename: string): Promise<void> {
    try {
      await new Promise(resolve => setTimeout(resolve, 50));
      
      if (!existsSync(filePath)) {
        return;
      }

      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      
      if (!data.type || !data.content) {
        logger.warn(`Invalid artifact file (missing type or content): ${filename}`);
        await unlink(filePath).catch(() => {});
        return;
      }

      const artifact: CanvasArtifact = {
        id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: data.type,
        content: data.content,
        language: data.language,
        title: data.title || filename.replace('.json', ''),
        timestamp: Date.now(),
        sourceWindow: data.sourceWindow,
      };

      this.processedFiles.add(filename);
      this.emit('artifact', artifact);
      
      logger.info(`Processed artifact: ${artifact.id} (${artifact.type})`);

      try {
        await unlink(filePath);
        this.processedFiles.delete(filename);
        logger.debug(`Cleaned up artifact file: ${filename}`);
      } catch {
      }

    } catch (err) {
      logger.error(`Error processing artifact file ${filename}:`, err);
      try {
        await unlink(filePath);
      } catch {
      }
    }
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    logger.info('ArtifactWatcher stopped');
  }
}

export const artifactWatcher = new ArtifactWatcher();
