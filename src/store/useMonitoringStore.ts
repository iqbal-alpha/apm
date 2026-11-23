'use client';

import { create } from 'zustand';
import {
  applyEffectiveImpactToMetrics,
  computeCascadingImpact,
  computeClusterHealthScore,
  computeNextBaselineMetric,
  evaluateHealthStatus,
} from '@/lib/telemetry-math';
import type {
  ActiveFault,
  ChaosScenarioId,
  ChaosScenarioMeta,
  EdgeConfig,
  EdgeTelemetry,
  IncidentTicket,
  LogEntry,
  LogLevel,
  ServiceMetrics,
  ServiceNodeConfig,
  ServiceNodeId,
  TelemetrySnapshot,
  TicketStatus,
} from '@/types/monitoring';

const STORAGE_KEY_INCIDENTS = 'sentinel_incidents_v1';
const STORAGE_KEY_COUNTER = 'sentinel_ticket_seq_v1';
const SEED_BASE_TIME = 1795360000000;

export const SERVICE_CONFIGS: Record<ServiceNodeId, ServiceNodeConfig> = {
  'web-app': {
    id: 'web-app',
    name: 'Web App Frontend',
    host: 'edge-cdn-01.prod',
    region: 'ap-southeast-1a',
    tier: 'Presentation',
    baseCpu: 18.2,
    baseLatencyMs: 24,
    baseErrorRate: 0.01,
    baseRps: 2400,
    cpuSigma: 2.1,
    latencySigma: 3.5,
    errorSigma: 0.02,
    propagationMultiplier: 920,
    desktopPos: { x: 16, y: 16 },
    mobilePos: { x: 16, y: 14 },
  },
  'api-gateway': {
    id: 'api-gateway',
    name: 'API Gateway',
    host: 'kong-gw-02.prod',
    region: 'ap-southeast-1a',
    tier: 'Ingress Policy',
    baseCpu: 22.5,
    baseLatencyMs: 18,
    baseErrorRate: 0.02,
    baseRps: 1920,
    cpuSigma: 2.4,
    latencySigma: 3.0,
    errorSigma: 0.02,
    propagationMultiplier: 1480,
    desktopPos: { x: 16, y: 274 },
    mobilePos: { x: 16, y: 198 },
  },
  'auth-service': {
    id: 'auth-service',
    name: 'Auth Service',
    host: 'keycloak-01.prod',
    region: 'ap-southeast-1b',
    tier: 'Identity & JWT',
    baseCpu: 14.1,
    baseLatencyMs: 11,
    baseErrorRate: 0.01,
    baseRps: 480,
    cpuSigma: 1.8,
    latencySigma: 2.2,
    errorSigma: 0.01,
    propagationMultiplier: 960,
    desktopPos: { x: 356, y: 20 },
    mobilePos: { x: 202, y: 382 },
  },
  'payment-service': {
    id: 'payment-service',
    name: 'Payment Service',
    host: 'pay-orchestrator.prod',
    region: 'ap-southeast-1b',
    tier: 'Core Ledger',
    baseCpu: 26.4,
    baseLatencyMs: 15,
    baseErrorRate: 0.01,
    baseRps: 1450,
    cpuSigma: 2.6,
    latencySigma: 3.2,
    errorSigma: 0.02,
    propagationMultiplier: 1720,
    desktopPos: { x: 356, y: 274 },
    mobilePos: { x: 16, y: 382 },
  },
  'postgres-db': {
    id: 'postgres-db',
    name: 'Database PostgreSQL',
    host: 'pg-primary-01.prod',
    region: 'ap-southeast-1c',
    tier: 'Primary RDS',
    baseCpu: 24.2,
    baseLatencyMs: 12,
    baseErrorRate: 0.02,
    baseRps: 1820,
    cpuSigma: 2.4,
    latencySigma: 2.8,
    errorSigma: 0.02,
    propagationMultiplier: 1850,
    desktopPos: { x: 696, y: 146 },
    mobilePos: { x: 16, y: 566 },
  },
};

export const EDGE_CONFIGS: EdgeConfig[] = [
  { id: 'e-web-gw', source: 'web-app', target: 'api-gateway', weight: 0.78, baseLatencyMs: 9, baseRps: 2400 },
  { id: 'e-gw-auth', source: 'api-gateway', target: 'auth-service', weight: 0.65, baseLatencyMs: 7, baseRps: 480 },
  { id: 'e-gw-pay', source: 'api-gateway', target: 'payment-service', weight: 0.84, baseLatencyMs: 12, baseRps: 1800 },
  { id: 'e-auth-db', source: 'auth-service', target: 'postgres-db', weight: 0.35, baseLatencyMs: 11, baseRps: 390 },
  { id: 'e-pay-db', source: 'payment-service', target: 'postgres-db', weight: 0.92, baseLatencyMs: 12, baseRps: 1800 },
];

