export interface OutputPipelineConfig {
  flushIntervalMs?: number;
}

interface WindowOutputState {
  buffer: string;
  flushTimer: number | null;
  resizePending: boolean;
  pendingResizeBuffer: string;
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
      };
      this.windows.set(windowId, state);
    }
    return state;
  }

  private scheduleFlush(windowId: string): void {
    const state = this.windows.get(windowId);
    if (!state) return;

    if (state.flushTimer !== null) {
      cancelAnimationFrame(state.flushTimer);
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

    if (state.resizePending) {
      state.pendingResizeBuffer += data;
      return;
    }

    state.buffer += data;
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
