import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { RateLimiter } from '../middleware/rateLimit';
import { AutomationEngine } from '../automation/AutomationEngine';
import { SessionStore } from '../session/SessionStore';
import { WindowManager } from '../window/WindowManager';

// Mock implementations for testing
class MockTmux {
  async createSession() { return { name: 'test', id: 'test' }; }
  async listSessions() { return []; }
  async capturePane() { return ''; }
  async sendKeys() { return true; }
}

describe('Safety Safeguards', () => {
  let db: Database.Database;
  let store: SessionStore;
  let engine: AutomationEngine;
  let windowManager: WindowManager;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    store = new SessionStore(':memory:');

    // Initialize window manager with mock tmux
    windowManager = new WindowManager(new MockTmux() as any, store);
    engine = new AutomationEngine(store, windowManager);
  });

  describe('Rate Limiting', () => {
    it('should allow first 5 calls within 1 minute', () => {
      const limiter = new RateLimiter(db);

      for (let i = 0; i < 5; i++) {
        const result = limiter.check('test-user', 5, 60000);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(4 - i);
      }
    });

    it('should block 6th call within 1 minute', () => {
      const limiter = new RateLimiter(db);

      // First 5 calls allowed
      for (let i = 0; i < 5; i++) {
        limiter.check('test-user', 5, 60000);
      }

      // 6th call should be blocked
      const result = limiter.check('test-user', 5, 60000);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should reset after time window expires', () => {
      const limiter = new RateLimiter(db);
      const now = Date.now();

      // Make 5 calls at time 0
      for (let i = 0; i < 5; i++) {
        limiter.check('test-user', 5, 1000);
      }

      // 6th call within window should fail
      let result = limiter.check('test-user', 5, 1000);
      expect(result.allowed).toBe(false);

      // Simulate time passing (window expires)
      vi.useFakeTimers();
      vi.setSystemTime(now + 1001);

      // Next call should be allowed (new window)
      result = limiter.check('test-user', 5, 1000);
      expect(result.allowed).toBe(true);

      vi.useRealTimers();
    });

    it('should apply lockout after exceeding limit', () => {
      const limiter = new RateLimiter(db);

      // Exhaust limit
      for (let i = 0; i < 5; i++) {
        limiter.check('test-user', 5, 60000);
      }

      // Apply lockout for 1 minute
      limiter.lockout('test-user', 1);

      // Next check should fail
      const result = limiter.check('test-user', 5, 60000);
      expect(result.allowed).toBe(false);
    });

    it('should track remaining requests correctly', () => {
      const limiter = new RateLimiter(db);

      const result1 = limiter.check('user1', 10, 60000);
      expect(result1.remaining).toBe(9);

      const result2 = limiter.check('user1', 10, 60000);
      expect(result2.remaining).toBe(8);

      const result3 = limiter.check('user1', 10, 60000);
      expect(result3.remaining).toBe(7);
    });
  });

  describe('Execution Timeouts', () => {
    it('should have MAX_EXECUTION_TIME_MS constant', () => {
      // @ts-ignore - accessing private field for testing
      expect(engine.MAX_EXECUTION_TIME_MS).toBe(30 * 1000);
    });

    it('should have MAX_CONCURRENT_PER_USER constant', () => {
      // @ts-ignore - accessing private field for testing
      expect(engine.MAX_CONCURRENT_PER_USER).toBe(10);
    });

    it('should enforce concurrency limit', async () => {
      const userEmail = 'test@example.com';

      // Create mock automation
      const automation = {
        id: 'test-1',
        sessionId: 'session-1',
        userEmail,
        name: 'test-automation',
        triggerType: 'on_resume' as const,
        command: 'echo test',
        enabled: true,
        createWindow: false,
        createdAt: new Date(),
      };

      // Mock executeAutomation to check concurrency before running
      vi.spyOn(engine, 'executeAutomation').mockResolvedValue({
        success: true,
      });

      // Simulate 11 concurrent executions (should fail on 11th)
      const results = await Promise.all(
        Array.from({ length: 11 }, (_, i) =>
          engine.executeAutomation(
            { ...automation, id: `test-${i}` },
            'session-1',
            'test'
          )
        )
      );

      // At least one should fail due to concurrency limit
      const failed = results.filter(r => !r.success);
      expect(failed.length).toBeGreaterThan(0);
    });
  });

  describe('Database Cleanup', () => {
    it('should cleanup old rate limit records', () => {
      const limiter = new RateLimiter(db);

      // Create a record
      limiter.check('old-user', 5, 60000);

      // Cleanup with 0 max age (should delete everything)
      const deleted = limiter.cleanup(0);

      // Verify deletion happened
      expect(deleted).toBeGreaterThan(0);
    });

    it('should not cleanup recent records', () => {
      const limiter = new RateLimiter(db);

      // Create a record
      limiter.check('recent-user', 5, 60000);

      // Cleanup with future max age (should keep everything)
      const deleted = limiter.cleanup(24 * 60 * 60 * 1000);

      // Verify nothing was deleted
      expect(deleted).toBe(0);
    });
  });

  describe('Resource Management', () => {
    it('should cleanup resources on destroy', () => {
      // @ts-ignore - accessing private fields for testing
      engine.cronJobs.set('test', setTimeout(() => {}, 1000));
      engine['executionTimeouts'].set('test', setTimeout(() => {}, 1000));
      engine['lastActivity'].set('session-1', Date.now());

      engine.destroy();

      // @ts-ignore
      expect(engine.cronJobs.size).toBe(0);
      expect(engine['executionTimeouts'].size).toBe(0);
      // @ts-ignore
      expect(engine.lastActivity.size).toBe(0);
    });
  });

  describe('Error Recovery', () => {
    it('should handle timeout gracefully', async () => {
      const automation = {
        id: 'timeout-test',
        sessionId: 'session-1',
        userEmail: 'test@example.com',
        name: 'slow-automation',
        triggerType: 'on_resume' as const,
        command: 'sleep 60',  // Very long command
        enabled: true,
        createWindow: false,
        createdAt: new Date(),
      };

      // executeWithTimeout should return timeout error
      const result = await engine.executeWithTimeout(
        automation,
        'session-1',
        'test'
      );

      // Should handle timeout without throwing
      expect(result).toBeDefined();
      expect(result.error).toBe('EXECUTION_TIMEOUT');
    });

    it('should cleanup state after timeout', async () => {
      const userEmail = 'test@example.com';
      const automation = {
        id: 'cleanup-test',
        sessionId: 'session-1',
        userEmail,
        name: 'cleanup-automation',
        triggerType: 'on_resume' as const,
        command: 'sleep 60',
        enabled: true,
        createWindow: false,
        createdAt: new Date(),
      };

      // @ts-ignore - accessing private field
      const initialCount = engine.userConcurrencyCount.get(userEmail) || 0;

      // Should timeout but cleanup properly
      await engine.executeWithTimeout(
        automation,
        'session-1',
        'test'
      );

      // @ts-ignore - accessing private field
      const finalCount = engine.userConcurrencyCount.get(userEmail) || 0;

      // Count should be same or lower (cleanup happened)
      expect(finalCount).toBeLessThanOrEqual(initialCount);
    });
  });
});
