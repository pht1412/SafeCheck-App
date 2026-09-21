-- =====================================================================
-- Migration: 20260921000001_fix_realtime_sos_and_sync.sql
-- Mục tiêu:
-- 1. Thêm sos_events vào supabase_realtime publication & thiết lập REPLICA IDENTITY FULL.
-- 2. Hoàn thiện resolve_alarm_atomic cho cả Cụ và Con cháu, giải quyết triệt để cả nút bấm SOS và TIMEOUT.
-- 3. Cập nhật trigger_sos, check_overdue_routine_v2, perform_checkin_atomic_v2 luôn điền đầy đủ cả elderly_id & family_code.
-- 4. Hợp nhất (deduplicate) các bản ghi checkin_logs bị phân mảnh (split rows) do thiếu liên kết.
-- =====================================================================

-- 1. Bổ sung sos_events vào Supabase Realtime & cấu hình REPLICA IDENTITY
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'sos_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sos_events;
  END IF;
END $$;

ALTER TABLE public.sos_events REPLICA IDENTITY FULL;
ALTER TABLE public.checkin_logs REPLICA IDENTITY FULL;

-- Xóa bỏ triệt để foreign key legacy trỏ từ checkin_logs sang configurations cũ (nếu còn sót)
ALTER TABLE public.checkin_logs DROP CONSTRAINT IF EXISTS checkin_logs_family_code_fkey;
DO $$ 
DECLARE
  c RECORD;
BEGIN
  FOR c IN 
    SELECT constraint_name 
    FROM information_schema.table_constraints 
    WHERE table_name = 'checkin_logs' AND constraint_type = 'FOREIGN KEY'
  LOOP
    IF c.constraint_name LIKE '%family_code%' THEN
      EXECUTE 'ALTER TABLE public.checkin_logs DROP CONSTRAINT IF EXISTS ' || quote_ident(c.constraint_name);
    END IF;
  END LOOP;
END $$;

-- 2. Nâng cấp hoàn chỉnh RPC resolve_alarm_atomic
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

  -- 4. Nếu có truyền p_sos_event_id cụ thể, kiểm tra xem đã được resolve trước đó chưa
  IF p_sos_event_id IS NOT NULL THEN
    SELECT * INTO v_target_sos
    FROM public.sos_events
    WHERE id = p_sos_event_id AND elderly_id = p_elderly_id
    FOR UPDATE;

    IF FOUND AND v_target_sos.status = 'resolved' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'CONFLICT_ALREADY_RESOLVED',
        'message', 'Báo động này đã được giải quyết trước đó',
        'resolved_by', v_target_sos.resolved_by,
        'resolved_at', v_target_sos.resolved_at
      );
    END IF;

    UPDATE public.sos_events
    SET status = 'resolved',
        resolved_at = now(),
        resolved_by = v_caller_id,
        resolution_note = p_note
    WHERE id = p_sos_event_id;
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

-- 3. Cập nhật trigger_sos luôn đồng bộ elderly_id và family_code
CREATE OR REPLACE FUNCTION public.trigger_sos(p_family_code VARCHAR)
RETURNS JSON 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, auth
AS $$
DECLARE
  v_clean_code VARCHAR := UPPER(TRIM(p_family_code));
  v_elderly_id UUID;
BEGIN
  SELECT id INTO v_elderly_id FROM public.profiles WHERE pairing_code = v_clean_code;

  -- Cập nhật dòng của hôm nay nếu đã có sẵn
  UPDATE public.checkin_logs
  SET status = 'Emergency',
      source = 'SOS',
      emergency_reason = 'SOS',
      family_code = COALESCE(family_code, v_clean_code),
      elderly_id = COALESCE(elderly_id, v_elderly_id),
      emergency_triggered_at = COALESCE(emergency_triggered_at, now()),
      updated_at = now()
  WHERE (family_code = v_clean_code OR (v_elderly_id IS NOT NULL AND elderly_id = v_elderly_id))
    AND log_date = CURRENT_DATE;

  IF NOT FOUND THEN
    INSERT INTO public.checkin_logs (family_code, elderly_id, log_date, status, source, emergency_reason, emergency_triggered_at)
    VALUES (v_clean_code, v_elderly_id, CURRENT_DATE, 'Emergency', 'SOS', 'SOS', now());
  END IF;

  RETURN json_build_object('success', true, 'message', 'Đã kích hoạt báo động khẩn cấp');
