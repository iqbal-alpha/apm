'use client';

import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { formatLatency, formatRps } from '@/lib/telemetry-math';
import type { HealthStatus } from '@/types/monitoring';

export interface TelemetryEdgeData extends Record<string, unknown> {
  latencyMs: number;
  rps: number;
  errorRate: number;
  status: HealthStatus;
  isTraceHighlighted: boolean;
  labelOffsetX?: number;
  labelOffsetY?: number;
}

export type TelemetryRfEdge = Edge<TelemetryEdgeData, 'telemetryEdge'>;

const EDGE_COLORS: Record<
  HealthStatus,
  { stroke: string; particle: string; animClass: string; pillBorder: string; pillBg: string; pillText: string }
> = {
  HEALTHY: {
    stroke: 'var(--telemetry)',
    particle: 'var(--telemetry-bright)',
    animClass: 'animate-flow-healthy',
    pillBorder: 'border-[var(--telemetry)]',
    pillBg: 'bg-[var(--bg-surface)]',
    pillText: 'text-[var(--telemetry-bright)]',
  },
  DEGRADED: {
    stroke: 'var(--warn)',
    particle: 'var(--warn-bright)',
    animClass: 'animate-flow-degraded',
    pillBorder: 'border-[var(--warn)]',
    pillBg: 'bg-[var(--bg-surface)]',
    pillText: 'text-[var(--warn-bright)]',
  },
  CRITICAL: {
    stroke: 'var(--critical)',
    particle: 'var(--critical-bright)',
    animClass: 'animate-flow-critical',
    pillBorder: 'border-[var(--critical)]',
    pillBg: 'bg-[var(--bg-surface)]',
    pillText: 'text-[var(--critical-bright)]',
  },
};

export function TelemetryEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<TelemetryRfEdge>) {
  const status: HealthStatus = data?.status ?? 'HEALTHY';
  const palette = EDGE_COLORS[status];

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.35,
  });

  const px = labelX + (data?.labelOffsetX ?? 0);
  const py = labelY + (data?.labelOffsetY ?? 0);

  const latencyLabel = formatLatency(data?.latencyMs ?? 12);
  const detailLabel =
    status === 'HEALTHY'
      ? formatRps(data?.rps ?? 1400)
      : `${(data?.errorRate ?? 0).toFixed(1)}% err`;

  const motionDuration = status === 'CRITICAL' ? '0.9s' : status === 'DEGRADED' ? '3.0s' : '1.8s';

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: palette.stroke,
          strokeWidth: data?.isTraceHighlighted ? 3 : status === 'CRITICAL' ? 2.5 : 1.75,
          strokeOpacity: data?.isTraceHighlighted ? 0.9 : 0.38,
        }}
      />

      {/* Animated Dashed Flow Stream */}
      <path
        d={edgePath}
        fill="none"
        stroke={palette.stroke}
        strokeWidth={status === 'CRITICAL' ? 2.5 : 2}
        strokeDasharray={status === 'DEGRADED' ? '6 10' : '4 12'}
        strokeLinecap="round"
        className={palette.animClass}
      />

      {/* Moving Light Particle along Bezier Path */}
      <circle r={status === 'CRITICAL' ? 3.5 : 3} fill={palette.particle}>
        <animateMotion dur={motionDuration} repeatCount="indefinite" path={edgePath} />
      </circle>

      {/* Non-Overlapping EdgeLatencyPill */}
      <EdgeLabelRenderer>
        <div
          style={{
            transform: `translate(-50%, -50%) translate(${px}px, ${py}px)`,
          }}
          className={`pointer-events-auto nodrag nopan absolute z-10 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-2 py-0.5 font-mono text-[10.5px] font-medium tabular-nums shadow-sm ${palette.pillBg} ${palette.pillBorder} ${palette.pillText}`}
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: palette.particle }}
          />
          <span className="whitespace-nowrap">
            {latencyLabel} · {detailLabel}
          </span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
