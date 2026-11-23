'use client';

import React, { useMemo } from 'react';
import { TelemetryChartCard } from '@/components/telemetry/TelemetryChartCard';
import { formatCpu, formatErrorRate, formatLatency } from '@/lib/telemetry-math';
import {
  selectActiveSnapshot,
  SERVICE_CONFIGS,
  useMonitoringStore,
} from '@/store/useMonitoringStore';
import type { ServiceNodeId } from '@/types/monitoring';

export function TelemetryChartsPanel() {
  const selectedNodeId = useMonitoringStore((s) => s.selectedNodeId);
  const activeFaults = useMonitoringStore((s) => s.activeFaults);
  const historyBuffer = useMonitoringStore((s) => s.historyBuffer);
  const replayOffsetSeconds = useMonitoringStore((s) => s.replayOffsetSeconds);
  const snap = useMonitoringStore(selectActiveSnapshot);

  // Focus selected node, or faulted root cause node, or default to primary PostgreSQL sink
  const targetNodeId: ServiceNodeId = useMemo(() => {
    if (selectedNodeId) return selectedNodeId;
    const faultKeys = Object.keys(activeFaults) as ServiceNodeId[];
    if (faultKeys.length > 0) return faultKeys[0];
    return 'postgres-db';
  }, [selectedNodeId, activeFaults]);

  const targetCfg = SERVICE_CONFIGS[targetNodeId];
  const liveMetric = snap.nodes[targetNodeId];

  // Slice trailing 60s rolling window ending at current replay frame
  const windowSlice = useMemo(() => {
    if (historyBuffer.length === 0) return [];
    const endIdx =
      replayOffsetSeconds < 0
        ? Math.max(1, historyBuffer.length + replayOffsetSeconds)
        : historyBuffer.length;
    const startIdx = Math.max(0, endIdx - 60);
    return historyBuffer.slice(startIdx, endIdx);
  }, [historyBuffer, replayOffsetSeconds]);

  const cpuSeries = windowSlice.map((s) => s.nodes[targetNodeId].cpu);
  const latSeries = windowSlice.map((s) => s.nodes[targetNodeId].latencyP95);
  const errSeries = windowSlice.map((s) => s.nodes[targetNodeId].errorRate);

  const cpuStatus =
    liveMetric.cpu >= 88 ? 'CRITICAL' : liveMetric.cpu >= 70 ? 'DEGRADED' : 'HEALTHY';
  const latStatus =
    liveMetric.latencyP95 >= 450
      ? 'CRITICAL'
      : liveMetric.latencyP95 >= 120
      ? 'DEGRADED'
      : 'HEALTHY';
  const errStatus =
    liveMetric.errorRate >= 5.0
      ? 'CRITICAL'
      : liveMetric.errorRate >= 1.0
      ? 'DEGRADED'
      : 'HEALTHY';

  return (
    <section
      aria-label="Synchronized Real-Time Telemetry Charts"
      className="flex flex-col gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="truncate font-sans text-[14px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Live Telemetry · {targetCfg.host.split('.')[0]}
        </div>
        <span className="shrink-0 font-mono text-[10.5px] text-[var(--text-muted)]">
          60s rolling · 1s tick
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <TelemetryChartCard
          title="CPU Utilization"
          liveValue={formatCpu(liveMetric.cpu)}
          thresholdLabel="SLO < 80%"
          thresholdValue={80}
          series={cpuSeries}
          maxY={100}
          status={cpuStatus}
        />

        <TelemetryChartCard
          title="p95 Latency"
          liveValue={formatLatency(liveMetric.latencyP95)}
          thresholdLabel="SLO < 250ms"
          thresholdValue={250}
          series={latSeries}
          maxY={2000}
          status={latStatus}
        />

        <TelemetryChartCard
          title="Error Rate"
          liveValue={formatErrorRate(liveMetric.errorRate)}
          thresholdLabel="SLO < 1.0%"
          thresholdValue={1.0}
          series={errSeries}
          maxY={30}
          status={errStatus}
        />
      </div>
    </section>
  );
}
