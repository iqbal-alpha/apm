'use client';

import React, { useId, useMemo, useState } from 'react';
import { Check, CheckCheck, Clock, Copy, Send, Terminal } from 'lucide-react';
import { ActionButton } from '@/components/ui/ActionButton';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { computeSlaState, formatMmSs } from '@/lib/telemetry-math';
import { SERVICE_CONFIGS, useMonitoringStore } from '@/store/useMonitoringStore';
import type { TicketStatus } from '@/types/monitoring';

type PanelSubTab = 'overview' | 'audit' | 'webhook';

export function BmcIncidentPanel() {
  const incidents = useMonitoringStore((s) => s.incidents);
  const selectedIncidentId = useMonitoringStore((s) => s.selectedIncidentId);
  const selectIncident = useMonitoringStore((s) => s.selectIncident);
  const updateIncidentStatus = useMonitoringStore((s) => s.updateIncidentStatus);
  const addIncidentWorkNote = useMonitoringStore((s) => s.addIncidentWorkNote);
  const executeAutoMitigation = useMonitoringStore((s) => s.executeAutoMitigation);
  const triggerChaosScenario = useMonitoringStore((s) => s.triggerChaosScenario);
  const bridgeDispatching = useMonitoringStore((s) => s.bridgeDispatching);
  const syncMode = useMonitoringStore((s) => s.syncMode);
  const nowMs = useMonitoringStore((s) => s.nowMs);

  const ticketSelectId = useId();
  const workNoteId = useId();
  const [subTab, setSubTab] = useState<PanelSubTab>('overview');
  const [workNote, setWorkNote] = useState('');
  const [copiedJson, setCopiedJson] = useState(false);

  const activeTicket = useMemo(
    () => incidents.find((t) => t.id === selectedIncidentId) ?? incidents[0],
    [incidents, selectedIncidentId]
  );

  const sla = useMemo(() => {
    if (!activeTicket) return null;
    return computeSlaState(
      activeTicket.triggeredAt,
      nowMs,
      activeTicket.slaTargetSeconds,
      activeTicket.status,
      activeTicket.resolvedAt
    );
  }, [activeTicket, nowMs]);

  if (!activeTicket || !sla) {
    return null;
  }

  const isResolved = activeTicket.status === 'RESOLVED';
  const isUrgent = !isResolved && (sla.remainingSeconds < 300 || sla.slaBreached);

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(activeTicket.webhookPayload, null, 2));
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 1600);
    } catch {
      // Ignore clipboard unavailability
    }
  };

  const handleSubmitNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workNote.trim()) return;
    addIncidentWorkNote(activeTicket.id, workNote);
    setWorkNote('');
  };

  return (
    <section
      aria-label="Dynatrace to BMC Helix Incident Ticket Panel"
      className="flex min-h-0 flex-1 flex-col gap-2 bg-[var(--bg-surface)] px-3.5 py-2.5 overflow-y-auto"
    >
      {/* Bridge Signal Banner + Historical Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className={bridgeDispatching ? 'animate-bridge-dispatch' : ''}>
          <StatusBadge
            tone={isResolved ? 'HEALTHY' : 'ITSM'}
            pulse={!isResolved}
            label={`Dynatrace ${activeTicket.problemId} -> BMC Helix (201 CREATED)`}
          />
        </div>

        <select
          id={ticketSelectId}
          name="selectedIncident"
          aria-label="Select BMC Helix incident ticket"
          value={activeTicket.id}
          onChange={(e) => selectIncident(e.target.value)}
          className="h-[36px] md:h-[24px] rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-2 font-mono text-base md:text-[10.5px] text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
        >
          {incidents.map((t) => (
            <option key={t.id} value={t.id} className="bg-[var(--bg-surface)] text-[var(--text-primary)]">
              {t.ticketNumber} ({t.status})
            </option>
          ))}
        </select>
      </div>

      {/* Ticket Identity + SLA Countdown Box */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate font-sans text-[15px] font-semibold tracking-[-0.015em] text-[var(--text-primary)]">
            {activeTicket.ticketNumber}
          </h3>
          <StatusBadge
            tone={isResolved ? 'HEALTHY' : 'CRITICAL'}
            label={isResolved ? 'RESOLVED' : activeTicket.severity}
          />
        </div>

        {isResolved ? (
          <div className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--healthy)] bg-[var(--healthy-tint)] px-2 py-1 font-mono text-[12px] font-semibold text-[var(--healthy-bright)]">
            <Clock className="h-3.5 w-3.5" />
            <span className="tabular-nums-strict">
              MTTR {formatMmSs(activeTicket.mttrSeconds ?? 68)}
            </span>
          </div>
        ) : (
          <div
            className={`inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-2 py-1 ${
              isUrgent ? 'sla-pulse border-[var(--critical)] bg-[var(--critical-tint)]' : 'border-[var(--critical)] bg-[var(--critical-tint)]'
            }`}
          >
            <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--critical-bright)]">
              {sla.slaBreached ? 'BREACHED' : 'SLA'}
            </span>
            <span className="tabular-nums-strict text-[13px] font-bold leading-none text-[var(--critical-bright)]">
              {formatMmSs(sla.remainingSeconds)}
            </span>
          </div>
        )}
      </div>

      {/* Interactive 3-Step Workflow Stepper: OPEN -> INVESTIGATING -> RESOLVED */}
      <div className="grid grid-cols-3 gap-1 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-1">
        {(['OPEN', 'INVESTIGATING', 'RESOLVED'] as TicketStatus[]).map((step) => {
          const isCurrent = activeTicket.status === step;
          const isCompleted =
            activeTicket.status === 'RESOLVED' ||
            (activeTicket.status === 'INVESTIGATING' && step === 'OPEN');

          return (
            <button
              key={step}
              type="button"
              onClick={() => updateIncidentStatus(activeTicket.id, step)}
              className={`rounded-[var(--radius-pill)] py-1 font-mono text-[10px] font-medium transition-colors ${
                isCurrent
                  ? step === 'RESOLVED'
                    ? 'bg-[var(--healthy-tint)] text-[var(--healthy-bright)] border border-[var(--healthy)]'
                    : 'bg-[var(--critical-tint)] text-[var(--critical-bright)] border border-[var(--critical)]'
                  : isCompleted
                  ? 'text-[var(--healthy-bright)] hover:bg-[var(--bg-floating)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-floating)] hover:text-[var(--text-primary)]'
              }`}
            >
              {isCompleted ? '✓ ' : isCurrent ? '● ' : '○ '}
              {step}
            </button>
          );
        })}
      </div>

      {/* Internal Panel Sub-Tabs: Overview | Webhook JSON | Activity Audit */}
      <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] pb-1">
        {(
          [
            { id: 'overview', label: 'RCA & Impact' },
            { id: 'webhook', label: 'Webhook JSON' },
            { id: 'audit', label: `Audit Log (${activeTicket.activityLogs.length})` },
          ] as Array<{ id: PanelSubTab; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`rounded-[var(--radius-pill)] px-2.5 py-1 font-sans text-[11px] font-semibold transition-colors ${
              subTab === tab.id
                ? 'bg-[var(--telemetry-tint)] text-[var(--telemetry-bright)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sub-Tab Content */}
      {subTab === 'overview' && (
        <div className="flex flex-col gap-2">
          {/* Affected Services Blast Radius */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-sans text-[10.5px] font-semibold text-[var(--text-muted)] mr-1">
              Blast Radius:
            </span>
            {activeTicket.affectedServices.map((svcId, idx) => (
              <span
                key={svcId}
                className={`rounded-[var(--radius-pill)] border px-1.5 py-0.5 font-mono text-[10px] ${
                  idx === 0
                    ? 'border-[var(--critical)] bg-[var(--critical-tint)] text-[var(--critical-bright)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-raised)] text-[var(--text-secondary)]'
                }`}
              >
                {idx === 0 ? 'Root: ' : ''}
                {SERVICE_CONFIGS[svcId].host.split('.')[0]}
              </span>
            ))}
          </div>

          {/* Davis AI RCA Summary Box */}
          <div className="rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-2.5 py-2">
            <div className="mb-1 font-sans text-[10.5px] font-semibold text-[var(--telemetry-bright)]">
              Automated RCA · Davis AI
            </div>
            <p className="font-sans text-[12px] leading-[1.45] text-[var(--text-secondary)]">
              {activeTicket.rootCauseSummary}
            </p>
          </div>

          {/* Primary Mitigation CTA or Healthy Drill Prompt */}
          {!isResolved ? (
            <ActionButton variant="mitigate" size="md" fullWidth onClick={executeAutoMitigation}>
              <Check className="h-3.5 w-3.5" />
              <span>Execute Auto-Mitigation & Resolve P1</span>
            </ActionButton>
          ) : (
            <div className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--bg-ground)] px-2.5 py-2">
              <span className="font-sans text-[11.5px] text-[var(--text-secondary)]">
                All 5 services within SLO. Run another drill anytime.
              </span>
              <ActionButton
                variant="simulate"
                size="sm"
                onClick={() => triggerChaosScenario()}
                className="shrink-0"
              >
                Trigger Drill
              </ActionButton>
            </div>
          )}

          {/* Latest Audit Line Peek */}
          <div className="rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--bg-ground)] px-2.5 py-1.5">
            <div className="flex items-center justify-between text-[10px] font-sans font-semibold text-[var(--text-muted)]">
              <span>Latest Audit · {syncMode === 'SUPABASE_SYNCED' ? 'Supabase' : 'Local Cache'}</span>
              <span>{activeTicket.activityLogs.length} events</span>
            </div>
            {activeTicket.activityLogs[activeTicket.activityLogs.length - 1] && (
              <div className="mt-0.5 truncate font-mono text-[10.5px] text-[var(--telemetry-bright)]">
                {activeTicket.activityLogs[activeTicket.activityLogs.length - 1].createdAt} ·{' '}
                {activeTicket.activityLogs[activeTicket.activityLogs.length - 1].message}
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'webhook' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-[var(--text-secondary)]">
              <Terminal className="h-3 w-3 text-[var(--telemetry-bright)]" />
              /api/arsys/v1/entry/HPD:IncidentInterface_Create
            </span>
            <button
              type="button"
              onClick={handleCopyJson}
              className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {copiedJson ? <CheckCheck className="h-3 w-3 text-[var(--healthy-bright)]" /> : <Copy className="h-3 w-3" />}
              <span>{copiedJson ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <pre className="max-h-[160px] overflow-auto rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--bg-ground)] p-2.5 font-mono text-[11px] leading-[1.45] text-[var(--telemetry-bright)] break-all whitespace-pre-wrap">
            {JSON.stringify(activeTicket.webhookPayload, null, 2)}
          </pre>
        </div>
      )}

      {subTab === 'audit' && (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="max-h-[130px] flex-1 space-y-1 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--bg-ground)] p-2">
            {activeTicket.activityLogs.map((log) => (
              <div
                key={log.id}
                className="border-b border-[var(--border-subtle)] pb-1 last:border-b-0 last:pb-0 font-mono text-[10.5px] leading-[1.4]"
              >
                <span className="text-[var(--text-muted)]">{log.createdAt}</span>{' '}
                <span className="text-[var(--telemetry-bright)]">[{log.actor}]</span>{' '}
                <span className="text-[var(--text-primary)]">{log.message}</span>
              </div>
            ))}
          </div>

          <form onSubmit={handleSubmitNote} className="flex items-center gap-1.5">
            <input
              id={workNoteId}
              name="workNote"
              type="text"
              aria-label="Add SRE Work Note"
              placeholder="Add SRE work note..."
              value={workNote}
              onChange={(e) => setWorkNote(e.target.value)}
              className="min-w-0 flex-1 h-[40px] md:h-[32px] rounded-[var(--radius-control)] border border-[var(--border-focus)] bg-[var(--bg-ground)] px-2.5 font-sans text-base md:text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--telemetry)]"
            />
            <ActionButton
              type="submit"
              variant="primary"
              size="sm"
              className="h-[40px] md:h-[32px] px-3"
              aria-label="Submit SRE work note"
            >
              <Send className="h-3.5 w-3.5" />
            </ActionButton>
          </form>
        </div>
      )}
    </section>
  );
}
