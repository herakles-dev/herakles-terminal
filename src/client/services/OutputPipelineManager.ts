import type { WebGLHealthMonitor } from './WebGLHealthMonitor';

export interface OutputPipelineConfig {
  flushIntervalMs?: number;
  healthMonitor?: WebGLHealthMonitor;
}

// Maximum buffer size before truncation (512KB)
// Prevents unbounded memory growth during recovery or when RAF is blocked
const MAX_BUFFER_SIZE = 512 * 1024;
// Backpressure threshold (percentage of MAX_BUFFER_SIZE)
const BACKPRESSURE_HIGH_WATERMARK = 0.8; // 80% - request throttle

// Volume-based throttling constants (Phase 2: bytes/sec instead of flushes/sec)
// These thresholds correlate with GPU memory pressure better than frequency
const THROTTLE_WINDOW_MS = 1000;
const BYTES_PER_SEC_LIGHT = 50_000;    // 50KB/sec - normal Claude thinking
const BYTES_PER_SEC_HEAVY = 150_000;   // 150KB/sec - build output
const BYTES_PER_SEC_CRITICAL = 500_000; // 500KB/sec - catastrophic output
const LIGHT_THROTTLE_DELAY = 32;       // ~30fps
const HEAVY_THROTTLE_DELAY = 100;      // ~10fps
const CRITICAL_THROTTLE_DELAY = 200;   // ~5fps

interface WindowOutputState {
  buffer: string;
  flushTimer: number | null;
  resizePending: boolean;
  pendingResizeBuffer: string;
  restoreInProgress: boolean;
  recoveryInProgress: boolean;
  // Sequence tracking for replay after recovery/restore
  lastProcessedSeq: number;
  // Backpressure state
  backpressureActive: boolean;
  // Volume-based throttling state (Phase 2)
  windowStartTime: number;
  bytesInWindow: number;
  flushCountInWindow: number; // Keep for telemetry
  throttleMode: 'normal' | 'light' | 'heavy' | 'critical';
}

export type FlushCallback = (windowId: string, data: string) => void;
export type ReplayRequestCallback = (windowId: string, afterSeq: number) => void;
export type BackpressureCallback = (windowId: string, throttle: boolean) => void;

export class OutputPipelineManager {
  private windows: Map<string, WindowOutputState> = new Map();
  private onFlush: FlushCallback;
  private onReplayRequest?: ReplayRequestCallback;
  private onBackpressure?: BackpressureCallback;
  private healthMonitor?: WebGLHealthMonitor;
  private forcedThrottleMode?: 'light' | 'heavy' | 'critical';

  constructor(onFlush: FlushCallback, config?: OutputPipelineConfig) {
    this.onFlush = onFlush;
    this.healthMonitor = config?.healthMonitor;
  }

  /**
   * Set callback for requesting replay from server.
   * Called when exiting recovery/restore mode with a known last sequence.
   */
  setReplayRequestCallback(callback: ReplayRequestCallback): void {
    this.onReplayRequest = callback;
  }

  /**
   * Set callback for backpressure signaling.
   * Called with throttle=true when buffer reaches 80%, throttle=false when it drops below 50%.
   */
  setBackpressureCallback(callback: BackpressureCallback): void {
    this.onBackpressure = callback;
  }

  /**
   * Set forced throttle mode override based on health score.
   * When set, the effective throttle mode will be the most conservative
   * between the forced mode and the calculated mode.
   *
   * @param mode - Forced throttle mode, or undefined to clear override
   */
  setForcedThrottleMode(mode?: 'light' | 'heavy' | 'critical'): void {
    this.forcedThrottleMode = mode;
  }

  /**
   * Cancel a pending flush timer, handling both RAF and setTimeout
   * Since throttle level can change, we cancel both ways to be safe
   */
  private cancelFlushTimer(state: WindowOutputState): void {
    if (state.flushTimer !== null) {
      // Cancel both setTimeout and RAF - one will no-op
      clearTimeout(state.flushTimer);
      cancelAnimationFrame(state.flushTimer);
      state.flushTimer = null;
    }
  }

