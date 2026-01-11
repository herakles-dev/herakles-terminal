import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TmuxManager } from '../tmux/TmuxManager.js';

describe('TmuxManager', () => {
  let tmux: TmuxManager;
  const testSocket = '/tmp/zeus-test-' + Date.now() + '.sock';
  const testSessionId = 'test-' + Date.now();

  beforeEach(() => {
    tmux = new TmuxManager(testSocket);
  });

  afterEach(async () => {
    try {
      await tmux.killSession(testSessionId);
    } catch {
    }
  });

  describe('session management', () => {
    it('checks session existence', async () => {
      const exists = await tmux.sessionExists('non-existent-session');
      expect(exists).toBe(false);
    });

    it('creates a new session', async () => {
      await tmux.createSession(testSessionId, 80, 24);
      const exists = await tmux.sessionExists(testSessionId);
      expect(exists).toBe(true);
    });

    it('resizes session', async () => {
      await tmux.createSession(testSessionId, 80, 24);
      await expect(tmux.resizeSession(testSessionId, 120, 40)).resolves.not.toThrow();
    });

    it('kills session', async () => {
      await tmux.createSession(testSessionId, 80, 24);
      await tmux.killSession(testSessionId);
      const exists = await tmux.sessionExists(testSessionId);
      expect(exists).toBe(false);
    });
  });
});
