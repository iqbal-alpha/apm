'use client';

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Database, X, Zap } from 'lucide-react';
import { TelemetryChartCard } from '@/components/telemetry/TelemetryChartCard';
import { ActionButton } from '@/components/ui/ActionButton';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatCpu, formatErrorRate, formatLatency } from '@/lib/telemetry-math';
import {
  selectActiveSnapshot,
  SERVICE_CONFIGS,
  useMonitoringStore,
} from '@/store/useMonitoringStore';
import type { ServiceNodeId } from '@/types/monitoring';

interface MobileNodeBottomSheetProps {
  nodeId: ServiceNodeId | null;
  onClose: () => void;
}

export function MobileNodeBottomSheet({ nodeId, onClose }: MobileNodeBottomSheetProps) {
  const historyBuffer = useMonitoringStore((s) => s.historyBuffer);
  const injectNodeFault = useMonitoringStore((s) => s.injectNodeFault);
  const executeAutoMitigation = useMonitoringStore((s) => s.executeAutoMitigation);
  const snap = useMonitoringStore(selectActiveSnapshot);

  const cfg = nodeId ? SERVICE_CONFIGS[nodeId] : null;
  const metrics = nodeId ? snap.nodes[nodeId] : null;
  const isTrouble = metrics ? metrics.status === 'CRITICAL' || metrics.status === 'DEGRADED' : false;

  const recent = historyBuffer.slice(-60);
  const cpuSeries = nodeId ? recent.map((s) => s.nodes[nodeId].cpu) : [];
  const latSeries = nodeId ? recent.map((s) => s.nodes[nodeId].latencyP95) : [];

  return (
    <AnimatePresence>
      {nodeId && cfg && metrics && (
        <div key={nodeId} className="fixed inset-0 z-50 md:hidden">
        {/* Dimmed Scrim */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-[#06080D]/70 backdrop-blur-[2px]"
        />

        {/* Slide-Up Bottom Sheet */}
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`${cfg.name} telemetry bottom sheet`}
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-x-0 bottom-0 flex max-h-[82dvh] flex-col gap-3 rounded-t-[16px] border-t border-[var(--border-default)] bg-[var(--bg-surface)] px-4 pt-2.5 pb-[max(16px,env(safe-area-inset-bottom))] shadow-2xl overflow-y-auto"
        >
          {/* Drag Handle */}
          <div className="flex justify-center">
            <span className="h-1 w-10 rounded-full bg-[var(--border-focus)]" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border ${
                  metrics.status === 'CRITICAL'
                    ? 'border-[var(--critical)] bg-[var(--critical-tint)] text-[var(--critical-bright)]'
                    : metrics.status === 'DEGRADED'
                    ? 'border-[var(--warn)] bg-[var(--warn-tint)] text-[var(--warn-bright)]'
                    : 'border-[var(--telemetry)] bg-[var(--telemetry-tint)] text-[var(--telemetry-bright)]'
                }`}
              >
                <Database className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate font-sans text-[15px] font-semibold text-[var(--text-primary)]">
                  {cfg.name}
                </div>
                <div className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                  {cfg.host}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge tone={metrics.status} pulse={metrics.status === 'CRITICAL'} label={metrics.status} />
              <button
                type="button"
                onClick={onClose}
                aria-label="Close telemetry sheet"
                className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--bg-raised)] text-[var(--text-secondary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* 3-Column Hairline Metric Strip */}
          <div className="grid grid-cols-3 gap-2 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-3 py-2.5">
            <div>
              <div className="font-sans text-[10px] font-semibold text-[var(--text-muted)]">CPU UTIL</div>
              <div className="tabular-nums-strict text-[14px] font-semibold text-[var(--text-primary)]">
                {formatCpu(metrics.cpu)}
              </div>
            </div>
            <div className="border-l border-[var(--border-subtle)] pl-2.5">
              <div className="font-sans text-[10px] font-semibold text-[var(--text-muted)]">p95 LATENCY</div>
              <div className="tabular-nums-strict text-[14px] font-semibold text-[var(--text-primary)]">
                {formatLatency(metrics.latencyP95)}
              </div>
            </div>
            <div className="border-l border-[var(--border-subtle)] pl-2.5">
              <div className="font-sans text-[10px] font-semibold text-[var(--text-muted)]">ERR RATE</div>
              <div className="tabular-nums-strict text-[14px] font-semibold text-[var(--text-primary)]">
                {formatErrorRate(metrics.errorRate)}
              </div>
            </div>
          </div>

          {/* 2 Mini Spike Charts */}
          <div className="flex flex-col gap-2">
            <TelemetryChartCard
              title="CPU Utilization (60s)"
              liveValue={formatCpu(metrics.cpu)}
              thresholdLabel="SLO < 80%"
              thresholdValue={80}
              series={cpuSeries}
              maxY={100}
              status={metrics.cpu >= 88 ? 'CRITICAL' : metrics.cpu >= 70 ? 'DEGRADED' : 'HEALTHY'}
            />
            <TelemetryChartCard
              title="p95 Query Latency"
              liveValue={formatLatency(metrics.latencyP95)}
              thresholdLabel="SLO < 250ms"
              thresholdValue={250}
              series={latSeries}
              maxY={2000}
              status={metrics.latencyP95 >= 450 ? 'CRITICAL' : metrics.latencyP95 >= 120 ? 'DEGRADED' : 'HEALTHY'}
            />
          </div>

          {/* Full-Width 48px Touch Action Button */}
          {isTrouble ? (
            <ActionButton
              variant="mitigate"
              size="touch"
              fullWidth
              onClick={() => {
                executeAutoMitigation();
                onClose();
              }}
            >
              <Check className="h-4 w-4" />
              <span>Execute Auto-Mitigation & Resolve</span>
            </ActionButton>
          ) : (
            <ActionButton
              variant="simulate"
              size="touch"
              fullWidth
              onClick={() => injectNodeFault(nodeId)}
            >
              <Zap className="h-4 w-4 text-[var(--warn-bright)]" />
              <span>Inject Fault on {cfg.name}</span>
            </ActionButton>
          )}
        </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
