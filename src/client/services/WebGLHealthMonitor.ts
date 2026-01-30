/**
 * WebGL Health Monitor
 *
 * Tracks GPU memory pressure indicators and terminal health to enable
 * proactive degradation before WebGL context loss occurs.
 *
 * Key Metrics:
 * - Context loss events (frequency and timing)
 * - Session duration (fragmentation risk increases over time)
 * - Output volume (bytes/sec correlates with GPU pressure)
 * - Scrollback size (VRAM usage indicator)
 *
 * Health Score Algorithm:
 * - 100 = Perfect health, normal operation
 * - 80-99 = Good, enable light throttling preemptively
 * - 60-79 = Warning, reduce scrollback and throttle
 * - 40-59 = Critical, warn user and force reinit soon
 * - 0-39 = Failing, immediate reinit required
 */

export interface WebGLHealthMetrics {
  // Direct measurements
  contextLossCount: number;
  lastContextLossTime: number | null;
  sessionStartTime: number;

  // Calculated metrics
  healthScore: number;
  recentContextLosses: number; // Last 5 minutes
  sessionDurationMinutes: number;
  averageFlushRate: number; // Flushes per second
  averageBytesRate: number; // Bytes per second

  // Current state
  currentScrollback: number;
  totalBytesProcessed: number;
  peakFlushRate: number;
  peakBytesRate: number;

  // Recommended action
  recommendation: 'normal' | 'light_throttle' | 'reduce_quality' | 'warn_user' | 'reinit_required';
}

export interface PerformanceSnapshot {
  timestamp: number;
  flushRate: number;
  bytesRate: number;
  bufferSize: number;
}

interface ContextLossEvent {
  timestamp: number;
}

const METRICS_REPORT_INTERVAL_MS = 30_000; // 30 seconds
const RECENT_CONTEXT_LOSS_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const PERFORMANCE_WINDOW_MS = 1000; // 1 second rolling window

// Health score thresholds
const HEALTH_THRESHOLDS = {
  EXCELLENT: 90,
  GOOD: 80,
  WARNING: 60,
  CRITICAL: 40,
  FAILING: 20,
};

// Penalty weights for health score calculation
const PENALTIES = {
  CONTEXT_LOSS: 20, // -20 per recent context loss
  SESSION_TIME_BASE: 15, // Minutes before fragmentation risk starts
  SESSION_TIME_PENALTY: 2, // -2 per minute over base
  HIGH_FLUSH_RATE_THRESHOLD: 30, // Flushes/sec threshold
  HIGH_FLUSH_RATE_PENALTY: 1, // -1 per fps over threshold
  HIGH_BYTES_RATE_THRESHOLD: 150_000, // 150KB/sec threshold
  HIGH_BYTES_RATE_PENALTY: 0.1, // -0.1 per KB/sec over threshold
};

export class WebGLHealthMonitor {
  private sessionStartTime: number;
  private contextLossEvents: ContextLossEvent[] = [];
  private performanceSnapshots: PerformanceSnapshot[] = [];
  private metricsReportTimer: number | null = null;

  // Counters
  private totalFlushes = 0;
  private totalBytes = 0;
  private peakFlushRate = 0;
  private peakBytesRate = 0;

  // Current window tracking
  private windowStartTime = 0;
  private windowFlushCount = 0;
  private windowByteCount = 0;

  // Callbacks
  private onMetricsReport?: (metrics: WebGLHealthMetrics) => void;

  constructor(onMetricsReport?: (metrics: WebGLHealthMetrics) => void) {
    this.sessionStartTime = performance.now();
    this.windowStartTime = this.sessionStartTime;
    this.onMetricsReport = onMetricsReport;
  }

  /**
   * Start periodic metrics reporting
   */
  start(): void {
    if (this.metricsReportTimer !== null) {
      return; // Already started
    }

    this.metricsReportTimer = window.setInterval(() => {
      const metrics = this.getMetrics();
      this.onMetricsReport?.(metrics);

      // Log to console for manual analysis
      console.info('[WebGLHealth] Metrics:', {
        score: metrics.healthScore,
        recommendation: metrics.recommendation,
        contextLosses: `${metrics.contextLossCount} total, ${metrics.recentContextLosses} recent`,
        sessionTime: `${metrics.sessionDurationMinutes.toFixed(1)} min`,
        rates: `${metrics.averageFlushRate.toFixed(1)} fps, ${(metrics.averageBytesRate / 1024).toFixed(1)} KB/s`,
        peaks: `${metrics.peakFlushRate.toFixed(1)} fps, ${(metrics.peakBytesRate / 1024).toFixed(1)} KB/s`,
      });
    }, METRICS_REPORT_INTERVAL_MS);
  }

