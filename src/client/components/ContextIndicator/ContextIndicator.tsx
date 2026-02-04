import { useMemo } from 'react';
import type { ContextUsage } from '../../../shared/contextProtocol';

interface ContextIndicatorProps {
  usage: ContextUsage | null;
  size?: number;
}

/**
 * Circular progress indicator showing Claude context window usage
 */
export function ContextIndicator({ usage, size = 18 }: ContextIndicatorProps) {
  const { color, glowClass, pulseClass, strokeDasharray, strokeDashoffset } = useMemo(() => {
    if (!usage) {
      return {
        color: '#52525b',
        glowClass: '',
        pulseClass: '',
        strokeDasharray: '100',
        strokeDashoffset: '100',
      };
    }

    const percentage = usage.percentage;
    const circumference = 2 * Math.PI * 7; // radius = 7
    const offset = circumference - (percentage / 100) * circumference;

    let color: string;
    let glowClass = '';
    let pulseClass = '';

    if (percentage < 50) {
      color = '#22c55e'; // Green
    } else if (percentage < 75) {
      color = '#eab308'; // Yellow
    } else if (percentage < 90) {
      color = '#f97316'; // Orange
      glowClass = 'context-glow-orange';
    } else {
      color = '#ef4444'; // Red
      glowClass = 'context-glow-red';
      pulseClass = 'context-pulse';
    }

    return {
      color,
      glowClass,
      pulseClass,
      strokeDasharray: `${circumference}`,
      strokeDashoffset: `${offset}`,
    };
  }, [usage]);

  // Don't render if no usage data
  if (!usage) {
    return null;
  }

  const formattedUsed = usage.usedTokens.toLocaleString();
  const formattedMax = usage.maxTokens.toLocaleString();
  const tooltipText = `Context: ${formattedUsed} / ${formattedMax} tokens (${Math.round(usage.percentage)}%)`;

  return (
    <div
      className={`relative ${pulseClass}`}
      style={{ width: size, height: size }}
      title={tooltipText}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 18 18"
        className={`transform -rotate-90 ${glowClass}`}
      >
        {/* Background circle */}
        <circle
          cx="9"
          cy="9"
          r="7"
          fill="none"
          stroke="#27272a"
          strokeWidth="2"
        />
        {/* Progress circle */}
        <circle
          cx="9"
          cy="9"
          r="7"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          style={{
            transition: 'stroke-dashoffset 0.3s ease-in-out, stroke 0.3s ease-in-out',
          }}
        />
      </svg>
      {/* Percentage text in center for larger sizes */}
      {size >= 24 && (
        <span
          className="absolute inset-0 flex items-center justify-center text-[8px] font-bold"
          style={{ color }}
        >
          {Math.round(usage.percentage)}
        </span>
      )}
    </div>
  );
}

export default ContextIndicator;