END;
$$;

-- 4. Cập nhật check_overdue_routine_v2 luôn điền cả elderly_id và family_code
CREATE OR REPLACE FUNCTION public.check_overdue_routine_v2()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
  v_current_time TIME := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::TIME;
BEGIN
  -- BƯỚC 0: MATERIALIZE TODAY'S LOGS CHO MỌI CỤ (Điền cả elderly_id và family_code)
  INSERT INTO public.checkin_logs (
    elderly_id, family_code, log_date, scheduled_start, scheduled_deadline, buffer_minutes, status
  )
  SELECT 
    p.id,
    p.pairing_code,
    v_today,
    COALESCE(s.checkin_start, '07:00:00'::TIME),
    COALESCE(s.checkin_deadline, '09:00:00'::TIME),
    COALESCE(s.emergency_buffer_minutes, 30),
    CASE 
      WHEN v_current_time < COALESCE(s.checkin_start, '07:00:00'::TIME) THEN 'Early_Waiting'
      WHEN v_current_time <= COALESCE(s.checkin_deadline, '09:00:00'::TIME) THEN 'Waiting'
      WHEN v_current_time <= (COALESCE(s.checkin_deadline, '09:00:00'::TIME) + (COALESCE(s.emergency_buffer_minutes, 30) || ' minutes')::INTERVAL) THEN 'Late'
      ELSE 'Emergency'
    END
  FROM public.profiles p
  LEFT JOIN public.checkin_schedules s ON p.id = s.elderly_id AND s.is_active = TRUE
  WHERE p.role = 'elderly'
  ON CONFLICT (elderly_id, log_date) DO UPDATE
  SET family_code = COALESCE(public.checkin_logs.family_code, EXCLUDED.family_code);

  -- 1. Chuyển Early_Waiting -> Waiting khi đến giờ checkin_start
  UPDATE public.checkin_logs l
  SET status = 'Waiting', updated_at = now()
  WHERE l.log_date = v_today
    AND l.status = 'Early_Waiting'
    AND v_current_time >= l.scheduled_start;

  -- 2. Chuyển Waiting -> Late khi quá checkin_deadline
  UPDATE public.checkin_logs l
  SET status = 'Late', updated_at = now()
  WHERE l.log_date = v_today
    AND l.status = 'Waiting'
    AND v_current_time > l.scheduled_deadline;

  -- 3. Chuyển Late -> Emergency khi quá buffer_minutes (Lưu emergency_reason = 'TIMEOUT')
  UPDATE public.checkin_logs l
  SET status = 'Emergency', 
      emergency_reason = 'TIMEOUT',
      emergency_triggered_at = COALESCE(l.emergency_triggered_at, now()),
      source = 'TIMEOUT', 
      updated_at = now()
  WHERE l.log_date = v_today
    AND l.status = 'Late'
    AND v_current_time > (l.scheduled_deadline + (l.buffer_minutes || ' minutes')::INTERVAL);

  -- 4. Ghi nhận nhật ký alarm_logs cho các ca timeout vừa phát tác
  INSERT INTO public.alarm_logs (
    elderly_id, action, performer_name, performer_role, 
    previous_state, new_state, note
  )
  SELECT 
    l.elderly_id,
    'TRIGGER_TIMEOUT',
    'SafeCheck System Cron',
    'system',
    'Late',
    'Emergency',
    'Hệ thống tự động kích hoạt báo động khẩn cấp do quá hạn điểm danh ' || l.buffer_minutes || ' phút'
  FROM public.checkin_logs l
  WHERE l.log_date = v_today
    AND l.status = 'Emergency'
    AND l.emergency_reason = 'TIMEOUT'
    AND NOT EXISTS (
      SELECT 1 FROM public.alarm_logs a 
      WHERE a.elderly_id = l.elderly_id 
        AND a.action = 'TRIGGER_TIMEOUT' 
        AND (a.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE = v_today
    );
END;
$$;

-- 5. Cập nhật perform_checkin_atomic_v2 luôn lưu family_code
CREATE OR REPLACE FUNCTION public.perform_checkin_atomic_v2(
  p_elderly_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_sched RECORD;
  v_today DATE;
  v_server_local_time TIME;
  v_today_log RECORD;
  v_pairing_code VARCHAR;
BEGIN
  -- 1. Xác thực caller chính là Cụ
  IF v_caller_id IS NULL OR v_caller_id <> p_elderly_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Chỉ Cụ mới có quyền bấm điểm danh');
  END IF;

  -- 2. Căn cứ thời gian lấy từ SERVER CLOCK (Asia/Ho_Chi_Minh)
  v_today := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
  v_server_local_time := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::TIME;

  -- 3. Đọc mã gia đình và cấu hình khung giờ của Cụ
  SELECT pairing_code INTO v_pairing_code FROM public.profiles WHERE id = p_elderly_id;
  SELECT * INTO v_sched 
  FROM public.checkin_schedules 
  WHERE elderly_id = p_elderly_id;

  IF NOT FOUND THEN
    v_sched.checkin_start := '07:00:00'::TIME;
    v_sched.checkin_deadline := '09:00:00'::TIME;
    v_sched.emergency_buffer_minutes := 30;
  END IF;

  -- 4. Kiểm tra bản ghi hôm nay
  SELECT * INTO v_today_log
  FROM public.checkin_logs
  WHERE elderly_id = p_elderly_id AND log_date = v_today;

  -- Bất biến 7: Chặn nếu đang trong Emergency
  IF FOUND AND v_today_log.status = 'Emergency' THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'STATE_IN_EMERGENCY', 
      'message', 'Hệ thống đang phát báo động khẩn cấp. Cần người thân xác nhận an toàn hoặc liên hệ hỗ trợ trực tiếp.'
    );
  END IF;

  -- 5. Chặn nếu chưa đến giờ bắt đầu (Server Time)
  IF v_server_local_time < v_sched.checkin_start THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'TOO_EARLY', 
      'message', 'Chưa đến giờ điểm danh. Cụ hãy quay lại sau ' || to_char(v_sched.checkin_start, 'HH24:MI')
    );
  END IF;

  -- 6. Ghi nhận an toàn (Safe)
  INSERT INTO public.checkin_logs (
    elderly_id, family_code, log_date, scheduled_start, scheduled_deadline, buffer_minutes, 
    status, checkin_time, source
  )
  VALUES (
    p_elderly_id, v_pairing_code, v_today, v_sched.checkin_start, v_sched.checkin_deadline, v_sched.emergency_buffer_minutes,
    'Safe', now(), 'Daily_Button'
  )
  ON CONFLICT (elderly_id, log_date) DO UPDATE
  SET status = 'Safe',
      family_code = COALESCE(public.checkin_logs.family_code, v_pairing_code),
      checkin_time = COALESCE(public.checkin_logs.checkin_time, now()),
      source = COALESCE(public.checkin_logs.source, 'Daily_Button'),
      updated_at = now()
  RETURNING * INTO v_today_log;

  -- 7. Audit trail
  INSERT INTO public.alarm_logs (
    elderly_id, action, performed_by, performer_name, performer_role, note, new_state
  )
  VALUES (
    p_elderly_id, 'CHECKIN_SAFE', p_elderly_id, 'Cụ', 'elderly', 'Điểm danh buổi sáng thành công', 'Safe'
  );

  RETURN jsonb_build_object(
    'success', true, 
    'message', 'Điểm danh an toàn thành công',
    'checkin_time', v_today_log.checkin_time
  );
