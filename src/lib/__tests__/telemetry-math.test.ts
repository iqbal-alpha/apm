import { describe, expect, it } from 'vitest';
import {
  applyEffectiveImpactToMetrics,
  clamp,
  computeCascadingImpact,
  computeClusterHealthScore,
  computeNextBaselineMetric,
  computeSlaState,
  evaluateHealthStatus,
  formatCpu,
  formatErrorRate,
  formatLatency,
  formatMmSs,
  formatRps,
} from '@/lib/telemetry-math';
import type { ActiveFault, ServiceNodeId } from '@/types/monitoring';

describe('telemetry-math (PRD Section 5 & Section 2.3)', () => {
  it('clamp bounds values deterministically', () => {
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(108, 0, 100)).toBe(100);
    expect(clamp(42.5, 0, 100)).toBe(42.5);
  });

  it('bounded mean-reverting generator never exceeds physical CPU/Error/Latency limits', () => {
    let cpu = 24.2;
    let lat = 12;
    let err = 0.02;

    for (let i = 0; i < 500; i++) {
      const unit = ((i % 19) - 9) / 9; // [-1, 1]
      cpu = computeNextBaselineMetric(cpu, 24.2, 0.4, 2.4, 0, 100, unit);
      lat = computeNextBaselineMetric(lat, 12, 0.35, 3.5, 1, 5000, -unit);
      err = computeNextBaselineMetric(err, 0.02, 0.3, 0.03, 0, 100, unit);

      expect(cpu).toBeGreaterThanOrEqual(0);
      expect(cpu).toBeLessThanOrEqual(100);
      expect(lat).toBeGreaterThanOrEqual(1);
      expect(lat).toBeLessThanOrEqual(5000);
      expect(err).toBeGreaterThanOrEqual(0);
      expect(err).toBeLessThanOrEqual(100);
    }
  });

  it('evaluates health status thresholds strictly per PRD Section 2.3', () => {
    expect(evaluateHealthStatus(69.9, 119, 0.99)).toBe('HEALTHY');
    expect(evaluateHealthStatus(70.0, 20, 0.1)).toBe('DEGRADED');
    expect(evaluateHealthStatus(30.0, 120, 0.1)).toBe('DEGRADED');
    expect(evaluateHealthStatus(30.0, 20, 1.0)).toBe('DEGRADED');
    expect(evaluateHealthStatus(87.9, 449, 4.99)).toBe('DEGRADED');
    expect(evaluateHealthStatus(88.0, 20, 0.1)).toBe('CRITICAL');
    expect(evaluateHealthStatus(30.0, 450, 0.1)).toBe('CRITICAL');
    expect(evaluateHealthStatus(30.0, 20, 5.0)).toBe('CRITICAL');
  });

  it('propagates postgres-db cascading domino chronologically up the DAG without skipping hop delays', () => {
    const t0 = 1_700_000_000_000;
    const faults: Partial<Record<ServiceNodeId, ActiveFault>> = {
      'postgres-db': {
        nodeId: 'postgres-db',
        scenarioId: 'SCEN-DB-CPU',
        severity: 1.0,
        injectedAt: t0,
      },
    };

    // At T+0s: only postgres-db is affected
    expect(computeCascadingImpact('postgres-db', faults, t0, 2500).effectiveImpact).toBe(1.0);
    expect(computeCascadingImpact('payment-service', faults, t0, 2500).effectiveImpact).toBe(0);
    expect(computeCascadingImpact('api-gateway', faults, t0, 2500).effectiveImpact).toBe(0);
    expect(computeCascadingImpact('web-app', faults, t0, 2500).effectiveImpact).toBe(0);

    // At T+2.5s: tier-1 children (payment-service & auth-service) are impacted; api-gateway still unaffected
    const tTier1 = t0 + 2500;
    const payTier1 = computeCascadingImpact('payment-service', faults, tTier1, 2500);
    const authTier1 = computeCascadingImpact('auth-service', faults, tTier1, 2500);
    expect(payTier1.effectiveImpact).toBeGreaterThan(0.3);
    expect(authTier1.effectiveImpact).toBeGreaterThan(0.1);
    expect(payTier1.rootCauseSource).toBe('postgres-db');
    expect(computeCascadingImpact('api-gateway', faults, tTier1, 2500).effectiveImpact).toBe(0);

    // At T+5.0s: api-gateway suffers tier-2 cascade
    const tTier2 = t0 + 5000;
    expect(computeCascadingImpact('api-gateway', faults, tTier2, 2500).effectiveImpact).toBeGreaterThan(0.2);
    expect(computeCascadingImpact('web-app', faults, tTier2, 2500).effectiveImpact).toBe(0);

    // At T+7.5s: web-app degrades at tier-3
    const tTier3 = t0 + 7500;
    expect(computeCascadingImpact('web-app', faults, tTier3, 2500).effectiveImpact).toBeGreaterThan(0.15);
  });

  it('isolates mid-tier payment-service faults to upstream nodes without impacting auth-service or postgres-db', () => {
    const t0 = 1_700_000_000_000;
    const faults: Partial<Record<ServiceNodeId, ActiveFault>> = {
      'payment-service': {
        nodeId: 'payment-service',
        scenarioId: 'SCEN-PAY-SPIKE',
        severity: 1.0,
        injectedAt: t0,
      },
    };

    const tLate = t0 + 10_000;
    expect(computeCascadingImpact('payment-service', faults, tLate, 2500).effectiveImpact).toBe(1.0);
    expect(computeCascadingImpact('api-gateway', faults, tLate, 2500).effectiveImpact).toBeGreaterThan(0.7);
    expect(computeCascadingImpact('web-app', faults, tLate, 2500).effectiveImpact).toBeGreaterThan(0.5);
    expect(computeCascadingImpact('auth-service', faults, tLate, 2500).effectiveImpact).toBe(0);
    expect(computeCascadingImpact('postgres-db', faults, tLate, 2500).effectiveImpact).toBe(0);
  });

  it('applies EffectiveImpact to latency, error rate, and throughput degradation cleanly', () => {
    const base = { cpu: 24.2, latencyP95: 12, errorRate: 0.02, rps: 1800 };
    const impacted = applyEffectiveImpactToMetrics(base, 1.0, 1850);

    expect(impacted.cpu).toBeCloseTo(98.4, 1);
    expect(impacted.latencyP95).toBe(1862);
    expect(impacted.errorRate).toBeCloseTo(28.02, 2);
    expect(impacted.rps).toBe(810); // 1800 * (1 - 0.55)
    expect(impacted.status).toBe('CRITICAL');
  });

  it('calculates Cluster Health Score monotonically lower when critical node (postgres-db) degrades vs web-app', () => {
    const healthyNodes = {
      'web-app': { cpu: 18, latencyP95: 20, errorRate: 0.01 },
      'api-gateway': { cpu: 22, latencyP95: 18, errorRate: 0.02 },
      'auth-service': { cpu: 14, latencyP95: 11, errorRate: 0.01 },
      'payment-service': { cpu: 26, latencyP95: 15, errorRate: 0.01 },
      'postgres-db': { cpu: 24, latencyP95: 12, errorRate: 0.02 },
    };

    const baseScore = computeClusterHealthScore(healthyNodes);
    expect(baseScore).toBeGreaterThan(98);

    const dbImpactedScore = computeClusterHealthScore({
      ...healthyNodes,
      'postgres-db': { cpu: 98.4, latencyP95: 1850, errorRate: 14.5 },
    });
    const webImpactedScore = computeClusterHealthScore({
      ...healthyNodes,
      'web-app': { cpu: 98.4, latencyP95: 1850, errorRate: 14.5 },
    });

    expect(dbImpactedScore).toBeLessThan(webImpactedScore);
    expect(dbImpactedScore).toBeGreaterThanOrEqual(0);
  });

  it('calculates SLA remaining seconds, breach flag, and MTTR accurately', () => {
    const triggered = 1_700_000_000_000;
    const mid = computeSlaState(triggered, triggered + 125_000, 900, 'OPEN');
    expect(mid.remainingSeconds).toBe(775);
    expect(mid.slaBreached).toBe(false);
    expect(mid.mttrSeconds).toBeNull();
    expect(formatMmSs(mid.remainingSeconds)).toBe('12:55');

    const breached = computeSlaState(triggered, triggered + 905_000, 900, 'INVESTIGATING');
    expect(breached.remainingSeconds).toBe(0);
    expect(breached.slaBreached).toBe(true);

    const resolved = computeSlaState(triggered, triggered + 500_000, 900, 'RESOLVED', triggered + 68_000);
    expect(resolved.slaBreached).toBe(false);
    expect(resolved.mttrSeconds).toBe(68);
    expect(formatMmSs(resolved.mttrSeconds!)).toBe('01:08');
  });

  it('formats numeric telemetry units with zero-jitter precision rules', () => {
    expect(formatCpu(98.44)).toBe('98.4%');
    expect(formatLatency(8.43)).toBe('8.4ms');
    expect(formatLatency(1850)).toBe('1,850ms');
    expect(formatErrorRate(14.5)).toBe('14.50%');
    expect(formatRps(480)).toBe('480 rps');
    expect(formatRps(1820)).toBe('1.8k rps');
  });
});
