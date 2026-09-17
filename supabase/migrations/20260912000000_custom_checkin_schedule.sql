-- ====================================================================
-- SafeCheck - Migration v4.0: Custom Check-in Schedule & Dynamic Engine
-- PRD: PRD_CHECKIN_SCHEDULE.md (v1.2)
-- ====================================================================

-- 1. BẢNG CẤU HÌNH LỊCH ĐIỂM DANH THEO TỪNG CỤ
CREATE TABLE IF NOT EXISTS public.checkin_schedules (
  elderly_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  checkin_start TIME NOT NULL DEFAULT '07:00:00',
  checkin_deadline TIME NOT NULL DEFAULT '09:00:00',
  emergency_buffer_minutes INT NOT NULL DEFAULT 30,
  timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Bất biến 2, 7 & 9: Ràng buộc múi giờ & Không tràn ngày qua Epoch (< 86400s)
  CONSTRAINT check_timezone_vn CHECK (timezone = 'Asia/Ho_Chi_Minh'),
  CONSTRAINT check_start_before_deadline CHECK (checkin_start < checkin_deadline),
  CONSTRAINT check_valid_buffer CHECK (emergency_buffer_minutes BETWEEN 5 AND 120),
  CONSTRAINT check_no_day_overflow CHECK (
    (EXTRACT(EPOCH FROM checkin_deadline) + (emergency_buffer_minutes * 60)) < 86400
  )
);

CREATE INDEX IF NOT EXISTS idx_checkin_schedules_active 
ON public.checkin_schedules(elderly_id) WHERE is_active = TRUE;

-- Đăng ký Realtime publication cho checkin_schedules
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'checkin_schedules'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.checkin_schedules;
  END IF;
END $$;


-- 2. MỞ RỘNG BẢNG CHECKIN_LOGS CHO HISTORY & SNAPSHOTTING
ALTER TABLE public.checkin_logs 
ADD COLUMN IF NOT EXISTS scheduled_start TIME DEFAULT '07:00:00',
ADD COLUMN IF NOT EXISTS scheduled_deadline TIME DEFAULT '09:00:00',
ADD COLUMN IF NOT EXISTS buffer_minutes INT DEFAULT 30,
ADD COLUMN IF NOT EXISTS emergency_reason VARCHAR(30),
ADD COLUMN IF NOT EXISTS emergency_triggered_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Đảm bảo check constraint emergency_reason hợp lệ nếu chưa có
DO $$ BEGIN
  ALTER TABLE public.checkin_logs 
  ADD CONSTRAINT check_emergency_reason 
  CHECK (emergency_reason IS NULL OR emergency_reason IN ('TIMEOUT', 'SOS', 'OVERDUE_PING'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- Đảm bảo có Unique Constraint (elderly_id, log_date) phục vụ ON CONFLICT
DO $$ BEGIN
  UPDATE public.checkin_logs l
  SET elderly_id = p.id
  FROM public.profiles p
  WHERE l.elderly_id IS NULL AND l.family_code = p.pairing_code;

  DELETE FROM public.checkin_logs WHERE elderly_id IS NULL;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_elderly_date'
  ) THEN
    ALTER TABLE public.checkin_logs ADD CONSTRAINT unique_elderly_date UNIQUE (elderly_id, log_date);
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- Đảm bảo checkin_logs nằm trong Supabase Realtime
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'checkin_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.checkin_logs;
  END IF;
END $$;

-- Bất biến 3: Trigger bảo vệ Snapshot Immutability ở tầng DB
CREATE OR REPLACE FUNCTION public.enforce_checkin_log_immutability()
RETURNS TRIGGER 
LANGUAGE plpgsql
AS $$
BEGIN
  -- 1. Cấm sửa đổi dữ liệu điểm danh của log quá khứ
  IF OLD.log_date < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.checkin_time IS DISTINCT FROM OLD.checkin_time
       OR NEW.scheduled_start IS DISTINCT FROM OLD.scheduled_start
       OR NEW.scheduled_deadline IS DISTINCT FROM OLD.scheduled_deadline
       OR NEW.buffer_minutes IS DISTINCT FROM OLD.buffer_minutes THEN
      RAISE EXCEPTION 'Bảo mật: Bản ghi điểm danh quá khứ là bất biến tuyệt đối (Immutable)!';
    END IF;
  END IF;

  -- 2. Đối với log hôm nay, nếu đã đạt Safe hoặc Emergency, cấm đổi snapshot mốc giờ
  IF OLD.status IN ('Safe', 'Emergency') THEN
    IF NEW.scheduled_start IS DISTINCT FROM OLD.scheduled_start
       OR NEW.scheduled_deadline IS DISTINCT FROM OLD.scheduled_deadline
       OR NEW.buffer_minutes IS DISTINCT FROM OLD.buffer_minutes THEN
      RAISE EXCEPTION 'Bảo mật: Không được phép thay đổi mốc giờ snapshot khi ngày đã Safe hoặc Emergency!';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_checkin_log_immutability ON public.checkin_logs;
CREATE TRIGGER tr_enforce_checkin_log_immutability
BEFORE UPDATE ON public.checkin_logs
FOR EACH ROW EXECUTE FUNCTION public.enforce_checkin_log_immutability();


-- 3. CỦNG CỐ ROW LEVEL SECURITY (RLS)

-- 3.1. RLS cho checkin_schedules (Chặn DELETE hoàn toàn)
ALTER TABLE public.checkin_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Elderly and Caregivers view schedule" ON public.checkin_schedules;
CREATE POLICY "Elderly and Caregivers view schedule"
ON public.checkin_schedules FOR SELECT
USING (
  auth.uid() = elderly_id 
  OR EXISTS (
    SELECT 1 FROM public.family_links fl
    WHERE fl.elderly_id = checkin_schedules.elderly_id
      AND fl.caregiver_id = auth.uid()
      AND fl.status = 'accepted'
  )
);

DROP POLICY IF EXISTS "Caregivers insert linked elderly schedule" ON public.checkin_schedules;
CREATE POLICY "Caregivers insert linked elderly schedule"
ON public.checkin_schedules FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.family_links fl
    WHERE fl.elderly_id = checkin_schedules.elderly_id
      AND fl.caregiver_id = auth.uid()
      AND fl.status = 'accepted'
  )
);

