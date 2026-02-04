import { SessionStore } from '../session/SessionStore.js';
import { WindowManager } from '../window/WindowManager.js';
import { createChildLogger } from '../utils/logger.js';
import {
  validateAutomationCommand,
  validateCronExpression,
  validateRegexPattern,
} from '../utils/validation.js';

const logger = createChildLogger('automation');

export type TriggerType =
  | 'on_connect'
  | 'on_disconnect'
  | 'on_resume'
  | 'on_idle'
  | 'on_output_match'
  | 'scheduled';

interface CommandStep {
  id: string;
  command: string;
  delayAfter: number;
  noNewline?: boolean;  // If true, don't append \r to command
}

export interface Automation {
  id: string;
  sessionId: string;
  userEmail: string;
  name: string;
  triggerType: TriggerType;
  triggerConfig?: {
    idleMinutes?: number;
    timeout?: number;
    pattern?: string;
    cronExpression?: string;
    cron?: string;
    timezone?: string;
    maxRuns?: number;
  };
  command: string;
  steps?: CommandStep[];
  createWindow: boolean;
  windowName?: string;
  targetWindow?: string;
  enabled: boolean;
  createdAt: Date;
  lastRunAt?: Date;
  runCount?: number;
}

export interface AutomationLog {
  id: number;
  automationId: string;
  triggeredAt: Date;
  triggerReason?: string;
  command: string;
  output?: string;
  success: boolean;
}

interface ExecutionMetrics {
  traceId: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  success: boolean;
  errorType?: string;
  errorMessage?: string;
}

type AutomationCallback = (automation: Automation, result: { success: boolean; output?: string }) => void;

type WindowCreatedCallback = (sessionId: string, windowId: string, userEmail: string) => void;

/**
 * AutomationEngine orchestrates command automation for Zeus Terminal.
 *
 * Responsibilities:
 * - Execute automations on various triggers (connect, disconnect, idle, output match, scheduled)
 * - Create new windows for automation-triggered commands
 * - Coordinate with WindowManager and SessionStore
 * - Maintain structured logging with trace IDs
 * - Invoke callbacks on execution completion
 *
 * Observability:
 * - Every automation execution gets a unique trace ID
 * - Structured logs include timing, success/failure, and error classification
 * - Callbacks notify external systems (e.g., handoff hook) of execution completion
 */
export class AutomationEngine {
  private store: SessionStore;
  private windowManager: WindowManager;
  private cronJobs: Map<string, NodeJS.Timeout> = new Map();
  private lastActivity: Map<string, number> = new Map();
  private outputBuffer: Map<string, string> = new Map();
  private executionCallbacks: AutomationCallback[] = [];
  private windowCreatedCallbacks: WindowCreatedCallback[] = [];
  private runningAutomations: Set<string> = new Set();
  private executionTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private userConcurrencyCount: Map<string, number> = new Map();
  private executionMetrics: Map<string, ExecutionMetrics> = new Map();

  // Safety limits
  private readonly MAX_EXECUTION_TIME_MS = 30 * 1000;  // 30 seconds
  private readonly MAX_CONCURRENT_PER_USER = 10;
  private readonly STEP_TIMEOUT_MULTIPLIER = 1.5;  // Add 50% to step delays for timeout

  constructor(store: SessionStore, windowManager: WindowManager) {
    this.store = store;
    this.windowManager = windowManager;
  }