END;
$$;

-- 6. HỢP NHẤT DỮ LIỆU CŨ: Dọn dẹp các bản ghi checkin_logs bị phân mảnh
DO $$
DECLARE
  p RECORD;
  d RECORD;
  best_id UUID;
  has_emergency BOOLEAN;
  v_source VARCHAR;
  v_reason VARCHAR;
  v_emergency_at TIMESTAMPTZ;
BEGIN
  FOR p IN SELECT id, pairing_code FROM public.profiles WHERE role = 'elderly' LOOP
    FOR d IN 
      SELECT DISTINCT log_date 
      FROM public.checkin_logs 
      WHERE elderly_id = p.id OR (p.pairing_code IS NOT NULL AND family_code = p.pairing_code)
    LOOP
      IF (SELECT COUNT(*) FROM public.checkin_logs WHERE (elderly_id = p.id OR (p.pairing_code IS NOT NULL AND family_code = p.pairing_code)) AND log_date = d.log_date) > 1 THEN
        SELECT 
          EXISTS(SELECT 1 FROM public.checkin_logs WHERE (elderly_id = p.id OR (p.pairing_code IS NOT NULL AND family_code = p.pairing_code)) AND log_date = d.log_date AND status = 'Emergency'),
          (SELECT source FROM public.checkin_logs WHERE (elderly_id = p.id OR (p.pairing_code IS NOT NULL AND family_code = p.pairing_code)) AND log_date = d.log_date AND status = 'Emergency' LIMIT 1),
          (SELECT emergency_reason FROM public.checkin_logs WHERE (elderly_id = p.id OR (p.pairing_code IS NOT NULL AND family_code = p.pairing_code)) AND log_date = d.log_date AND status = 'Emergency' LIMIT 1),
          (SELECT emergency_triggered_at FROM public.checkin_logs WHERE (elderly_id = p.id OR (p.pairing_code IS NOT NULL AND family_code = p.pairing_code)) AND log_date = d.log_date AND status = 'Emergency' LIMIT 1)
        INTO has_emergency, v_source, v_reason, v_emergency_at;

        SELECT id INTO best_id 
        FROM public.checkin_logs 
        WHERE (elderly_id = p.id OR (p.pairing_code IS NOT NULL AND family_code = p.pairing_code)) AND log_date = d.log_date
        ORDER BY (status = 'Emergency') DESC, updated_at DESC, id ASC
        LIMIT 1;

        DELETE FROM public.checkin_logs 
        WHERE (elderly_id = p.id OR (p.pairing_code IS NOT NULL AND family_code = p.pairing_code)) 
          AND log_date = d.log_date 
          AND id <> best_id;

        IF has_emergency THEN
          UPDATE public.checkin_logs
          SET elderly_id = p.id,
              family_code = p.pairing_code,
              status = 'Emergency',
              source = COALESCE(source, v_source, 'SOS'),
              emergency_reason = COALESCE(emergency_reason, v_reason, 'SOS'),
              emergency_triggered_at = COALESCE(emergency_triggered_at, v_emergency_at, now()),
              updated_at = now()
          WHERE id = best_id;
        ELSE
          UPDATE public.checkin_logs
          SET elderly_id = p.id,
              family_code = p.pairing_code
          WHERE id = best_id;
        END IF;

      ELSE
        UPDATE public.checkin_logs
        SET elderly_id = p.id,
            family_code = p.pairing_code
        WHERE (elderly_id = p.id OR (p.pairing_code IS NOT NULL AND family_code = p.pairing_code)) 
          AND log_date = d.log_date;
      END IF;
    END LOOP;
  END LOOP;
END $$;
