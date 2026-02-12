import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WebGLHealthMonitor, type WebGLHealthMetrics } from '../WebGLHealthMonitor';

describe('WebGLHealthMonitor', () => {
  let monitor: WebGLHealthMonitor;
  let reportedMetrics: WebGLHealthMetrics | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    reportedMetrics = null;
    monitor = new WebGLHealthMonitor((metrics) => {
      reportedMetrics = metrics;
    });
  });

  afterEach(() => {
    monitor.stop();
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should start with perfect health score', () => {
      const metrics = monitor.getMetrics();
      expect(metrics.healthScore).toBe(100);
      expect(metrics.recommendation).toBe('normal');
      expect(metrics.contextLossCount).toBe(0);
    });

    it('should track session start time', () => {
      const metrics = monitor.getMetrics();
      expect(metrics.sessionStartTime).toBeGreaterThanOrEqual(0);
      expect(metrics.sessionDurationMinutes).toBeCloseTo(0, 2);
    });
  });

  describe('Context Loss Tracking', () => {
    it('should record context loss events', () => {
      monitor.recordContextLoss();
      monitor.recordContextLoss();

      const metrics = monitor.getMetrics();
      expect(metrics.contextLossCount).toBe(2);
      expect(metrics.recentContextLosses).toBe(2);
    });

    it('should penalize health score for context losses', () => {
      monitor.recordContextLoss();
      const metrics = monitor.getMetrics();

      // -20 penalty per context loss
      expect(metrics.healthScore).toBe(80);
      expect(metrics.recommendation).toBe('light_throttle');
    });

    it('should count only recent context losses (5 min window)', () => {
      monitor.recordContextLoss();

      // Advance 6 minutes
      vi.advanceTimersByTime(6 * 60 * 1000);

      const metrics = monitor.getMetrics();
      expect(metrics.contextLossCount).toBe(1); // Total still 1
      expect(metrics.recentContextLosses).toBe(0); // But not recent
    });

    it('should recommend reinit after 3 recent context losses', () => {
      monitor.recordContextLoss();
      monitor.recordContextLoss();
      monitor.recordContextLoss();

      const metrics = monitor.getMetrics();
      expect(metrics.recommendation).toBe('reinit_required');
    });
  });

  describe('Flush Tracking', () => {
    it('should track flush events and byte volume', () => {
      monitor.recordFlush(1000); // 1KB
      monitor.recordFlush(2000); // 2KB
      monitor.recordFlush(1500); // 1.5KB

      const metrics = monitor.getMetrics();
      expect(metrics.totalBytesProcessed).toBe(4500);
    });

    it('should calculate flush rate over time', () => {
      // Record 30 flushes in 1 second
      for (let i = 0; i < 30; i++) {
        monitor.recordFlush(1000);
      }

      vi.advanceTimersByTime(1000); // Complete the window

      monitor.recordFlush(1000); // Trigger rate calculation

      const metrics = monitor.getMetrics();
      expect(metrics.averageFlushRate).toBeGreaterThan(25);
    });

    it('should track peak flush rate', () => {
      // Low rate
      for (let i = 0; i < 10; i++) {
        monitor.recordFlush(1000);
      }
      vi.advanceTimersByTime(1000);
      monitor.recordFlush(1000);

      // High rate spike
      for (let i = 0; i < 50; i++) {
        monitor.recordFlush(1000);
      }
      vi.advanceTimersByTime(1000);
      monitor.recordFlush(1000);

      const metrics = monitor.getMetrics();
      expect(metrics.peakFlushRate).toBeGreaterThan(40);
    });

    it('should track peak bytes rate', () => {
      // Record high volume
      for (let i = 0; i < 100; i++) {
        monitor.recordFlush(10000); // 10KB per flush
      }
      vi.advanceTimersByTime(1000);
      monitor.recordFlush(1000);

      const metrics = monitor.getMetrics();
      expect(metrics.peakBytesRate).toBeGreaterThan(500_000); // >500KB/s
    });
  });

  describe('Health Score Calculation', () => {
    it('should penalize for long sessions', () => {
      // Advance 70 minutes (beyond 60 min base)
      vi.advanceTimersByTime(70 * 60 * 1000);

      const metrics = monitor.getMetrics();
      // Penalty: (70 - 60) * 1 = -10
      expect(metrics.healthScore).toBe(90);
      expect(metrics.sessionDurationMinutes).toBeCloseTo(70, 1);
    });

    it('should penalize for high flush rate', () => {
      // Generate 40 flushes/sec (above 30 threshold)
      for (let i = 0; i < 40; i++) {
        monitor.recordFlush(1000);
      }
      vi.advanceTimersByTime(1000);
      monitor.recordFlush(1000);

      const metrics = monitor.getMetrics();
      // Penalty: (40 - 30) * 1 = -10
      expect(metrics.healthScore).toBeLessThan(95);
    });

    it('should penalize for high byte rate', () => {
      // Generate 200KB/sec (above 150KB threshold)
      for (let i = 0; i < 100; i++) {
        monitor.recordFlush(2000); // 2KB per flush
      }
      vi.advanceTimersByTime(1000);
      monitor.recordFlush(1000);

      const metrics = monitor.getMetrics();
      // Penalty for excess bytes
      expect(metrics.healthScore).toBeLessThan(95);
    });

    it('should apply cumulative penalties', () => {
      // Advance 90 minutes first (beyond 60 min base)
      vi.advanceTimersByTime(90 * 60 * 1000);

      // Multiple factors:
      // 1. Context loss (recent, -20)
      monitor.recordContextLoss();

      // 2. Long session (90 min, -30 penalty: (90-60)*1)

      // 3. High flush rate (50 fps = -20)
      for (let i = 0; i < 50; i++) {
        monitor.recordFlush(5000);
      }
      vi.advanceTimersByTime(1000);
      monitor.recordFlush(1000);

      const metrics = monitor.getMetrics();
      // Should be ~30 (-20 context, -30 session, -20 flush rate)
      expect(metrics.healthScore).toBeLessThan(60);
      expect(metrics.recommendation).not.toBe('normal');
    });
  });

  describe('Recommendations', () => {
    it('should recommend normal operation at high health', () => {
      const metrics = monitor.getMetrics();
      expect(metrics.healthScore).toBe(100);
      expect(metrics.recommendation).toBe('normal');
    });

    it('should recommend light throttle at 80-89 health', () => {
      // One context loss = 80 score
      monitor.recordContextLoss();
      const metrics = monitor.getMetrics();
      expect(metrics.healthScore).toBe(80);
      expect(metrics.recommendation).toBe('light_throttle');
    });

    it('should recommend reduce quality at 60-79 health', () => {
      // Advance time first, then add context loss
      vi.advanceTimersByTime(80 * 60 * 1000); // 80 minutes = -20 penalty ((80-60)*1)
      monitor.recordContextLoss(); // Recent loss = -20 penalty
      const metrics = monitor.getMetrics();
      // Should be 60 (-20 context, -20 session time)
      expect(metrics.healthScore).toBe(60);
      expect(metrics.recommendation).toBe('reduce_quality');
    });

    it('should recommend warn user at 40-59 health', () => {
      // Use long session + one loss to reach 40-59 range
      vi.advanceTimersByTime(100 * 60 * 1000); // 100 minutes = -40 penalty ((100-60)*1)
      monitor.recordContextLoss(); // -20 (must be AFTER time advance to stay within 5min recent window)
      const metrics = monitor.getMetrics();
      // Score: 100 - 20 (loss) - 40 (session) = 40
      expect(metrics.recommendation).toBe('warn_user');
    });

    it('should recommend reinit for 3+ recent context losses', () => {
      monitor.recordContextLoss();
      monitor.recordContextLoss();
      monitor.recordContextLoss();

      const metrics = monitor.getMetrics();
      expect(metrics.recommendation).toBe('reinit_required');
    });
  });

  describe('Periodic Reporting', () => {
    it('should report metrics every 30 seconds', () => {
      monitor.start();

      expect(reportedMetrics).toBeNull();

      vi.advanceTimersByTime(30_000);
      expect(reportedMetrics).not.toBeNull();
      expect(reportedMetrics!.healthScore).toBe(100);

      reportedMetrics = null;
      vi.advanceTimersByTime(30_000);
      expect(reportedMetrics).not.toBeNull();
    });

    it('should not double-start reporting', () => {
      monitor.start();
      monitor.start(); // Should be no-op

      vi.advanceTimersByTime(30_000);
      // Should only fire once
      const firstReport = reportedMetrics;

      reportedMetrics = null;
      vi.advanceTimersByTime(1000);
      expect(reportedMetrics).toBeNull(); // Not time yet

      vi.advanceTimersByTime(29_000);
      expect(reportedMetrics).not.toBeNull();
      expect(reportedMetrics).not.toBe(firstReport); // New metrics
    });

    it('should stop reporting when stopped', () => {
      monitor.start();

      vi.advanceTimersByTime(30_000);
      expect(reportedMetrics).not.toBeNull();

      monitor.stop();
      reportedMetrics = null;

      vi.advanceTimersByTime(30_000);
      expect(reportedMetrics).toBeNull(); // No more reports
    });
  });

  describe('Reset Functionality', () => {
    it('should reset counters after reset', () => {
      monitor.recordContextLoss();
      monitor.recordContextLoss();
      monitor.recordFlush(10000);
      monitor.recordFlush(10000);

      monitor.reset();

      const metrics = monitor.getMetrics();
      expect(metrics.contextLossCount).toBe(0);
      expect(metrics.totalBytesProcessed).toBe(0);
      expect(metrics.healthScore).toBe(100);
    });

    it('should preserve session start time after reset', () => {
      vi.advanceTimersByTime(10 * 60 * 1000); // 10 minutes

      const beforeReset = monitor.getMetrics();
      expect(beforeReset.sessionDurationMinutes).toBeCloseTo(10, 1);

      monitor.reset();

      const afterReset = monitor.getMetrics();
      // Session time should still show 10 minutes, not reset to 0
      expect(afterReset.sessionDurationMinutes).toBeCloseTo(10, 1);
    });
  });

  describe('Telemetry Access', () => {
    it('should provide telemetry for debugging', () => {
      monitor.recordContextLoss();
      monitor.recordFlush(5000);
      monitor.recordFlush(5000);

      const telemetry = monitor.getTelemetry();

      expect(telemetry.contextLossHistory).toHaveLength(1);
      expect(telemetry.totals.bytes).toBe(10000);
      expect(telemetry.totals.flushes).toBe(2);
    });

    it('should track performance history snapshots', () => {
      for (let i = 0; i < 30; i++) {
        monitor.recordFlush(1000);
      }
      vi.advanceTimersByTime(1000);
      monitor.recordFlush(1000); // Trigger snapshot

      const telemetry = monitor.getTelemetry();
      expect(telemetry.performanceHistory.length).toBeGreaterThan(0);
    });

    it('should limit performance history to 60 seconds', () => {
      // Generate snapshots over 2 minutes
      for (let i = 0; i < 120; i++) {
        monitor.recordFlush(1000);
        vi.advanceTimersByTime(1000);
      }

      const telemetry = monitor.getTelemetry();
      // Should only keep last 60 snapshots
      expect(telemetry.performanceHistory.length).toBeLessThanOrEqual(60);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero flushes gracefully', () => {
      const metrics = monitor.getMetrics();
      expect(metrics.averageFlushRate).toBe(0);
      expect(metrics.averageBytesRate).toBe(0);
      expect(metrics.healthScore).toBe(100);
    });

    it('should handle negative health scores (clamp to 0)', () => {
      // Generate extreme penalties
      for (let i = 0; i < 10; i++) {
        monitor.recordContextLoss();
      }
      vi.advanceTimersByTime(100 * 60 * 1000); // 100 minutes

      const metrics = monitor.getMetrics();
      expect(metrics.healthScore).toBeGreaterThanOrEqual(0);
      expect(metrics.healthScore).toBeLessThanOrEqual(100);
    });

    it('should handle very small byte counts', () => {
      monitor.recordFlush(1); // 1 byte
      monitor.recordFlush(1);

      const metrics = monitor.getMetrics();
      expect(metrics.totalBytesProcessed).toBe(2);
    });

    it('should handle very large byte counts', () => {
      monitor.recordFlush(10_000_000); // 10MB

      const metrics = monitor.getMetrics();
      expect(metrics.totalBytesProcessed).toBe(10_000_000);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should detect Claude thinking dots pattern', () => {
      // Simulate Claude thinking: 60 flushes/sec for 2 minutes
      for (let minute = 0; minute < 2; minute++) {
        for (let i = 0; i < 60; i++) {
          monitor.recordFlush(100); // Small updates
        }
        vi.advanceTimersByTime(1000);
      }

      const metrics = monitor.getMetrics();
      expect(metrics.averageFlushRate).toBeGreaterThan(30);
      expect(metrics.recommendation).not.toBe('normal');
    });

    it('should detect build output pattern', () => {
      // Simulate npm install: high volume for 30 seconds
      for (let i = 0; i < 30; i++) {
        for (let j = 0; j < 100; j++) {
          monitor.recordFlush(2000); // 2KB per flush
        }
        vi.advanceTimersByTime(1000);
      }

      const metrics = monitor.getMetrics();
      expect(metrics.peakBytesRate).toBeGreaterThan(150_000);
    });

    it('should degrade gracefully over long session', () => {
      // Advance to 85 minutes (beyond 60 min base)
      vi.advanceTimersByTime(85 * 60 * 1000);

      // Add two recent context losses (within 5 min window)
      monitor.recordContextLoss();
      vi.advanceTimersByTime(2 * 60 * 1000); // 2 minutes later
      monitor.recordContextLoss();

      // Advance to 90 minutes total
      vi.advanceTimersByTime(3 * 60 * 1000);

      const metrics = monitor.getMetrics();
      expect(metrics.sessionDurationMinutes).toBeCloseTo(90, 1);
      // 2 recent context losses (-40) + 90 min session (-30) = 30 score
      expect(metrics.healthScore).toBeLessThanOrEqual(50);
      expect(metrics.recommendation).toBe('warn_user');
    });
  });
});