export const CHAOS_SCENARIOS: Record<ChaosScenarioId, ChaosScenarioMeta> = {
  'SCEN-DB-CPU': {
    id: 'SCEN-DB-CPU',
    label: 'SCEN-DB-CPU · PostgreSQL CPU 98%',
    shortLabel: 'PostgreSQL CPU 98%',
    rootNodeId: 'postgres-db',
    title: 'PostgreSQL Primary Lock Contention & CPU Saturation (P1)',
    dominoSummary: 'pg-primary (T+0s) -> pay-orchestrator (T+2.5s) -> kong-gw (T+5.0s)',
    rcaSummary:
      'Detected high lock contention & 98.4% CPU saturation on pg-primary-01.prod (412 waiting workers on ledger_entries). Cascading 504 timeouts observed on pay-orchestrator and kong-gw-02.',
    remediationAction: 'kill_idle_locks_scale_pool',
  },
  'SCEN-PAY-SPIKE': {
    id: 'SCEN-PAY-SPIKE',
    label: 'SCEN-PAY-SPIKE · Payment Deadlock',
    shortLabel: 'Payment Deadlock',
    rootNodeId: 'payment-service',
    title: 'Payment Service PSP Socket Hangup & Deadlock (P1)',
    dominoSummary: 'pay-orchestrator (T+0s) -> kong-gw (T+2.5s) -> edge-cdn (T+5.0s)',
    rcaSummary:
      'Upstream PSP settlement gateway socket hangup saturated pay-orchestrator worker threads (24.8% checkout error rate). Auth and PostgreSQL baseline remain healthy.',
    remediationAction: 'trip_psp_circuit_drain_queue',
  },
  'SCEN-AUTH-LEAK': {
    id: 'SCEN-AUTH-LEAK',
    label: 'SCEN-AUTH-LEAK · Auth JWT Memory Leak',
    shortLabel: 'Auth Memory Leak',
    rootNodeId: 'auth-service',
    title: 'Auth Service JWT Signer Heap Exhaustion (P1)',
    dominoSummary: 'keycloak-01 (T+0s) -> kong-gw (T+2.5s) -> edge-cdn (T+5.0s)',
    rcaSummary:
      'JVM heap saturation on keycloak-01.prod slowed token introspection p95 from 11ms to 940ms, causing 401/503 session validation failures at kong-gw-02.',
    remediationAction: 'recycle_jwt_pods_flush_cache',
  },
  'SCEN-GW-STORM': {
    id: 'SCEN-GW-STORM',
    label: 'SCEN-GW-STORM · API Gateway Flood',
    shortLabel: 'Gateway Connection Storm',
    rootNodeId: 'api-gateway',
    title: 'API Gateway Ingress Rate-Limit & Connection Storm (P1)',
    dominoSummary: 'kong-gw (T+0s) -> edge-cdn (T+2.5s)',
    rcaSummary:
      'Anomalous 4.8x ingress burst saturated kong-gw-02.prod Epoll workers (95% CPU, 18.2% HTTP 502), causing edge timeouts on web-app checkout routes.',
    remediationAction: 'enforce_adaptive_waf_rate_limit',
  },
};

function deterministicNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function buildInitialHistory(): TelemetrySnapshot[] {
  const snaps: TelemetrySnapshot[] = [];
  const prev: Record<ServiceNodeId, ServiceMetrics> = {
    'web-app': { cpu: 18.2, latencyP95: 24, errorRate: 0.01, rps: 2400, status: 'HEALTHY', faultSeverity: 0 },
    'api-gateway': { cpu: 22.5, latencyP95: 18, errorRate: 0.02, rps: 1920, status: 'HEALTHY', faultSeverity: 0 },
    'auth-service': { cpu: 14.1, latencyP95: 11, errorRate: 0.01, rps: 480, status: 'HEALTHY', faultSeverity: 0 },
    'payment-service': { cpu: 26.4, latencyP95: 15, errorRate: 0.01, rps: 1450, status: 'HEALTHY', faultSeverity: 0 },
    'postgres-db': { cpu: 24.2, latencyP95: 12, errorRate: 0.02, rps: 1820, status: 'HEALTHY', faultSeverity: 0 },
  };

  for (let i = 0; i < 60; i++) {
    const nextNodes = {} as Record<ServiceNodeId, ServiceMetrics>;
    (Object.keys(SERVICE_CONFIGS) as ServiceNodeId[]).forEach((id, idx) => {
      const cfg = SERVICE_CONFIGS[id];
      const n1 = deterministicNoise(i * 11 + idx);
      const n2 = deterministicNoise(i * 17 + idx);
      const n3 = deterministicNoise(i * 23 + idx);
      const cpu = Number(computeNextBaselineMetric(prev[id].cpu, cfg.baseCpu, 0.35, cfg.cpuSigma, 2, 100, n1).toFixed(1));
      const latencyP95 = Math.round(computeNextBaselineMetric(prev[id].latencyP95, cfg.baseLatencyMs, 0.35, cfg.latencySigma, 1, 5000, n2));
      const errorRate = Number(computeNextBaselineMetric(prev[id].errorRate, cfg.baseErrorRate, 0.35, cfg.errorSigma, 0, 100, n3).toFixed(2));
      const rps = Math.max(20, Math.round(cfg.baseRps + deterministicNoise(i * 7 + idx) * (cfg.baseRps * 0.04)));
      const metric: ServiceMetrics = {
        cpu,
        latencyP95,
        errorRate,
        rps,
        status: evaluateHealthStatus(cpu, latencyP95, errorRate),
        faultSeverity: 0,
      };
      nextNodes[id] = metric;
      prev[id] = metric;
    });

    const edges: EdgeTelemetry[] = EDGE_CONFIGS.map((ec) => ({
      ...ec,
      latencyMs: Math.round(nextNodes[ec.target].latencyP95 * 0.72),
      rps: nextNodes[ec.target].rps,
      errorRate: nextNodes[ec.target].errorRate,
      status: nextNodes[ec.target].status,
    }));

    snaps.push({
      timestamp: SEED_BASE_TIME - (60 - i) * 1000,
      offsetSeconds: -(59 - i),
      clusterHealth: computeClusterHealthScore(nextNodes),
      nodes: nextNodes,
      edges,
    });
  }

  return snaps;
}

