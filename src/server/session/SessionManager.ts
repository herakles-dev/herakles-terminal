import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import type { Session, ReconnectToken } from '../../shared/types.js';
import { config } from '../config.js';

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private tokens: Map<string, ReconnectToken> = new Map();

  createSession(name?: string, userEmail = 'default@herakles.dev'): Session {
    if (this.sessions.size >= config.session.maxSessions) {
      this.cleanupOldSessions();
    }

    const id = uuidv4();
    const session: Session = {
      id,
      name: name || `Session ${this.sessions.size + 1}`,
      userEmail,
      tmuxSession: `herakles-${id.substring(0, 8)}`,
      createdAt: new Date(),
      lastActiveAt: new Date(),
      state: 'active',
      timeoutHours: config.session.defaultTimeout,
      workingDirectory: '/home/hercules',
      activeConnections: 1,
      env: {},
    };

    this.sessions.set(id, session);
    console.log(`Created session: ${id}`);
    
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  resumeSession(sessionId: string, token: string): Session | null {
    const storedToken = this.tokens.get(sessionId);
    
    if (!storedToken) {
      return null;
    }

    if (storedToken.token !== token) {
      return null;
    }

    if (Date.now() > storedToken.expiresAt) {
      this.tokens.delete(sessionId);
      return null;
    }

    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActiveAt = new Date();
      session.activeConnections++;
      return session;
    }

    return null;
  }

  generateToken(sessionId: string): string {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + (24 * 60 * 60 * 1000);

    this.tokens.set(sessionId, {
      sessionId,
      token,
      expiresAt,
      deviceId: uuidv4(),
    });

    return token;
  }

  updateSessionActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActiveAt = new Date();
      if (session.activeConnections > 0) {
        session.activeConnections--;
      }
    }
  }

  deleteSession(id: string): boolean {
    this.tokens.delete(id);
    return this.sessions.delete(id);
  }

  renameSession(id: string, name: string): Session | null {
    const session = this.sessions.get(id);
    if (session) {
      session.name = name;
      return session;
    }
    return null;
  }

  listSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  private cleanupOldSessions(): void {
    const now = Date.now();
    const timeout = config.session.timeout * 1000;

    this.sessions.forEach((session, id) => {
      if (session.activeConnections === 0) {
        const inactive = now - session.lastActiveAt.getTime();
        if (inactive > timeout) {
          console.log(`Cleaning up inactive session: ${id}`);
          this.deleteSession(id);
        }
      }
    });
  }
}
