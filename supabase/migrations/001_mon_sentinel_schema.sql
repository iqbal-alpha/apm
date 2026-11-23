-- SENTINEL AIOps tables (mon_* prefix for shared Supabase database)

CREATE TABLE IF NOT EXISTS public.mon_incident_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT UNIQUE NOT NULL,
  problem_id TEXT NOT NULL,
  source_system TEXT NOT NULL DEFAULT 'Dynatrace Davis AI',
  target_itsm TEXT NOT NULL DEFAULT 'BMC Helix ITSM',
  severity TEXT NOT NULL DEFAULT 'P1' CHECK (severity IN ('P1', 'P2', 'P3')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'RESOLVED')),
  scenario_id TEXT NOT NULL,
  root_node_id TEXT NOT NULL,
  affected_services TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  title TEXT NOT NULL,
  root_cause_summary TEXT NOT NULL,
  webhook_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  sla_target_seconds INTEGER NOT NULL DEFAULT 900 CHECK (sla_target_seconds > 0),
  sla_breached BOOLEAN NOT NULL DEFAULT FALSE,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  mttr_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.mon_incident_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.mon_incident_tickets(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (
    action_type IN ('AUTO_CREATED', 'CASCADE_DETECTED', 'STATUS_CHANGE', 'WORK_NOTE', 'AUTO_MITIGATED', 'SLA_BREACH')
  ),
  from_status TEXT,
  to_status TEXT,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mon_idx_incident_tickets_status_triggered
  ON public.mon_incident_tickets (status, triggered_at DESC);

CREATE INDEX IF NOT EXISTS mon_idx_incident_tickets_number
  ON public.mon_incident_tickets (ticket_number);

CREATE INDEX IF NOT EXISTS mon_idx_activity_logs_ticket_created
  ON public.mon_incident_activity_logs (ticket_id, created_at ASC);

CREATE OR REPLACE FUNCTION public.mon_update_incident_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'mon_trg_incident_tickets_updated_at'
  ) THEN
    CREATE TRIGGER mon_trg_incident_tickets_updated_at
      BEFORE UPDATE ON public.mon_incident_tickets
      FOR EACH ROW
      EXECUTE FUNCTION public.mon_update_incident_updated_at();
  END IF;
END;
$$;

CREATE OR REPLACE VIEW public.mon_incident_metrics_summary
WITH (security_invoker = true)
AS
SELECT
  COUNT(*)::INTEGER AS total_incidents,
  COUNT(*) FILTER (WHERE status <> 'RESOLVED')::INTEGER AS active_incidents,
  COUNT(*) FILTER (WHERE severity = 'P1' AND status <> 'RESOLVED')::INTEGER AS active_p1_count,
  COALESCE(ROUND(AVG(mttr_seconds) FILTER (WHERE status = 'RESOLVED')), 0)::INTEGER AS avg_mttr_seconds,
  COALESCE(
    ROUND(
      (COUNT(*) FILTER (WHERE sla_breached = FALSE)::NUMERIC / NULLIF(COUNT(*), 0)) * 100,
      1
    ),
    100.0
  )::NUMERIC(5,1) AS sla_compliance_pct
FROM public.mon_incident_tickets;

ALTER TABLE public.mon_incident_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mon_incident_activity_logs ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.mon_incident_tickets TO anon, authenticated;
GRANT SELECT ON public.mon_incident_activity_logs TO anon, authenticated;
GRANT SELECT ON public.mon_incident_metrics_summary TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mon_incident_tickets' AND policyname = 'mon_allow_public_read_tickets'
  ) THEN
    CREATE POLICY "mon_allow_public_read_tickets"
      ON public.mon_incident_tickets
      FOR SELECT
      TO anon, authenticated
      USING (TRUE);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mon_incident_activity_logs' AND policyname = 'mon_allow_public_read_logs'
  ) THEN
    CREATE POLICY "mon_allow_public_read_logs"
      ON public.mon_incident_activity_logs
      FOR SELECT
      TO anon, authenticated
      USING (TRUE);
  END IF;
END;
$$;