  private getOrCreateState(windowId: string): WindowOutputState {
    let state = this.windows.get(windowId);
    if (!state) {
      state = {
        buffer: '',
        flushTimer: null,
        resizePending: false,
        pendingResizeBuffer: '',
        restoreInProgress: false,
        recoveryInProgress: false,
        lastProcessedSeq: 0,
        backpressureActive: false,
        windowStartTime: performance.now(),
        bytesInWindow: 0,
        flushCountInWindow: 0,
        throttleMode: 'normal',
      };
      this.windows.set(windowId, state);
    }
    return state;
  }

  private scheduleFlush(windowId: string): void {
    const state = this.windows.get(windowId);
    if (!state) return;

    // Coalesced scheduling: don't cancel existing timer/RAF
    // Multiple enqueue() calls will batch into a single flush
    if (state.flushTimer !== null) {
      return; // Already scheduled - buffer will be flushed
    }

    // PHASE 2: Volume-based throttling (bytes/sec not flushes/sec)
    const now = performance.now();
    const windowElapsed = now - state.windowStartTime;

    // Calculate throttle mode based on current or expired window
    let shouldResetWindow = false;
    if (windowElapsed > THROTTLE_WINDOW_MS) {
      shouldResetWindow = true;
    }

    // Calculate bytes/sec for throttle mode decision
    const effectiveElapsed = Math.max(windowElapsed, 1); // Avoid division by zero
    const bytesPerSec = (state.bytesInWindow / effectiveElapsed) * 1000;

    // Update throttle mode based on byte rate
    const prevMode = state.throttleMode;
    if (bytesPerSec > BYTES_PER_SEC_CRITICAL) {
      state.throttleMode = 'critical';
    } else if (bytesPerSec > BYTES_PER_SEC_HEAVY) {
      state.throttleMode = 'heavy';
    } else if (bytesPerSec > BYTES_PER_SEC_LIGHT) {
      state.throttleMode = 'light';
    } else {
      state.throttleMode = 'normal';
    }

    if (state.throttleMode !== prevMode && state.throttleMode !== 'normal') {
      console.debug(
        `[OutputPipeline] ${windowId}: Throttle ${prevMode} → ${state.throttleMode} ` +
        `(${(bytesPerSec / 1024).toFixed(1)} KB/s, ${state.flushCountInWindow} flushes/sec)`
      );
    }

    // Reset window if expired
    if (shouldResetWindow) {
      state.windowStartTime = now;
      state.bytesInWindow = 0;
      state.flushCountInWindow = 0;
    }

    state.flushCountInWindow++;

    // Determine effective throttle mode (most conservative of forced vs calculated)
    let effectiveMode = state.throttleMode;
    if (this.forcedThrottleMode) {
      const modes: Array<'normal' | 'light' | 'heavy' | 'critical'> = ['normal', 'light', 'heavy', 'critical'];
      const forcedIdx = modes.indexOf(this.forcedThrottleMode);
      const calculatedIdx = modes.indexOf(state.throttleMode);
      effectiveMode = modes[Math.max(forcedIdx, calculatedIdx)] as typeof effectiveMode;
    }

    // Apply delay based on effective throttle mode
    const delay =
      effectiveMode === 'critical' ? CRITICAL_THROTTLE_DELAY :
      effectiveMode === 'heavy' ? HEAVY_THROTTLE_DELAY :
      effectiveMode === 'light' ? LIGHT_THROTTLE_DELAY : 0;

    if (delay > 0) {
      // Use setTimeout for throttled flush
      state.flushTimer = window.setTimeout(() => {
        this.performFlush(windowId);
      }, delay) as unknown as number;
    } else {
      // Use RAF for normal flush (maximum responsiveness)
      state.flushTimer = requestAnimationFrame(() => {
        this.performFlush(windowId);
      });
    }
  }