  /**
   * Stop periodic metrics reporting
   */
  stop(): void {
    if (this.metricsReportTimer !== null) {
      clearInterval(this.metricsReportTimer);
      this.metricsReportTimer = null;
    }
  }

  /**
   * Record a context loss event
   */
  recordContextLoss(): void {
    const event: ContextLossEvent = {
      timestamp: performance.now(),
    };
    this.contextLossEvents.push(event);

    console.error('[WebGLHealth] Context loss recorded:', {
      total: this.contextLossEvents.length,
      timeSinceSessionStart: ((event.timestamp - this.sessionStartTime) / 1000 / 60).toFixed(1) + ' min',
    });
  }

  /**
   * Record a flush event (tracks frequency and volume)
   */
  recordFlush(byteCount: number): void {
    const now = performance.now();

    // Reset window if expired
    if (now - this.windowStartTime >= PERFORMANCE_WINDOW_MS) {
      // Calculate rates before resetting
      const elapsed = (now - this.windowStartTime) / 1000; // seconds
      const flushRate = this.windowFlushCount / elapsed;
      const bytesRate = this.windowByteCount / elapsed;

      // Update peaks
      if (flushRate > this.peakFlushRate) {
        this.peakFlushRate = flushRate;
      }
      if (bytesRate > this.peakBytesRate) {
        this.peakBytesRate = bytesRate;
      }

      // Store snapshot for rate calculations
      this.performanceSnapshots.push({
        timestamp: now,
        flushRate,
        bytesRate,
        bufferSize: byteCount,
      });

      // Keep only last 60 seconds of snapshots
      const cutoff = now - 60_000;
      this.performanceSnapshots = this.performanceSnapshots.filter(
        (snap) => snap.timestamp > cutoff
      );

      // Reset window
      this.windowStartTime = now;
      this.windowFlushCount = 0;
      this.windowByteCount = 0;
    }

    // Track in current window
    this.windowFlushCount++;
    this.windowByteCount += byteCount;

    // Track totals
    this.totalFlushes++;
    this.totalBytes += byteCount;
  }

  /**
   * Update scrollback size (for VRAM usage tracking)
   */
  updateScrollback(_scrollback: number): void {
    // No-op for now - scrollback is tracked externally
    // Will be used in Phase 3 for proactive degradation
  }

  /**
   * Calculate current health metrics
   */
  getMetrics(): WebGLHealthMetrics {
    const now = performance.now();
    const sessionDurationMs = now - this.sessionStartTime;
    const sessionDurationMinutes = sessionDurationMs / 1000 / 60;

    // Count recent context losses (last 5 minutes)
    const recentCutoff = now - RECENT_CONTEXT_LOSS_WINDOW_MS;
    const recentContextLosses = this.contextLossEvents.filter(
      (event) => event.timestamp > recentCutoff
    ).length;

    // Calculate average rates from recent snapshots
    const recentSnapshots = this.performanceSnapshots.slice(-10); // Last 10 seconds
    const avgFlushRate =
      recentSnapshots.length > 0
        ? recentSnapshots.reduce((sum, snap) => sum + snap.flushRate, 0) / recentSnapshots.length
        : 0;
    const avgBytesRate =
      recentSnapshots.length > 0
        ? recentSnapshots.reduce((sum, snap) => sum + snap.bytesRate, 0) / recentSnapshots.length
        : 0;

    // Calculate health score
    const healthScore = this.calculateHealthScore({
      recentContextLosses,
      sessionDurationMinutes,
      avgFlushRate,
      avgBytesRate,
    });

    // Determine recommendation based on health score
    const recommendation = this.getRecommendation(healthScore, recentContextLosses);

    const lastContextLoss =
      this.contextLossEvents.length > 0
        ? this.contextLossEvents[this.contextLossEvents.length - 1].timestamp
        : null;

    return {
      // Direct measurements
      contextLossCount: this.contextLossEvents.length,
      lastContextLossTime: lastContextLoss,
      sessionStartTime: this.sessionStartTime,

      // Calculated metrics
      healthScore,
      recentContextLosses,
      sessionDurationMinutes,
      averageFlushRate: avgFlushRate,
      averageBytesRate: avgBytesRate,

      // Current state
      currentScrollback: 0, // Updated externally via updateScrollback
      totalBytesProcessed: this.totalBytes,
      peakFlushRate: this.peakFlushRate,
      peakBytesRate: this.peakBytesRate,

      // Recommendation
      recommendation,
    };
  }

