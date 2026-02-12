/**
 * AutomationEngine - Refactored for improved logging, error handling, and observability
 *
 * Key improvements:
 * - Structured logging with trace IDs on every execution
 * - User-friendly error messages with recovery actions
 * - Execution metrics tracking (timing, success/failure, error classification)
 * - Callback invocation with comprehensive result details
 * - JSDoc documentation for all public methods
 * - Error classification for better observability
 *
 * This is a reference implementation showing refactored patterns.
 * Integration: Copy improvements into existing AutomationEngine.ts
 */

import { SessionStore } from '../session/SessionStore.js';
import { WindowManager } from '../window/WindowManager.js';
import { createChildLogger } from '../utils/logger.js';
import {
  validateAutomationCommand,
  validateCronExpression,
  validateRegexPattern,
} from '../utils/validation.js';

const logger = createChildLogger('automation');

/**
 * Error classification for structured error handling and metrics.
 */
export enum ExecutionErrorType {
  DISABLED = 'DISABLED',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  WINDOW_NOT_FOUND = 'WINDOW_NOT_FOUND',
  WINDOW_CREATE_FAILED = 'WINDOW_CREATE_FAILED',
  COMMAND_EXECUTION_FAILED = 'COMMAND_EXECUTION_FAILED',
  TIMEOUT = 'TIMEOUT',
  CONCURRENCY_LIMIT = 'CONCURRENCY_LIMIT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/**
 * Execution result with error details.
 */
export interface ExecutionResult {
  success: boolean;
  windowId?: string;
  windowName?: string;
  output?: string;
  error?: {
    type: ExecutionErrorType;
    message: string;
    recovery: string; // User-friendly recovery instructions
  };
}

/**
 * Execution metrics for observability.
 */
export interface ExecutionMetrics {
  traceId: string;
  automationId: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  success: boolean;
  errorType?: ExecutionErrorType;
  errorMessage?: string;
  windowCreated: boolean;
  stepCount: number;
  completedSteps?: number;
}

/**
 * Callback signature for execution completion.
 * Called after automation execution (success or failure).
 */
type ExecutionCallback = (
  automation: any,
  result: ExecutionResult,
  metrics: ExecutionMetrics
) => void;

/**
 * Refactored excerpt showing key improvements to AutomationEngine.
 */
export class AutomationEngineRefactored {
  private executionCallbacks: ExecutionCallback[] = [];
  private executionMetrics: Map<string, ExecutionMetrics> = new Map();

  /**
   * Register callback to be invoked on automation execution completion.
   *
   * Usage:
   * ```typescript
   * engine.onExecution((automation, result, metrics) => {
   *   console.log(`Automation ${automation.id} completed in ${metrics.durationMs}ms`);
   *   if (!result.success) {
   *     console.error(`Error: ${result.error.message}`);
   *     console.info(`Recovery: ${result.error.recovery}`);
   *   }
   * });
   * ```
   *
   * @param callback - Function called with (automation, result, metrics)
   */
  onExecution(callback: ExecutionCallback): void {
    this.executionCallbacks.push(callback);
    logger.info('Execution callback registered', {
      totalCallbacks: this.executionCallbacks.length,
    });
  }

