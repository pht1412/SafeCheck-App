-- =====================================================================
-- Migration: 20260921000000_fix_resolve_alarm_and_timeout.sql
-- Mục tiêu:
-- 1. Cho phép Cụ tự tắt báo động của chính mình (v_caller_id = p_elderly_id).
-- 2. Hỗ trợ tắt báo động trễ giờ TIMEOUT khi p_sos_event_id IS NULL.
-- 3. Cập nhật checkin_logs bằng cả elderly_id hoặc family_code (v_pairing_code).
-- 4. Backfill elderly_id cho các bản ghi checkin_logs còn thiếu.
-- =====================================================================

-- 1. Nâng cấp RPC resolve_alarm_atomic
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
  v_today DATE := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
BEGIN
  -- 1. Kiểm tra xác thực đăng nhập
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Yêu cầu đăng nhập để thực hiện tác vụ này');
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
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Chỉ người thân đã kết nối hoặc chính Cụ mới có quyền tắt báo động');
  END IF;

  -- 3. Lấy thông tin pairing_code và người gọi
  SELECT pairing_code INTO v_pairing_code FROM public.profiles WHERE id = p_elderly_id;
  SELECT full_name, role INTO v_caller_name, v_caller_role FROM public.profiles WHERE id = v_caller_id;

  -- 4. TRƯỜNG HỢP A: Báo động do TIMEOUT (p_sos_event_id IS NULL hoặc không có sự kiện nút bấm)
  IF p_sos_event_id IS NULL THEN
    UPDATE public.checkin_logs
    SET status = 'Safe',
        resolved_at = now(),
        resolved_by = v_caller_id,
        updated_at = now()
    WHERE (elderly_id = p_elderly_id OR family_code = v_pairing_code)
      AND log_date = v_today;

    INSERT INTO public.alarm_logs (
      elderly_id, sos_event_id, action,
      performed_by, performer_name, performer_role,
      previous_state, new_state, note
    ) VALUES (
      p_elderly_id, NULL, 'RESOLVE',
      v_caller_id, COALESCE(v_caller_name, 'Người thân'), COALESCE(v_caller_role, 'caregiver'),
      'Emergency', 'Safe', COALESCE(p_note, 'Giải tỏa báo động trễ giờ')
    );

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Đã tắt báo động thành công',
      'resolved_by', v_caller_id,
      'resolved_by_name', COALESCE(v_caller_name, 'Người thân'),
      'resolved_at', now()
    );
  END IF;

  -- 5. TRƯỜNG HỢP B: Báo động có sos_event_id (nút bấm SOS khẩn cấp)
  SELECT * INTO v_target_sos
  FROM public.sos_events
  WHERE id = p_sos_event_id AND elderly_id = p_elderly_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Fallback: Nếu không tìm thấy event nhưng ngày hôm nay đang Emergency, vẫn giải tỏa checkin_logs
    UPDATE public.checkin_logs
    SET status = 'Safe',
        resolved_at = now(),
        resolved_by = v_caller_id,
        updated_at = now()
    WHERE (elderly_id = p_elderly_id OR family_code = v_pairing_code)
      AND log_date = v_today;

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Đã tắt báo động thành công (sự kiện đã kết thúc trước đó)',
      'resolved_by', v_caller_id,
      'resolved_by_name', COALESCE(v_caller_name, 'Người thân'),
      'resolved_at', now()
    );
  END IF;

  IF v_target_sos.status = 'resolved' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'CONFLICT_ALREADY_RESOLVED',
      'message', 'Báo động này đã được giải quyết trước đó',
      'resolved_by', v_target_sos.resolved_by,
      'resolved_at', v_target_sos.resolved_at
    );
  END IF;

  -- Cập nhật sos_events
  UPDATE public.sos_events
  SET status = 'resolved',
      resolved_at = now(),
      resolved_by = v_caller_id,
      resolution_note = p_note
  WHERE id = v_target_sos.id;

  -- Phản chiếu trạng thái checkin_logs hôm nay về 'Safe'
  UPDATE public.checkin_logs
  SET status = 'Safe',
      resolved_at = now(),
      resolved_by = v_caller_id,
      updated_at = now()
  WHERE (elderly_id = p_elderly_id OR family_code = v_pairing_code)
    AND log_date = v_today;

  -- Ghi nhận audit trail
  INSERT INTO public.alarm_logs (
    elderly_id, sos_event_id, action,
    performed_by, performer_name, performer_role,
    previous_state, new_state, note
  ) VALUES (
    p_elderly_id, v_target_sos.id, 'RESOLVE',
    v_caller_id, COALESCE(v_caller_name, 'Người thân'), COALESCE(v_caller_role, 'caregiver'),
    'active', 'resolved', p_note
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Đã tắt báo động thành công',
    'sos_event_id', v_target_sos.id,
    'resolved_by', v_caller_id,
    'resolved_by_name', COALESCE(v_caller_name, 'Người thân'),
    'resolved_at', now()
  );
END;
$$;

-- 2. Phân quyền thực thi
REVOKE EXECUTE ON FUNCTION public.resolve_alarm_atomic(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_alarm_atomic(UUID, UUID, TEXT) TO authenticated;

-- 3. Đồng bộ elderly_id cho các bản ghi checkin_logs hiện có
UPDATE public.checkin_logs l
SET elderly_id = p.id
FROM public.profiles p
WHERE l.family_code = p.pairing_code
  AND l.elderly_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.checkin_logs dup
    WHERE dup.elderly_id = p.id AND dup.log_date = l.log_date
  );