DROP POLICY IF EXISTS "Caregivers update linked elderly schedule" ON public.checkin_schedules;
CREATE POLICY "Caregivers update linked elderly schedule"
ON public.checkin_schedules FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.family_links fl
    WHERE fl.elderly_id = checkin_schedules.elderly_id
      AND fl.caregiver_id = auth.uid()
      AND fl.status = 'accepted'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.family_links fl
    WHERE fl.elderly_id = checkin_schedules.elderly_id
      AND fl.caregiver_id = auth.uid()
      AND fl.status = 'accepted'
  )
);
-- KHÔNG CÓ POLICY DELETE CHO checkin_schedules (Bất biến 8)

-- 3.2. Audit RLS trên checkin_logs: Cấm direct mutations từ client
ALTER TABLE public.checkin_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Elderly insert own checkin logs" ON public.checkin_logs;
DROP POLICY IF EXISTS "Elderly update own checkin logs" ON public.checkin_logs;
DROP POLICY IF EXISTS "Caregivers update linked elderly checkin logs" ON public.checkin_logs;
DROP POLICY IF EXISTS "Caregivers insert linked elderly checkin logs" ON public.checkin_logs;
DROP POLICY IF EXISTS "Elderly delete own checkin logs" ON public.checkin_logs;
DROP POLICY IF EXISTS "Caregivers delete linked elderly checkin logs" ON public.checkin_logs;

DROP POLICY IF EXISTS "Elderly view own checkin logs" ON public.checkin_logs;
CREATE POLICY "Elderly view own checkin logs"
ON public.checkin_logs FOR SELECT
USING (auth.uid() = elderly_id);

