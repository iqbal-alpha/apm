'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { Lock, Maximize2, RotateCcw, Unlock, Zap } from 'lucide-react';
import {
  ServiceNodeCard,
  type ServiceRfNode,
} from '@/components/topology/ServiceNodeCard';
import { TelemetryEdge, type TelemetryRfEdge } from '@/components/topology/TelemetryEdge';
import { ActionButton } from '@/components/ui/ActionButton';
import {
  CHAOS_SCENARIOS,
  selectActiveSnapshot,
  SERVICE_CONFIGS,
  useMonitoringStore,
} from '@/store/useMonitoringStore';
import type { ServiceNodeId } from '@/types/monitoring';

const nodeTypes: NodeTypes = {
  serviceNode: ServiceNodeCard,
};

const edgeTypes: EdgeTypes = {
  telemetryEdge: TelemetryEdge,
};

interface TopologyInnerProps {
  isMobile: boolean;
  onMobileNodeTap?: (nodeId: ServiceNodeId) => void;
}

function TopologyInner({ isMobile, onMobileNodeTap }: TopologyInnerProps) {
  const { fitView, zoomTo } = useReactFlow();
  const [isPanUnlocked, setIsPanUnlocked] = useState(false);

  const selectedNodeId = useMonitoringStore((s) => s.selectedNodeId);
  const selectNode = useMonitoringStore((s) => s.selectNode);
  const highlightedTraceId = useMonitoringStore((s) => s.highlightedTraceId);
  const activeFaults = useMonitoringStore((s) => s.activeFaults);
  const activeScenario = useMonitoringStore((s) => s.activeScenario);
  const mitigating = useMonitoringStore((s) => s.mitigating);
  const snap = useMonitoringStore(selectActiveSnapshot);

  const faultList = Object.values(activeFaults).filter(Boolean);
  const hasFault = faultList.length > 0;
  const activeFaultScenario = faultList[0]?.scenarioId;
  const scenarioMeta =
    activeFaultScenario && activeFaultScenario !== 'MANUAL_SPIKE'
      ? CHAOS_SCENARIOS[activeFaultScenario]
      : CHAOS_SCENARIOS[activeScenario];

  const rfNodes: ServiceRfNode[] = useMemo(() => {
    const mobileCompactPositions: Record<ServiceNodeId, { x: number; y: number }> = {
      'web-app': { x: 48, y: 12 },
      'api-gateway': { x: 48, y: 168 },
      'payment-service': { x: 8, y: 324 },
      'auth-service': { x: 294, y: 324 },
      'postgres-db': { x: 48, y: 480 },
    };

    const desktopPositions: Record<ServiceNodeId, { x: number; y: number }> = {
      'web-app': { x: 16, y: 16 },
      'api-gateway': { x: 16, y: 274 },
      'auth-service': { x: 374, y: 20 },
      'payment-service': { x: 374, y: 274 },
      'postgres-db': { x: 732, y: 146 },
    };

    return (Object.keys(SERVICE_CONFIGS) as ServiceNodeId[]).map((id) => {
      const cfg = SERVICE_CONFIGS[id];
      const metric = snap.nodes[id];
      return {
        id,
        type: 'serviceNode',
        position: isMobile ? mobileCompactPositions[id] : desktopPositions[id],
        draggable: false,
        selectable: true,
        data: {
          nodeId: id,
          name: cfg.name,
          host: cfg.host,
          region: cfg.region,
          cpu: metric.cpu,
          latencyP95: metric.latencyP95,
          errorRate: metric.errorRate,
          rps: metric.rps,
          status: metric.status,
          isRootCause: Boolean(activeFaults[id]),
          isSelected: selectedNodeId === id,
          isTraceHighlighted: Boolean(highlightedTraceId),
          isMitigating: mitigating,
          isMobileLayout: isMobile,
          compactMobileCard: isMobile,
        },
      };
    });
  }, [snap.nodes, activeFaults, selectedNodeId, highlightedTraceId, mitigating, isMobile]);

  const rfEdges: TelemetryRfEdge[] = useMemo(() => {
    return snap.edges.map((edge) => {
      // Offset specific edge labels cleanly in open canvas corridors so pills never cover cards
      const labelOffsetX = 0;
      let labelOffsetY = 0;
      if (!isMobile) {
        if (edge.id === 'e-gw-pay') {
          labelOffsetY = 36;
        } else if (edge.id === 'e-pay-db') {
          labelOffsetY = 24;
        } else if (edge.id === 'e-auth-db') {
          labelOffsetY = -20;
        }
      }

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'telemetryEdge',
        data: {
          latencyMs: edge.latencyMs,
          rps: edge.rps,
          errorRate: edge.errorRate,
          status: edge.status,
          isTraceHighlighted: Boolean(highlightedTraceId),
          labelOffsetX,
          labelOffsetY,
        },
      };
    });
  }, [snap.edges, highlightedTraceId, isMobile]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fitView({ padding: isMobile ? 0.08 : 0.12, duration: 250 });
    }, 80);
    return () => clearTimeout(timer);
  }, [fitView, isMobile]);

  return (
    <div className="relative flex h-full w-full flex-col bg-[var(--bg-ground)]">
      {/* Topology Toolbar */}
      <div className="flex h-[42px] shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 md:px-4">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="truncate font-sans text-[13px] md:text-[14px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            Service Dependency Graph
          </h2>
          <span className="hidden sm:inline font-mono text-[11px] text-[var(--text-muted)]">
            React Flow · 5 microservices
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isMobile && (
            <button
              type="button"
              onClick={() => setIsPanUnlocked((v) => !v)}
              className={`inline-flex h-[28px] items-center gap-1 rounded-[var(--radius-pill)] border px-2 font-sans text-[11px] font-semibold transition-colors ${
                isPanUnlocked
                  ? 'border-[var(--warn)] bg-[var(--warn-tint)] text-[var(--warn-bright)]'
                  : 'border-[var(--telemetry)] bg-[var(--telemetry-tint)] text-[var(--telemetry-bright)]'
              }`}
            >
              {isPanUnlocked ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
              <span>{isPanUnlocked ? 'Lock Pan' : 'Unlock Pan'}</span>
            </button>
          )}

          <ActionButton
            variant="ghost"
            size="sm"
            onClick={() => fitView({ padding: 0.12, duration: 280 })}
            className="hidden sm:inline-flex"
          >
            <Maximize2 className="h-3 w-3" />
            <span>Fit View</span>
          </ActionButton>

          <ActionButton
            variant="ghost"
            size="sm"
            onClick={() => zoomTo(1, { duration: 280 })}
            className="hidden lg:inline-flex"
          >
            <span>Zoom 100%</span>
          </ActionButton>

          {selectedNodeId ? (
            <button
              type="button"
              onClick={() => selectNode(null)}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--critical)] bg-[var(--critical-tint)] px-2.5 font-sans text-[11px] font-semibold text-[var(--critical-bright)] hover:opacity-90"
            >
              <span className="truncate max-w-[140px]">
                Focus: {SERVICE_CONFIGS[selectedNodeId].name}
              </span>
              <RotateCcw className="h-3 w-3 shrink-0" />
            </button>
          ) : (
            <span className="hidden md:inline-flex h-[30px] items-center rounded-[var(--radius-control)] border border-[var(--telemetry)] bg-[var(--telemetry-tint)] px-2.5 font-sans text-[11px] font-semibold text-[var(--telemetry-bright)]">
              All Cluster Services
            </span>
          )}
        </div>
      </div>

      {/* Interactive DAG Viewport */}
      <div className="relative flex-1 min-h-[420px] md:min-h-0">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={(_, node) => {
            const nodeId = node.id as ServiceNodeId;
            selectNode(nodeId);
            if (isMobile && onMobileNodeTap) {
              onMobileNodeTap(nodeId);
            }
          }}
          fitView
          minZoom={0.45}
          maxZoom={1.5}
          panOnScroll={!isMobile || isPanUnlocked}
          zoomOnScroll={!isMobile || isPanUnlocked}
          panOnDrag={!isMobile || isPanUnlocked}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
          className="bg-[var(--bg-ground)]"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={28}
            size={1.2}
            color="rgba(56, 75, 110, 0.35)"
          />
        </ReactFlow>

        {/* Bottom-Left Floating Status Banner Overlay */}
        <div className="pointer-events-none absolute bottom-3 left-3 right-3 md:right-auto z-10 flex max-w-[calc(100%-24px)]">
          {hasFault ? (
            <div className="inline-flex max-w-full items-center gap-2 rounded-[var(--radius-control)] border border-[var(--critical)] bg-[var(--bg-floating)]/95 px-3 py-1.5 font-mono text-[11px] text-[var(--critical-bright)] shadow-lg backdrop-blur-sm">
              <Zap className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                Cascading Domino: {scenarioMeta.dominoSummary}
              </span>
            </div>
          ) : (
            <div className="inline-flex max-w-full items-center gap-2 rounded-[var(--radius-control)] border border-[var(--telemetry)] bg-[var(--bg-floating)]/95 px-3 py-1.5 font-mono text-[11px] text-[var(--telemetry-bright)] shadow-lg backdrop-blur-sm">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--healthy-bright)]" />
              <span className="truncate sm:hidden">
                Baseline Verified · Tap node or Simulate
              </span>
              <span className="hidden truncate sm:inline">
                Baseline Flow Verified · Click a node or Simulate Incident to trigger Davis AI
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ServiceTopologyGraph({
  isMobile,
  onMobileNodeTap,
}: {
  isMobile: boolean;
  onMobileNodeTap?: (nodeId: ServiceNodeId) => void;
}) {
  return (
    <ReactFlowProvider>
      <TopologyInner isMobile={isMobile} onMobileNodeTap={onMobileNodeTap} />
    </ReactFlowProvider>
  );
}