  private performFlush(windowId: string): void {
    const state = this.windows.get(windowId);
    if (!state) return;

    const data = state.buffer;
    const byteCount = data.length;
    state.buffer = '';
    state.flushTimer = null;

    if (data) {
      // Report to health monitor if available
      this.healthMonitor?.recordFlush(byteCount);

      this.onFlush(windowId, data);

      // Release backpressure after flush if buffer was fully drained
      // (buffer is now empty since we just cleared it)
      if (state.backpressureActive) {
        state.backpressureActive = false;
        this.onBackpressure?.(windowId, false);
      }
    }
  }

  enqueue(windowId: string, data: string, seq?: number): void {
    const state = this.getOrCreateState(windowId);

    // Track sequence number regardless of discard state
    if (seq !== undefined && seq > state.lastProcessedSeq) {
      state.lastProcessedSeq = seq;
    }

    // Discard data during restore - restore handler writes directly to terminal
    if (state.restoreInProgress) {
      return;
    }

    // Discard data during WebGL recovery - terminal was cleared and is reinitializing
    if (state.recoveryInProgress) {
      return;
    }

    if (state.resizePending) {
      state.pendingResizeBuffer += data;
      // Enforce buffer limit for pending resize buffer too
      if (state.pendingResizeBuffer.length > MAX_BUFFER_SIZE) {
        const excess = state.pendingResizeBuffer.length - MAX_BUFFER_SIZE;
        state.pendingResizeBuffer = state.pendingResizeBuffer.slice(excess);
        console.warn(`[OutputPipeline] ${windowId}: Pending resize buffer truncated, discarded ${excess} bytes`);
      }
      return;
    }

    state.buffer += data;

    // Enforce buffer size limit - keep newest data by trimming from the start
    if (state.buffer.length > MAX_BUFFER_SIZE) {
      const excess = state.buffer.length - MAX_BUFFER_SIZE;
      state.buffer = state.buffer.slice(excess);
      console.warn(`[OutputPipeline] ${windowId}: Buffer truncated, discarded ${excess} bytes`);
    }

    // Backpressure signaling
    const bufferRatio = state.buffer.length / MAX_BUFFER_SIZE;
    if (!state.backpressureActive && bufferRatio >= BACKPRESSURE_HIGH_WATERMARK) {
      state.backpressureActive = true;
      this.onBackpressure?.(windowId, true);
    }

    // Track bytes for throttle calculation (now tracks on enqueue, not just flush)
    state.bytesInWindow += data.length;

    this.scheduleFlush(windowId);
  }

  flush(windowId: string): string {
    const state = this.windows.get(windowId);
    if (!state) return '';

    this.cancelFlushTimer(state);

    const data = state.buffer;
    state.buffer = '';
    return data;
  }

  setResizePending(windowId: string, pending: boolean): void {
    const state = this.getOrCreateState(windowId);
    state.resizePending = pending;

    if (!pending && state.pendingResizeBuffer) {
      state.buffer += state.pendingResizeBuffer;
      state.pendingResizeBuffer = '';
      if (state.buffer) {
        this.scheduleFlush(windowId);
      }
    }
  }

  isResizePending(windowId: string): boolean {
    const state = this.windows.get(windowId);
    return state?.resizePending ?? false;
  }

  /**
   * Enter or exit restore mode for a window.
   * When entering restore mode:
   * - Clears ALL buffers (main buffer, pending resize buffer)
   * - Cancels any pending flush
   * - Blocks future enqueue() calls from buffering
   *
   * When exiting restore mode:
   * - Resumes normal operation
   */
  setRestoreInProgress(windowId: string, inProgress: boolean): void {
    const state = this.getOrCreateState(windowId);

    if (inProgress) {
      // Clear all buffers when entering restore mode
      this.cancelFlushTimer(state);
      state.buffer = '';
      state.pendingResizeBuffer = '';
    } else if (state.restoreInProgress && state.lastProcessedSeq > 0) {
      // Exiting restore mode - request replay of missed data
      this.requestReplay(windowId, state.lastProcessedSeq);
    }

    state.restoreInProgress = inProgress;
  }

