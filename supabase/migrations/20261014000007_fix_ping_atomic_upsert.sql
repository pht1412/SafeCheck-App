-- ==============================================================================
-- SafeCheck Migration: 20261014000007_fix_ping_atomic_upsert.sql
-- Khắc phục triệt để lỗi xung đột UNIQUE constraint khi Ping & SOS
-- Đồng bộ hóa khóa tự nhiên (elderly_id, log_date) thay vì (family_code, log_date)
-- ==============================================================================

-- 1. Chuẩn hóa dữ liệu checkin_logs: Đảm bảo mọi dòng đều gắn với elderly_id chính xác
UPDATE public.checkin_logs l
SET elderly_id = p.id
FROM public.profiles p
WHERE l.elderly_id IS NULL AND l.family_code = p.pairing_code;

-- Đảm bảo có Unique Constraint (elderly_id, log_date)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_elderly_date'
  ) THEN
    ALTER TABLE public.checkin_logs ADD CONSTRAINT unique_elderly_date UNIQUE (elderly_id, log_date);
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- 2. Cập nhật RPC request_ping_atomic để ON CONFLICT trên (elderly_id, log_date)
CREATE OR REPLACE FUNCTION public.request_ping_atomic(
  p_elderly_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_caller_name VARCHAR(100);
  v_caller_email VARCHAR;
  v_pairing_code VARCHAR;
  v_last_ping TIMESTAMPTZ;
  v_cooldown_interval INTERVAL := INTERVAL '15 minutes';
  v_last_pinger_name VARCHAR;
  v_diff_seconds INT;
  v_locked_elderly_id UUID;
BEGIN
  -- 1. Bảo mật: Chặn Anonymous Caller
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Yêu cầu đăng nhập để gửi chuông kiểm tra' USING ERRCODE = '42501';
  END IF;

  -- 2. Kiểm tra quan hệ gia đình (chỉ Caregiver có liên kết accepted)
  IF NOT EXISTS (
    SELECT 1 FROM public.family_links
    WHERE elderly_id = p_elderly_id 
      AND caregiver_id = v_caller_id 
      AND status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'Forbidden: Bạn không có quyền gửi chuông cho Cụ này' USING ERRCODE = '42501';
  END IF;

  -- 3. KHÓA ROW PROFILES CỦA CỤ (Đối tượng đảm bảo luôn tồn tại 100% trong DB)
  SELECT id, pairing_code INTO v_locked_elderly_id, v_pairing_code
  FROM public.profiles
  WHERE id = p_elderly_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Không tìm thấy hồ sơ của Cụ');
  END IF;

  -- Lấy thông tin người gọi
  SELECT full_name, email INTO v_caller_name, v_caller_email FROM public.profiles WHERE id = v_caller_id;

  -- Hỗ trợ tài khoản tester: Cooldown rút ngắn còn 10 giây
  IF LOWER(COALESCE(v_caller_email, '')) = 'test01@gmail.com' THEN
    v_cooldown_interval := INTERVAL '10 seconds';
  END IF;

  -- 4. Kiểm tra thời điểm Ping gần nhất từ checkin_logs theo elderly_id
  SELECT ping_requested_at INTO v_last_ping
  FROM public.checkin_logs
  WHERE (elderly_id = p_elderly_id OR (v_pairing_code IS NOT NULL AND family_code = v_pairing_code))
    AND log_date = CURRENT_DATE
  ORDER BY created_at DESC LIMIT 1;

  -- 5. Nếu đang trong Cooldown -> Báo lỗi xung đột ngay lập tức
  IF v_last_ping IS NOT NULL AND (NOW() - v_last_ping) < v_cooldown_interval THEN
    v_diff_seconds := EXTRACT(EPOCH FROM (NOW() - v_last_ping))::INT;
    
    SELECT performer_name INTO v_last_pinger_name
    FROM public.alarm_logs
    WHERE elderly_id = p_elderly_id AND action = 'PING'
    ORDER BY created_at DESC LIMIT 1;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'CONFLICT_PING_ALREADY_SENT',
      'message', 'Chuông kiểm tra vừa được gửi bởi ' || COALESCE(v_last_pinger_name, 'thành viên khác') || ' cách đây ' || v_diff_seconds || ' giây.',
      'last_pinger_name', COALESCE(v_last_pinger_name, 'Người thân'),
      'remaining_seconds', EXTRACT(EPOCH FROM (v_cooldown_interval - (NOW() - v_last_ping)))::INT
    );
  END IF;

  -- 6. Cập nhật hoặc tạo mới bản ghi checkin_logs ngày hôm nay dựa trên (elderly_id, log_date)
  INSERT INTO public.checkin_logs (elderly_id, family_code, log_date, status, ping_requested_at)
  VALUES (p_elderly_id, v_pairing_code, CURRENT_DATE, 'Ping_Requested', NOW())
  ON CONFLICT (elderly_id, log_date)
  DO UPDATE SET 
    family_code = COALESCE(EXCLUDED.family_code, checkin_logs.family_code),
    status = 'Ping_Requested', 
    ping_requested_at = NOW();

  -- 7. Ghi Audit Log vào alarm_logs
  INSERT INTO public.alarm_logs (
    elderly_id, action, performed_by, performer_name, performer_role, new_state
  ) VALUES (
    p_elderly_id, 'PING', v_caller_id, COALESCE(v_caller_name, 'Người thân'), 'caregiver', 'Ping_Requested'
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Đã phát chuông kiểm tra tới máy Cụ'
  );
END;
$$;

-- 3. Cập nhật create_sos_event_idempotent để ON CONFLICT an toàn trên (elderly_id, log_date)
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

  -- Phản chiếu trạng thái sang checkin_logs hôm nay dựa trên (elderly_id, log_date)
  INSERT INTO public.checkin_logs (elderly_id, family_code, log_date, status, source)
  VALUES (p_elderly_id, v_pairing_code, CURRENT_DATE, 'Emergency', 'SOS')
  ON CONFLICT (elderly_id, log_date)
  DO UPDATE SET 
    family_code = COALESCE(EXCLUDED.family_code, checkin_logs.family_code),
    status = 'Emergency', 
    source = 'SOS';

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
    'status', v_new_event.status,
    'escalation_deadline', v_new_event.escalation_deadline,
    'is_duplicate', false,
    'message', 'Cảnh báo SOS khẩn cấp đã được kích hoạt thành công'
  );
END;
$$;

-- Phân quyền
REVOKE EXECUTE ON FUNCTION public.request_ping_atomic(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_ping_atomic(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_sos_event_idempotent(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sos_event_idempotent(UUID, UUID, TEXT) TO authenticated;