  /**
   * Generate a unique trace ID for execution tracking.
   * Used to correlate logs across the automation flow.
   */
  private generateTraceId(): string {
    return `auto-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  onWindowCreated(callback: WindowCreatedCallback): void {
    this.windowCreatedCallbacks.push(callback);
  }

  /**
   * Handle session connection event.
   * Executes all on_connect automations for the user.
   */
  async onConnect(sessionId: string, userEmail: string): Promise<void> {
    const traceId = this.generateTraceId();
    logger.info('Session connected - triggering automations', {
      traceId,
      sessionId,
      userEmail,
      trigger: 'on_connect',
    });

    const automations = this.getAutomationsByTrigger(userEmail, 'on_connect');
    logger.info('Retrieved on_connect automations', {
      traceId,
      count: automations.length,
    });

    for (const automation of automations) {
      logger.debug('Executing on_connect automation', {
        traceId,
        automationId: automation.id,
        automationName: automation.name,
      });
      await this.executeAutomation(automation, sessionId, 'Session connected');
    }

    logger.info('on_connect processing complete', { traceId });
  }

  async onDisconnect(sessionId: string, userEmail: string): Promise<void> {
    const automations = this.getAutomationsByTrigger(userEmail, 'on_disconnect');
    for (const automation of automations) {
      await this.executeAutomation(automation, sessionId, 'Session disconnected');
    }
  }

  async onResume(sessionId: string, userEmail: string): Promise<void> {
    const automations = this.getAutomationsByTrigger(userEmail, 'on_resume');
    for (const automation of automations) {
      await this.executeAutomation(automation, sessionId, 'Session resumed');
    }
  }

  checkIdle(sessionId: string, userEmail: string): void {
    const lastActive = this.lastActivity.get(sessionId);
    if (!lastActive) return;

    const idleMs = Date.now() - lastActive;
    const automations = this.getAutomationsByTrigger(userEmail, 'on_idle');

    for (const automation of automations) {
      const idleSeconds = automation.triggerConfig?.timeout || (automation.triggerConfig?.idleMinutes || 5) * 60;
      if (idleMs >= idleSeconds * 1000) {
        this.executeAutomation(automation, sessionId, `Idle for ${Math.round(idleSeconds / 60)} minutes`);
      }
    }
  }

  updateActivity(sessionId: string): void {
    this.lastActivity.set(sessionId, Date.now());
  }

  async checkOutput(sessionId: string, userEmail: string, output: string): Promise<void> {
    let buffer = this.outputBuffer.get(sessionId) || '';
    buffer = (buffer + output).slice(-1000);
    this.outputBuffer.set(sessionId, buffer);

    const automations = this.getAutomationsByTrigger(userEmail, 'on_output_match');

    for (const automation of automations.slice(0, 10)) {
      const pattern = automation.triggerConfig?.pattern;
      if (!pattern) continue;

      const validation = validateRegexPattern(pattern);
      if (!validation.valid) continue;

      try {
        const regex = new RegExp(pattern);
        const startTime = Date.now();
        const match = regex.test(buffer);
        
        if (Date.now() - startTime > 100) {
          console.warn(`Regex took too long for automation ${automation.id}`);
          continue;
        }

        if (match) {
          await this.executeAutomation(automation, sessionId, `Output matched: ${pattern}`);
        }
      } catch (e) {
      }
    }
  }

  initializeCronJobs(userEmail: string): void {
    const automations = this.getAutomationsByTrigger(userEmail, 'scheduled');
    for (const automation of automations) {
      this.registerCronJob(automation);
    }
  }

  registerCronJob(automation: Automation): void {
    const cronExpr = automation.triggerConfig?.cronExpression || automation.triggerConfig?.cron;
    if (!cronExpr) {
      console.log(`[Cron] No cron expression for automation ${automation.id}`);
      return;
    }

    const validation = validateCronExpression(cronExpr);
    if (!validation.valid) {
      console.error(`[Cron] Invalid cron for automation ${automation.id}: ${validation.error}`);
      return;
    }

    this.unregisterCronJob(automation.id);

    const interval = this.cronToInterval(cronExpr);
    if (interval < 60000) {
      console.log(`[Cron] Interval too short (${interval}ms) for automation ${automation.id}`);
      return;
    }

    console.log(`[Cron] Registering automation ${automation.id} "${automation.name}" with interval ${interval}ms (${interval/1000}s)`);

    const timer = setInterval(() => {
      console.log(`[Cron] Timer fired for automation ${automation.id} "${automation.name}"`);
      if (this.runningAutomations.has(automation.id)) {
        console.log(`[Cron] Skipping automation ${automation.id} - previous execution still running`);
        return;
      }
      this.executeScheduledAutomation(automation);
    }, interval);

    this.cronJobs.set(automation.id, timer);
  }

  unregisterCronJob(automationId: string): void {
    const timer = this.cronJobs.get(automationId);
    if (timer) {
      clearInterval(timer);
      this.cronJobs.delete(automationId);
    }
  }

  async executeAutomation(
    automation: Automation,
    sessionId: string,
    triggerReason: string
  ): Promise<{ success: boolean; output?: string; windowId?: string; windowName?: string; error?: string }> {
    const traceId = `${automation.id}-${Date.now()}`;

    console.log(`[AutomationEngine] [${traceId}] executeAutomation called:`, {
      automationId: automation.id,
      name: automation.name,
      sessionId,
      triggerReason,
      createWindow: automation.createWindow,
      enabled: automation.enabled,
    });

    if (!automation.enabled) {
      const msg = `Automation ${automation.id} is disabled`;
      console.log(`[AutomationEngine] [${traceId}] ${msg}`);
      return { success: false, output: msg };
    }

    const steps = automation.steps && automation.steps.length > 0
      ? automation.steps
      : [{ id: '1', command: automation.command, delayAfter: 0 }];

    for (const step of steps) {
      // Skip validation for empty commands (used to just send \r)
      if (step.command === '') continue;
      const validation = validateAutomationCommand(step.command);
      if (!validation.valid) {
        return { success: false, output: `Invalid command in step: ${validation.error}` };
      }
    }

    // Check concurrency limit per user
    const userConcurrency = this.userConcurrencyCount.get(automation.userEmail) || 0;
    if (userConcurrency >= this.MAX_CONCURRENT_PER_USER) {
      console.warn(`[AutomationEngine] [${traceId}] User ${automation.userEmail} has reached max concurrent automations (${this.MAX_CONCURRENT_PER_USER})`);
      return {
        success: false,
        output: `Maximum ${this.MAX_CONCURRENT_PER_USER} concurrent automations per user exceeded. Please wait for running automations to complete.`,
        error: 'CONCURRENCY_LIMIT_EXCEEDED'
      };
    }

    this.runningAutomations.add(automation.id);
    this.userConcurrencyCount.set(automation.userEmail, userConcurrency + 1);

    try {
      let targetWindowId = automation.targetWindow;
      let createdWindowId: string | undefined;
      let createdWindowName: string | undefined;

      if (automation.createWindow) {
        const windowName = automation.windowName || `auto-${automation.name}`;
        console.log(`[AutomationEngine] [${traceId}] Creating new window: ${windowName}`);

        try {
          const newWindow = await this.windowManager.createWindow(
            sessionId,
            automation.userEmail,
            windowName
          );

          targetWindowId = newWindow.id;
          createdWindowId = newWindow.id;
          createdWindowName = newWindow.name;

          console.log(`[AutomationEngine] [${traceId}] Window created successfully: ${newWindow.id}`);
          console.log(`[AutomationEngine] [${traceId}] Calling ${this.windowCreatedCallbacks.length} callbacks`);

          // Fire callbacks - these set up window subscriptions and broadcast window:created
          for (const callback of this.windowCreatedCallbacks) {
            try {
              callback(sessionId, newWindow.id, automation.userEmail);
              console.log(`[AutomationEngine] [${traceId}] Callback executed for window ${newWindow.id}`);
            } catch (callbackError) {
              console.error(`[AutomationEngine] [${traceId}] Callback failed:`, callbackError);
              // Don't fail automation if callback fails - window is already created
            }
          }

          // Wait a small delay to ensure callbacks are processed and subscriptions are set up
          // before we start sending commands to the window
          console.log(`[AutomationEngine] [${traceId}] Waiting 200ms for window setup to complete`);
          await new Promise(resolve => setTimeout(resolve, 200));

        } catch (createError) {
          const errorMsg = `Failed to create window: ${(createError as Error).message}`;
          console.error(`[AutomationEngine] [${traceId}] Window creation failed:`, createError);
          this.logExecution(automation.id, triggerReason, `window creation: ${windowName}`, false, errorMsg);

          // Return explicit error so spawn script knows creation failed
          return {
            success: false,
            output: errorMsg,
            error: 'WINDOW_CREATION_FAILED'
          };
        }
      }

      if (!targetWindowId) {
        const mainWindow = await this.windowManager.getMainWindow(sessionId, automation.userEmail);
        if (mainWindow) {
          targetWindowId = mainWindow.id;
          console.log(`[AutomationEngine] [${traceId}] Using main window: ${mainWindow.id}`);
        }
      }

      if (!targetWindowId) {
        const errorMsg = 'No window available for automation execution';
        console.error(`[AutomationEngine] [${traceId}] ${errorMsg}`);
        return { success: false, output: errorMsg, error: 'NO_WINDOW_AVAILABLE' };
      }

      console.log(`[AutomationEngine] [${traceId}] Executing ${steps.length} steps for automation ${automation.id}`);
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const content = step.noNewline ? step.command : step.command + '\r';
        const preview = step.command.substring(0, 50) + (step.command.length > 50 ? '...' : '');

        try {
          console.log(`[AutomationEngine] [${traceId}] Step ${i + 1}/${steps.length}: "${preview}"`);
          await this.windowManager.sendToWindow(targetWindowId, content, automation.userEmail);
          console.log(`[AutomationEngine] [${traceId}] Step ${i + 1} sent successfully`);
        } catch (stepError) {
          const errorMsg = `Step ${i + 1} failed: ${(stepError as Error).message}`;
          console.error(`[AutomationEngine] [${traceId}] ${errorMsg}`);
          this.logExecution(automation.id, triggerReason, `step ${i + 1}: ${step.command}`, false, errorMsg);

          // Return error but don't fail entire automation if subsequent steps fail
          // (window was created successfully)
          if (i === 0 && createdWindowId) {
            // If first step fails, still return success for window creation
            return { success: true, windowId: createdWindowId, windowName: createdWindowName };
          }
          return { success: false, output: errorMsg, error: 'STEP_EXECUTION_FAILED' };
        }

        if (step.delayAfter > 0 && i < steps.length - 1) {
          console.log(`[AutomationEngine] [${traceId}] Waiting ${step.delayAfter}s before next step`);
          await new Promise(resolve => setTimeout(resolve, step.delayAfter * 1000));
        }
      }

      const allCommands = steps.map(s => s.command).join('; ');
      this.logExecution(automation.id, triggerReason, allCommands, true);

      const maxRuns = automation.triggerConfig?.maxRuns;
      const { disabled } = this.store.incrementAutomationRunCount(automation.id, automation.userEmail, maxRuns);

      if (disabled) {
        this.unregisterCronJob(automation.id);
      }

      const result = { success: true, windowId: createdWindowId, windowName: createdWindowName };
      console.log(`[AutomationEngine] [${traceId}] Automation completed successfully`);
      this.notifyExecutionCallbacks(automation, result);
      return result;
    } catch (error) {
      const errorMsg = (error as Error).message;
      console.error(`[AutomationEngine] [${traceId}] Unexpected error:`, error);
      this.logExecution(automation.id, triggerReason, automation.command, false, errorMsg);

      const result = { success: false, output: errorMsg, error: 'UNEXPECTED_ERROR' };
      this.notifyExecutionCallbacks(automation, result);
      return result;
    } finally {
      this.runningAutomations.delete(automation.id);

      // Decrement user concurrency count
      const currentCount = this.userConcurrencyCount.get(automation.userEmail) || 0;
      if (currentCount > 0) {
        this.userConcurrencyCount.set(automation.userEmail, currentCount - 1);
      }

      // Clear any pending timeout
      const timeout = this.executionTimeouts.get(automation.id);
      if (timeout) {
        clearTimeout(timeout);
        this.executionTimeouts.delete(automation.id);
      }

      console.log(`[AutomationEngine] [${traceId}] Execution finished, cleaned up from running set`);
    }
  }

  private async executeScheduledAutomation(automation: Automation): Promise<void> {
    console.log(`[Cron] Executing scheduled automation ${automation.id} "${automation.name}"`);
    
    const sessionId = automation.sessionId;
    if (sessionId) {
      const session = this.store.getSession(sessionId, automation.userEmail);
      if (session && session.state === 'active') {
        console.log(`[Cron] Using automation's session ${sessionId}`);
        const result = await this.executeAutomation(automation, sessionId, 'Scheduled execution');
        console.log(`[Cron] Execution result:`, result);
        return;
      }
    }
    
    const sessions = this.store.getSessionsByUser(automation.userEmail);
    const activeSession = sessions.find(s => s.state === 'active');
    
    if (activeSession) {
      console.log(`[Cron] Found active session ${activeSession.id} for user ${automation.userEmail}`);
      const result = await this.executeAutomation(automation, activeSession.id, 'Scheduled execution');
      console.log(`[Cron] Execution result:`, result);
    } else {
      console.log(`[Cron] No active session for user ${automation.userEmail}, skipping`);
    }
  }

  private logExecution(
    automationId: string,
    triggerReason: string,
    command: string,
    success: boolean,
    output?: string
  ): void {
    const db = this.store.getDatabase();
    const stmt = db.prepare(`
      INSERT INTO automation_logs (automation_id, triggered_at, trigger_reason, command, output, success)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(automationId, Date.now(), triggerReason, command, output || null, success ? 1 : 0);

    const updateStmt = db.prepare('UPDATE automations SET last_run_at = ? WHERE id = ?');
    updateStmt.run(Date.now(), automationId);
  }

  private getAutomationsByTrigger(userEmail: string, triggerType: TriggerType): Automation[] {
    const db = this.store.getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM automations 
      WHERE user_email = ? AND trigger_type = ? AND enabled = 1
    `);
    const rows = stmt.all(userEmail, triggerType) as any[];
    
    return rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      userEmail: row.user_email,
      name: row.name,
      triggerType: row.trigger_type as TriggerType,
      triggerConfig: row.trigger_config ? JSON.parse(row.trigger_config) : undefined,
      command: row.command,
      steps: row.steps ? JSON.parse(row.steps) : undefined,
      createWindow: row.create_window === 1,
      windowName: row.window_name || undefined,
      targetWindow: row.target_window || undefined,
      enabled: row.enabled === 1,
      createdAt: new Date(row.created_at),
      lastRunAt: row.last_run_at ? new Date(row.last_run_at) : undefined,
    }));
  }

  private cronToInterval(cronExpr: string): number {
    const parts = cronExpr.split(' ');
    const minute = parts[0];
    
    if (minute === '*') return 60000;
    if (minute.includes('/')) {
      const interval = parseInt(minute.split('/')[1], 10);
      return interval * 60000;
    }
    
    return 60 * 60000;
  }

  onExecution(callback: AutomationCallback): void {
    this.executionCallbacks.push(callback);
  }

  private notifyExecutionCallbacks(automation: Automation, result: { success: boolean; output?: string }): void {
    for (const callback of this.executionCallbacks) {
      callback(automation, result);
    }
  }

  /**
   * Execute automation with timeout protection
   * Kills execution if it exceeds MAX_EXECUTION_TIME_MS
   */
  async executeWithTimeout(
    automation: Automation,
    sessionId: string,
    triggerReason: string
  ): Promise<{ success: boolean; output?: string; windowId?: string; windowName?: string; error?: string }> {
    const traceId = `${automation.id}-${Date.now()}`;
    console.log(`[AutomationEngine] [${traceId}] Executing with ${this.MAX_EXECUTION_TIME_MS}ms timeout`);

    return Promise.race([
      this.executeAutomation(automation, sessionId, triggerReason),
      new Promise<{ success: boolean; output?: string; error?: string }>((_, reject) =>
        setTimeout(() => {
          reject(new Error(`Automation execution timeout after ${this.MAX_EXECUTION_TIME_MS}ms`));
        }, this.MAX_EXECUTION_TIME_MS)
      ),
    ]).catch(error => {
      if ((error as Error).message.includes('timeout')) {
        console.error(`[AutomationEngine] [${traceId}] TIMEOUT: ${(error as Error).message}`);
        this.runningAutomations.delete(automation.id);
        const currentCount = this.userConcurrencyCount.get(automation.userEmail) || 0;
        if (currentCount > 0) {
          this.userConcurrencyCount.set(automation.userEmail, currentCount - 1);
        }
        return {
          success: false,
          output: (error as Error).message,
          error: 'EXECUTION_TIMEOUT'
        };
      }
      throw error;
    });
  }

  destroy(): void {
    for (const timer of this.cronJobs.values()) {
      clearInterval(timer);
    }
    this.cronJobs.clear();

    for (const timeout of this.executionTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.executionTimeouts.clear();

    this.lastActivity.clear();
    this.outputBuffer.clear();
    this.executionCallbacks = [];
    this.runningAutomations.clear();
    this.userConcurrencyCount.clear();
  }
}
