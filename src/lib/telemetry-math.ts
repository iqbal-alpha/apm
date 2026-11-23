import type {
  ActiveFault,
  HealthStatus,
  ServiceMetrics,
  ServiceNodeId,
  TicketStatus,
} from '@/types/monitoring';

export const NODE_CRITICALITY_WEIGHTS: Record<ServiceNodeId, number> = {
  'postgres-db': 0.28,
  'payment-service': 0.25,
  'api-gateway': 0.20,
  'auth-service': 0.15,
  'web-app': 0.12,
};

/**
 * Upstream adjacency map: edge from child (target) -> list of upstream parents with hop weight
 */
export const DEPENDENCY_PARENTS: Record<
  ServiceNodeId,
  Array<{ parent: ServiceNodeId; weight: number }>
> = {
  'postgres-db': [
    { parent: 'payment-service', weight: 0.92 },
    { parent: 'auth-service', weight: 0.35 },
  ],
  'payment-service': [{ parent: 'api-gateway', weight: 0.84 }],
  'auth-service': [{ parent: 'api-gateway', weight: 0.65 }],
  'api-gateway': [{ parent: 'web-app', weight: 0.78 }],
  'web-app': [],
};

/**
 * Upstream parents -> direct children dependencies with link weight w_{u -> v}
 */
export const DEPENDENCY_CHILDREN: Record<
  ServiceNodeId,
  Array<{ child: ServiceNodeId; weight: number }>
> = {
  'web-app': [{ child: 'api-gateway', weight: 0.78 }],
  'api-gateway': [
    { child: 'payment-service', weight: 0.84 },
    { child: 'auth-service', weight: 0.65 },
  ],
  'auth-service': [{ child: 'postgres-db', weight: 0.35 }],
  'payment-service': [{ child: 'postgres-db', weight: 0.92 }],
  'postgres-db': [],
};

export function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

/**
 * PRD 5.1: Bounded Mean-Reverting Telemetry Generator
 * M_i(t) = clamp(M_i(t-1) + theta * (mu_i - M_i(t-1)) + sigma_i * eps_t, M_min, M_max)
 */
export function computeNextBaselineMetric(
  prev: number,
  targetMean: number,
  theta: number,
  sigma: number,
  min: number,
  max: number,
  randomUnit?: number
): number {
  const eps = randomUnit !== undefined ? clamp(randomUnit, -1, 1) : Math.random() * 2 - 1;
  const clampedTheta = clamp(theta, 0.25, 0.45);
  const next = prev + clampedTheta * (targetMean - prev) + sigma * eps;
  return clamp(next, min, max);
}

/**
 * PRD 2.3: Deterministic Health State Thresholds
 */
export function evaluateHealthStatus(
  cpu: number,
  latencyP95: number,
  errorRate: number
): HealthStatus {
  if (cpu >= 88 || latencyP95 >= 450 || errorRate >= 5.0) {
    return 'CRITICAL';
  }
  if (cpu >= 70 || latencyP95 >= 120 || errorRate >= 1.0) {
    return 'DEGRADED';
  }
  return 'HEALTHY';
}

/**
 * Compute shortest dependency hop distance from faulted root `source` up to `targetParent`
 */
function getUpstreamHopDistance(
  source: ServiceNodeId,
  targetParent: ServiceNodeId
): { hops: number; pathWeight: number } | null {
  if (source === targetParent) {
    return { hops: 0, pathWeight: 1 };
  }

  const queue: Array<{ id: ServiceNodeId; hops: number; weight: number }> = [
    { id: source, hops: 0, weight: 1 },
  ];
  let best: { hops: number; pathWeight: number } | null = null;

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of DEPENDENCY_PARENTS[current.id]) {
      const nextHops = current.hops + 1;
      const nextWeight = current.weight * edge.weight;
      if (edge.parent === targetParent) {
        if (!best || nextWeight > best.pathWeight) {
          best = { hops: nextHops, pathWeight: nextWeight };
        }
      } else if (nextHops < 4) {
        queue.push({ id: edge.parent, hops: nextHops, weight: nextWeight });
      }
    }
  }

  return best;
}

/**
 * PRD 5.2: Directed Graph Cascading Failure Propagation (EffectiveImpact)
 * Applies hop delay of 2.5s per upstream hop (T+0s -> T+2.5s -> T+5.0s).
 */
export function computeCascadingImpact(
  nodeId: ServiceNodeId,
  activeFaults: Partial<Record<ServiceNodeId, ActiveFault>>,
  nowMs: number,
  hopDelayMs = 2500
): { effectiveImpact: number; rootCauseSource: ServiceNodeId | null } {
  let maxImpact = 0;
  let rootCauseSource: ServiceNodeId | null = null;

  const directFault = activeFaults[nodeId];
  if (directFault) {
    maxImpact = clamp(directFault.severity, 0, 1);
    rootCauseSource = nodeId;
  }

  for (const fault of Object.values(activeFaults)) {
    if (!fault || fault.nodeId === nodeId) continue;
    const rel = getUpstreamHopDistance(fault.nodeId, nodeId);
    if (!rel) continue;

    const elapsedMs = Math.max(0, nowMs - fault.injectedAt);
    const requiredDelayMs = rel.hops * hopDelayMs;
    if (elapsedMs < requiredDelayMs) continue;

    // Smoothly ramp impact over 1.2s once hop delay threshold is crossed
    const ramp = clamp((elapsedMs - requiredDelayMs + 400) / 1200, 0.35, 1);
    const propagatedImpact = clamp(fault.severity * rel.pathWeight * ramp, 0, 1);
    if (propagatedImpact > maxImpact) {
      maxImpact = propagatedImpact;
      rootCauseSource = fault.nodeId;
    }
  }

  return { effectiveImpact: maxImpact, rootCauseSource };
}

