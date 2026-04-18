import type { WebGLHealthMonitor } from './WebGLHealthMonitor';
import { ANSI_STRIP_REGEX } from '@shared/terminalFilters';

/**
 * Client-side thinking line detector — filters dots but NOT braille spinners.
 * The shared isThinkingLine() filters braille too (^[\u2800-\u28FF]), which
 * kills Claude Code's Ink spinner animation. This version intentionally skips
 * braille so the DOM renderer can animate ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ via \r overwrites.
 */
function isDotArtifact(stripped: string): boolean {
  if (stripped.length === 0) return false;
  // Pure dots/whitespace/bullet chars — always artifacts
  if (/^[.\s\u00B7\u2022\u2026]+$/.test(stripped)) return true;
  // 20+ consecutive dots — tmux SIGWINCH resize noise
  if (/\.{20,}/.test(stripped)) return true;
  // Lines with paths/URLs/structured content — never filter
  if (/[/\\:[\]#@]/.test(stripped)) return false;
  // 80%+ dots — likely artifacts
  const dotCount = (stripped.match(/\./g) || []).length;
  const totalNonWhitespace = stripped.replace(/\s/g, '').length;
  if (totalNonWhitespace > 0 && dotCount / totalNonWhitespace >= 0.8 && dotCount >= 3) return true;
  return false;
}

/** Matches cursor positioning sequences (CSI H/f) used as line delimiters by Ink. */
const CURSOR_POSITION_REGEX = /^\x1b\[\d*(?:;\d*)?[Hf]$/;

export interface OutputPipelineConfig {
  flushIntervalMs?: number;
  healthMonitor?: WebGLHealthMonitor;
  isMobile?: boolean;
}

// Maximum buffer size before truncation (512KB)
// Prevents unbounded memory growth during recovery or when RAF is blocked
const MAX_BUFFER_SIZE = 512 * 1024;
// Backpressure threshold (percentage of MAX_BUFFER_SIZE)
const BACKPRESSURE_HIGH_WATERMARK = 0.8; // 80% - request throttle

// Volume-based throttling constants (Phase 2: bytes/sec instead of flushes/sec)
// Thresholds tuned to catch Claude Code Ink redraws at 10-40KB/s
const THROTTLE_WINDOW_MS = 1000;
const BYTES_PER_SEC_LIGHT = 20_000;    // 20KB/sec - Claude Code thinking/Ink redraws
const BYTES_PER_SEC_HEAVY = 80_000;    // 80KB/sec - build output
const BYTES_PER_SEC_CRITICAL = 250_000; // 250KB/sec - catastrophic output
const LIGHT_THROTTLE_DELAY = 24;       // ~42fps - gentler throttle
const HEAVY_THROTTLE_DELAY = 100;      // ~10fps
const CRITICAL_THROTTLE_DELAY = 200;   // ~5fps

// Post-resize suppression window: after resize-pending clears, apply aggressive
// dot filtering for this duration to catch late-arriving tmux SIGWINCH artifacts.
// 500ms covers Android keyboard close animation (300-500ms) + network latency.
const POST_RESIZE_SUPPRESSION_MS = 500;

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
  // Post-resize suppression: timestamp when resize-pending was last cleared
  postResizeSuppressUntil: number;
  // Ink redraw coalescing: detect erase+home sequences
  lastEraseHomeTime: number;
}

export type FlushCallback = (windowId: string, data: string) => void;
export type ReplayRequestCallback = (windowId: string, afterSeq: number) => void;
export type BackpressureCallback = (windowId: string, throttle: boolean) => void;

// Re-export shared filters (server-side still uses full filters via TmuxManager)
export { filterThinkingOutput, filterCarriageReturnThinking, filterAllThinkingOutput } from '@shared/terminalFilters';

/**
 * Client-side thinking filter that preserves braille spinner animation.
 * Use this instead of filterAllThinkingOutput() on paths that may contain
 * active Claude Code UI (restore, replay, pending restore).
 * Filters dot artifacts but keeps ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ spinners intact.
 *
 * Splits on newlines AND cursor positioning sequences — Ink renders multiline
 * output via cursor moves (e.g. \x1b[2;1H), not newlines. Without this split,
 * dot lines between cursor positions slip through as part of a larger chunk.
 */
export function filterOutputPreservingSpinners(data: string): string {
  if (!data) return data;

  // Stage 1: Filter \r-delimited dot sequences (preserves braille via isDotArtifact)
  let filtered = data;
  if (filtered.includes('\r')) {
    const lines = filtered.split(/(\r\n|\n)/);
    const crResult: string[] = [];
    for (const line of lines) {
      if (line === '\r\n' || line === '\n') { crResult.push(line); continue; }
      if (line === '\r') { crResult.push(line); continue; }
      const segments = line.split('\r');
      if (segments.length <= 1) { crResult.push(line); continue; }
      let kept: string | null = null;
      let needsCR = false;
      for (let i = segments.length - 1; i >= 0; i--) {
        const seg = segments[i];
        const stripped = seg.replace(ANSI_STRIP_REGEX, '').trim();
        if (stripped.length > 0 && isDotArtifact(stripped)) continue;
        if (seg.length === 0) continue;
        kept = seg;
        needsCR = i > 0;
        break;
      }
      if (kept !== null) {
        crResult.push(needsCR ? '\r' + kept : kept);
      }
    }
    filtered = crResult.join('');
  }

  // Stage 2: Split on newlines AND cursor positioning (Ink uses CSI H/f between rows)
  const parts = filtered.split(/(\r\n|\r|\n|\x1b\[\d*(?:;\d*)?[Hf])/);
  const result: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '\r\n' || part === '\r' || part === '\n') {
      result.push(part);
      continue;
    }
    if (CURSOR_POSITION_REGEX.test(part)) {
      result.push(part);
      continue;
    }
    const stripped = part.replace(ANSI_STRIP_REGEX, '').trim();
    if (stripped.length === 0) { result.push(part); continue; }
    if (isDotArtifact(stripped)) {
      // Preserve DEC 2026 sync brackets to prevent dangling sync state
      const hasSyncBegin = part.includes('\x1b[?2026h');
      const hasSyncEnd = part.includes('\x1b[?2026l');
      const syncPrefix = hasSyncBegin ? '\x1b[?2026h' : '';
      const syncSuffix = hasSyncEnd ? '\x1b[?2026l' : '';
      // Always erase the full line when filtering dots — prevents stale dot
      // content from remaining visible when Ink renders split across messages
      // or cursor-positioned updates skip explicit clears.
      result.push(syncPrefix + '\x1b[2K' + syncSuffix);
      continue;
    }
    result.push(part);
  }
  return result.join('');
}

export class OutputPipelineManager {
  private windows: Map<string, WindowOutputState> = new Map();
  private onFlush: FlushCallback;
  private onReplayRequest?: ReplayRequestCallback;
  private onBackpressure?: BackpressureCallback;
  private healthMonitor?: WebGLHealthMonitor;
  private forcedThrottleMode?: 'light' | 'heavy' | 'critical';
  // Threshold scale for volume-based throttling.
  // Was 0.5 for mobile (GPU protection for WebGL renderer) — DOM renderer v2 doesn't
  // need aggressive throttling since it uses row-level dirty tracking, not GPU compositing.
  private readonly thresholdScale: number;

  constructor(onFlush: FlushCallback, config?: OutputPipelineConfig) {
    this.onFlush = onFlush;
    this.healthMonitor = config?.healthMonitor;
    this.thresholdScale = 1.0;
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

  private cancelFlushTimer(state: WindowOutputState): void {
    if (state.flushTimer !== null) {
      clearTimeout(state.flushTimer);
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
        postResizeSuppressUntil: 0,
        lastEraseHomeTime: 0,
      };
      this.windows.set(windowId, state);
    }
    return state;
  }

  // R-3: currentMessageBytes is the byte count of the message being enqueued in this call.
  // When the throttle window expires and resets, these bytes are carried into the fresh
  // window so rate classification for the NEXT message is accurate.
  private scheduleFlush(windowId: string, currentMessageBytes: number = 0): void {
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

    // I-09 / Fb-2: Reset expired window BEFORE calculating rate.
    // Old ordering computed bytesPerSec from stale bytesInWindow accumulated over a
    // multi-second idle gap, producing an artificially inflated or deflated rate that
    // latched throttle mode incorrectly (e.g. 80 KB burst in 100 ms, then 1.5 s idle:
    // old code → 80000 / 1600 * 1000 = 50 KB/s → light mode on next tiny message).
    //
    // Note: enqueue() adds bytesInWindow += filtered.length BEFORE calling scheduleFlush,
    // so after a reset bytesInWindow contains only the current message's bytes. With
    // effectiveElapsed near 0, that would produce a falsely huge rate. We therefore
    // force normal mode on the first flush of every fresh window — the prior burst is
    // over and a single message cannot by itself represent a sustained rate.
    let windowJustReset = false;
    if (windowElapsed > THROTTLE_WINDOW_MS) {
      state.windowStartTime = now;
      // R-3: Carry the current message's bytes into the fresh window. enqueue() adds
      // bytesInWindow += filtered.length BEFORE calling scheduleFlush, so zeroing here
      // would lose those bytes — the next call's rate calc would start from 0. Instead,
      // seed the new window with just the current message's bytes so the second message
      // in the burst gets an accurate rate reading.
      state.bytesInWindow = currentMessageBytes;
      state.flushCountInWindow = 0;
      windowJustReset = true;
    }

    // Calculate bytes/sec for throttle mode decision.
    // Skip when window just reset: currentMessageBytes is the only sample, elapsed ≈ 0ms
    // → rate is meaningless. Default to normal to release the stale-mode latch.
    const effectiveElapsed = Math.max(windowElapsed, 1); // use pre-reset elapsed for non-reset path
    const bytesPerSec = windowJustReset ? 0 : (state.bytesInWindow / effectiveElapsed) * 1000;

    // Update throttle mode based on byte rate (scaled for mobile)
    const prevMode = state.throttleMode;
    if (bytesPerSec > BYTES_PER_SEC_CRITICAL * this.thresholdScale) {
      state.throttleMode = 'critical';
    } else if (bytesPerSec > BYTES_PER_SEC_HEAVY * this.thresholdScale) {
      state.throttleMode = 'heavy';
    } else if (bytesPerSec > BYTES_PER_SEC_LIGHT * this.thresholdScale) {
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

    // Always use setTimeout for flushing — never RAF.
    // RAF gets throttled by mobile browsers during low-interaction periods,
    // which blocks data from reaching the terminal (spinner freezes, output stalls).
    // setTimeout(0) is ~4ms (browser minimum) — faster than RAF's ~16ms vsync anyway.
    state.flushTimer = window.setTimeout(() => {
      this.performFlush(windowId);
    }, delay) as unknown as number;
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

  /** Delegates to the exported filterOutputPreservingSpinners — single implementation. */
  private filterThinkingOutput(data: string): string {
    return filterOutputPreservingSpinners(data);
  }

  /**
   * Detect Ink (React for CLI) full-screen redraws.
   * Requires \x1b[2J (erase entire display) — this distinguishes Ink from
   * standard TUI programs (vim, less, htop) that use cursor-hide + cursor-home
   * without full erase. Those programs must NOT trigger buffer replacement.
   */
  private detectInkRedraw(data: string): boolean {
    // Matches: erase-display (2J), erase-saved-lines (3J), enter-alt-buffer (?1049h), RIS (ESC c).
    // Intentionally EXCLUDES \x1b[?1049l (exit-alt-buffer) — coalescing on exit would
    // discard primary-buffer content buffered before the exit. See issues.md I-03 / MC-1.
    return /\x1b\[(?:2J|3J|\?1049h)|\x1bc/.test(data);
  }

  enqueue(windowId: string, data: string, seq?: number): void {
    const state = this.getOrCreateState(windowId);

    // Discard data during restore - restore handler writes directly to terminal
    if (state.restoreInProgress) {
      return;  // seq NOT advanced — replay after restore will re-fetch this message
    }

    // Discard data during WebGL recovery - terminal was cleared and is reinitializing
    if (state.recoveryInProgress) {
      return;  // seq NOT advanced — replay after recovery will re-fetch this message
    }

    // Track sequence number only for messages we actually process (I-05 / Fb-3 fix).
    // Previously this was above the guards, causing replay requests to skip the
    // last-discarded seq on restore/recovery exit.
    if (seq !== undefined && seq > state.lastProcessedSeq) {
      state.lastProcessedSeq = seq;
    }

    // Filter Claude thinking output from live data
    let filtered = this.filterThinkingOutput(data);

    // Post-resize suppression: aggressively re-filter during the suppression window
    // to catch late-arriving tmux SIGWINCH dot artifacts
    if (state.postResizeSuppressUntil > 0 && performance.now() < state.postResizeSuppressUntil) {
      filtered = this.filterThinkingOutput(filtered);
    }

    if (state.resizePending) {
      state.pendingResizeBuffer += filtered;
      // Enforce buffer limit for pending resize buffer too
      if (state.pendingResizeBuffer.length > MAX_BUFFER_SIZE) {
        const excess = state.pendingResizeBuffer.length - MAX_BUFFER_SIZE;
        state.pendingResizeBuffer = state.pendingResizeBuffer.slice(excess);
        console.warn(`[OutputPipeline] ${windowId}: Pending resize buffer truncated, discarded ${excess} bytes`);
      }
      return;
    }

    // Ink redraw coalescing: each Ink full-screen redraw (\x1b[2J) clears+redraws
    // everything. Only the latest frame matters — replace buffer to prevent stale
    // frames from coalescing and killing spinner animation.
    // Placed AFTER resizePending guard so we don't replace main buffer during resize.
    if (this.detectInkRedraw(filtered)) {
      state.buffer = filtered;
      state.lastEraseHomeTime = performance.now();
      state.bytesInWindow += filtered.length;
      this.scheduleFlush(windowId, filtered.length);
      return;
    }

    // Carriage return overwrite: \r (not \r\n) moves cursor to column 0 and
    // the following content overwrites the current line. If the buffer already
    // has content on its last line, that content is superseded — replace the
    // tail instead of appending to prevent stale spinner frames from accumulating.
    if (filtered.length > 0 && filtered[0] === '\r' && filtered[1] !== '\n' && state.buffer.length > 0) {
      const lastNL = state.buffer.lastIndexOf('\n');
      state.buffer = (lastNL >= 0 ? state.buffer.slice(0, lastNL + 1) : '') + filtered;
    } else {
      state.buffer += filtered;
    }

    // Enforce buffer size limit — keep newest data by trimming from the start.
    // Advance trim point past any split ANSI escape or UTF-16 surrogate pair.
    if (state.buffer.length > MAX_BUFFER_SIZE) {
      let trimAt = state.buffer.length - MAX_BUFFER_SIZE;
      // Skip past split surrogates (lone low surrogate at trim point)
      const ch = state.buffer.charCodeAt(trimAt);
      if (ch >= 0xDC00 && ch <= 0xDFFF) trimAt++;
      // Skip past mid-ANSI escape: if we're inside an escape, advance to next ESC or newline
      if (trimAt > 0 && state.buffer[trimAt - 1] === '\x1b') trimAt++;
      state.buffer = state.buffer.slice(trimAt);
    }

    // Backpressure signaling
    const bufferRatio = state.buffer.length / MAX_BUFFER_SIZE;
    if (!state.backpressureActive && bufferRatio >= BACKPRESSURE_HIGH_WATERMARK) {
      state.backpressureActive = true;
      this.onBackpressure?.(windowId, true);
    }

    // Track bytes for throttle calculation (use filtered length)
    state.bytesInWindow += filtered.length;

    this.scheduleFlush(windowId, filtered.length);
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
    // Idempotency: skip if already in the requested state.
    // Prevents duplicate acks from re-triggering buffer merge + suppression window.
    if (!pending && !state.resizePending) return;
    state.resizePending = pending;

    if (pending) {
      // Start suppression immediately when resize begins — catches dots that
      // arrive via fast network before the resize ack comes back.
      state.postResizeSuppressUntil = performance.now() + POST_RESIZE_SUPPRESSION_MS;
    }

    if (!pending) {
      // Extend suppression window when resize completes — covers late SIGWINCH artifacts
      state.postResizeSuppressUntil = performance.now() + POST_RESIZE_SUPPRESSION_MS;

      if (state.pendingResizeBuffer) {
        // FIX B (strengthened): Double-filter resize buffer before merging.
        // First pass catches complete thinking lines, second pass catches fragments
        // that only form dot patterns after reassembly from partial chunks.
        const firstPass = this.filterThinkingOutput(state.pendingResizeBuffer);
        state.buffer += this.filterThinkingOutput(firstPass);
        state.pendingResizeBuffer = '';
        if (state.buffer) {
          // Immediate flush after resize — bypass volume-based throttle to avoid
          // 100-200ms delay when terminal is in heavy/critical output mode.
          this.cancelFlushTimer(state);
          state.flushTimer = window.setTimeout(() => {
            this.performFlush(windowId);
          }, 0) as unknown as number;
        }
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
   * Advance lastProcessedSeq for a window after consuming out-of-band data
   * (e.g. window:replay-response). Monotonic — only advances forward; never
   * rewinds. Creates state if the window hasn't been seen yet (idempotent).
   *
   * Without this, replay-response data bypasses enqueue() so the seq tracker
   * stays stale. A subsequent restore/recovery would then request replay from
   * the same stale seq, and the server would either replay duplicates or
   * (after eviction) report a spurious gap.
   */
  advanceLastProcessedSeq(windowId: string, toSeq: number): void {
    if (toSeq <= 0) return;
    const state = this.getOrCreateState(windowId);
    if (toSeq > state.lastProcessedSeq) {
      state.lastProcessedSeq = toSeq;
    }
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
    state.postResizeSuppressUntil = 0;
    state.flushCountInWindow = 0;
    state.windowStartTime = performance.now();
    // Release backpressure — server may still be throttling sends to this client
    if (state.backpressureActive) {
      state.backpressureActive = false;
      this.onBackpressure?.(windowId, false);
    }
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
