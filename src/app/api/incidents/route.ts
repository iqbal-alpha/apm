import { NextRequest, NextResponse } from 'next/server';
import {
  getSupabaseAdminClient,
  getSupabaseAnonServerClient,
  mapTicketRow,
  MON_TABLES,
  type MonIncidentActivityLogRow,
  type MonIncidentMetricsSummaryRow,
  type MonIncidentTicketRow,
} from '@/lib/supabase/server';

const VALID_SEVERITIES = new Set(['P1', 'P2', 'P3']);
const VALID_STATUSES = new Set(['OPEN', 'INVESTIGATING', 'RESOLVED']);
const VALID_ACTIONS = new Set([
  'AUTO_CREATED',
  'CASCADE_DETECTED',
  'STATUS_CHANGE',
  'WORK_NOTE',
  'AUTO_MITIGATED',
  'SLA_BREACH',
]);

/**
 * GET /api/incidents
 * Fetch persisted SENTINEL BMC Helix incident tickets, activity audit logs, and KPI view summary.
 */
export async function GET() {
  const client = getSupabaseAdminClient() ?? getSupabaseAnonServerClient();
  if (!client) {
    return NextResponse.json({
      configured: false,
      mode: 'LOCAL_CACHE',
      tickets: [],
      summary: null,
    });
  }

  try {
    const { data: ticketRows, error: ticketError } = await client
      .from(MON_TABLES.tickets)
      .select('*')
      .order('triggered_at', { ascending: false })
      .limit(25);

    if (ticketError) {
      throw ticketError;
    }

    const typedTickets = (ticketRows ?? []) as MonIncidentTicketRow[];
    const ticketIds = typedTickets.map((t) => t.id);

    let typedLogs: MonIncidentActivityLogRow[] = [];
    if (ticketIds.length > 0) {
      const { data: logRows, error: logError } = await client
        .from(MON_TABLES.activityLogs)
        .select('*')
        .in('ticket_id', ticketIds)
        .order('created_at', { ascending: true });

      if (logError) {
        throw logError;
      }
      typedLogs = (logRows ?? []) as MonIncidentActivityLogRow[];
    }

    const logsByTicketId = new Map<string, MonIncidentActivityLogRow[]>();
    for (const log of typedLogs) {
      const existing = logsByTicketId.get(log.ticket_id) ?? [];
      existing.push(log);
      logsByTicketId.set(log.ticket_id, existing);
    }

    const tickets = typedTickets.map((row) =>
      mapTicketRow(row, logsByTicketId.get(row.id) ?? [])
    );

    const { data: summaryRow } = await client
      .from(MON_TABLES.metricsSummary)
      .select('*')
      .maybeSingle<MonIncidentMetricsSummaryRow>();

    return NextResponse.json({
      configured: true,
      mode: 'SUPABASE_SYNCED',
      tickets,
      summary: summaryRow ?? null,
    });
  } catch (err) {
    console.error('[GET /api/incidents] Supabase read failed:', err);
    return NextResponse.json(
      {
        configured: true,
        mode: 'LOCAL_CACHE',
        tickets: [],
        summary: null,
        error: 'Database unavailable, operating in local cache mode',
      },
      { status: 503 }
    );
  }
}

/**
 * POST /api/incidents
 * Persist a newly triggered Dynatrace -> BMC Helix incident ticket and initial audit entries.
 */
