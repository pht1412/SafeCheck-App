-- ==============================================================================
-- Migration: 20261014000003_secure_escalation_scanner.sql
-- Mô tả: RPC SECURITY DEFINER cho phép Escalation Worker quét các sự kiện SOS quá hạn SLA
--        hoạt động tin cậy 100% ngay cả khi chạy với Anon Key (không bị RLS chặn).
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_overdue_sos_events(p_now TIMESTAMPTZ DEFAULT timezone('utc'::text, now()))
RETURNS TABLE (
    id UUID,
    elderly_id UUID,
    escalation_deadline TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    status VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    SELECT se.id, se.elderly_id, se.escalation_deadline, se.created_at, se.status
    FROM public.sos_events se
    WHERE se.status = 'active'
      AND se.escalation_deadline <= p_now;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_overdue_sos_events(TIMESTAMPTZ) TO service_role;