  /**
   * Generate unique trace ID for execution tracking.
   * Used to correlate logs across the automation flow.
   *
   * Format: auto-{timestamp}-{random}
   * Example: auto-1704067200000-abc123def
   */
  private generateTraceId(): string {
    return `auto-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Record execution metrics for observability.
   * Metrics are retained for analytics and debugging.
   */
  private recordMetrics(metrics: ExecutionMetrics): void {
    this.executionMetrics.set(metrics.traceId, metrics);

    logger.info('Execution metrics recorded', {
      traceId: metrics.traceId,
      automationId: metrics.automationId,
      durationMs: metrics.durationMs,
      success: metrics.success,
      errorType: metrics.errorType,
    });

    // Clean up old metrics (keep last 1000)
    if (this.executionMetrics.size > 1000) {
      const keys = Array.from(this.executionMetrics.keys());
      keys.slice(0, keys.length - 1000).forEach(k => {
        this.executionMetrics.delete(k);
      });
    }
  }

  /**
   * Invoke execution callbacks with comprehensive result details.
   * Separated into dedicated method for better testability and maintainability.
   *
   * Benefits:
   * - Each callback is invoked separately, preventing one error from blocking others
   * - Comprehensive logging of callback invocations
   * - Metrics passed to callbacks for monitoring integration
   */
  private notifyExecutionCallbacks(
    automation: any,
    result: ExecutionResult,
    metrics: ExecutionMetrics
  ): void {
    logger.info('Notifying execution callbacks', {
      traceId: metrics.traceId,
      callbackCount: this.executionCallbacks.length,
      success: result.success,
    });

    for (let i = 0; i < this.executionCallbacks.length; i++) {
      try {
        this.executionCallbacks[i](automation, result, metrics);
        logger.debug('Execution callback completed', {
          traceId: metrics.traceId,
          callbackIndex: i,
        });
      } catch (err) {
        // Prevent one callback from affecting others
        logger.error('Execution callback failed', {
          traceId: metrics.traceId,
          callbackIndex: i,
          error: (err as Error).message,
        });
      }
    }

    logger.info('All execution callbacks completed', {
      traceId: metrics.traceId,
    });
  }

  /**
   * Create user-friendly error response with recovery instructions.
   *
   * Example responses:
   * ```
   * {
   *   type: 'WINDOW_NOT_FOUND',
   *   message: 'No window available to run commands in',
   *   recovery: 'Open Zeus Terminal and create a new window before running automations'
   * }
   * ```
   */
  private createErrorResponse(
    errorType: ExecutionErrorType,
    detailMessage: string
  ): ExecutionResult {
    const errorMap: Record<ExecutionErrorType, { message: string; recovery: string }> = {
      [ExecutionErrorType.DISABLED]: {
        message: 'This automation is disabled',
        recovery: 'Enable the automation in the automation settings',
      },
      [ExecutionErrorType.VALIDATION_ERROR]: {
        message: `Command validation failed: ${detailMessage}`,
        recovery: 'Check the automation command syntax and try again',
      },
      [ExecutionErrorType.SESSION_NOT_FOUND]: {
        message: 'Session not found or inactive',
        recovery: 'Create a new session in Zeus Terminal (npm run dev)',
      },
      [ExecutionErrorType.WINDOW_NOT_FOUND]: {
        message: 'No window available to run commands',
        recovery: 'Open Zeus Terminal and create a window, or enable "Create Window" in automation',
      },
      [ExecutionErrorType.WINDOW_CREATE_FAILED]: {
        message: `Failed to create window: ${detailMessage}`,
        recovery: 'Check Zeus Terminal health and available resources',
      },
      [ExecutionErrorType.COMMAND_EXECUTION_FAILED]: {
        message: `Command execution failed: ${detailMessage}`,
        recovery: 'Check the command is valid and the terminal is responsive',
      },
      [ExecutionErrorType.TIMEOUT]: {
        message: 'Automation execution timed out',
        recovery: 'Check command durations and step delays, reduce parallelism if needed',
      },
      [ExecutionErrorType.CONCURRENCY_LIMIT]: {
        message: 'Too many automations running concurrently',
        recovery: 'Wait for other automations to complete or reduce concurrent executions',
      },
      [ExecutionErrorType.INTERNAL_ERROR]: {
        message: `Internal error: ${detailMessage}`,
        recovery: 'Check server logs and contact support if issue persists',
      },
    };

    const errorInfo = errorMap[errorType];
    return {
      success: false,
      error: {
        type: errorType,
        message: errorInfo.message,
        recovery: errorInfo.recovery,
      },
    };
  }

  /**
   * Example refactored executeAutomation structure.
   * Shows improved logging, error handling, and callback invocation.
   *
   * Key improvements:
   * - Trace ID on every step
   * - Structured error responses with recovery actions
   * - Metrics tracking with timing
   * - Comprehensive callback invocation with error isolation
   * - Early validation before execution
   */
  async executeAutomationExample(
    automation: any,
    sessionId: string,
    triggerReason: string
  ): Promise<ExecutionResult> {
    const traceId = this.generateTraceId();
    const metrics: ExecutionMetrics = {
      traceId,
      automationId: automation.id,
      startTime: Date.now(),
      success: false,
      windowCreated: false,
      stepCount: automation.steps?.length || 1,
    };

    try {
      // Step 1: Validation
      logger.info('Executing automation', {
        traceId,
        automationId: automation.id,
        automationName: automation.name,
        triggerReason,
      });

      if (!automation.enabled) {
        const result = this.createErrorResponse(
          ExecutionErrorType.DISABLED,
          'Automation is disabled'
        );
        metrics.success = false;
        metrics.errorType = ExecutionErrorType.DISABLED;
        metrics.endTime = Date.now();
        metrics.durationMs = metrics.endTime - metrics.startTime;
        this.recordMetrics(metrics);

        return result;
      }

      // Step 2: Prepare steps
      const steps = automation.steps?.length > 0
        ? automation.steps
        : [{ id: '1', command: automation.command, delayAfter: 0 }];

      // Step 3: Validate all commands before execution
      for (const step of steps) {
        if (step.command === '') continue;
        const validation = validateAutomationCommand(step.command);
        if (!validation.valid) {
          const result = this.createErrorResponse(
            ExecutionErrorType.VALIDATION_ERROR,
            validation.error || 'Invalid command'
          );
          metrics.errorType = ExecutionErrorType.VALIDATION_ERROR;
          metrics.endTime = Date.now();
          metrics.durationMs = metrics.endTime - metrics.startTime;
          this.recordMetrics(metrics);
          logger.warn('Command validation failed', {
            traceId,
            automationId: automation.id,
            error: validation.error,
          });

          return result;
        }
      }

      // Step 4: Create window if needed
      let targetWindowId = automation.targetWindow;
      if (automation.createWindow) {
        logger.info('Creating window for automation', {
          traceId,
          windowName: automation.windowName,
        });
        try {
          const newWindow = await this.createWindowExample(sessionId, automation.userEmail);
          targetWindowId = newWindow.id;
          metrics.windowCreated = true;

          // Invoke window created callbacks
          // (would call real callbacks here)
          logger.info('Window created', {
            traceId,
            windowId: newWindow.id,
          });
        } catch (err) {
          const result = this.createErrorResponse(
            ExecutionErrorType.WINDOW_CREATE_FAILED,
            (err as Error).message
          );
          metrics.errorType = ExecutionErrorType.WINDOW_CREATE_FAILED;
          metrics.endTime = Date.now();
          metrics.durationMs = metrics.endTime - metrics.startTime;
          this.recordMetrics(metrics);
          logger.error('Window creation failed', {
            traceId,
            error: (err as Error).message,
          });

          return result;
        }
      }

      // Step 5: Validate window exists
      if (!targetWindowId) {
        const result = this.createErrorResponse(
          ExecutionErrorType.WINDOW_NOT_FOUND,
          'No target window available'
        );
        metrics.errorType = ExecutionErrorType.WINDOW_NOT_FOUND;
        metrics.endTime = Date.now();
        metrics.durationMs = metrics.endTime - metrics.startTime;
        this.recordMetrics(metrics);
        logger.warn('No window available', {
          traceId,
          automationId: automation.id,
        });

        return result;
      }

      // Step 6: Execute commands
      logger.info('Executing command steps', {
        traceId,
        stepCount: steps.length,
      });

      metrics.completedSteps = 0;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        logger.debug('Executing step', {
          traceId,
          stepNumber: i + 1,
          stepCommand: step.command.substring(0, 50),
        });

        // Would execute command here
        metrics.completedSteps = i + 1;

        if (step.delayAfter > 0 && i < steps.length - 1) {
          logger.debug('Waiting between steps', {
            traceId,
            delaySeconds: step.delayAfter,
          });
          await new Promise(resolve => setTimeout(resolve, step.delayAfter * 1000));
        }
      }

      // Step 7: Success
      metrics.success = true;
      metrics.endTime = Date.now();
      metrics.durationMs = metrics.endTime - metrics.startTime;
      this.recordMetrics(metrics);

      const result: ExecutionResult = {
        success: true,
        windowId: targetWindowId,
        windowName: automation.windowName,
      };

      logger.info('Automation execution successful', {
        traceId,
        durationMs: metrics.durationMs,
      });

      // Notify callbacks
      this.notifyExecutionCallbacks(automation, result, metrics);

      return result;
    } catch (err) {
      metrics.success = false;
      metrics.errorType = ExecutionErrorType.INTERNAL_ERROR;
      metrics.errorMessage = (err as Error).message;
      metrics.endTime = Date.now();
      metrics.durationMs = metrics.endTime - metrics.startTime;
      this.recordMetrics(metrics);

      const result = this.createErrorResponse(
        ExecutionErrorType.INTERNAL_ERROR,
        (err as Error).message
      );

      logger.error('Automation execution failed', {
        traceId,
        automationId: automation.id,
        error: (err as Error).message,
        durationMs: metrics.durationMs,
      });

      // Notify callbacks even on error
      this.notifyExecutionCallbacks(automation, result, metrics);

      return result;
    }
  }

  /**
   * Placeholder for window creation (would call WindowManager).
   */
  private async createWindowExample(_sessionId: string, _userEmail: string): Promise<any> {
    return { id: 'window-123', name: 'auto-window' };
  }
}

/**
 * Integration checklist for improving existing AutomationEngine.ts:
 *
 * 1. Add imports:
 *    - import { createChildLogger } from '../utils/logger.js';
 *    - const logger = createChildLogger('automation');
 *
 * 2. Add error types and result interfaces:
 *    - ExecutionErrorType enum
 *    - ExecutionResult interface
 *    - ExecutionMetrics interface
 *
 * 3. Update onExecution callback signature to include metrics:
 *    - type ExecutionCallback = (automation, result, metrics) => void
 *
 * 4. Add private methods:
 *    - generateTraceId()
 *    - recordMetrics(metrics)
 *    - notifyExecutionCallbacks(automation, result, metrics)
 *    - createErrorResponse(errorType, message)
 *
 * 5. Refactor executeAutomation:
 *    - Add trace ID generation at start
 *    - Create metrics object
 *    - Add structured logger.info/warn/error calls
 *    - Replace string error messages with ExecutionResult objects
 *    - Add metrics recording on all paths (success/error)
 *    - Update callback invocation to pass metrics
 *    - Wrap callbacks in try-catch for error isolation
 *
 * 6. Update other trigger methods:
 *    - onConnect: Add trace ID and structured logging
 *    - onDisconnect: Add trace ID and structured logging
 *    - onResume: Add trace ID and structured logging
 *    - etc.
 *
 * 7. Add metrics retrieval endpoint (new API):
 *    - GET /api/automations/{automationId}/metrics
 *    - Returns last N execution metrics
 *
 * 8. Add tests:
 *    - src/server/automation/__tests__/AutomationEngine.logging.test.ts
 *    - Verify trace IDs are generated and logged
 *    - Verify callbacks receive metrics
 *    - Verify error responses have recovery actions
 *    - Verify metrics are recorded for all paths
 */