  /**
   * Calculate health score (0-100)
   * Lower is worse, 100 is perfect
   */
  private calculateHealthScore(factors: {
    recentContextLosses: number;
    sessionDurationMinutes: number;
    avgFlushRate: number;
    avgBytesRate: number;
  }): number {
    let score = 100;

    // CRITICAL: Recent context losses (most important factor)
    if (factors.recentContextLosses > 0) {
      score -= factors.recentContextLosses * PENALTIES.CONTEXT_LOSS;
    }

    // Penalize long sessions (fragmentation risk)
    if (factors.sessionDurationMinutes > PENALTIES.SESSION_TIME_BASE) {
      const excessMinutes = factors.sessionDurationMinutes - PENALTIES.SESSION_TIME_BASE;
      score -= excessMinutes * PENALTIES.SESSION_TIME_PENALTY;
    }

    // Penalize high flush rates
    if (factors.avgFlushRate > PENALTIES.HIGH_FLUSH_RATE_THRESHOLD) {
      const excess = factors.avgFlushRate - PENALTIES.HIGH_FLUSH_RATE_THRESHOLD;
      score -= excess * PENALTIES.HIGH_FLUSH_RATE_PENALTY;
    }

    // Penalize high byte rates
    if (factors.avgBytesRate > PENALTIES.HIGH_BYTES_RATE_THRESHOLD) {
      const excessKB = (factors.avgBytesRate - PENALTIES.HIGH_BYTES_RATE_THRESHOLD) / 1024;
      score -= excessKB * PENALTIES.HIGH_BYTES_RATE_PENALTY;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get recommended action based on health score
   */
  private getRecommendation(
    healthScore: number,
    recentContextLosses: number
  ): WebGLHealthMetrics['recommendation'] {
    // Override: if we've had context losses recently, be aggressive
    if (recentContextLosses >= 3) {
      return 'reinit_required';
    }
    if (recentContextLosses >= 2) {
      return 'warn_user';
    }

    // Normal scoring
    if (healthScore >= HEALTH_THRESHOLDS.EXCELLENT) {
      return 'normal';
    }
    if (healthScore >= HEALTH_THRESHOLDS.GOOD) {
      return 'light_throttle';
    }
    if (healthScore >= HEALTH_THRESHOLDS.WARNING) {
      return 'reduce_quality';
    }
    if (healthScore >= HEALTH_THRESHOLDS.CRITICAL) {
      return 'warn_user';
    }
    return 'reinit_required';
  }

  /**
   * Reset health metrics (used after successful reinit)
   */
  reset(): void {
    this.contextLossEvents = [];
    this.performanceSnapshots = [];
    this.totalFlushes = 0;
    this.totalBytes = 0;
    this.peakFlushRate = 0;
    this.peakBytesRate = 0;
    this.windowStartTime = performance.now();
    this.windowFlushCount = 0;
    this.windowByteCount = 0;

    // DON'T reset session start time - keep tracking total uptime
  }

  /**
   * Get telemetry for debugging/validation
   */
  getTelemetry() {
    return {
      contextLossHistory: this.contextLossEvents,
      performanceHistory: this.performanceSnapshots,
      totals: {
        flushes: this.totalFlushes,
        bytes: this.totalBytes,
        peakFlushRate: this.peakFlushRate,
        peakBytesRate: this.peakBytesRate,
      },
    };
  }
}

/**
 * Export singleton for global access (useful for debugging in console)
 * Access via: window.terminalMetrics
 */
export function exposeMetricsToWindow(monitor: WebGLHealthMonitor): void {
  if (typeof window !== 'undefined') {
    (window as unknown as { terminalMetrics: WebGLHealthMonitor }).terminalMetrics = monitor;
    console.info('[WebGLHealth] Metrics exposed to window.terminalMetrics');
  }
}
