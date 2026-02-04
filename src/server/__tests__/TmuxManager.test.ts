import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { TmuxManager } from '../tmux/TmuxManager.js';

// Check if tmux is available
function isTmuxAvailable(): boolean {
  try {
    execSync('which tmux', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasTmux = isTmuxAvailable();

describe.skipIf(!hasTmux)('TmuxManager', () => {
  let tmux: TmuxManager;
  const testSocket = '/tmp/zeus-test-' + Date.now() + '.sock';
  const testSessionId = randomUUID();

  beforeEach(() => {
    tmux = new TmuxManager(testSocket);
  });

  afterEach(async () => {
    try {
      await tmux.killSession(testSessionId);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('session management', () => {
    it('checks session existence', async () => {
      // Use a valid UUID that doesn't exist
      const nonExistentUUID = randomUUID();
      const exists = await tmux.sessionExists(nonExistentUUID);
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
