-- ==============================================================================
-- Migration: 20260923000000_sos_escalation_schema.sql
-- Mô tả: Thêm escalation_deadline và escalated_at vào sos_events,
--        RPC escalate_sos_event_atomic (nguyên tử), nâng cấp create_sos_event_idempotent
--        và hoàn thiện liên kết với sos_acknowledgements.
-- Tuân thủ: PRD_Deep_v2.md (v2.1) & Implementation Plan Phase 3
-- ==============================================================================

-- 1. BỔ SUNG CỘT SLA DEADLINE VÀ ESCALATED_AT VÀO sos_events
ALTER TABLE public.sos_events
ADD COLUMN IF NOT EXISTS escalation_deadline TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sos_events_deadline ON public.sos_events(escalation_deadline)
WHERE status = 'active';

-- 2. CẬP NHẬT RPC: create_sos_event_idempotent
-- Tự động tính escalation_deadline = now() + INTERVAL '120 seconds'
CREATE OR REPLACE FUNCTION public.create_sos_event_idempotent(
  p_elderly_id UUID,
  p_client_event_id UUID,
  p_trigger_source TEXT DEFAULT 'button'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_existing_event RECORD;
  v_new_event RECORD;
  v_pairing_code VARCHAR;
  v_caller_name VARCHAR;
  v_caller_role VARCHAR;
  v_deadline TIMESTAMPTZ := timezone('utc'::text, now()) + INTERVAL '120 seconds';
BEGIN
  -- 1. Bảo mật: Chặn đứng Anonymous Caller
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Yêu cầu đăng nhập để thực hiện tác vụ này' USING ERRCODE = '42501';
  END IF;

  -- 2. Xác thực quyền: Người gọi phải là Cụ hoặc con cháu đã liên kết accepted
  IF v_caller_id <> p_elderly_id AND NOT EXISTS (
    SELECT 1 FROM public.family_links
    WHERE elderly_id = p_elderly_id 
      AND caregiver_id = v_caller_id 
      AND status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'Forbidden: Bạn không có quyền kích hoạt báo động cho người dùng này' USING ERRCODE = '42501';
  END IF;

  -- 3. INSERT NGUYÊN TỬ VỚI ON CONFLICT VÀ GÁN escalation_deadline BỀN VỮNG
  INSERT INTO public.sos_events (
    elderly_id, client_event_id, status, trigger_source, escalation_deadline
  ) VALUES (
    p_elderly_id, p_client_event_id, 'active', COALESCE(p_trigger_source, 'button'), v_deadline
  )
  ON CONFLICT (client_event_id) DO NOTHING
  RETURNING * INTO v_new_event;

  -- Nếu không có dòng nào được insert -> Request này là Duplicate/Retry
  IF v_new_event.id IS NULL THEN
    SELECT id, status, created_at, escalation_deadline INTO v_existing_event
    FROM public.sos_events
    WHERE client_event_id = p_client_event_id;

    RETURN jsonb_build_object(
      'success', true,
      'sos_event_id', v_existing_event.id,
      'status', v_existing_event.status,
      'escalation_deadline', v_existing_event.escalation_deadline,
      'is_duplicate', true,
      'message', 'Sự kiện đã được ghi nhận trước đó (Idempotent ACK)'
    );
  END IF;

  -- 4. Đọc pairing_code và profile để phản chiếu trạng thái
  SELECT pairing_code INTO v_pairing_code FROM public.profiles WHERE id = p_elderly_id;
  SELECT full_name, role INTO v_caller_name, v_caller_role FROM public.profiles WHERE id = v_caller_id;

  -- Phản chiếu trạng thái sang checkin_logs hôm nay
  IF v_pairing_code IS NOT NULL THEN
    INSERT INTO public.checkin_logs (family_code, log_date, status, source)
    VALUES (v_pairing_code, CURRENT_DATE, 'Emergency', 'SOS')
    ON CONFLICT (family_code, log_date)
    DO UPDATE SET status = 'Emergency', source = 'SOS';
  END IF;

  -- 5. Ghi Audit Log trong cùng transaction
  INSERT INTO public.alarm_logs (
    elderly_id, sos_event_id, action,
    performed_by, performer_name, performer_role, new_state
  ) VALUES (
    p_elderly_id, v_new_event.id, 'SOS_TRIGGERED',
    v_caller_id, COALESCE(v_caller_name, 'Người dùng'), COALESCE(v_caller_role, 'elderly'), 'Emergency'
  );

  RETURN jsonb_build_object(
    'success', true,
    'sos_event_id', v_new_event.id,
    'status', 'active',
    'escalation_deadline', v_new_event.escalation_deadline,
    'is_duplicate', false,
    'message', 'Đã kích hoạt sự kiện cứu hộ thành công'
  );
END;
$$;

-- 3. RPC NGUYÊN TỬ: escalate_sos_event_atomic
-- Chuyển trạng thái sang Escalation nếu quá deadline và chưa có ai tiếp nhận
CREATE OR REPLACE FUNCTION public.escalate_sos_event_atomic(
  p_sos_event_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_event RECORD;
  v_has_ack BOOLEAN;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  -- 1. Bảo mật
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- 2. Khóa hàng sự kiện SOS FOR UPDATE
  SELECT * INTO v_event
  FROM public.sos_events
  WHERE id = p_sos_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'SOS_EVENT_NOT_FOUND');
  END IF;

  IF v_event.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SOS_EVENT_NOT_ACTIVE', 'status', v_event.status);
  END IF;

  -- 3. Xác thực quyền (Cụ bà hoặc con cháu liên kết)
  IF v_caller_id <> v_event.elderly_id AND NOT EXISTS (
    SELECT 1 FROM public.family_links
    WHERE elderly_id = v_event.elderly_id
      AND caregiver_id = v_caller_id
      AND status = 'accepted'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden');
  END IF;

  -- 4. Kiểm tra xem đã có ai tiếp nhận chưa
  SELECT EXISTS (
    SELECT 1 FROM public.sos_acknowledgements
    WHERE sos_event_id = p_sos_event_id
  ) INTO v_has_ack;

  -- Nếu đã có người thân tiếp nhận -> Không cho phép leo thang
  IF v_has_ack THEN
    RETURN jsonb_build_object(
      'success', true,
      'escalated', false,
      'reason', 'ALREADY_ACKNOWLEDGED',
      'message', 'Đã có người thân tiếp nhận sự kiện, không kích hoạt leo thang'
    );
  END IF;

  -- 5. Kiểm tra thời hạn deadline
  IF v_event.escalation_deadline IS NOT NULL AND v_event.escalation_deadline > v_now THEN
    RETURN jsonb_build_object(
      'success', true,
      'escalated', false,
      'reason', 'SLA_NOT_EXPIRED',
      'remaining_seconds', EXTRACT(EPOCH FROM (v_event.escalation_deadline - v_now))
    );
  END IF;

  -- 6. Kích hoạt Escalation nguyên tử
  UPDATE public.sos_events
  SET escalated_at = v_now
  WHERE id = p_sos_event_id
    AND escalated_at IS NULL;

  -- 7. Ghi Audit Log
  INSERT INTO public.alarm_logs (
    elderly_id, sos_event_id, action,
    performed_by, performer_name, performer_role, new_state, note
  ) VALUES (
    v_event.elderly_id, p_sos_event_id, 'SOS_ESCALATED',
    v_caller_id, 'Hệ thống SafeCheck', 'system', 'Escalated', 'Hết hạn SLA 120s không có người thân tiếp nhận'
  );

  RETURN jsonb_build_object(
    'success', true,
    'escalated', true,
    'escalated_at', v_now,
    'message', 'Đã kích hoạt chế độ leo thang cứu hộ khẩn cấp'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.escalate_sos_event_atomic(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.escalate_sos_event_atomic(UUID) TO authenticated, service_role;