function buildSeedIncidents(): IncidentTicket[] {
  const base = SEED_BASE_TIME;
  return [
    {
      id: 'seed-inc-0889',
      ticketNumber: 'INC-2026-0889',
      problemId: 'P-260918',
      sourceSystem: 'Dynatrace Davis AI',
      targetItsm: 'BMC Helix ITSM',
      severity: 'P1',
      status: 'RESOLVED',
      scenarioId: 'SCEN-DB-CPU',
      rootNodeId: 'postgres-db',
      affectedServices: ['postgres-db', 'payment-service', 'api-gateway'],
      title: 'PostgreSQL Autovacuum Wraparound Lock Contention',
      rootCauseSummary:
        'Long-running analytic query held AccessExclusiveLock on ledger_entries, saturating PgBouncer pool.',
      webhookPayload: {
        source: 'dynatrace_davis_ai',
        problemId: 'P-260918',
        bmcIncident: 'INC-2026-0889',
        status: 'RESOLVED',
        mttrSeconds: 68,
        remediation: 'kill_idle_locks_scale_pool',
        rootCauseEntity: 'pg-primary-01.prod',
      },
      slaTargetSeconds: 900,
      slaBreached: false,
      triggeredAt: base - 7200_000,
      acknowledgedAt: base - 7180_000,
      resolvedAt: base - 7132_000,
      mttrSeconds: 68,
      activityLogs: [
        {
          id: 'al-889-1',
          ticketId: 'seed-inc-0889',
          actor: 'Dynatrace Bridge',
          actionType: 'AUTO_CREATED',
          message: 'Problem P-260918 detected -> BMC Helix INC-2026-0889 (201 CREATED)',
          createdAt: '12:21:08Z',
        },
        {
          id: 'al-889-2',
          ticketId: 'seed-inc-0889',
          actor: 'AIOps Auto-Remediation',
          actionType: 'AUTO_MITIGATED',
          fromStatus: 'INVESTIGATING',
          toStatus: 'RESOLVED',
          message: 'Terminated 412 idle locks & scaled PgBouncer pool (MTTR 68s)',
          createdAt: '12:22:16Z',
        },
      ],
    },
    {
      id: 'seed-inc-0887',
      ticketNumber: 'INC-2026-0887',
      problemId: 'P-260744',
      sourceSystem: 'Dynatrace Davis AI',
      targetItsm: 'BMC Helix ITSM',
      severity: 'P2',
      status: 'RESOLVED',
      scenarioId: 'SCEN-PAY-SPIKE',
      rootNodeId: 'payment-service',
      affectedServices: ['payment-service', 'api-gateway'],
      title: 'PSP Webhook Timeout Elevated 504 Rate',
      rootCauseSummary: 'Downstream issuer retry storm cleared via circuit breaker.',
      webhookPayload: {
        source: 'dynatrace_davis_ai',
        problemId: 'P-260744',
        bmcIncident: 'INC-2026-0887',
        status: 'RESOLVED',
        mttrSeconds: 112,
        remediation: 'trip_psp_circuit_drain_queue',
        rootCauseEntity: 'pay-orchestrator.prod',
      },
      slaTargetSeconds: 900,
      slaBreached: false,
      triggeredAt: base - 18000_000,
      acknowledgedAt: base - 17965_000,
      resolvedAt: base - 17888_000,
      mttrSeconds: 112,
      activityLogs: [
        {
          id: 'al-887-1',
          ticketId: 'seed-inc-0887',
          actor: 'AIOps Auto-Remediation',
          actionType: 'AUTO_MITIGATED',
          fromStatus: 'OPEN',
          toStatus: 'RESOLVED',
          message: 'Tripped PSP failover route & drained queue (MTTR 112s)',
          createdAt: '09:14:12Z',
        },
      ],
    },
    {
      id: 'seed-inc-0884',
      ticketNumber: 'INC-2026-0884',
      problemId: 'P-260512',
      sourceSystem: 'Dynatrace Davis AI',
      targetItsm: 'BMC Helix ITSM',
      severity: 'P2',
      status: 'RESOLVED',
      scenarioId: 'SCEN-AUTH-LEAK',
      rootNodeId: 'auth-service',
      affectedServices: ['auth-service', 'api-gateway'],
      title: 'Keycloak JWKS Signing Key Cache Eviction Spike',
      rootCauseSummary: 'JWT signer heap pressure mitigated via rolling pod recycle.',
      webhookPayload: {
        source: 'dynatrace_davis_ai',
        problemId: 'P-260512',
        bmcIncident: 'INC-2026-0884',
        status: 'RESOLVED',
        mttrSeconds: 94,
        remediation: 'recycle_jwt_pods_flush_cache',
        rootCauseEntity: 'keycloak-01.prod',
      },
      slaTargetSeconds: 900,
      slaBreached: false,
      triggeredAt: base - 32000_000,
      acknowledgedAt: base - 31960_000,
      resolvedAt: base - 31906_000,
      mttrSeconds: 94,
      activityLogs: [
        {
          id: 'al-884-1',
          ticketId: 'seed-inc-0884',
          actor: 'SRE Operator',
          actionType: 'AUTO_MITIGATED',
          fromStatus: 'INVESTIGATING',
          toStatus: 'RESOLVED',
          message: 'Recycled auth signer pods; p95 normalized to 11ms (MTTR 94s)',
          createdAt: '05:20:04Z',
        },
      ],
    },
  ];
}

function buildSeedLogs(): LogEntry[] {
  const fmt = (offsetSec: number) => {
    const d = new Date(SEED_BASE_TIME - offsetSec * 1000);
    return d.toISOString().slice(11, 23) + 'Z';
  };
  return [
    {
      id: 'seed-log-1',
      timestamp: fmt(6),
      timestampMs: SEED_BASE_TIME - 6000,
      level: 'INFO',
      serviceId: 'postgres-db',
      serviceName: 'pg-primary',
      traceId: 'tr-4c12a80e',
      message: 'Checkpoint complete: wrote 124 buffers (0.8%); replication lag 0.4ms',
    },
    {
      id: 'seed-log-2',
      timestamp: fmt(5),
      timestampMs: SEED_BASE_TIME - 5000,
      level: 'INFO',
      serviceId: 'payment-service',
      serviceName: 'pay-orchestrator',
      traceId: 'tr-4c12a80e',
      message: 'ACID settlement committed order=ORD-89412 p95=15ms status=200',
    },
    {
      id: 'seed-log-3',
      timestamp: fmt(4),
      timestampMs: SEED_BASE_TIME - 4000,
      level: 'INFO',
      serviceId: 'auth-service',
      serviceName: 'keycloak-01',
      traceId: 'tr-71bb03d2',
      message: 'JWKS RS256 token verification cache hit ratio 99.4% p95=11ms',
    },
    {
      id: 'seed-log-4',
      timestamp: fmt(3),
      timestampMs: SEED_BASE_TIME - 3000,
      level: 'INFO',
      serviceId: 'api-gateway',
      serviceName: 'kong-gateway',
      traceId: 'tr-4c12a80e',
      message: 'Ingress healthchecks 5/5 passing; edge throughput 1.9k rps SLA=99.9%',
    },
    {
      id: 'seed-log-5',
      timestamp: fmt(2),
      timestampMs: SEED_BASE_TIME - 2000,
      level: 'INFO',
      serviceId: 'web-app',
      serviceName: 'webapp-edge',
      traceId: 'tr-4c12a80e',
      message: 'Edge checkout TTFB=24ms across ap-southeast-1a PoPs (within 120ms SLO)',
    },
  ];
}

