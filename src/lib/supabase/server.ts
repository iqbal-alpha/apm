import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  ChaosScenarioId,
  IncidentActionType,
  IncidentActivityLog,
  IncidentTicket,
  ServiceNodeId,
  TicketStatus,
} from '@/types/monitoring';

export const MON_TABLES = {
  tickets: 'mon_incident_tickets',
  activityLogs: 'mon_incident_activity_logs',
  metricsSummary: 'mon_incident_metrics_summary',
} as const;

export interface MonIncidentTicketRow {
  id: string;
  ticket_number: string;
  problem_id: string;
  source_system: string;
  target_itsm: string;
  severity: 'P1' | 'P2' | 'P3';
  status: TicketStatus;
  scenario_id: string;
  root_node_id: string;
  affected_services: string[];
  title: string;
  root_cause_summary: string;
  webhook_payload: Record<string, unknown>;
  sla_target_seconds: number;
  sla_breached: boolean;
  triggered_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  mttr_seconds: number | null;
  created_at: string;
  updated_at: string;
}

export interface MonIncidentActivityLogRow {
  id: string;
  ticket_id: string;
  actor: string;
  action_type: IncidentActionType;
  from_status: TicketStatus | null;
  to_status: TicketStatus | null;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface MonIncidentMetricsSummaryRow {
  total_incidents: number;
  active_incidents: number;
  active_p1_count: number;
  avg_mttr_seconds: number;
  sla_compliance_pct: number | string;
}

function readSupabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
}

function readSupabaseAnonKey(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
}

function readSupabaseServiceKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
}

export function isSupabaseAnonConfigured(): boolean {
  return Boolean(readSupabaseUrl() && readSupabaseAnonKey());
}

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(readSupabaseUrl() && readSupabaseServiceKey());
}

const SERVER_AUTH_OPTS = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
} as const;

/**
 * Server-side read client using public anon/publishable key (subject to Postgres RLS).
 */
export function getSupabaseAnonServerClient(): SupabaseClient | null {
  if (!isSupabaseAnonConfigured()) return null;
  return createClient(readSupabaseUrl(), readSupabaseAnonKey(), SERVER_AUTH_OPTS);
}

/**
 * Server-only privileged client using service_role / secret key for writes.
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  if (!isSupabaseAdminConfigured()) return null;
  return createClient(readSupabaseUrl(), readSupabaseServiceKey(), SERVER_AUTH_OPTS);
}

export function formatUtcTimestamp(isoOrMs: string | number): string {
  const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
  if (Number.isNaN(d.getTime())) return '00:00:00.000Z';
  return d.toISOString().slice(11, 23) + 'Z';
}

export function mapActivityLogRow(row: MonIncidentActivityLogRow): IncidentActivityLog {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    actor: row.actor,
    actionType: row.action_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    message: row.message,
    createdAt: formatUtcTimestamp(row.created_at),
  };
}

export function mapTicketRow(
  row: MonIncidentTicketRow,
  logs: MonIncidentActivityLogRow[]
): IncidentTicket {
  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    problemId: row.problem_id,
    sourceSystem: row.source_system,
    targetItsm: row.target_itsm,
    severity: row.severity,
    status: row.status,
    scenarioId: row.scenario_id as ChaosScenarioId | 'MANUAL_SPIKE',
    rootNodeId: row.root_node_id as ServiceNodeId,
    affectedServices: (row.affected_services ?? []) as ServiceNodeId[],
    title: row.title,
    rootCauseSummary: row.root_cause_summary,
    webhookPayload: row.webhook_payload ?? {},
    slaTargetSeconds: row.sla_target_seconds,
    slaBreached: row.sla_breached,
    triggeredAt: new Date(row.triggered_at).getTime(),
    acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at).getTime() : null,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).getTime() : null,
    mttrSeconds: row.mttr_seconds,
    activityLogs: logs.map(mapActivityLogRow),
  };
}
