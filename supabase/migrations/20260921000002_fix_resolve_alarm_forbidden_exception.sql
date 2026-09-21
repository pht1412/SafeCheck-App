-- =====================================================================
-- Migration: 20260921000002_fix_resolve_alarm_forbidden_exception.sql
-- Mục tiêu:
-- Đảm bảo resolve_alarm_atomic phát sinh RAISE EXCEPTION khi Unauthorized / Forbidden
-- theo đúng chuẩn PostgreSQL Error 42501 mà bộ test TC07C và TC07D kiểm tra.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.resolve_alarm_atomic(
  p_elderly_id UUID,
  p_sos_event_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_is_authorized BOOLEAN := FALSE;
  v_target_sos RECORD;
  v_pairing_code VARCHAR;
  v_caller_name VARCHAR;
  v_caller_role VARCHAR;
  v_last_resolver_name VARCHAR;
  v_last_resolved_at TIMESTAMPTZ;
  v_today DATE := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
BEGIN
  -- 1. Kiểm tra xác thực đăng nhập (42501)
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Yêu cầu đăng nhập để thực hiện tác vụ này' USING ERRCODE = '42501';
  END IF;

  -- 2. Kiểm tra thẩm quyền: Cho phép chính Cụ (v_caller_id = p_elderly_id) HOẶC Caregiver đã kết nối accepted
  IF v_caller_id = p_elderly_id THEN
    v_is_authorized := TRUE;
  ELSE
    SELECT TRUE INTO v_is_authorized
    FROM public.family_links
    WHERE elderly_id = p_elderly_id
      AND caregiver_id = v_caller_id
      AND status = 'accepted';
  END IF;

  IF v_is_authorized IS NOT TRUE THEN
    RAISE EXCEPTION 'Forbidden: Bạn không có quyền giải quyết báo động của người dùng này' USING ERRCODE = '42501';
  END IF;

  -- 3. Lấy thông tin pairing_code và người gọi
  SELECT pairing_code INTO v_pairing_code FROM public.profiles WHERE id = p_elderly_id;
  SELECT full_name, role INTO v_caller_name, v_caller_role FROM public.profiles WHERE id = v_caller_id;

  -- 4. Nếu có truyền p_sos_event_id cụ thể, kiểm tra FOR UPDATE
  IF p_sos_event_id IS NOT NULL THEN
    SELECT * INTO v_target_sos
    FROM public.sos_events
    WHERE id = p_sos_event_id AND elderly_id = p_elderly_id
    FOR UPDATE;

    IF FOUND AND v_target_sos.status = 'resolved' THEN
      SELECT performer_name, created_at 
      INTO v_last_resolver_name, v_last_resolved_at
      FROM public.alarm_logs
      WHERE sos_event_id = p_sos_event_id AND action = 'RESOLVE'
      ORDER BY created_at DESC LIMIT 1;

      RETURN jsonb_build_object(
        'success', false,
        'error', 'CONFLICT_ALREADY_RESOLVED',
        'message', 'Báo động này đã được giải quyết trước đó bởi ' || COALESCE(v_last_resolver_name, 'người thân khác'),
        'resolved_by', v_target_sos.resolved_by,
        'resolved_at', v_target_sos.resolved_at
      );
    END IF;

    IF FOUND THEN
      UPDATE public.sos_events
      SET status = 'resolved',
          resolved_at = now(),
          resolved_by = v_caller_id,
          resolution_note = p_note
      WHERE id = p_sos_event_id;
    END IF;
  END IF;

  -- Luôn giải tỏa toàn bộ sự kiện sos_events active còn lại của Cụ này
  UPDATE public.sos_events
  SET status = 'resolved',
      resolved_at = now(),
      resolved_by = v_caller_id,
      resolution_note = COALESCE(p_note, 'Tắt báo động')
  WHERE elderly_id = p_elderly_id AND status = 'active';

  -- 5. Cập nhật checkin_logs hôm nay về 'Safe'
  UPDATE public.checkin_logs
  SET status = 'Safe',
      resolved_at = now(),
      resolved_by = v_caller_id,
      updated_at = now()
  WHERE (elderly_id = p_elderly_id OR (v_pairing_code IS NOT NULL AND family_code = v_pairing_code))
    AND log_date = v_today;

  -- 6. Ghi nhật ký audit trail
  INSERT INTO public.alarm_logs (
    elderly_id, sos_event_id, action,
    performed_by, performer_name, performer_role,
    previous_state, new_state, note
  ) VALUES (
    p_elderly_id, p_sos_event_id, 'RESOLVE',
    v_caller_id, COALESCE(v_caller_name, 'Người thân'), COALESCE(v_caller_role, 'caregiver'),
    'Emergency', 'Safe', COALESCE(p_note, 'Tắt báo động')
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Đã tắt báo động thành công',
    'sos_event_id', p_sos_event_id,
    'resolved_by', v_caller_id,
    'resolved_by_name', COALESCE(v_caller_name, 'Người thân'),
    'resolved_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_alarm_atomic(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_alarm_atomic(UUID, UUID, TEXT) TO authenticated;
