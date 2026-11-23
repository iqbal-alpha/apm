'use client';

import React, { useId } from 'react';
import type { HealthStatus } from '@/types/monitoring';

interface TelemetryChartCardProps {
  title: string;
  liveValue: string;
  thresholdLabel: string;
  thresholdValue: number;
  series: number[];
  maxY: number;
  status: HealthStatus;
}

const CHART_PALETTES: Record<
  HealthStatus,
  { stroke: string; fillStop: string; border: string; valueText: string }
> = {
  HEALTHY: {
    stroke: '#0EA5E9',
    fillStop: 'rgba(14, 165, 233, 0.22)',
    border: 'border-[var(--border-subtle)]',
    valueText: 'text-[var(--telemetry-bright)]',
  },
  DEGRADED: {
    stroke: '#F59E0B',
    fillStop: 'rgba(245, 158, 11, 0.24)',
    border: 'border-[var(--warn)]',
    valueText: 'text-[var(--warn-bright)]',
  },
  CRITICAL: {
    stroke: '#EF4444',
    fillStop: 'rgba(239, 68, 68, 0.26)',
    border: 'border-[var(--critical)]',
    valueText: 'text-[var(--critical-bright)]',
  },
};

export function TelemetryChartCard({
  title,
  liveValue,
  thresholdLabel,
  thresholdValue,
  series,
  maxY,
  status,
}: TelemetryChartCardProps) {
  const gradId = useId();
  const palette = CHART_PALETTES[status];

  const width = 340;
  const height = 38;
  const safeMax = Math.max(maxY, ...series, thresholdValue * 1.1, 1);

  const points = (series.length > 1 ? series : [0, 0]).map((val, idx, arr) => {
    const x = (idx / (arr.length - 1)) * width;
    const clamped = Math.min(safeMax, Math.max(0, val));
    const y = height - 2 - (clamped / safeMax) * (height - 6);
    return { x, y };
  });

  const linePath = points
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

  const thresholdY = Math.max(
    3,
    Math.min(height - 3, height - 2 - (thresholdValue / safeMax) * (height - 6))
  );

  return (
    <div
      className={`flex flex-col gap-1.5 rounded-[var(--radius-control)] border bg-[var(--bg-raised)] px-3 py-2 transition-colors duration-300 ${palette.border}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-sans text-[12px] font-medium text-[var(--text-secondary)]">
          {title}
        </span>
        <div className="flex items-baseline gap-2.5 shrink-0">
          <span className="font-mono text-[10px] text-[var(--text-muted)]">
            {thresholdLabel}
          </span>
          <span
            className={`tabular-nums-strict text-[14px] font-bold leading-none ${palette.valueText}`}
          >
            {liveValue}
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-[38px] w-full overflow-visible"
        aria-label={`${title} 60 second telemetry chart`}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.fillStop} />
            <stop offset="100%" stopColor="rgba(6, 8, 13, 0)" />
          </linearGradient>
        </defs>

        {/* Subtle Carbon Horizontal Gridlines */}
        <line x1="0" y1="10" x2={width} y2="10" stroke="#1B2436" strokeWidth="1" />
        <line x1="0" y1="22" x2={width} y2="22" stroke="#1B2436" strokeWidth="1" />
        <line x1="0" y1="34" x2={width} y2="34" stroke="#1B2436" strokeWidth="1" />

        {/* Dashed SLO Threshold Line */}
        <line
          x1="0"
          y1={thresholdY}
          x2={width}
          y2={thresholdY}
          stroke="#566B8C"
          strokeWidth="1"
          strokeDasharray="4 4"
          strokeOpacity="0.65"
        />

        {/* Single-Series Area + Stroke */}
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path
          d={linePath}
          fill="none"
          stroke={palette.stroke}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
