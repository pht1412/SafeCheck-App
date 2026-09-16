-- ==============================================================================
-- SafeCheck - Migration: 20260911000000_concurrency_offline_schema.sql
-- Mô tả: Cung cấp cơ chế Concurrency Control (Atomic Resolve & Ping qua Row Lock)
--        và Offline Resilience (Idempotent SOS Insert + Audit Trail bất biến).
-- Tuân thủ: PRD_Deep_v1.md (v3.0) & implementation_plan.md
-- ==============================================================================

-- 1. BỔ SUNG IDEMPOTENCY KEY VÀO BẢNG SOS_EVENTS
ALTER TABLE public.sos_events
ADD COLUMN IF NOT EXISTS client_event_id UUID UNIQUE,
ADD COLUMN IF NOT EXISTS resolution_note TEXT;

CREATE INDEX IF NOT EXISTS idx_sos_events_client_id ON public.sos_events(client_event_id);

-- 2. BẢNG ALARM_LOGS (AUDIT TRAIL BẢO MẬT TỐI GIẢN - DATA MINIMIZATION)
-- Tuyệt đối KHÔNG lưu pairing_code trong bảng này
CREATE TABLE IF NOT EXISTS public.alarm_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    elderly_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    sos_event_id UUID REFERENCES public.sos_events(id) ON DELETE SET NULL,
    action VARCHAR(30) NOT NULL CHECK (action IN ('SOS_TRIGGERED', 'RESOLVE', 'PING', 'CHECKIN_SAFE')),
    performed_by UUID NOT NULL REFERENCES public.profiles(id),
    performer_name VARCHAR(100) NOT NULL,
    performer_role VARCHAR(20) NOT NULL,
    note TEXT,
    previous_state VARCHAR(30),
    new_state VARCHAR(30),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_alarm_logs_elderly ON public.alarm_logs(elderly_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alarm_logs_sos_event ON public.alarm_logs(sos_event_id);

-- Thiết lập Row Level Security (RLS) trên alarm_logs
ALTER TABLE public.alarm_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view relevant alarm logs" ON public.alarm_logs;
CREATE POLICY "Users can view relevant alarm logs"
ON public.alarm_logs FOR SELECT
USING (
  auth.uid() = elderly_id OR
  EXISTS (
    SELECT 1 FROM public.family_links fl
    WHERE fl.elderly_id = alarm_logs.elderly_id
      AND fl.caregiver_id = auth.uid()
      AND fl.status = 'accepted'
  )
);

-- 3. RPC FUNCTION: create_sos_event_idempotent
-- Tạo sự kiện SOS nguyên tử với Idempotency Key, chống race condition khi client retry
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

  -- 3. INSERT NGUYÊN TỬ VỚI ON CONFLICT (Triệt tiêu hoàn toàn race condition dạng SELECT -> INSERT)
  INSERT INTO public.sos_events (
    elderly_id, client_event_id, status, trigger_source
  ) VALUES (
    p_elderly_id, p_client_event_id, 'active', COALESCE(p_trigger_source, 'button')
  )
  ON CONFLICT (client_event_id) DO NOTHING
  RETURNING * INTO v_new_event;

  -- Nếu không có dòng nào được insert -> Request này là Duplicate/Retry do xung đột đồng thời
  IF v_new_event.id IS NULL THEN
    SELECT id, status, created_at INTO v_existing_event
    FROM public.sos_events
    WHERE client_event_id = p_client_event_id;

    RETURN jsonb_build_object(
      'success', true,
      'sos_event_id', v_existing_event.id,
      'status', v_existing_event.status,
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

  -- 5. Ghi Audit Log trong cùng transaction (Tuyệt đối không lưu pairing_code)
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
    'is_duplicate', false,
    'message', 'Đã kích hoạt sự kiện cứu hộ thành công'
  );
END;
$$;

-- 4. RPC FUNCTION: resolve_alarm_atomic
-- Tắt báo động nguyên tử qua khóa hàng sos_events FOR UPDATE, bắt buộc p_sos_event_id
CREATE OR REPLACE FUNCTION public.resolve_alarm_atomic(
  p_elderly_id UUID,
  p_sos_event_id UUID,
  p_note TEXT DEFAULT 'Xác nhận an toàn từ ứng dụng'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_caller_name VARCHAR(100);
  v_caller_role VARCHAR(20);
  v_pairing_code VARCHAR;
  v_target_sos RECORD;
  v_last_resolver_name VARCHAR;
  v_last_resolved_at TIMESTAMPTZ;
BEGIN
  -- 1. Bảo mật: Chặn đứng Anonymous Caller
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Yêu cầu đăng nhập để thực hiện tác vụ này' USING ERRCODE = '42501';
  END IF;

  -- 2. Kiểm tra tham số bắt buộc (Production path: bắt buộc có sos_event_id)
  IF p_sos_event_id IS NULL THEN
    RAISE EXCEPTION 'Bad Request: Yêu cầu cung cấp p_sos_event_id cần giải quyết' USING ERRCODE = '22023';
  END IF;

  -- 3. Xác thực quan hệ gia đình (Caregiver phải có link accepted hoặc chính Cụ)
  IF v_caller_id <> p_elderly_id AND NOT EXISTS (
    SELECT 1 FROM public.family_links
    WHERE elderly_id = p_elderly_id 
      AND caregiver_id = v_caller_id 
      AND status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'Forbidden: Bạn không có quyền giải quyết báo động của người dùng này' USING ERRCODE = '42501';
  END IF;

  -- 4. Lấy thông tin người thực hiện & pairing_code của Cụ
  SELECT full_name, role INTO v_caller_name, v_caller_role FROM public.profiles WHERE id = v_caller_id;
  SELECT pairing_code INTO v_pairing_code FROM public.profiles WHERE id = p_elderly_id;

  -- 5. KHÓA ĐÍCH DANH HÀNG SOS_EVENTS ĐƯỢC CHỈ ĐỊNH (Source of Truth)
  SELECT * INTO v_target_sos
  FROM public.sos_events
  WHERE id = p_sos_event_id AND elderly_id = p_elderly_id
  FOR UPDATE;

  -- 6. Xử lý trường hợp xung đột: Sự kiện không tồn tại hoặc đã được resolve trước đó
  IF v_target_sos.id IS NULL OR v_target_sos.status <> 'active' THEN
    -- Truy vấn nhanh ai là người vừa resolve sự kiện này trong alarm_logs
    SELECT performer_name, created_at 
    INTO v_last_resolver_name, v_last_resolved_at
    FROM public.alarm_logs
    WHERE sos_event_id = p_sos_event_id AND action = 'RESOLVE'
    ORDER BY created_at DESC LIMIT 1;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'CONFLICT_ALREADY_RESOLVED',
      'message', 'Báo động này đã được xử lý bởi ' || COALESCE(v_last_resolver_name, 'thành viên khác trong gia đình') || '.',
      'resolved_by_name', COALESCE(v_last_resolver_name, 'Người thân'),
      'resolved_at', v_last_resolved_at
    );
  END IF;

  -- 7. CẬP NHẬT NGUYÊN TỬ: Chuyển status sos_events sang 'resolved'
  UPDATE public.sos_events
  SET status = 'resolved',
      resolved_at = NOW(),
      resolved_by = v_caller_id,
      resolution_note = p_note
  WHERE id = v_target_sos.id;

  -- 8. Phản chiếu trạng thái checkin_logs hôm nay về 'Safe'
  IF v_pairing_code IS NOT NULL THEN
    UPDATE public.checkin_logs
    SET status = 'Safe'
    WHERE family_code = v_pairing_code AND log_date = CURRENT_DATE;
  END IF;

  -- 9. GHI AUDIT TRAIL TRONG CÙNG TRANSACTION (Tuyệt đối không lưu pairing_code)
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
    'message', 'Đã tắt báo động, xác nhận an toàn thành công',
    'sos_event_id', v_target_sos.id,
    'resolved_by', v_caller_name,
    'resolved_at', NOW()
  );
END;
$$;

-- 5. RPC FUNCTION: request_ping_atomic
-- Khóa hàng trên bảng profiles của Cụ để serialize các request Ping đồng thời
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

  -- 4. Kiểm tra thời điểm Ping gần nhất từ checkin_logs
  SELECT ping_requested_at INTO v_last_ping
  FROM public.checkin_logs
  WHERE family_code = v_pairing_code AND log_date = CURRENT_DATE;

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

  -- 6. Cập nhật hoặc tạo mới bản ghi checkin_logs ngày hôm nay
  INSERT INTO public.checkin_logs (family_code, log_date, status, ping_requested_at, elderly_id)
  VALUES (v_pairing_code, CURRENT_DATE, 'Ping_Requested', NOW(), p_elderly_id)
  ON CONFLICT (family_code, log_date)
  DO UPDATE SET status = 'Ping_Requested', ping_requested_at = NOW();

  -- 7. Ghi Audit Log vào alarm_logs (Không lưu pairing_code)
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

-- 6. SIẾT CHẶT PHÂN QUYỀN THỰC THI (DEFENSE-IN-DEPTH)
REVOKE EXECUTE ON FUNCTION public.create_sos_event_idempotent(UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resolve_alarm_atomic(UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_ping_atomic(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_sos_event_idempotent(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_alarm_atomic(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_ping_atomic(UUID) TO authenticated;