DROP POLICY IF EXISTS "Caregivers view linked elderly checkin logs" ON public.checkin_logs;
CREATE POLICY "Caregivers view linked elderly checkin logs"
ON public.checkin_logs FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.family_links fl
    WHERE fl.elderly_id = checkin_logs.elderly_id
      AND fl.caregiver_id = auth.uid()
      AND fl.status = 'accepted'
  )
);


-- 4. CÁC HÀM XỬ LÝ NGHIỆP VỤ (SECURITY DEFINER RPCs)

-- 4.1. Hàm cập nhật cấu hình khung giờ: update_checkin_schedule
CREATE OR REPLACE FUNCTION public.update_checkin_schedule(
  p_elderly_id UUID,
  p_start TIME,
  p_deadline TIME,
  p_buffer_minutes INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_is_authorized BOOLEAN := FALSE;
  v_today DATE;
  v_today_log RECORD;
  v_current_local_time TIME;
  v_new_status VARCHAR;
BEGIN
  -- 1. Kiểm tra xác thực
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Yêu cầu đăng nhập');
  END IF;

  -- 2. Kiểm tra quyền Caregiver đã kết nối hợp lệ
  SELECT TRUE INTO v_is_authorized
  FROM public.family_links
  WHERE elderly_id = p_elderly_id
    AND caregiver_id = v_caller_id
    AND status = 'accepted';

  IF NOT FOUND OR v_is_authorized IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Chỉ người thân đã kết nối mới có quyền đổi giờ');
  END IF;

  -- 3. Kiểm tra tính hợp lệ của thời gian (Bất biến 2)
  IF p_start >= p_deadline THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_RANGE', 'message', 'Giờ bắt đầu phải trước giờ hạn chót');
  END IF;

  IF p_buffer_minutes < 5 OR p_buffer_minutes > 120 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_BUFFER', 'message', 'Thời gian chờ phải từ 5 đến 120 phút');
  END IF;

  IF (EXTRACT(EPOCH FROM p_deadline) + (p_buffer_minutes * 60)) >= 86400 THEN
    RETURN jsonb_build_object('success', false, 'error', 'DAY_OVERFLOW', 'message', 'Hạn chót cộng thời gian chờ không được vượt quá 23:59 trong ngày');
  END IF;

  -- 4. Ghi đè hoặc tạo mới cấu hình
  INSERT INTO public.checkin_schedules (
    elderly_id, checkin_start, checkin_deadline, emergency_buffer_minutes, timezone, updated_by, updated_at
  )
  VALUES (
    p_elderly_id, p_start, p_deadline, p_buffer_minutes, 'Asia/Ho_Chi_Minh', v_caller_id, now()
  )
  ON CONFLICT (elderly_id) DO UPDATE
  SET checkin_start = EXCLUDED.checkin_start,
      checkin_deadline = EXCLUDED.checkin_deadline,
      emergency_buffer_minutes = EXCLUDED.emergency_buffer_minutes,
      updated_by = EXCLUDED.updated_by,
      updated_at = now();

  -- 5. Xử lý tác động tức thì tới bản ghi hôm nay (Bất biến 3)
  v_today := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
  v_current_local_time := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::TIME;

  SELECT * INTO v_today_log
  FROM public.checkin_logs
  WHERE elderly_id = p_elderly_id AND log_date = v_today;

  IF FOUND THEN
    -- Nếu Cụ ĐÃ Safe hoặc ĐANG trong báo động Emergency -> Snapshot IMMUTABLE!
    IF v_today_log.status NOT IN ('Safe', 'Emergency') THEN
      IF v_current_local_time < p_start THEN
        v_new_status := 'Early_Waiting';
      ELSIF v_current_local_time <= p_deadline THEN
        v_new_status := 'Waiting';
      ELSIF v_current_local_time <= (p_deadline + (p_buffer_minutes || ' minutes')::INTERVAL) THEN
        v_new_status := 'Late';
      ELSE
        v_new_status := 'Emergency';
      END IF;

      UPDATE public.checkin_logs
      SET scheduled_start = p_start,
          scheduled_deadline = p_deadline,
          buffer_minutes = p_buffer_minutes,
          status = v_new_status,
          emergency_reason = CASE WHEN v_new_status = 'Emergency' THEN 'TIMEOUT' ELSE emergency_reason END,
          emergency_triggered_at = CASE WHEN v_new_status = 'Emergency' THEN now() ELSE emergency_triggered_at END,
          updated_at = now()
      WHERE id = v_today_log.id;
    END IF;
  ELSE
    -- Chưa có bản ghi hôm nay -> Khởi tạo sẵn bản ghi
    IF v_current_local_time < p_start THEN
      v_new_status := 'Early_Waiting';
    ELSIF v_current_local_time <= p_deadline THEN
      v_new_status := 'Waiting';
    ELSE
      v_new_status := 'Late';
    END IF;

    INSERT INTO public.checkin_logs (
      elderly_id, log_date, scheduled_start, scheduled_deadline, buffer_minutes, status
    )
    VALUES (
      p_elderly_id, v_today, p_start, p_deadline, p_buffer_minutes, v_new_status
    )
    ON CONFLICT (elderly_id, log_date) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 
    'message', 'Cập nhật khung giờ điểm danh thành công',
    'schedule', jsonb_build_object(
      'checkin_start', p_start,
      'checkin_deadline', p_deadline,
      'emergency_buffer_minutes', p_buffer_minutes
    )
  );
