import { NextRequest, NextResponse } from 'next/server';
import {
  getSupabaseAdminClient,
  mapTicketRow,
  MON_TABLES,
  type MonIncidentActivityLogRow,
  type MonIncidentTicketRow,
} from '@/lib/supabase/server';
import type { TicketStatus } from '@/types/monitoring';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = new Set<TicketStatus>(['OPEN', 'INVESTIGATING', 'RESOLVED']);

async function findTicketRow(
  idParam: string,
  ticketNumberHint?: string
): Promise<MonIncidentTicketRow | null> {
  const admin = getSupabaseAdminClient();
  if (!admin) return null;

  if (UUID_REGEX.test(idParam)) {
    const { data } = await admin
      .from(MON_TABLES.tickets)
      .select('*')
      .eq('id', idParam)
      .maybeSingle<MonIncidentTicketRow>();
    if (data) return data;
  }

  const lookupNumber = ticketNumberHint?.trim() || idParam;
  const { data: byNumber } = await admin
    .from(MON_TABLES.tickets)
    .select('*')
    .eq('ticket_number', lookupNumber)
    .maybeSingle<MonIncidentTicketRow>();

  return byNumber ?? null;
}

/**
 * PATCH /api/incidents/[id]
 * Update ticket workflow status (OPEN -> INVESTIGATING -> RESOLVED), auto-mitigate, or append SRE work note.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const admin = getSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json(
      { synced: false, mode: 'LOCAL_CACHE' },
      { status: 202 }
    );
  }

  const { id } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  const ticketNumberHint =
    typeof body.ticketNumber === 'string' ? body.ticketNumber : undefined;
  const nextStatus =
    typeof body.status === 'string' && VALID_STATUSES.has(body.status as TicketStatus)
      ? (body.status as TicketStatus)
      : undefined;
  const workNote = typeof body.workNote === 'string' ? body.workNote.trim() : '';
  const autoMitigate = body.autoMitigate === true;

  if (!nextStatus && !workNote) {
    return NextResponse.json(
      { error: 'Either a valid status or workNote is required' },
      { status: 400 }
    );
  }

  try {
    const existing = await findTicketRow(id, ticketNumberHint);
    if (!existing) {
      return NextResponse.json({ error: 'Incident ticket not found' }, { status: 404 });
    }

    let latestTicket = existing;
    const nowIso = new Date().toISOString();

    if (nextStatus && nextStatus !== existing.status) {
      const patchPayload: Record<string, unknown> = { status: nextStatus };

      if (nextStatus === 'INVESTIGATING' && !existing.acknowledged_at) {
        patchPayload.acknowledged_at = nowIso;
      }

      if (nextStatus === 'RESOLVED') {
        const triggeredMs = new Date(existing.triggered_at).getTime();
        const computedMttr =
          typeof body.mttrSeconds === 'number' && Number.isFinite(body.mttrSeconds) && body.mttrSeconds > 0
            ? Math.round(body.mttrSeconds)
            : Math.max(1, Math.floor((Date.now() - triggeredMs) / 1000));

        patchPayload.resolved_at = nowIso;
        patchPayload.mttr_seconds = computedMttr;
        patchPayload.sla_breached =
          Math.floor((Date.now() - triggeredMs) / 1000) > existing.sla_target_seconds;
        patchPayload.webhook_payload = {
          ...(existing.webhook_payload ?? {}),
          status: 'RESOLVED',
          mttrSeconds: computedMttr,
        };
      }

      const { data: updated, error: updateError } = await admin
        .from(MON_TABLES.tickets)
        .update(patchPayload)
        .eq('id', existing.id)
        .select('*')
        .single<MonIncidentTicketRow>();

      if (updateError || !updated) {
        throw updateError ?? new Error('Failed to update incident status');
      }
      latestTicket = updated;

      const auditMessage = autoMitigate
        ? `Auto-mitigation sweep executed; all SLOs restored (MTTR ${updated.mttr_seconds ?? 1}s)`
        : `Ticket status transitioned ${existing.status} -> ${nextStatus}`;

      const { error: statusLogError } = await admin
        .from(MON_TABLES.activityLogs)
        .insert({
          ticket_id: existing.id,
          actor: autoMitigate ? 'AIOps Auto-Remediation' : 'SRE Operator',
          action_type: autoMitigate ? 'AUTO_MITIGATED' : 'STATUS_CHANGE',
          from_status: existing.status,
          to_status: nextStatus,
          message: auditMessage,
        });

      if (statusLogError) {
        throw statusLogError;
      }
    }

    if (workNote) {
      const { error: noteError } = await admin
        .from(MON_TABLES.activityLogs)
        .insert({
          ticket_id: existing.id,
          actor: 'SRE Operator',
          action_type: 'WORK_NOTE',
          message: workNote.slice(0, 600),
        });

      if (noteError) {
        throw noteError;
      }
    }

    const { data: allLogs, error: logsFetchError } = await admin
      .from(MON_TABLES.activityLogs)
      .select('*')
      .eq('ticket_id', existing.id)
      .order('created_at', { ascending: true });

    if (logsFetchError) {
      throw logsFetchError;
    }

    return NextResponse.json({
      synced: true,
      mode: 'SUPABASE_SYNCED',
      ticket: mapTicketRow(latestTicket, (allLogs ?? []) as MonIncidentActivityLogRow[]),
    });
  } catch (err) {
    console.error('[PATCH /api/incidents/[id]] Supabase update failed:', err);
    return NextResponse.json(
      {
        synced: false,
        mode: 'LOCAL_CACHE',
        error: 'Failed to sync incident update to Supabase',
      },
      { status: 503 }
    );
  }
}
