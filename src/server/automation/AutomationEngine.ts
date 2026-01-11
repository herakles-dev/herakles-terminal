import { SessionStore } from '../session/SessionStore.js';
import { WindowManager } from '../window/WindowManager.js';
import {
  validateAutomationCommand,
  validateCronExpression,
  validateRegexPattern,
} from '../utils/validation.js';

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

type AutomationCallback = (automation: Automation, result: { success: boolean; output?: string }) => void;

type WindowCreatedCallback = (sessionId: string, windowId: string, userEmail: string) => void;

export class AutomationEngine {
  private store: SessionStore;
  private windowManager: WindowManager;
  private cronJobs: Map<string, NodeJS.Timeout> = new Map();
  private lastActivity: Map<string, number> = new Map();
  private outputBuffer: Map<string, string> = new Map();
  private executionCallbacks: AutomationCallback[] = [];
  private windowCreatedCallbacks: WindowCreatedCallback[] = [];
  private runningAutomations: Set<string> = new Set();

  constructor(store: SessionStore, windowManager: WindowManager) {
    this.store = store;
    this.windowManager = windowManager;
  }

  onWindowCreated(callback: WindowCreatedCallback): void {
    this.windowCreatedCallbacks.push(callback);
  }

  async onConnect(sessionId: string, userEmail: string): Promise<void> {
    console.log(`[Automation] onConnect triggered for session ${sessionId}, user ${userEmail}`);
    const automations = this.getAutomationsByTrigger(userEmail, 'on_connect');
    console.log(`[Automation] Found ${automations.length} on_connect automations`);
    for (const automation of automations) {
      console.log(`[Automation] Executing automation ${automation.id} "${automation.name}"`);
      const result = await this.executeAutomation(automation, sessionId, 'Session connected');
      console.log(`[Automation] Result:`, result);
    }
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
  ): Promise<{ success: boolean; output?: string; windowId?: string; windowName?: string }> {
    if (!automation.enabled) {
      return { success: false, output: 'Automation disabled' };
    }

    const steps = automation.steps && automation.steps.length > 0
      ? automation.steps
      : [{ id: '1', command: automation.command, delayAfter: 0 }];

    for (const step of steps) {
      const validation = validateAutomationCommand(step.command);
      if (!validation.valid) {
        return { success: false, output: `Invalid command in step: ${validation.error}` };
      }
    }

    this.runningAutomations.add(automation.id);

    try {
      let targetWindowId = automation.targetWindow;
      let createdWindowId: string | undefined;
      let createdWindowName: string | undefined;

      if (automation.createWindow) {
        const windowName = automation.windowName || `auto-${automation.name}`;
        const newWindow = await this.windowManager.createWindow(
          sessionId,
          automation.userEmail,
          windowName
        );
        targetWindowId = newWindow.id;
        createdWindowId = newWindow.id;
        createdWindowName = newWindow.name;
        
        for (const callback of this.windowCreatedCallbacks) {
          callback(sessionId, newWindow.id, automation.userEmail);
        }
      }

      if (!targetWindowId) {
        const mainWindow = await this.windowManager.getMainWindow(sessionId, automation.userEmail);
        if (mainWindow) {
          targetWindowId = mainWindow.id;
        }
      }

      if (!targetWindowId) {
        return { success: false, output: 'No window available' };
      }

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        await this.windowManager.sendToWindow(targetWindowId, step.command + '\r', automation.userEmail);

        if (step.delayAfter > 0 && i < steps.length - 1) {
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
      this.notifyExecutionCallbacks(automation, result);
      return result;
    } catch (error) {
      const errorMsg = (error as Error).message;
      this.logExecution(automation.id, triggerReason, automation.command, false, errorMsg);

      const result = { success: false, output: errorMsg };
      this.notifyExecutionCallbacks(automation, result);
      return result;
    } finally {
      this.runningAutomations.delete(automation.id);
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

  destroy(): void {
    for (const timer of this.cronJobs.values()) {
      clearInterval(timer);
    }
    this.cronJobs.clear();
    this.lastActivity.clear();
    this.outputBuffer.clear();
    this.executionCallbacks = [];
    this.runningAutomations.clear();
  }
}
