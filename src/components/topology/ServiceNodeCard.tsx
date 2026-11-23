'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  Check,
  CreditCard,
  Database,
  Globe,
  Network,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { ActionButton } from '@/components/ui/ActionButton';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatCpu, formatErrorRate, formatLatency } from '@/lib/telemetry-math';
import { useMonitoringStore } from '@/store/useMonitoringStore';
import type { HealthStatus, ServiceNodeId } from '@/types/monitoring';

export interface ServiceNodeCardData extends Record<string, unknown> {
  nodeId: ServiceNodeId;
  name: string;
  host: string;
  region: string;
  cpu: number;
  latencyP95: number;
  errorRate: number;
  rps: number;
  status: HealthStatus;
  isRootCause: boolean;
  isSelected: boolean;
  isTraceHighlighted: boolean;
  isMitigating: boolean;
  isMobileLayout: boolean;
  compactMobileCard?: boolean;
}

export type ServiceRfNode = Node<ServiceNodeCardData, 'serviceNode'>;

const SERVICE_ICONS: Record<ServiceNodeId, React.ComponentType<{ className?: string }>> = {
  'web-app': Globe,
  'api-gateway': Network,
  'auth-service': ShieldCheck,
  'payment-service': CreditCard,
  'postgres-db': Database,
};

const STATUS_FRAME: Record<
  HealthStatus,
  { border: string; accent: string; valueText: string; shadowClass: string }
> = {
  HEALTHY: {
    border: 'border-[var(--border-default)]',
    accent: 'bg-[var(--healthy)]',
    valueText: 'text-[var(--text-primary)]',
    shadowClass: '',
  },
  DEGRADED: {
    border: 'border-[var(--warn)] border-[1.5px]',
    accent: 'bg-[var(--warn)]',
    valueText: 'text-[var(--warn-bright)]',
    shadowClass: 'shadow-[var(--warn-glow)]',
  },
  CRITICAL: {
    border: 'border-[var(--critical)] border-[1.5px]',
    accent: 'bg-[var(--critical)]',
    valueText: 'text-[var(--critical-bright)]',
    shadowClass: 'node-critical-pulse',
  },
};

export function ServiceNodeCard({ data }: NodeProps<ServiceRfNode>) {
  const injectNodeFault = useMonitoringStore((s) => s.injectNodeFault);
  const mitigateNode = useMonitoringStore((s) => s.mitigateNode);
  const selectNode = useMonitoringStore((s) => s.selectNode);

  const [flashing, setFlashing] = useState(false);
  const prevCpuRef = useRef(data.cpu);
  const prevLatRef = useRef(data.latencyP95);

  useEffect(() => {
    const spiked =
      data.cpu - prevCpuRef.current >= 14 || data.latencyP95 - prevLatRef.current >= 220;
    prevCpuRef.current = data.cpu;
    prevLatRef.current = data.latencyP95;

    if (spiked) {
      setFlashing(true);
      const timer = setTimeout(() => setFlashing(false), 240);
      return () => clearTimeout(timer);
    }
  }, [data.cpu, data.latencyP95]);

  const Icon = SERVICE_ICONS[data.nodeId];
  const palette = STATUS_FRAME[data.status];
  const isTrouble = data.status === 'CRITICAL' || data.status === 'DEGRADED';

  return (
    <div
      role="region"
      aria-label={`${data.name} telemetry card (${data.status})`}
      aria-live="polite"
      onClick={() => selectNode(data.nodeId)}
      className={`group relative w-[268px] overflow-hidden rounded-[var(--radius-node)] border bg-[var(--bg-surface)] transition-all duration-200 cursor-pointer select-none ${
        palette.border
      } ${palette.shadowClass} ${
        data.isMitigating ? 'mitigation-sweep-active' : ''
      } ${
        data.isSelected || data.isTraceHighlighted
          ? 'ring-2 ring-[var(--border-focus)] ring-offset-1 ring-offset-[var(--bg-ground)]'
          : ''
      }`}
    >
      {/* Target/Source React Flow Handles (adapted to Horizontal Desktop or Vertical Mobile DAG) */}
      <Handle
        type="target"
        position={data.isMobileLayout ? Position.Top : Position.Left}
        className="!h-2 !w-2 !border-[var(--bg-ground)] !bg-[var(--border-focus)]"
      />
      <Handle
        type="source"
        position={data.isMobileLayout ? Position.Bottom : Position.Right}
        className="!h-2 !w-2 !border-[var(--bg-ground)] !bg-[var(--telemetry)]"
      />

      {/* Top 3px Semantic Accent Strip matching Figma ServiceNodeCard */}
      <div className={`h-[3px] w-full ${palette.accent}`} />

      <div className="flex flex-col gap-2.5 p-3">
        {/* Header Row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Icon
              className={`h-4 w-4 shrink-0 ${
                data.status === 'CRITICAL'
                  ? 'text-[var(--critical-bright)]'
                  : data.status === 'DEGRADED'
                  ? 'text-[var(--warn-bright)]'
                  : 'text-[var(--text-secondary)]'
              }`}
            />
            <div className="min-w-0">
              <div className="truncate font-sans text-[14px] font-semibold leading-[1.25] tracking-[-0.01em] text-[var(--text-primary)]">
                {data.name}
              </div>
              <div className="truncate font-mono text-[10px] leading-[1.3] text-[var(--text-muted)]">
                {data.host} · {data.region}
              </div>
            </div>
          </div>

          <StatusBadge
            tone={data.status}
            pulse={data.status === 'CRITICAL'}
            label={data.status}
            className="shrink-0"
          />
        </div>

        {/* 3-Column Hairline Telemetry Strip */}
        <div
          className={`grid grid-cols-3 gap-2 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-2.5 py-2 ${
            flashing ? 'metric-flash-critical' : ''
          }`}
        >
          <div className="min-w-0">
            <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--text-secondary)]">
              CPU
            </div>
            <div
              className={`tabular-nums-strict truncate text-[13px] font-semibold leading-[1.25] ${palette.valueText}`}
            >
              {formatCpu(data.cpu)}
            </div>
          </div>

          <div className="min-w-0 border-l border-[var(--border-subtle)] pl-2">
            <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--text-secondary)]">
              p95
            </div>
            <div
              className={`tabular-nums-strict truncate text-[13px] font-semibold leading-[1.25] ${palette.valueText}`}
            >
              {formatLatency(data.latencyP95)}
            </div>
          </div>

          <div className="min-w-0 border-l border-[var(--border-subtle)] pl-2">
            <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--text-secondary)]">
              ERR
            </div>
            <div
              className={`tabular-nums-strict truncate text-[13px] font-semibold leading-[1.25] ${palette.valueText}`}
            >
              {formatErrorRate(data.errorRate)}
            </div>
          </div>
        </div>

        {/* Contextual Action Trigger (hidden in mobile compact vertical view to avoid scroll clutter) */}
        {!data.compactMobileCard && (
          <ActionButton
            variant={isTrouble ? 'mitigate' : 'simulate'}
            size="sm"
            fullWidth
            onClick={(e) => {
              e.stopPropagation();
              if (isTrouble) {
                mitigateNode(data.nodeId);
              } else {
                injectNodeFault(data.nodeId);
              }
            }}
          >
            {isTrouble ? (
              <>
                <Check className="h-3.5 w-3.5" />
                <span>Mitigate Node</span>
              </>
            ) : (
              <>
                <Zap className="h-3.5 w-3.5 text-[var(--warn-bright)]" />
                <span>Simulate Incident</span>
              </>
            )}
          </ActionButton>
        )}
      </div>
    </div>
  );
}
