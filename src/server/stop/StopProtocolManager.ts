/**
 * StopProtocolManager — Partner-enforced bedtime system
 *
 * State machine: IDLE → GRACE (10 min) → LOCKOUT (2 hr) → IDLE
 * Only the authorized user (riz) can activate the protocol.
 * Broadcasts state changes to all WebSocket subscribers.
 */

import { EventEmitter } from 'events';
import type { WebSocket } from 'ws';
import {
  type StopProtocolPhase,
  GRACE_DURATION_MS,
  LOCKOUT_DURATION_MS,
  STOP_PROTOCOL_USER,
  DEFAULT_STOP_VIDEO,
} from '../../shared/stopProtocol.js';
import { logger } from '../utils/logger.js';

export class StopProtocolManager extends EventEmitter {
  private subscribers: Set<WebSocket> = new Set();
  private phase: StopProtocolPhase = 'idle';
  private youtubeUrl?: string;
  private message?: string;
  private graceEndsAt?: number;
  private lockoutEndsAt?: number;
  private graceTimer: NodeJS.Timeout | null = null;
  private lockoutTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    logger.info('StopProtocolManager initialized');
  }

  subscribe(ws: WebSocket): void {
    this.subscribers.add(ws);

    // Send current state to new subscriber
    const sync = {
      type: 'stop:sync',
      phase: this.phase,
      youtubeUrl: this.youtubeUrl,
      message: this.message,
      graceEndsAt: this.graceEndsAt,
      lockoutEndsAt: this.lockoutEndsAt,
    };
    this.send(ws, sync);

    ws.on('close', () => {
      this.subscribers.delete(ws);
    });
  }

  unsubscribe(ws: WebSocket): void {
    this.subscribers.delete(ws);
  }

  /**
   * Activate the stop protocol. Only the authorized user can trigger this.
   * Returns true if activated, false if unauthorized or already active.
   */
  activate(username: string, youtubeUrl?: string, message?: string): { ok: boolean; reason?: string } {
    if (username !== STOP_PROTOCOL_USER) {
      logger.warn(`StopProtocol: unauthorized activation attempt by ${username}`);
      return { ok: false, reason: 'Unauthorized: only riz can activate the stop protocol' };
    }

    if (this.phase !== 'idle') {
      return { ok: false, reason: `Protocol already active (phase: ${this.phase})` };
    }

    logger.info(`StopProtocol: ACTIVATED by ${username}`);
    this.youtubeUrl = youtubeUrl || DEFAULT_STOP_VIDEO;
    this.message = message;
    this.enterGrace();
    return { ok: true };
  }

  private enterGrace(): void {
    this.phase = 'grace';
    this.graceEndsAt = Date.now() + GRACE_DURATION_MS;

    // Broadcast warning to all subscribers
    const warning = {
      type: 'stop:warning',
      youtubeUrl: this.youtubeUrl,
      message: this.message,
      graceEndsAt: this.graceEndsAt,
    };
    this.broadcast(warning);

    // Start grace timer
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      this.enterLockout();
    }, GRACE_DURATION_MS);

    logger.info(`StopProtocol: GRACE period started, ends at ${new Date(this.graceEndsAt).toISOString()}`);
  }

  private enterLockout(): void {
    this.phase = 'lockout';
    this.lockoutEndsAt = Date.now() + LOCKOUT_DURATION_MS;
    this.graceEndsAt = undefined;

    const lockout = {
      type: 'stop:lockout',
      lockoutEndsAt: this.lockoutEndsAt,
    };
    this.broadcast(lockout);

    // Start lockout timer
    this.lockoutTimer = setTimeout(() => {
      this.lockoutTimer = null;
      this.clear();
    }, LOCKOUT_DURATION_MS);

    logger.info(`StopProtocol: LOCKOUT started, ends at ${new Date(this.lockoutEndsAt).toISOString()}`);
  }

  private clear(): void {
    this.phase = 'idle';
    this.youtubeUrl = undefined;
    this.message = undefined;
    this.graceEndsAt = undefined;
    this.lockoutEndsAt = undefined;

    const clearMsg = { type: 'stop:clear' as const };
    this.broadcast(clearMsg);

    logger.info('StopProtocol: CLEARED — back to idle');
  }

  getPhase(): StopProtocolPhase {
    return this.phase;
  }

  private broadcast(msg: object): void {
    const data = JSON.stringify(msg);
    for (const ws of this.subscribers) {
      try {
        if (ws.readyState === ws.OPEN) {
          ws.send(data);
        }
      } catch {
        this.subscribers.delete(ws);
      }
    }
  }

  private send(ws: WebSocket, msg: object): void {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    } catch {
      this.subscribers.delete(ws);
    }
  }

  destroy(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    if (this.lockoutTimer) clearTimeout(this.lockoutTimer);
    this.subscribers.clear();
  }
}

// Singleton instance
export const stopProtocolManager = new StopProtocolManager();