export async function POST(req: NextRequest) {
  const admin = getSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json(
      { synced: false, mode: 'LOCAL_CACHE' },
      { status: 202 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  const ticketNumber = typeof body.ticketNumber === 'string' ? body.ticketNumber.trim() : '';
  const problemId = typeof body.problemId === 'string' ? body.problemId.trim() : '';
  const scenarioId = typeof body.scenarioId === 'string' ? body.scenarioId.trim() : '';
  const rootNodeId = typeof body.rootNodeId === 'string' ? body.rootNodeId.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const rootCauseSummary =
    typeof body.rootCauseSummary === 'string' ? body.rootCauseSummary.trim() : '';

  if (!ticketNumber || !problemId || !scenarioId || !rootNodeId || !title || !rootCauseSummary) {
    return NextResponse.json(
      { error: 'Missing required incident fields' },
      { status: 400 }
    );
  }

  const severity =
    typeof body.severity === 'string' && VALID_SEVERITIES.has(body.severity)
      ? body.severity
      : 'P1';
  const status =
    typeof body.status === 'string' && VALID_STATUSES.has(body.status)
      ? body.status
      : 'OPEN';
  const affectedServices = Array.isArray(body.affectedServices)
    ? body.affectedServices.filter((item): item is string => typeof item === 'string')
    : [rootNodeId];
  const webhookPayload =
    body.webhookPayload && typeof body.webhookPayload === 'object' && !Array.isArray(body.webhookPayload)
      ? (body.webhookPayload as Record<string, unknown>)
      : {};
  const slaTargetSeconds =
    typeof body.slaTargetSeconds === 'number' && Number.isFinite(body.slaTargetSeconds) && body.slaTargetSeconds > 0
      ? Math.round(body.slaTargetSeconds)
      : 900;
  const triggeredAtIso =
    typeof body.triggeredAt === 'number' && Number.isFinite(body.triggeredAt)
      ? new Date(body.triggeredAt).toISOString()
      : new Date().toISOString();

  try {
    const { data: upsertedRow, error: insertError } = await admin
      .from(MON_TABLES.tickets)
      .upsert(
        {
          ticket_number: ticketNumber,
          problem_id: problemId,
          source_system:
            typeof body.sourceSystem === 'string' ? body.sourceSystem : 'Dynatrace Davis AI',
          target_itsm:
            typeof body.targetItsm === 'string' ? body.targetItsm : 'BMC Helix ITSM',
          severity,
          status,
          scenario_id: scenarioId,
          root_node_id: rootNodeId,
          affected_services: affectedServices,
          title,
          root_cause_summary: rootCauseSummary,
          webhook_payload: webhookPayload,
          sla_target_seconds: slaTargetSeconds,
          sla_breached: Boolean(body.slaBreached),
          triggered_at: triggeredAtIso,
        },
        { onConflict: 'ticket_number' }
      )
      .select('*')
      .single<MonIncidentTicketRow>();

    if (insertError || !upsertedRow) {
      throw insertError ?? new Error('Failed to upsert incident ticket');
    }

    const incomingLogs = Array.isArray(body.activityLogs) ? body.activityLogs : [];
    const logsToInsert = incomingLogs
      .filter(
        (item): item is Record<string, unknown> =>
          Boolean(item && typeof item === 'object' && typeof (item as Record<string, unknown>).message === 'string')
      )
      .map((item) => ({
        ticket_id: upsertedRow.id,
        actor: typeof item.actor === 'string' ? item.actor : 'Dynatrace Davis AI',
        action_type:
          typeof item.actionType === 'string' && VALID_ACTIONS.has(item.actionType)
            ? item.actionType
            : 'AUTO_CREATED',
        from_status: typeof item.fromStatus === 'string' ? item.fromStatus : null,
        to_status: typeof item.toStatus === 'string' ? item.toStatus : null,
        message: String(item.message).slice(0, 600),
      }));

    if (logsToInsert.length === 0) {
      logsToInsert.push({
        ticket_id: upsertedRow.id,
        actor: 'Dynatrace Davis AI',
        action_type: 'AUTO_CREATED',
        from_status: null,
        to_status: status,
        message: `Problem ${problemId} correlated -> BMC Helix Webhook 201 CREATED (${ticketNumber})`,
      });
    }

    const { data: insertedLogs, error: logError } = await admin
      .from(MON_TABLES.activityLogs)
      .insert(logsToInsert)
      .select('*');

    if (logError) {
      throw logError;
    }

    return NextResponse.json(
      {
        synced: true,
        mode: 'SUPABASE_SYNCED',
        ticket: mapTicketRow(upsertedRow, (insertedLogs ?? []) as MonIncidentActivityLogRow[]),
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[POST /api/incidents] Supabase persist failed:', err);
    return NextResponse.json(
      {
        synced: false,
        mode: 'LOCAL_CACHE',
        error: 'Failed to persist incident to Supabase',
      },
      { status: 503 }
    );
  }
}