  isRestoreInProgress(windowId: string): boolean {
    const state = this.windows.get(windowId);
    return state?.restoreInProgress ?? false;
  }

  /**
   * Enter or exit WebGL recovery mode for a window.
   * When entering recovery mode:
   * - Clears ALL buffers (main buffer, pending resize buffer)
   * - Cancels any pending flush
   * - Blocks future enqueue() calls from buffering
   *
   * This prevents stale data from being written after term.clear() during
   * WebGL context loss recovery.
   *
   * When exiting recovery mode:
   * - Resumes normal operation
   */
  setRecoveryInProgress(windowId: string, inProgress: boolean): void {
    const state = this.getOrCreateState(windowId);

    if (inProgress) {
      // Clear all buffers when entering recovery mode
      this.cancelFlushTimer(state);
      state.buffer = '';
      state.pendingResizeBuffer = '';

      // FIX RS-3: Also clear resize pending flag
      // This prevents output from being buffered in resize buffer during recovery
      state.resizePending = false;

      // Reset throttle state for clean recovery
      state.throttleMode = 'normal';
      state.bytesInWindow = 0;
      state.flushCountInWindow = 0;
      state.windowStartTime = performance.now();

      console.info(`[OutputPipeline] ${windowId}: Entering recovery mode, buffers cleared, resize flag reset`);
    } else {
      console.info(`[OutputPipeline] ${windowId}: Exiting recovery mode`);
      // Exiting recovery mode - request replay of missed data
      if (state.recoveryInProgress && state.lastProcessedSeq > 0) {
        this.requestReplay(windowId, state.lastProcessedSeq);
      }
    }

    state.recoveryInProgress = inProgress;
  }

  isRecoveryInProgress(windowId: string): boolean {
    const state = this.windows.get(windowId);
    return state?.recoveryInProgress ?? false;
  }

  /**
   * Get the last processed sequence number for a window.
   * Used by recovery handlers to know where to request replay from.
   */
  getLastProcessedSeq(windowId: string): number {
    const state = this.windows.get(windowId);
    return state?.lastProcessedSeq ?? 0;
  }

  /**
   * Request replay of missed data from the server.
   */
  private requestReplay(windowId: string, afterSeq: number): void {
    if (this.onReplayRequest && afterSeq > 0) {
      console.info(`[OutputPipeline] ${windowId}: Requesting replay after seq ${afterSeq}`);
      this.onReplayRequest(windowId, afterSeq);
    }
  }

  /**
   * Reset all state for a window. Called on WebSocket disconnect
   * to prevent stale flags from blocking output on reconnect.
   */
  resetState(windowId: string): void {
    const state = this.windows.get(windowId);
    if (!state) return;

    this.cancelFlushTimer(state);

    state.buffer = '';
    state.pendingResizeBuffer = '';
    state.resizePending = false;
    state.restoreInProgress = false;
    state.recoveryInProgress = false;
    state.throttleMode = 'normal';
    state.bytesInWindow = 0;
    state.flushCountInWindow = 0;
    state.windowStartTime = performance.now();
    // Preserve lastProcessedSeq for potential reconnect replay
  }

  clear(windowId: string): void {
    const state = this.windows.get(windowId);
    if (state) {
      this.cancelFlushTimer(state);
    }
    this.windows.delete(windowId);
  }

  clearAll(): void {
    this.windows.forEach((state) => {
      this.cancelFlushTimer(state);
    });
    this.windows.clear();
  }

  getStats(): { windowCount: number; totalBuffered: number } {
    let totalBuffered = 0;
    this.windows.forEach((state) => {
      totalBuffered += state.buffer.length + state.pendingResizeBuffer.length;
    });
    return {
      windowCount: this.windows.size,
      totalBuffered,
    };
  }
}