function formatUtcTime(ms: number): string {
  return new Date(ms).toISOString().slice(11, 23) + 'Z';
}

function makeShortId(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2, 8)}`;
}

function persistIncidentsToStorage(incidents: IncidentTicket[], seq: number) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY_INCIDENTS, JSON.stringify(incidents));
    window.localStorage.setItem(STORAGE_KEY_COUNTER, String(seq));
  } catch {
    // Ignore storage quota errors safely
  }
}

function computeNextTicketSeq(incidents: IncidentTicket[], minSeq = 891): number {
  let maxSeq = minSeq - 1;
  for (const t of incidents) {
    const match = /^INC-2026-(\d+)$/.exec(t.ticketNumber);
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > maxSeq) {
        maxSeq = parsed;
      }
    }
  }
  return Math.max(minSeq, maxSeq + 1);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 3000
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface MonitoringStoreState {
  currentMetrics: Record<ServiceNodeId, ServiceMetrics>;
  currentEdges: EdgeTelemetry[];
  clusterHealth: number;
  liveSnapshot: TelemetrySnapshot;
  historyBuffer: TelemetrySnapshot[];
  logs: LogEntry[];

  selectedNodeId: ServiceNodeId | null;
  highlightedTraceId: string | null;
  replayOffsetSeconds: number; // 0 = LIVE, -1..-119 = REPLAY
  isLogPaused: boolean;
  logLevelFilter: 'ALL' | 'WARN+' | 'ERROR/FATAL';

  activeScenario: ChaosScenarioId;
  activeFaults: Partial<Record<ServiceNodeId, ActiveFault>>;
  ticketCreatedForFaultAt: number | null;
  incidents: IncidentTicket[];
  selectedIncidentId: string;
  ticketSeq: number;

  bridgeDispatching: boolean;
  mitigating: boolean;
  syncMode: 'SUPABASE_SYNCED' | 'LOCAL_CACHE';
  nowMs: number;

  // Actions
  hydrateClient: () => void;
  tick: () => void;
  selectNode: (nodeId: ServiceNodeId | null) => void;
  setActiveScenario: (scenarioId: ChaosScenarioId) => void;
  injectNodeFault: (nodeId: ServiceNodeId, scenarioId?: ChaosScenarioId) => void;
  triggerChaosScenario: (scenarioId?: ChaosScenarioId) => void;
  mitigateNode: (nodeId: ServiceNodeId) => void;
  executeAutoMitigation: () => void;
  updateIncidentStatus: (ticketId: string, nextStatus: TicketStatus) => void;
  addIncidentWorkNote: (ticketId: string, note: string) => void;
  selectIncident: (ticketId: string) => void;
  setReplayOffset: (offsetSeconds: number) => void;
  resumeLive: () => void;
  toggleLogPause: () => void;
  clearLogs: () => void;
  setLogLevelFilter: (filter: 'ALL' | 'WARN+' | 'ERROR/FATAL') => void;
  highlightTrace: (traceId: string | null) => void;
}

const initialHistory = buildInitialHistory();
const initialLatest = initialHistory[initialHistory.length - 1];
const initialSeedIncidents = buildSeedIncidents();

export const useMonitoringStore = create<MonitoringStoreState>((set, get) => ({
  currentMetrics: initialLatest.nodes,
  currentEdges: initialLatest.edges,
  clusterHealth: initialLatest.clusterHealth,
  liveSnapshot: initialLatest,
  historyBuffer: initialHistory,
  logs: buildSeedLogs(),

  selectedNodeId: null,
  highlightedTraceId: null,
  replayOffsetSeconds: 0,
  isLogPaused: false,
  logLevelFilter: 'ALL',

  activeScenario: 'SCEN-DB-CPU',
  activeFaults: {},
  ticketCreatedForFaultAt: null,
  incidents: initialSeedIncidents,
  selectedIncidentId: initialSeedIncidents[0].id,
  ticketSeq: 891,

  bridgeDispatching: false,
  mitigating: false,
  syncMode: 'LOCAL_CACHE',
  nowMs: SEED_BASE_TIME,

  hydrateClient: () => {
    if (typeof window === 'undefined') return;
    try {
      const savedIncidents = window.localStorage.getItem(STORAGE_KEY_INCIDENTS);
      const savedSeq = window.localStorage.getItem(STORAGE_KEY_COUNTER);
      if (savedIncidents) {
        const parsed = JSON.parse(savedIncidents) as IncidentTicket[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          set({
            incidents: parsed,
            selectedIncidentId: parsed[0].id,
            ticketSeq: computeNextTicketSeq(parsed, savedSeq ? Number(savedSeq) : 891),
            nowMs: Date.now(),
          });
        }
      } else {
        set({ nowMs: Date.now() });
      }
    } catch {
      set({ nowMs: Date.now() });
    }

    // Background cloud hydration from Supabase via Next.js Route Handler
    void (async () => {
      try {
        const res = await fetchWithTimeout('/api/incidents', { method: 'GET', cache: 'no-store' }, 3000);
        if (!res.ok) {
          set({ syncMode: 'LOCAL_CACHE' });
          return;
        }
        const data = (await res.json()) as {
          configured?: boolean;
          mode?: 'SUPABASE_SYNCED' | 'LOCAL_CACHE';
          tickets?: IncidentTicket[];
        };

        if (data.mode === 'SUPABASE_SYNCED' && Array.isArray(data.tickets)) {
          set((s) => {
            const dbTickets = data.tickets!;
            if (dbTickets.length === 0) {
              return { syncMode: 'SUPABASE_SYNCED' };
            }
            const dbNumbers = new Set(dbTickets.map((t) => t.ticketNumber));
            const unsyncedLocal = s.incidents.filter(
              (t) => !t.id.startsWith('seed-') && !dbNumbers.has(t.ticketNumber)
            );
            const merged = [...unsyncedLocal, ...dbTickets];
            const nextSeq = computeNextTicketSeq(merged, 891);
            persistIncidentsToStorage(merged, nextSeq);
            return {
              incidents: merged,
              selectedIncidentId: merged[0]?.id ?? s.selectedIncidentId,
              ticketSeq: nextSeq,
              syncMode: 'SUPABASE_SYNCED',
            };
          });
        } else {
          set({ syncMode: 'LOCAL_CACHE' });
        }
      } catch {
        set({ syncMode: 'LOCAL_CACHE' });
      }
    })();
  },

  tick: () => {
    const state = get();
    if (state.replayOffsetSeconds < 0) {
      // Keep wall clock advancing while replay view stays frozen
      set({ nowMs: Date.now() });
      return;
    }

    const nowMs = Date.now();
    const nextNodes = {} as Record<ServiceNodeId, ServiceMetrics>;
    const faults = state.activeFaults;
    let highestFaultStart: number | null = null;
    let rootFaultNode: ServiceNodeId | null = null;
    let activeScenarioForFault: ChaosScenarioId = state.activeScenario;

    for (const f of Object.values(faults)) {
      if (f && (!highestFaultStart || f.injectedAt < highestFaultStart)) {
        highestFaultStart = f.injectedAt;
        rootFaultNode = f.nodeId;
        if (f.scenarioId !== 'MANUAL_SPIKE') {
          activeScenarioForFault = f.scenarioId;
        }
      }
    }

    for (const id of Object.keys(SERVICE_CONFIGS) as ServiceNodeId[]) {
      const cfg = SERVICE_CONFIGS[id];
      const prev = state.currentMetrics[id];
      const baseCpu = computeNextBaselineMetric(prev.cpu, cfg.baseCpu, 0.35, cfg.cpuSigma, 2, 100);
      const baseLat = computeNextBaselineMetric(
        prev.latencyP95,
        cfg.baseLatencyMs,
        0.35,
        cfg.latencySigma,
        1,
        5000
      );
      const baseErr = computeNextBaselineMetric(
        prev.errorRate,
        cfg.baseErrorRate,
        0.35,
        cfg.errorSigma,
        0,
        100
      );
      const baseRps = Math.max(20, cfg.baseRps + (Math.random() * 2 - 1) * cfg.baseRps * 0.05);

      const { effectiveImpact } = computeCascadingImpact(id, faults, nowMs, 2500);
      nextNodes[id] = applyEffectiveImpactToMetrics(
        { cpu: baseCpu, latencyP95: baseLat, errorRate: baseErr, rps: baseRps },
        effectiveImpact,
        cfg.propagationMultiplier
      );
    }

    const nextEdges: EdgeTelemetry[] = EDGE_CONFIGS.map((ec) => {
      const targetMetric = nextNodes[ec.target];
      const sourceMetric = nextNodes[ec.source];
      const worseStatus =
        targetMetric.status === 'CRITICAL' || sourceMetric.status === 'CRITICAL'
          ? 'CRITICAL'
          : targetMetric.status === 'DEGRADED' || sourceMetric.status === 'DEGRADED'
          ? 'DEGRADED'
          : 'HEALTHY';

      return {
        ...ec,
        latencyMs: Math.max(2, Math.round(targetMetric.latencyP95 * 0.78)),
        rps: targetMetric.rps,
        errorRate: Number(Math.max(targetMetric.errorRate, sourceMetric.errorRate * 0.65).toFixed(2)),
        status: worseStatus,
      };
    });

    const clusterHealth = computeClusterHealthScore(nextNodes);

    // T+1.2s Dynatrace Davis AI -> BMC Helix auto-create P1 ticket check
    let nextIncidents = state.incidents;
    let nextSelectedId = state.selectedIncidentId;
    let nextSeq = state.ticketSeq;
    let nextTicketCreatedAt = state.ticketCreatedForFaultAt;
    let nextDispatching = false;
    let eventPin: TelemetrySnapshot['eventPin'];

    if (
      highestFaultStart &&
      rootFaultNode &&
      state.ticketCreatedForFaultAt !== highestFaultStart &&
      nowMs - highestFaultStart >= 1100
    ) {
      const openTicket = state.incidents.find(
        (t) => t.status !== 'RESOLVED' && t.rootNodeId === rootFaultNode
      );

      if (!openTicket) {
        const scenarioMeta = CHAOS_SCENARIOS[activeScenarioForFault];
        const ticketNumber = `INC-2026-${String(state.ticketSeq).padStart(4, '0')}`;
        const problemId = `P-${261142 + (state.ticketSeq - 891)}`;
        const newId = `inc-${nowMs}`;

        const impacted: ServiceNodeId[] = [rootFaultNode];
        if (rootFaultNode === 'postgres-db') {
          impacted.push('payment-service', 'api-gateway', 'web-app');
        } else if (rootFaultNode === 'payment-service' || rootFaultNode === 'auth-service') {
          impacted.push('api-gateway', 'web-app');
        } else if (rootFaultNode === 'api-gateway') {
          impacted.push('web-app');
        }

        const newTicket: IncidentTicket = {
          id: newId,
          ticketNumber,
          problemId,
          sourceSystem: 'Dynatrace Davis AI',
          targetItsm: 'BMC Helix ITSM',
          severity: 'P1',
          status: 'OPEN',
          scenarioId: activeScenarioForFault,
          rootNodeId: rootFaultNode,
          affectedServices: impacted,
          title:
            scenarioMeta.rootNodeId === rootFaultNode
              ? scenarioMeta.title
              : `${SERVICE_CONFIGS[rootFaultNode].name} Critical Saturation Breach (P1)`,
          rootCauseSummary:
            scenarioMeta.rootNodeId === rootFaultNode
              ? scenarioMeta.rcaSummary
              : `Critical threshold breach injected on ${SERVICE_CONFIGS[rootFaultNode].host} propagating latency & errors upstream.`,
          webhookPayload: {
            source: 'dynatrace_davis_ai',
            problemId,
            bmcIncident: ticketNumber,
            status: 'OPEN',
            severity: 'P1',
            scenario: activeScenarioForFault,
            rootCauseEntity: SERVICE_CONFIGS[rootFaultNode].host,
            impactedEntities: impacted.map((id) => SERVICE_CONFIGS[id].host),
            httpResponse: '201 CREATED',
          },
          slaTargetSeconds: 900,
          slaBreached: false,
          triggeredAt: nowMs,
          acknowledgedAt: null,
          resolvedAt: null,
          mttrSeconds: null,
          activityLogs: [
            {
              id: makeShortId('al'),
              ticketId: newId,
              actor: 'Dynatrace Davis AI',
              actionType: 'AUTO_CREATED',
              toStatus: 'OPEN',
              message: `Problem ${problemId} correlated -> BMC Helix Webhook 201 CREATED (${ticketNumber})`,
              createdAt: formatUtcTime(nowMs),
            },
            {
              id: makeShortId('al'),
              ticketId: newId,
              actor: 'AIOps Cascade Engine',
              actionType: 'CASCADE_DETECTED',
              message: `Upstream blast radius mapped across ${impacted.length} services`,
              createdAt: formatUtcTime(nowMs),
            },
          ],
        };

        nextIncidents = [newTicket, ...state.incidents];
        nextSelectedId = newTicket.id;
        nextSeq = state.ticketSeq + 1;
        nextTicketCreatedAt = highestFaultStart;
        nextDispatching = true;
        eventPin = 'P1_CREATED';
        persistIncidentsToStorage(nextIncidents, nextSeq);

        // Optimistic 0ms UI + background cloud sync to Supabase
        void (async () => {
          try {
            const res = await fetchWithTimeout(
              '/api/incidents',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newTicket),
              },
              3000
            );
            if (!res.ok) {
              set({ syncMode: 'LOCAL_CACHE' });
              return;
            }
            const json = (await res.json()) as { synced?: boolean; ticket?: IncidentTicket };
            if (json.synced && json.ticket) {
              set((s) => {
                const updated = s.incidents.map((item) =>
                  item.ticketNumber === json.ticket!.ticketNumber
                    ? { ...item, id: json.ticket!.id }
                    : item
                );
                persistIncidentsToStorage(updated, s.ticketSeq);
                return {
                  incidents: updated,
                  selectedIncidentId:
                    s.selectedIncidentId === newId ? json.ticket!.id : s.selectedIncidentId,
                  syncMode: 'SUPABASE_SYNCED',
                };
              });
            } else {
              set({ syncMode: 'LOCAL_CACHE' });
            }
          } catch {
            set({ syncMode: 'LOCAL_CACHE' });
          }
        })();
      } else {
        nextTicketCreatedAt = highestFaultStart;
      }
    }

    // Ring buffer push (keep latest 120 snapshots)
    const snapshot: TelemetrySnapshot = {
      timestamp: nowMs,
      offsetSeconds: 0,
      clusterHealth,
      nodes: nextNodes,
      edges: nextEdges,
      eventPin: eventPin ?? (highestFaultStart && nowMs - highestFaultStart < 1100 ? 'ANOMALY_START' : undefined),
    };

    const rawBuffer = [...state.historyBuffer.slice(-119), snapshot];
    const total = rawBuffer.length;
    const historyBuffer = rawBuffer.map((snap, idx) => ({
      ...snap,
      offsetSeconds: -(total - 1 - idx),
    }));

    // Emit realistic live correlated log line unless paused
    let nextLogs = state.logs;
    if (!state.isLogPaused) {
      const traceId = highestFaultStart ? 'tr-9f8a2c1e' : `tr-${Math.floor((nowMs / 1000) % 9000 + 1000).toString(16)}a4`;
      const criticalEntry = (Object.keys(SERVICE_CONFIGS) as ServiceNodeId[]).find(
        (id) => nextNodes[id].status === 'CRITICAL'
      );
      const degradedEntry = (Object.keys(SERVICE_CONFIGS) as ServiceNodeId[]).find(
        (id) => nextNodes[id].status === 'DEGRADED'
      );

      let newLog: LogEntry;
      if (criticalEntry) {
        const cfg = SERVICE_CONFIGS[criticalEntry];
        const m = nextNodes[criticalEntry];
        const level: LogLevel = criticalEntry === rootFaultNode ? 'FATAL' : 'ERROR';
        newLog = {
          id: makeShortId('log'),
          timestamp: formatUtcTime(nowMs),
          timestampMs: nowMs,
          level,
          serviceId: criticalEntry,
          serviceName: cfg.host.split('.')[0],
          traceId,
          message:
            criticalEntry === 'postgres-db'
              ? `FATAL: lock wait saturation on ${cfg.host} (cpu=${m.cpu.toFixed(1)}%, p95=${m.latencyP95}ms, err=${m.errorRate.toFixed(2)}%)`
              : `Upstream timeout calling dependency from ${cfg.host} p95=${m.latencyP95}ms err_rate=${m.errorRate.toFixed(2)}% (circuit HALF-OPEN)`,
        };
      } else if (degradedEntry) {
        const cfg = SERVICE_CONFIGS[degradedEntry];
        const m = nextNodes[degradedEntry];
        newLog = {
          id: makeShortId('log'),
          timestamp: formatUtcTime(nowMs),
          timestampMs: nowMs,
          level: 'WARN',
          serviceId: degradedEntry,
          serviceName: cfg.host.split('.')[0],
          traceId,
          message: `SLO latency warning on ${cfg.host}: p95=${m.latencyP95}ms err=${m.errorRate.toFixed(2)}% (upstream domino impact)`,
        };
      } else {
        const cycleIds: ServiceNodeId[] = ['web-app', 'api-gateway', 'auth-service', 'payment-service', 'postgres-db'];
        const chosenId = cycleIds[Math.floor(nowMs / 1000) % cycleIds.length];
        const cfg = SERVICE_CONFIGS[chosenId];
        const m = nextNodes[chosenId];
        newLog = {
          id: makeShortId('log'),
          timestamp: formatUtcTime(nowMs),
          timestampMs: nowMs,
          level: 'INFO',
          serviceId: chosenId,
          serviceName: cfg.host.split('.')[0],
          traceId,
          message: `Healthcheck OK ${cfg.host} cpu=${m.cpu.toFixed(1)}% p95=${m.latencyP95}ms rps=${m.rps}`,
        };
      }

      nextLogs = [newLog, ...state.logs].slice(0, 150);
    }

    set({
      currentMetrics: nextNodes,
      currentEdges: nextEdges,
      clusterHealth,
      liveSnapshot: snapshot,
      historyBuffer,
      logs: nextLogs,
      incidents: nextIncidents,
      selectedIncidentId: nextSelectedId,
      ticketSeq: nextSeq,
      ticketCreatedForFaultAt: nextTicketCreatedAt,
      bridgeDispatching: nextDispatching,
      nowMs,
    });
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  setActiveScenario: (scenarioId) => set({ activeScenario: scenarioId }),

  injectNodeFault: (nodeId, scenarioId) => {
    const nowMs = Date.now();
    const state = get();
    const chosenScenario = scenarioId ?? state.activeScenario;
    const cfg = SERVICE_CONFIGS[nodeId];
    const nextFaults: Partial<Record<ServiceNodeId, ActiveFault>> = {
      ...state.activeFaults,
      [nodeId]: {
        nodeId,
        scenarioId: chosenScenario,
        severity: 1.0,
        injectedAt: nowMs,
      },
    };

    // Immediate T+0s visual feedback on faulted node
    const prev = state.currentMetrics[nodeId];
    const spiked = applyEffectiveImpactToMetrics(
      { cpu: prev.cpu, latencyP95: prev.latencyP95, errorRate: prev.errorRate, rps: prev.rps },
      1.0,
      cfg.propagationMultiplier
    );
    const nextNodes = { ...state.currentMetrics, [nodeId]: spiked };
    const clusterHealth = computeClusterHealthScore(nextNodes);
    const faultSnapshot: TelemetrySnapshot = {
      timestamp: nowMs,
      offsetSeconds: 0,
      clusterHealth,
      nodes: nextNodes,
      edges: state.currentEdges,
      eventPin: 'ANOMALY_START',
    };
    const injectLog: LogEntry = {
      id: makeShortId('log'),
      timestamp: formatUtcTime(nowMs),
      timestampMs: nowMs,
      level: 'FATAL',
      serviceId: nodeId,
      serviceName: cfg.host.split('.')[0],
      traceId: 'tr-9f8a2c1e',
      message: `Chaos Fault Injected on ${cfg.host} (${chosenScenario}): cpu=${spiked.cpu.toFixed(1)}% p95=${spiked.latencyP95}ms`,
    };

    set({
      activeFaults: nextFaults,
      selectedNodeId: nodeId,
      replayOffsetSeconds: 0,
      currentMetrics: nextNodes,
      clusterHealth,
      liveSnapshot: faultSnapshot,
      logs: [injectLog, ...state.logs].slice(0, 150),
      nowMs,
    });
  },

  triggerChaosScenario: (scenarioId) => {
    const state = get();
    const targetScenario = scenarioId ?? state.activeScenario;
    const meta = CHAOS_SCENARIOS[targetScenario];
    set({ activeScenario: targetScenario, activeFaults: {}, ticketCreatedForFaultAt: null });
    get().injectNodeFault(meta.rootNodeId, targetScenario);
  },

  mitigateNode: (nodeId) => {
    const state = get();
    const remainingFaults = { ...state.activeFaults };
    delete remainingFaults[nodeId];
    if (Object.keys(remainingFaults).length === 0) {
      get().executeAutoMitigation();
      return;
    }
    set({ activeFaults: remainingFaults });
  },

  executeAutoMitigation: () => {
    const state = get();
    const nowMs = Date.now();
    set({ mitigating: true });

    const mitigatedNodes = {} as Record<ServiceNodeId, ServiceMetrics>;
    for (const id of Object.keys(SERVICE_CONFIGS) as ServiceNodeId[]) {
      const cfg = SERVICE_CONFIGS[id];
      mitigatedNodes[id] = {
        cpu: cfg.baseCpu,
        latencyP95: cfg.baseLatencyMs,
        errorRate: cfg.baseErrorRate,
        rps: cfg.baseRps,
        status: 'HEALTHY',
        faultSeverity: 0,
      };
    }

    const mitigatedEdges: EdgeTelemetry[] = EDGE_CONFIGS.map((ec) => ({
      ...ec,
      latencyMs: ec.baseLatencyMs,
      rps: ec.baseRps,
      errorRate: 0.01,
      status: 'HEALTHY',
    }));

    const nextIncidents = state.incidents.map((t) => {
      if (t.status === 'RESOLVED') return t;
      const mttr = Math.max(12, Math.floor((nowMs - t.triggeredAt) / 1000));
      return {
        ...t,
        status: 'RESOLVED' as TicketStatus,
        resolvedAt: nowMs,
        mttrSeconds: mttr,
        webhookPayload: {
          ...t.webhookPayload,
          status: 'RESOLVED',
          mttrSeconds: mttr,
        },
        activityLogs: [
          ...t.activityLogs,
          {
            id: makeShortId('al'),
            ticketId: t.id,
            actor: 'AIOps Auto-Remediation',
            actionType: 'AUTO_MITIGATED' as const,
            fromStatus: t.status,
            toStatus: 'RESOLVED' as TicketStatus,
            message: `Auto-mitigation sweep executed; all SLOs restored (MTTR ${mttr}s)`,
            createdAt: formatUtcTime(nowMs),
          },
        ],
      };
    });

    persistIncidentsToStorage(nextIncidents, state.ticketSeq);

    // Sync resolved tickets to Supabase in background
    const newlyResolved = nextIncidents.filter(
      (item) =>
        item.status === 'RESOLVED' &&
        state.incidents.some((prev) => prev.id === item.id && prev.status !== 'RESOLVED')
    );
    for (const resolvedTicket of newlyResolved) {
      void (async () => {
        try {
          const res = await fetchWithTimeout(
            `/api/incidents/${encodeURIComponent(resolvedTicket.id)}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                status: 'RESOLVED',
                autoMitigate: true,
                mttrSeconds: resolvedTicket.mttrSeconds,
                ticketNumber: resolvedTicket.ticketNumber,
              }),
            },
            3000
          );
          if (res.ok) {
            const json = (await res.json()) as { synced?: boolean };
            set({ syncMode: json.synced ? 'SUPABASE_SYNCED' : 'LOCAL_CACHE' });
          } else {
            set({ syncMode: 'LOCAL_CACHE' });
          }
        } catch {
          set({ syncMode: 'LOCAL_CACHE' });
        }
      })();
    }

    const recoveryLog: LogEntry = {
      id: makeShortId('log'),
      timestamp: formatUtcTime(nowMs),
      timestampMs: nowMs,
      level: 'INFO',
      serviceId: 'postgres-db',
      serviceName: 'aiops-remediator',
      traceId: 'tr-9f8a2c1e',
      message: `Auto-Mitigation completed: faults cleared, connection pool warmed, upstream latency stabilized`,
    };

    const snap: TelemetrySnapshot = {
      timestamp: nowMs,
      offsetSeconds: 0,
      clusterHealth: computeClusterHealthScore(mitigatedNodes),
      nodes: mitigatedNodes,
      edges: mitigatedEdges,
      eventPin: 'MITIGATED',
    };

    const rawBuffer = [...state.historyBuffer.slice(-119), snap];
    const historyBuffer = rawBuffer.map((item, idx) => ({
      ...item,
      offsetSeconds: -(rawBuffer.length - 1 - idx),
    }));

    set({
      activeFaults: {},
      ticketCreatedForFaultAt: null,
      currentMetrics: mitigatedNodes,
      currentEdges: mitigatedEdges,
      clusterHealth: snap.clusterHealth,
      liveSnapshot: snap,
      historyBuffer,
      incidents: nextIncidents,
      logs: [recoveryLog, ...state.logs].slice(0, 150),
      replayOffsetSeconds: 0,
      nowMs,
    });

    setTimeout(() => {
      set({ mitigating: false });
    }, 650);
  },

  updateIncidentStatus: (ticketId, nextStatus) => {
    const state = get();
    const nowMs = Date.now();
    const target = state.incidents.find((t) => t.id === ticketId);
    if (!target || target.status === nextStatus) return;

    if (nextStatus === 'RESOLVED' && Object.keys(state.activeFaults).length > 0) {
      get().executeAutoMitigation();
      return;
    }

    const updated = state.incidents.map((t) => {
      if (t.id !== ticketId) return t;
      const mttr =
        nextStatus === 'RESOLVED' ? Math.max(1, Math.floor((nowMs - t.triggeredAt) / 1000)) : t.mttrSeconds;
      return {
        ...t,
        status: nextStatus,
        acknowledgedAt: nextStatus === 'INVESTIGATING' && !t.acknowledgedAt ? nowMs : t.acknowledgedAt,
        resolvedAt: nextStatus === 'RESOLVED' ? nowMs : t.resolvedAt,
        mttrSeconds: mttr,
        activityLogs: [
          ...t.activityLogs,
          {
            id: makeShortId('al'),
            ticketId: t.id,
            actor: 'SRE Operator',
            actionType: 'STATUS_CHANGE' as const,
            fromStatus: t.status,
            toStatus: nextStatus,
            message: `Ticket status transitioned ${t.status} -> ${nextStatus}`,
            createdAt: formatUtcTime(nowMs),
          },
        ],
      };
    });

    persistIncidentsToStorage(updated, state.ticketSeq);
    set({ incidents: updated, nowMs });

    void (async () => {
      try {
        const res = await fetchWithTimeout(
          `/api/incidents/${encodeURIComponent(target.id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: nextStatus,
              ticketNumber: target.ticketNumber,
            }),
          },
          3000
        );
        if (res.ok) {
          const json = (await res.json()) as { synced?: boolean };
          set({ syncMode: json.synced ? 'SUPABASE_SYNCED' : 'LOCAL_CACHE' });
        } else {
          set({ syncMode: 'LOCAL_CACHE' });
        }
      } catch {
        set({ syncMode: 'LOCAL_CACHE' });
      }
    })();
  },

  addIncidentWorkNote: (ticketId, note) => {
    const trimmed = note.trim();
    if (!trimmed) return;
    const state = get();
    const nowMs = Date.now();
    const target = state.incidents.find((t) => t.id === ticketId);

    const updated = state.incidents.map((t) => {
      if (t.id !== ticketId) return t;
      return {
        ...t,
        activityLogs: [
          ...t.activityLogs,
          {
            id: makeShortId('al'),
            ticketId: t.id,
            actor: 'SRE Operator',
            actionType: 'WORK_NOTE' as const,
            message: trimmed,
            createdAt: formatUtcTime(nowMs),
          },
        ],
      };
    });

    persistIncidentsToStorage(updated, state.ticketSeq);
    set({ incidents: updated, nowMs });

    void (async () => {
      try {
        const res = await fetchWithTimeout(
          `/api/incidents/${encodeURIComponent(ticketId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workNote: trimmed,
              ticketNumber: target?.ticketNumber,
            }),
          },
          3000
        );
        if (res.ok) {
          const json = (await res.json()) as { synced?: boolean };
          set({ syncMode: json.synced ? 'SUPABASE_SYNCED' : 'LOCAL_CACHE' });
        } else {
          set({ syncMode: 'LOCAL_CACHE' });
        }
      } catch {
        set({ syncMode: 'LOCAL_CACHE' });
      }
    })();
  },

  selectIncident: (ticketId) => set({ selectedIncidentId: ticketId }),

  setReplayOffset: (offsetSeconds) => {
    const clamped = Math.min(0, Math.max(-119, Math.round(offsetSeconds)));
    set({ replayOffsetSeconds: clamped });
  },

  resumeLive: () => set({ replayOffsetSeconds: 0 }),

  toggleLogPause: () => set((s) => ({ isLogPaused: !s.isLogPaused })),

  clearLogs: () => set({ logs: [] }),

  setLogLevelFilter: (filter) => set({ logLevelFilter: filter }),

  highlightTrace: (traceId) =>
    set((s) => ({ highlightedTraceId: s.highlightedTraceId === traceId ? null : traceId })),
}));

/**
 * Resolve displayed snapshot frame (Live or Scrubbed Time-Travel Replay)
 */
export function selectActiveSnapshot(state: MonitoringStoreState): TelemetrySnapshot {
  if (state.replayOffsetSeconds < 0 && state.historyBuffer.length > 0) {
    const targetIdx = Math.max(
      0,
      Math.min(state.historyBuffer.length - 1, state.historyBuffer.length - 1 + state.replayOffsetSeconds)
    );
    return state.historyBuffer[targetIdx];
  }
  return state.liveSnapshot;
}
