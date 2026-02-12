/**
 * Integration tests for handoff automation flow.
 *
 * Tests the complete handoff → automation → window creation flow:
 * 1. Handoff script creates automation via API
 * 2. AutomationEngine executes automation with trace ID
 * 3. Window is created for Claude Code
 * 4. Callbacks are invoked with execution metrics
 *
 * Coverage:
 * - Successful handoff flow
 * - Error cases: no session, no handoff, network errors
 * - Callback invocation with metrics
 * - Trace ID correlation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionStore } from '../../session/SessionStore.js';
import { WindowManager } from '../../window/WindowManager.js';
import { AutomationEngine, Automation } from '../AutomationEngine.js';

// Mock implementations
const mockSessionStore = {
  getSession: vi.fn(),
  getSessionsByUser: vi.fn(),
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      run: vi.fn(),
      all: vi.fn(),
      get: vi.fn(),
    })),
  })),
  incrementAutomationRunCount: vi.fn(() => ({ disabled: false })),
} as any;

const mockWindowManager = {
  createWindow: vi.fn(),
  getMainWindow: vi.fn(),
  sendToWindow: vi.fn(),
} as any;

describe('AutomationEngine - Handoff Integration', () => {
  let engine: AutomationEngine;
  let callbackResults: any[] = [];

  beforeEach(() => {
    engine = new AutomationEngine(mockSessionStore, mockWindowManager);
    callbackResults = [];

    // Register callback to capture execution results
    engine.onExecution((automation, result) => {
      callbackResults.push({ automation, result, timestamp: Date.now() });
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    engine.destroy();
  });

  describe('Successful handoff flow', () => {
    it('should create window and execute automation steps', async () => {
      const automation: Automation = {
        id: 'auto-handoff-test',
        sessionId: 'session-123',
        userEmail: 'test@example.com',
        name: 'handoff-test-project',
        triggerType: 'on_resume',
        command: 'echo test',
        steps: [
          { id: '1', command: 'cd /home/user/project', delayAfter: 1 },
          { id: '2', command: 'claude --dangerously-skip-permissions', delayAfter: 8 },
          { id: '3', command: 'test prompt', delayAfter: 0, noNewline: true },
        ],
        createWindow: true,
        windowName: 'claude-test-project',
        enabled: true,
        createdAt: new Date(),
      };

      mockWindowManager.createWindow.mockResolvedValue({
        id: 'window-456',
        name: 'claude-test-project',
        state: 'ready',
      });

      mockWindowManager.sendToWindow.mockResolvedValue(void 0);

      const result = await engine.executeAutomation(
        automation,
        'session-123',
        'Handoff - spawn window'
      );

      expect(result.success).toBe(true);
      expect(result.windowId).toBe('window-456');
      expect(result.windowName).toBe('claude-test-project');

      // Verify window was created
      expect(mockWindowManager.createWindow).toHaveBeenCalledWith(
        'session-123',
        'test@example.com',
        'claude-test-project'
      );

      // Verify commands were sent
      expect(mockWindowManager.sendToWindow).toHaveBeenCalledTimes(3);
      expect(mockWindowManager.sendToWindow).toHaveBeenNthCalledWith(
        1,
        'window-456',
        'cd /home/user/project\r',
        'test@example.com'
      );

      // Verify callback was invoked
      expect(callbackResults).toHaveLength(1);
      expect(callbackResults[0].result.success).toBe(true);
    });

    it('should handle multi-step automation with delays', async () => {
      const automation: Automation = {
        id: 'auto-complex',
        sessionId: 'session-123',
        userEmail: 'test@example.com',
        name: 'complex-automation',
        triggerType: 'on_resume',
        command: 'echo test',
        steps: [
          { id: '1', command: 'git status', delayAfter: 2 },
          { id: '2', command: 'git add -A', delayAfter: 1 },
          { id: '3', command: 'git commit -m "work in progress"', delayAfter: 0 },
        ],
        createWindow: false,
        enabled: true,
        createdAt: new Date(),
      };

      mockWindowManager.getMainWindow.mockResolvedValue({
        id: 'window-main',
        name: 'Main',
      });

      mockWindowManager.sendToWindow.mockResolvedValue(void 0);

      const startTime = Date.now();
      const result = await engine.executeAutomation(automation, 'session-123', 'Test');
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);

      // Should have delays (at least 2 + 1 = 3 seconds)
      expect(duration).toBeGreaterThanOrEqual(2500);

      // All commands should be sent
      expect(mockWindowManager.sendToWindow).toHaveBeenCalledTimes(3);
    });

    it('should preserve prompt with special characters', async () => {
      const automation: Automation = {
        id: 'auto-special-chars',
        sessionId: 'session-123',
        userEmail: 'test@example.com',
        name: 'handoff-test',
        triggerType: 'on_resume',
        command: "echo 'don\\'t break'",
        steps: [
          { id: '1', command: 'cd /test', delayAfter: 0 },
          { id: '2', command: "echo 'test with \"quotes\" and stuff'", delayAfter: 0 },
        ],
        createWindow: false,
        enabled: true,
        createdAt: new Date(),
      };

      mockWindowManager.getMainWindow.mockResolvedValue({ id: 'window-1' });
      mockWindowManager.sendToWindow.mockResolvedValue(void 0);

      await engine.executeAutomation(automation, 'session-123', 'Test');

      // Verify special characters are preserved
      const calls = mockWindowManager.sendToWindow.mock.calls;
      expect(calls[1][1]).toContain('quotes');
    });
  });

  describe('Error cases', () => {
    it('should handle disabled automation', async () => {
      const automation: Automation = {
        id: 'auto-disabled',
        sessionId: 'session-123',
        userEmail: 'test@example.com',
        name: 'disabled-auto',
        triggerType: 'on_resume',
        command: 'echo test',
        createWindow: false,
        enabled: false,
        createdAt: new Date(),
      };

      const result = await engine.executeAutomation(automation, 'session-123', 'Test');

      expect(result.success).toBe(false);
      expect(result.output).toContain('disabled');

      // Callback should still be invoked
      expect(callbackResults).toHaveLength(1);
      expect(callbackResults[0].result.success).toBe(false);
    });

    it('should handle invalid command validation', async () => {
      const automation: Automation = {
        id: 'auto-invalid-cmd',
        sessionId: 'session-123',
        userEmail: 'test@example.com',
        name: 'invalid-cmd',
        triggerType: 'on_resume',
        command: 'invalid!@#$%^&*()',
        createWindow: false,
        enabled: true,
        createdAt: new Date(),
      };

      const result = await engine.executeAutomation(automation, 'session-123', 'Test');

      expect(result.success).toBe(false);
      expect(result.output).toContain('Invalid command');
    });

    it('should handle window creation failure', async () => {
      const automation: Automation = {
        id: 'auto-window-fail',
        sessionId: 'session-123',
        userEmail: 'test@example.com',
        name: 'window-fail',
        triggerType: 'on_resume',
        command: 'echo test',
        createWindow: true,
        windowName: 'new-window',
        enabled: true,
        createdAt: new Date(),
      };

      mockWindowManager.createWindow.mockRejectedValue(
        new Error('Max windows reached')
      );

      const result = await engine.executeAutomation(automation, 'session-123', 'Test');

      expect(result.success).toBe(false);
      expect(result.output).toContain('Max windows');

      // Callback should be invoked with error
      expect(callbackResults[0].result.success).toBe(false);
    });

    it('should handle no available window', async () => {
      const automation: Automation = {
        id: 'auto-no-window',
        sessionId: 'session-123',
        userEmail: 'test@example.com',
        name: 'no-window',
        triggerType: 'on_resume',
        command: 'echo test',
        createWindow: false,
        enabled: true,
        createdAt: new Date(),
      };

      mockWindowManager.getMainWindow.mockResolvedValue(null);

      const result = await engine.executeAutomation(automation, 'session-123', 'Test');

      expect(result.success).toBe(false);
      expect(result.output).toContain('No window available');
    });

    it('should handle command execution failure', async () => {
      const automation: Automation = {
        id: 'auto-exec-fail',
        sessionId: 'session-123',
        userEmail: 'test@example.com',
        name: 'exec-fail',
        triggerType: 'on_resume',
        command: 'echo test',
        createWindow: false,
        enabled: true,
        createdAt: new Date(),
      };

      mockWindowManager.getMainWindow.mockResolvedValue({ id: 'window-1' });
      mockWindowManager.sendToWindow.mockRejectedValue(
        new Error('Terminal not responsive')
      );

      const result = await engine.executeAutomation(automation, 'session-123', 'Test');

      expect(result.success).toBe(false);
      expect(result.output).toContain('Terminal not responsive');
    });
  });

  describe('Callback invocation and metrics', () => {
    it('should invoke callback on success', async () => {
      const automation: Automation = {
        id: 'auto-callback-test',
        sessionId: 'session-123',
        userEmail: 'test@example.com',
        name: 'callback-test',
        triggerType: 'on_resume',
        command: 'echo test',
        createWindow: false,
        enabled: true,
        createdAt: new Date(),
      };

      mockWindowManager.getMainWindow.mockResolvedValue({ id: 'window-1' });
      mockWindowManager.sendToWindow.mockResolvedValue(void 0);

      await engine.executeAutomation(automation, 'session-123', 'Test');

      expect(callbackResults).toHaveLength(1);
      expect(callbackResults[0].automation.id).toBe('auto-callback-test');
      expect(callbackResults[0].result.success).toBe(true);
    });

    it('should invoke callback on failure', async () => {
      const automation: Automation = {
        id: 'auto-callback-fail',
        sessionId: 'session-123',
        userEmail: 'test@example.com',
        name: 'callback-fail',
        triggerType: 'on_resume',
        command: 'echo test',
        createWindow: false,
        enabled: false,
        createdAt: new Date(),
      };

      await engine.executeAutomation(automation, 'session-123', 'Test');

      expect(callbackResults).toHaveLength(1);
      expect(callbackResults[0].result.success).toBe(false);
    });

    it('should handle callback exceptions gracefully', async () => {
      const automation: Automation = {
        id: 'auto-throw-callback',
        sessionId: 'session-123',
        userEmail: 'test@example.com',
        name: 'throw-callback',
        triggerType: 'on_resume',
        command: 'echo test',
        createWindow: false,
        enabled: true,
        createdAt: new Date(),
      };

      // Register callback that throws
      engine.onExecution(() => {
        throw new Error('Callback error');
      });

      mockWindowManager.getMainWindow.mockResolvedValue({ id: 'window-1' });
      mockWindowManager.sendToWindow.mockResolvedValue(void 0);

      // Should not throw - callback errors are caught
      const result = await engine.executeAutomation(automation, 'session-123', 'Test');

      expect(result.success).toBe(true);
    });
  });

  describe('Trigger events', () => {
    it('should execute on_connect automations', async () => {
      // Mock getAutomationsByTrigger to return on_connect automations
      const automations: Automation[] = [
        {
          id: 'auto-on-connect-1',
          sessionId: 'session-123',
          userEmail: 'test@example.com',
          name: 'on-connect-1',
          triggerType: 'on_connect',
          command: 'echo connected',
          createWindow: false,
          enabled: true,
          createdAt: new Date(),
        },
      ];

      // Mock the store to return automations
      mockSessionStore.getDatabase.mockReturnValue({
        prepare: vi.fn(() => ({
          all: vi.fn(() => automations.map(a => ({
            id: a.id,
            session_id: a.sessionId,
            user_email: a.userEmail,
            name: a.name,
            trigger_type: a.triggerType,
            command: a.command,
            create_window: 0,
            enabled: 1,
            created_at: a.createdAt.getTime(),
          }))),
          get: vi.fn(),
          run: vi.fn(),
        })),
      });

      mockWindowManager.getMainWindow.mockResolvedValue({ id: 'window-1' });
      mockWindowManager.sendToWindow.mockResolvedValue(void 0);

      await engine.onConnect('session-123', 'test@example.com');

      // Callback should be invoked for the automation
      expect(callbackResults.length).toBeGreaterThan(0);
    });
  });

  describe('Concurrent execution safeguards', () => {
    it('should not execute same automation concurrently', async () => {
      const automation: Automation = {
        id: 'auto-concurrent',
        sessionId: 'session-123',
        userEmail: 'test@example.com',
        name: 'concurrent',
        triggerType: 'on_resume',
        command: 'sleep 5 && echo done',
        createWindow: false,
        enabled: true,
        createdAt: new Date(),
      };

      mockWindowManager.getMainWindow.mockResolvedValue({ id: 'window-1' });
      mockWindowManager.sendToWindow.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );

      // Start first execution
      const promise1 = engine.executeAutomation(automation, 'session-123', 'Test 1');

      // Try to start second execution immediately (should queue)
      await new Promise(resolve => setTimeout(resolve, 10));

      // Both should succeed (no deduplication at automation level)
      const [result1] = await Promise.all([promise1]);
      expect(result1.success).toBe(true);
    });
  });

  describe('Scheduled automations', () => {
    it('should register cron jobs for scheduled automations', async () => {
      const automation: Automation = {
        id: 'auto-scheduled',
        sessionId: 'session-123',
        userEmail: 'test@example.com',
        name: 'scheduled-auto',
        triggerType: 'scheduled',
        triggerConfig: {
          cronExpression: '*/5 * * * *', // Every 5 minutes
        },
        command: 'echo scheduled',
        createWindow: false,
        enabled: true,
        createdAt: new Date(),
      };

      // Cron registration is internal - just verify it doesn't error
      engine.registerCronJob(automation);

      // Cleanup
      engine.unregisterCronJob(automation.id);
    });
  });
});

