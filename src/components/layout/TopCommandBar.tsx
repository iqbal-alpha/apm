'use client';

import React from 'react';
import { Check, ChevronDown, Database, Zap } from 'lucide-react';
import { ActionButton } from '@/components/ui/ActionButton';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { computeSlaState, formatMmSs } from '@/lib/telemetry-math';
import {
  CHAOS_SCENARIOS,
  selectActiveSnapshot,
  useMonitoringStore,
} from '@/store/useMonitoringStore';
import type { ChaosScenarioId } from '@/types/monitoring';

export function TopCommandBar() {
  const activeScenario = useMonitoringStore((s) => s.activeScenario);
  const setActiveScenario = useMonitoringStore((s) => s.setActiveScenario);
  const triggerChaosScenario = useMonitoringStore((s) => s.triggerChaosScenario);
  const executeAutoMitigation = useMonitoringStore((s) => s.executeAutoMitigation);
  const activeFaults = useMonitoringStore((s) => s.activeFaults);
  const incidents = useMonitoringStore((s) => s.incidents);
  const replayOffsetSeconds = useMonitoringStore((s) => s.replayOffsetSeconds);
  const syncMode = useMonitoringStore((s) => s.syncMode);
  const nowMs = useMonitoringStore((s) => s.nowMs);
  const activeSnap = useMonitoringStore(selectActiveSnapshot);

  const hasFault = Object.keys(activeFaults).length > 0;
  const openP1 = incidents.find((t) => t.status !== 'RESOLVED') ?? incidents[0];
  const isReplaying = replayOffsetSeconds < 0;

  const healthTone =
    activeSnap.clusterHealth < 78
      ? 'CRITICAL'
      : activeSnap.clusterHealth < 94
      ? 'DEGRADED'
      : 'HEALTHY';

  const ambientStripColor =
    healthTone === 'CRITICAL'
      ? 'bg-[var(--critical)]'
      : isReplaying || healthTone === 'DEGRADED'
      ? 'bg-[var(--warn)]'
      : 'bg-[var(--telemetry)]';

  const openSla = openP1
    ? computeSlaState(openP1.triggeredAt, nowMs, openP1.slaTargetSeconds, openP1.status, openP1.resolvedAt)
    : null;

  return (
    <header className="relative flex h-[52px] md:h-[56px] w-full shrink-0 items-center justify-between gap-2 bg-[var(--bg-surface)] px-3 md:px-4 border-b border-[var(--border-subtle)]">
      {/* Bottom 2px Ambient Status Strip */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-[2px] transition-colors duration-300 ${ambientStripColor}`}
      />

      {/* Left Cluster: Brand & Health Score */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--telemetry-bright)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="shrink-0"
          >
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="5" />
            <path d="M12 12 L18.5 5.5" />
          </svg>
          <span className="font-sans text-[14px] md:text-[15px] font-semibold tracking-[-0.015em] text-[var(--text-primary)]">
            SENTINEL
          </span>
        </div>

        <div className="hidden md:block h-5 w-px bg-[var(--border-subtle)]" />

        <StatusBadge
          tone={healthTone}
          pulse={healthTone === 'CRITICAL'}
          label={`Cluster Health: ${activeSnap.clusterHealth.toFixed(1)}%`}
          className="hidden sm:inline-flex"
        />
        <StatusBadge
          tone={healthTone}
          pulse={healthTone === 'CRITICAL'}
          label={`P1 · ${activeSnap.clusterHealth.toFixed(1)}%`}
          className="sm:hidden"
        />

        {isReplaying ? (
          <StatusBadge tone="DEGRADED" label={`REPLAY · ${replayOffsetSeconds}s`} />
        ) : (
          <StatusBadge tone="TELEMETRY" pulse label="LIVE 1000ms" className="hidden lg:inline-flex" />
        )}
      </div>

      {/* Center Cluster (Desktop/Tablet): Chaos Drill Selector + Trigger/Mitigate CTA */}
      <div className="hidden md:flex items-center gap-2">
        <div className="relative flex items-center">
          <Zap
            className={`pointer-events-none absolute left-2.5 h-3.5 w-3.5 ${
              hasFault ? 'text-[var(--critical-bright)]' : 'text-[var(--healthy-bright)]'
            }`}
          />
          <select
            id="chaos-scenario-selector"
            name="chaosScenario"
            aria-label="Chaos Drill Scenario Selector"
            value={activeScenario}
            onChange={(e) => setActiveScenario(e.target.value as ChaosScenarioId)}
            className={`h-[34px] appearance-none rounded-[var(--radius-control)] border bg-[var(--bg-raised)] pl-8 pr-8 font-sans text-[12px] font-medium text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] ${
              hasFault
                ? 'border-[var(--critical)]'
                : 'border-[var(--border-default)] hover:border-[var(--border-focus)]'
            }`}
          >
            {(Object.values(CHAOS_SCENARIOS) as Array<(typeof CHAOS_SCENARIOS)[ChaosScenarioId]>).map(
              (scen) => (
                <option key={scen.id} value={scen.id} className="bg-[var(--bg-surface)] text-[var(--text-primary)]">
                  {scen.label}
                </option>
              )
            )}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-[var(--text-secondary)]" />
        </div>

        {hasFault ? (
          <ActionButton variant="mitigate" size="md" onClick={executeAutoMitigation}>
            <Check className="h-3.5 w-3.5" />
            <span>Auto-Mitigate All</span>
          </ActionButton>
        ) : (
          <ActionButton variant="simulate" size="md" onClick={() => triggerChaosScenario(activeScenario)}>
            <Zap className="h-3.5 w-3.5 text-[var(--warn-bright)]" />
            <span>Trigger Chaos Drill</span>
          </ActionButton>
        )}
      </div>

      {/* Right Cluster: Active Ticket + Sync Status */}
      <div className="flex items-center gap-2 shrink-0">
        {openP1 && openSla && (
          <StatusBadge
            tone={openP1.status === 'RESOLVED' ? 'HEALTHY' : 'ITSM'}
            pulse={openP1.status !== 'RESOLVED'}
            label={
              openP1.status === 'RESOLVED'
                ? `${openP1.ticketNumber} · RESOLVED`
                : `P1 ${openP1.ticketNumber} · SLA ${formatMmSs(openSla.remainingSeconds)}`
            }
            className="hidden xl:inline-flex"
          />
        )}

        <StatusBadge
          tone={syncMode === 'SUPABASE_SYNCED' ? 'HEALTHY' : 'DEGRADED'}
          label={syncMode === 'SUPABASE_SYNCED' ? 'Supabase Synced' : 'Local Cache Mode'}
          className="hidden sm:inline-flex"
        />
        <span className="sm:hidden inline-flex items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--itsm)] bg-[var(--itsm-tint)] px-2 py-0.5 font-mono text-[11px] font-medium text-[var(--itsm-bright)]">
          <Database className="h-3 w-3" />
          LIVE
        </span>
      </div>
    </header>
  );
}