END;
$$;

-- 4.2. Hàm điểm danh hàng ngày: perform_checkin_atomic_v2
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
BEGIN
  -- 1. Xác thực caller chính là Cụ
  IF v_caller_id IS NULL OR v_caller_id <> p_elderly_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Chỉ Cụ mới có quyền bấm điểm danh');
  END IF;

  -- 2. Căn cứ thời gian lấy từ SERVER CLOCK (Asia/Ho_Chi_Minh)
  v_today := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
  v_server_local_time := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::TIME;

  -- 3. Đọc cấu hình khung giờ của Cụ (hoặc fallback)
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
    elderly_id, log_date, scheduled_start, scheduled_deadline, buffer_minutes, 
    status, checkin_time, source
  )
  VALUES (
    p_elderly_id, v_today, v_sched.checkin_start, v_sched.checkin_deadline, v_sched.emergency_buffer_minutes,
    'Safe', now(), 'Daily_Button'
  )
  ON CONFLICT (elderly_id, log_date) DO UPDATE
  SET status = 'Safe',
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

-- 4.3. Cập nhật create_sos_event_idempotent phản chiếu emergency_reason = 'SOS'
DROP FUNCTION IF EXISTS public.create_sos_event_idempotent(UUID, UUID, VARCHAR);

CREATE OR REPLACE FUNCTION public.create_sos_event_idempotent(
  p_elderly_id UUID,
  p_client_event_id UUID,
  p_trigger_source TEXT DEFAULT 'button'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_is_authorized BOOLEAN := FALSE;
  v_existing_event RECORD;
  v_new_event RECORD;
  v_pairing_code VARCHAR;
  v_caller_name VARCHAR;
  v_caller_role VARCHAR;
  v_today DATE := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Yêu cầu đăng nhập');
  END IF;

  IF v_caller_id = p_elderly_id THEN
    v_is_authorized := TRUE;
  ELSE
    SELECT TRUE INTO v_is_authorized
    FROM public.family_links
    WHERE elderly_id = p_elderly_id
      AND caregiver_id = v_caller_id
      AND status = 'accepted';
  END IF;

  IF NOT FOUND OR v_is_authorized IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Không có quyền kích hoạt SOS cho Cụ này');
  END IF;

  SELECT * INTO v_existing_event
  FROM public.sos_events
  WHERE client_event_id = p_client_event_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'sos_event_id', v_existing_event.id,
      'status', v_existing_event.status,
      'is_duplicate', true,
      'message', 'Sự kiện đã được ghi nhận trước đó (Idempotent ACK)'
    );
  END IF;

  INSERT INTO public.sos_events (
    client_event_id, elderly_id, triggered_by, trigger_source, status
  )
  VALUES (
    p_client_event_id, p_elderly_id, v_caller_id, p_trigger_source, 'active'
  )
  ON CONFLICT (client_event_id) DO NOTHING
  RETURNING * INTO v_new_event;

  IF v_new_event.id IS NULL THEN
    SELECT * INTO v_existing_event
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

  SELECT pairing_code INTO v_pairing_code FROM public.profiles WHERE id = p_elderly_id;
  SELECT full_name, role INTO v_caller_name, v_caller_role FROM public.profiles WHERE id = v_caller_id;

  -- Phản chiếu trạng thái sang checkin_logs hôm nay kèm emergency_reason = 'SOS'
  INSERT INTO public.checkin_logs (
    elderly_id, family_code, log_date, status, source, emergency_reason, emergency_triggered_at
  )
  VALUES (
    p_elderly_id, v_pairing_code, v_today, 'Emergency', 'SOS', 'SOS', now()
  )
  ON CONFLICT (elderly_id, log_date)
  DO UPDATE SET status = 'Emergency', 
                source = 'SOS', 
                emergency_reason = 'SOS', 
                emergency_triggered_at = COALESCE(public.checkin_logs.emergency_triggered_at, now()),
                updated_at = now();

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
    'is_duplicate', false,
    'message', 'Đã kích hoạt báo động khẩn cấp SOS'
  );