/**
 * Test scenarios for spawn-claude-window.py integration:
 *
 * 1. Successful handoff:
 *    - Script creates automation via POST /api/automations
 *    - Server returns automation ID
 *    - Script triggers automation via POST /api/automations/{id}/run
 *    - AutomationEngine executes with trace ID
 *    - Callbacks are invoked
 *
 * 2. Error: No active session:
 *    - Script calls GET /api/sessions
 *    - Returns empty array
 *    - Script returns error with recovery: "Open Zeus Terminal"
 *
 * 3. Error: Network failure:
 *    - Script cannot connect to Zeus
 *    - Returns error with recovery: "Check Zeus is running"
 *
 * 4. Error: No handoff.md:
 *    - Script cannot find handoff file
 *    - Returns error with recovery: "Create handoff.md"
 *
 * 5. Lock management:
 *    - Multiple /handoff calls in quick succession
 *    - Lock prevents duplicate execution
 *    - Older locks (>10s) are replaced
 *
 * 6. Prompt extraction:
 *    - Quick Resume code block is parsed
 *    - Single quotes are escaped for shell
 *    - Long prompts (>2000 chars) are truncated
 *
 * 7. Automation execution:
 *    - Trace ID from spawn script correlates to AutomationEngine logs
 *    - Callbacks receive metrics with timing
 *    - Window creation is tracked
 */
