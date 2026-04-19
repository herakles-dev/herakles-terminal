import { useMemo } from 'react';
import type { ContextUsage } from '@shared/contextProtocol';
import { HANDOFF_THRESHOLDS, tokenColorBand } from '@shared/contextProtocol';

export interface ContextProgressBarProps {
  usage: ContextUsage | null;
  height?: number; // default 2
}

/**
 * Thin horizontal progress bar showing Claude context window usage.
 * Percentage fills against the model's hard limit (1M on Opus 4.7).
 * Color bands are token-absolute (green <200K, yellow 200-300K, red 300K+)
 * so a 250K conversation on Opus 4.7 shows 25% but is still yellow.
 */
export function ContextProgressBar({ usage, height = 2 }: ContextProgressBarProps) {
  const { color, fillPercent, glowClass, pulseClass, tooltipText } = useMemo(() => {
    if (!usage) {
      return {
        color: 'transparent',
        fillPercent: 0,
        glowClass: '',
        pulseClass: '',
        tooltipText: '',
      };
    }

    const band = tokenColorBand(usage.usedTokens);
    let color: string;
    let glowClass = '';
    let pulseClass = '';

    if (band === 'green') {
      color = '#22c55e';
    } else if (band === 'yellow') {
      color = '#eab308';
      glowClass = 'context-glow-orange';
    } else {
      color = '#ef4444';
      glowClass = 'context-glow-red';
      // Pulse only in the critical zone (>350K) so yellow/red are legible
      if (usage.usedTokens >= HANDOFF_THRESHOLDS.critical) pulseClass = 'context-pulse';
    }

    const pct = usage.percentage;
    const tooltipText =
      `Context: ${usage.usedTokens.toLocaleString()} / ${usage.maxTokens.toLocaleString()} tokens ` +
      `(${Math.round(pct * 10) / 10}%) — ${usage.model}`;

    return { color, fillPercent: Math.min(100, pct), glowClass, pulseClass, tooltipText };
  }, [usage]);

  return (
    <div
      className={`w-full ${pulseClass}`}
      style={{ height: `${height}px`, backgroundColor: '#27272a' }}
      title={tooltipText || undefined}
      aria-label={tooltipText || undefined}
      role={usage ? 'progressbar' : undefined}
      aria-valuenow={usage ? Math.round(usage.percentage) : undefined}
      aria-valuemin={usage ? 0 : undefined}
      aria-valuemax={usage ? 100 : undefined}
    >
      <div
        className={glowClass}
        style={{
          height: '100%',
          width: `${fillPercent}%`,
          backgroundColor: color,
          transition: 'width 0.3s ease-in-out, background-color 0.3s ease-in-out',
        }}
      />
    </div>
  );
}

export default ContextProgressBar;