END;
$$;

-- 4.4. Cập nhật resolve_alarm_atomic phản chiếu resolved_at, resolved_by
CREATE OR REPLACE FUNCTION public.resolve_alarm_atomic(
  p_elderly_id UUID,
  p_sos_event_id UUID,
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
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Yêu cầu đăng nhập');
  END IF;

  SELECT TRUE INTO v_is_authorized
  FROM public.family_links
  WHERE elderly_id = p_elderly_id
    AND caregiver_id = v_caller_id
    AND status = 'accepted';

  IF NOT FOUND OR v_is_authorized IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Chỉ người thân đã kết nối mới có quyền tắt báo động');
  END IF;

  SELECT * INTO v_target_sos
  FROM public.sos_events
  WHERE id = p_sos_event_id AND elderly_id = p_elderly_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'EVENT_NOT_FOUND', 'message', 'Không tìm thấy sự kiện báo động');
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

  SELECT pairing_code INTO v_pairing_code FROM public.profiles WHERE id = p_elderly_id;
  SELECT full_name, role INTO v_caller_name, v_caller_role FROM public.profiles WHERE id = v_caller_id;

  UPDATE public.sos_events
  SET status = 'resolved',
      resolved_at = now(),
      resolved_by = v_caller_id,
      resolution_note = p_note
  WHERE id = v_target_sos.id;

  -- Phản chiếu trạng thái checkin_logs hôm nay về 'Safe' và lưu resolved metadata
  UPDATE public.checkin_logs
  SET status = 'Safe',
      resolved_at = now(),
      resolved_by = v_caller_id,
      updated_at = now()
  WHERE elderly_id = p_elderly_id AND log_date = v_today;

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

-- 4.5. Dynamic Cron Engine: check_overdue_routine_v2
CREATE OR REPLACE FUNCTION public.check_overdue_routine_v2()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
  v_current_time TIME := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::TIME;
BEGIN
  -- BƯỚC 0: MATERIALIZE TODAY'S LOGS CHO MỌI CỤ (Bất biến 1)
  INSERT INTO public.checkin_logs (
    elderly_id, log_date, scheduled_start, scheduled_deadline, buffer_minutes, status
  )
  SELECT 
    p.id,
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
  ON CONFLICT (elderly_id, log_date) DO NOTHING;

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
      emergency_triggered_at = now(),
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

-- 5. CẬP NHẬT PG_CRON SCHEDULE
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-detect-late-elderly') THEN
      PERFORM cron.unschedule('auto-detect-late-elderly');
    END IF;

    PERFORM cron.schedule(
      'auto-detect-late-elderly',
      '* * * * *',
      'SELECT public.check_overdue_routine_v2()'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron không khả dụng hoặc quyền hạn bị giới hạn: %', SQLERRM;
END $$;