/**
 * PRD 5.2: Apply additive CPU, Latency, ErrorRate, and RPS degradation from EffectiveImpact
 */
export function applyEffectiveImpactToMetrics(
  base: { cpu: number; latencyP95: number; errorRate: number; rps: number },
  effectiveImpact: number,
  propagationMultiplier: number
): ServiceMetrics {
  const impact = clamp(effectiveImpact, 0, 1);
  if (impact <= 0.001) {
    return {
      cpu: Number(clamp(base.cpu, 0, 100).toFixed(1)),
      latencyP95: Math.max(1, Math.round(base.latencyP95)),
      errorRate: Number(clamp(base.errorRate, 0, 100).toFixed(2)),
      rps: Math.max(10, Math.round(base.rps)),
      status: evaluateHealthStatus(base.cpu, base.latencyP95, base.errorRate),
      faultSeverity: 0,
    };
  }

  const cpu = clamp(base.cpu + impact * (98.4 - base.cpu), 0, 99.6);
  const latencyP95 = Math.max(1, Math.round(base.latencyP95 + impact * propagationMultiplier));
  const errorRate = clamp(base.errorRate + impact * 28.0, 0, 100);
  const rps = Math.max(12, Math.round(base.rps * (1 - 0.55 * impact)));

  return {
    cpu: Number(cpu.toFixed(1)),
    latencyP95,
    errorRate: Number(errorRate.toFixed(2)),
    rps,
    status: evaluateHealthStatus(cpu, latencyP95, errorRate),
    faultSeverity: Number(impact.toFixed(2)),
  };
}

/**
 * PRD 5.3: Weighted Global Cluster Health Score (0 - 100)
 */
export function computeClusterHealthScore(
  nodes: Record<ServiceNodeId, Pick<ServiceMetrics, 'cpu' | 'latencyP95' | 'errorRate'>>
): number {
  let weightedPenalty = 0;

  for (const nodeId of Object.keys(NODE_CRITICALITY_WEIGHTS) as ServiceNodeId[]) {
    const m = nodes[nodeId];
    if (!m) continue;
    const alpha = NODE_CRITICALITY_WEIGHTS[nodeId];
    const normErr = clamp(m.errorRate / 25.0, 0, 1);
    const normLat = clamp((m.latencyP95 - 15) / 1800, 0, 1);
    const normCpu = clamp((m.cpu - 20) / 80, 0, 1);
    weightedPenalty += alpha * (0.45 * normErr + 0.35 * normLat + 0.20 * normCpu);
  }

  const score = (1 - clamp(weightedPenalty, 0, 1)) * 100;
  return Number(clamp(score, 0, 100).toFixed(1));
}

/**
 * PRD 5.4: SLA Countdown, Breach Detection, and MTTR
 */
export function computeSlaState(
  triggeredAtMs: number,
  nowMs: number,
  slaTargetSeconds: number,
  status: TicketStatus,
  resolvedAtMs?: number | null
): {
  remainingSeconds: number;
  slaBreached: boolean;
  mttrSeconds: number | null;
} {
  const effectiveNow = status === 'RESOLVED' && resolvedAtMs ? resolvedAtMs : nowMs;
  const elapsedSec = Math.max(0, Math.floor((effectiveNow - triggeredAtMs) / 1000));
  const remainingSeconds = Math.max(0, slaTargetSeconds - elapsedSec);
  const slaBreached = status !== 'RESOLVED' && elapsedSec > slaTargetSeconds;
  const mttrSeconds =
    status === 'RESOLVED' && resolvedAtMs
      ? Math.max(1, Math.floor((resolvedAtMs - triggeredAtMs) / 1000))
      : null;

  return { remainingSeconds, slaBreached, mttrSeconds };
}

export function formatMmSs(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * DESIGN_SYSTEM 3.3 Numeric Formatting Hygiene
 */
export function formatCpu(val: number): string {
  return `${clamp(val, 0, 100).toFixed(1)}%`;
}

export function formatLatency(val: number): string {
  if (val < 10) {
    return `${val.toFixed(1)}ms`;
  }
  return `${Math.round(val).toLocaleString('en-US')}ms`;
}

export function formatErrorRate(val: number): string {
  return `${clamp(val, 0, 100).toFixed(2)}%`;
}

export function formatRps(rps: number): string {
  if (rps >= 1000) {
    return `${(rps / 1000).toFixed(1)}k rps`;
  }
  return `${Math.round(rps)} rps`;
}
