/**
 * ArtifactManager - In-memory artifact history tracking
 *
 * Tracks the last 50 artifacts and provides history to subscribers.
 * Integrates with ArtifactWatcher for real-time artifact events.
 */

import type { WebSocket } from 'ws';
import type { ArtifactMetadata } from '../../shared/types.js';
import type { CanvasArtifact } from './ArtifactWatcher.js';
import { logger } from '../utils/logger.js';

const MAX_HISTORY = 50;
const THUMBNAIL_LENGTH = 200;

interface ArtifactSubscription {
  ws: WebSocket;
  userEmail: string;
}

export class ArtifactManager {
  private history: ArtifactMetadata[] = [];
  private subscribers: Set<ArtifactSubscription> = new Set();

  /**
   * Record a new artifact in history.
   * Called when ArtifactWatcher emits an artifact event.
   */
  recordArtifact(artifact: CanvasArtifact): void {
    const metadata: ArtifactMetadata = {
      id: artifact.id,
      title: artifact.title || 'Untitled',
      type: artifact.type,
      language: artifact.language,
      timestamp: artifact.timestamp,
      thumbnail: artifact.content.slice(0, THUMBNAIL_LENGTH),
      tags: this.generateTags(artifact),
    };

    this.history.unshift(metadata);

    // Trim to max history size
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(0, MAX_HISTORY);
    }

    logger.debug(`ArtifactManager: Recorded artifact ${metadata.id} (${metadata.type}), history size: ${this.history.length}`);
  }

  /**
   * Subscribe a client to receive artifact history.
   * Immediately sends the current history on subscribe.
   */
  subscribe(ws: WebSocket, userEmail: string): void {
    const sub: ArtifactSubscription = { ws, userEmail };
    this.subscribers.add(sub);

    // Send current history immediately
    this.sendHistory(ws);

    // Clean up on close
    const handleClose = (): void => {
      this.subscribers.delete(sub);
      ws.removeListener('close', handleClose);
    };
    ws.on('close', handleClose);
  }

  /**
   * Unsubscribe a client.
   */
  unsubscribe(ws: WebSocket): void {
    for (const sub of this.subscribers) {
      if (sub.ws === ws) {
        this.subscribers.delete(sub);
      }
    }
  }

  /**
   * Get the current artifact history.
   */
  getHistory(): ArtifactMetadata[] {
    return this.history;
  }

  /**
   * Broadcast updated history to all subscribers (called after new artifact).
   */
  broadcastHistory(): void {
    for (const sub of this.subscribers) {
      this.sendHistory(sub.ws);
    }
  }

  private sendHistory(ws: WebSocket): void {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'artifact:history',
          artifacts: this.history,
        }));
      }
    } catch {
      // Connection may have closed
    }
  }

  /**
   * Generate tags for an artifact based on its type and content.
   */
  private generateTags(artifact: CanvasArtifact): string[] {
    const tags: string[] = [artifact.type];

    if (artifact.language) {
      tags.push(artifact.language);
    }

    // Add content-based tags
    if (artifact.type === 'mermaid') {
      if (artifact.content.includes('graph')) tags.push('diagram');
      if (artifact.content.includes('sequenceDiagram')) tags.push('sequence');
      if (artifact.content.includes('gantt')) tags.push('gantt');
    }

    if (artifact.type === 'code' && artifact.content.length > 500) {
      tags.push('large');
    }

    return tags;
  }

  getStats(): { historySize: number; subscriberCount: number } {
    return {
      historySize: this.history.length,
      subscriberCount: this.subscribers.size,
    };
  }
}
