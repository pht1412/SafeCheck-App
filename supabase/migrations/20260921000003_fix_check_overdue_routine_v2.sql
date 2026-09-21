-- =====================================================================
-- Migration: 20260921000003_fix_check_overdue_routine_v2.sql
-- Mục tiêu:
-- Khôi phục logic chuẩn của check_overdue_routine_v2:
-- 1. Materialize today's log cho mọi Cụ (điền cả elderly_id và family_code).
-- 2. Chuyển Early_Waiting -> Waiting, Waiting -> Late, Late -> Emergency.
-- 3. Chuyển Ping_Requested -> Overdue_Ping khi quá 15 phút.
-- 4. Không vi phạm NOT NULL của alarm_logs.performed_by.
-- =====================================================================

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

  -- 4. Quá 15 phút từ lúc Ping mà Cụ chưa phản hồi -> Chuyển thành Overdue_Ping
  UPDATE public.checkin_logs
  SET status = 'Overdue_Ping', 
      emergency_reason = 'OVERDUE_PING',
      emergency_triggered_at = now(),
      updated_at = now()
  WHERE log_date = v_today
    AND status = 'Ping_Requested'
    AND (now() - ping_requested_at) > INTERVAL '15 minutes';
END;
$$;
