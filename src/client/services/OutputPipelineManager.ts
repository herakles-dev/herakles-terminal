export interface OutputPipelineConfig {
  flushIntervalMs?: number;
}

// Maximum buffer size before truncation (512KB)
// Prevents unbounded memory growth during recovery or when RAF is blocked
const MAX_BUFFER_SIZE = 512 * 1024;

interface WindowOutputState {
  buffer: string;
  flushTimer: number | null;
  resizePending: boolean;
  pendingResizeBuffer: string;
  restoreInProgress: boolean;
  recoveryInProgress: boolean;
}

export type FlushCallback = (windowId: string, data: string) => void;

export class OutputPipelineManager {
  private windows: Map<string, WindowOutputState> = new Map();
  private onFlush: FlushCallback;

  constructor(onFlush: FlushCallback) {
    this.onFlush = onFlush;
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
      };
      this.windows.set(windowId, state);
    }
    return state;
  }

  private scheduleFlush(windowId: string): void {
    const state = this.windows.get(windowId);
    if (!state) return;

    // Coalesced scheduling: don't cancel existing RAF
    // Multiple enqueue() calls will batch into a single flush
    // This prevents frame drops during high-volume output (builds, logs)
    if (state.flushTimer !== null) {
      return; // Already scheduled - buffer will be flushed
    }

    state.flushTimer = requestAnimationFrame(() => {
      const currentState = this.windows.get(windowId);
      if (!currentState || !currentState.buffer) return;

      const data = currentState.buffer;
      currentState.buffer = '';
      currentState.flushTimer = null;

      this.onFlush(windowId, data);
    });
  }

  enqueue(windowId: string, data: string): void {
    const state = this.getOrCreateState(windowId);

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

    this.scheduleFlush(windowId);
  }

  flush(windowId: string): string {
    const state = this.windows.get(windowId);
    if (!state) return '';

    if (state.flushTimer !== null) {
      cancelAnimationFrame(state.flushTimer);
      state.flushTimer = null;
    }

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
      if (state.flushTimer !== null) {
        cancelAnimationFrame(state.flushTimer);
        state.flushTimer = null;
      }
      state.buffer = '';
      state.pendingResizeBuffer = '';
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
      if (state.flushTimer !== null) {
        cancelAnimationFrame(state.flushTimer);
        state.flushTimer = null;
      }
      state.buffer = '';
      state.pendingResizeBuffer = '';

      // FIX RS-3: Also clear resize pending flag
      // This prevents output from being buffered in resize buffer during recovery
      state.resizePending = false;

      console.info(`[OutputPipeline] ${windowId}: Entering recovery mode, buffers cleared, resize flag reset`);
    } else {
      console.info(`[OutputPipeline] ${windowId}: Exiting recovery mode`);
    }

    state.recoveryInProgress = inProgress;
  }

  isRecoveryInProgress(windowId: string): boolean {
    const state = this.windows.get(windowId);
    return state?.recoveryInProgress ?? false;
  }

  clear(windowId: string): void {
    const state = this.windows.get(windowId);
    if (state && state.flushTimer !== null) {
      cancelAnimationFrame(state.flushTimer);
    }
    this.windows.delete(windowId);
  }

  clearAll(): void {
    this.windows.forEach((state) => {
      if (state.flushTimer !== null) {
        cancelAnimationFrame(state.flushTimer);
      }
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
