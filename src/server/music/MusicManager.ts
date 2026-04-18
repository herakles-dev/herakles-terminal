/**
 * MusicManager - WebSocket-based music dock state management
 *
 * Handles real-time music dock state synchronization between server and clients.
 * Persists dock position/size/collapsed state via MusicPlayerStore.
 */

import type { WebSocket } from 'ws';
import type { MusicPlayerStore } from './MusicPlayerStore.js';
import type { MusicDockState } from '../../shared/musicProtocol.js';

interface MusicSubscription {
  ws: WebSocket;
  userEmail: string;
}

export class MusicManager {
  private store: MusicPlayerStore;
  private subscribers: Set<MusicSubscription> = new Set();
  /** One close handler per ws — guards against duplicate listener attachment. */
  private wsCloseHandlers: WeakMap<WebSocket, () => void> = new WeakMap();

  constructor(store: MusicPlayerStore) {
    this.store = store;
  }

  /**
   * Subscribe a client to music state updates.
   * Immediately sends the persisted dock state on subscribe.
   */
  subscribe(ws: WebSocket, userEmail: string): void {
    // Dedup: a single ws should only have one subscription row.
    let alreadySubscribed = false;
    for (const sub of this.subscribers) {
      if (sub.ws === ws) {
        alreadySubscribed = true;
        break;
      }
    }
    if (!alreadySubscribed) {
      this.subscribers.add({ ws, userEmail });
    }

    // Send persisted dock state on connection
    const dockState = this.store.getDockState(userEmail);
    this.sendToWebSocket(ws, {
      type: 'music:dock:restore',
      state: dockState,
    });

    // Attach close handler exactly once per ws.
    if (!this.wsCloseHandlers.has(ws)) {
      const handleClose = (): void => {
        this.unsubscribe(ws);
        this.wsCloseHandlers.delete(ws);
        ws.removeListener('close', handleClose);
      };
      this.wsCloseHandlers.set(ws, handleClose);
      ws.on('close', handleClose);
    }
  }

  /**
   * Unsubscribe a client from music state updates.
   */
  unsubscribe(ws: WebSocket): void {
    for (const sub of this.subscribers) {
      if (sub.ws === ws) {
        this.subscribers.delete(sub);
      }
    }
  }

  /**
   * Handle dock state update from a client.
   * Persists to DB and broadcasts to other sessions of the same user.
   */
  handleDockUpdate(ws: WebSocket, userEmail: string, state: MusicDockState): void {
    // Persist to database
    this.store.saveDockState(userEmail, state);

    // Broadcast to other connections of the same user (multi-device sync)
    for (const sub of this.subscribers) {
      if (sub.userEmail === userEmail && sub.ws !== ws) {
        this.sendToWebSocket(sub.ws, {
          type: 'music:dock:restore',
          state,
        });
      }
    }
  }

  /**
   * Clean up all subscriptions for a WebSocket.
   */
  unsubscribeAll(ws: WebSocket): void {
    this.unsubscribe(ws);
  }

  private sendToWebSocket(ws: WebSocket, message: Record<string, unknown>): void {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch {
      // Connection may have closed
    }
  }

  getStats(): { subscriberCount: number } {
    return { subscriberCount: this.subscribers.size };
  }
}
