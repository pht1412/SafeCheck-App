-- ====================================================================
-- SafeCheck - Migration v2.0: Profiles, Family Links, RLS & Pairing RPC
-- ====================================================================

-- 1. BẢNG PROFILES (Lưu hồ sơ người dùng mở rộng từ auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255),
  full_name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('elderly', 'caregiver')),
  avatar_url TEXT,
  phone VARCHAR(20),
  pairing_code VARCHAR(10) UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index tìm kiếm nhanh mã ghép nối
CREATE INDEX IF NOT EXISTS idx_profiles_pairing_code ON public.profiles(pairing_code);

-- 2. TRIGGER TỰ ĐỘNG TẠO PROFILE KHI ĐĂNG KÝ (Supabase Auth -> public.profiles)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role VARCHAR;
  v_pairing_code VARCHAR := NULL;
  v_full_name VARCHAR;
  v_phone VARCHAR;
BEGIN
  -- Lấy role, full_name, phone từ raw_user_meta_data
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'elderly');
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', 'Người dùng');
  v_phone := NEW.raw_user_meta_data->>'phone';

  -- Nếu là Cụ (elderly), tự sinh mã 6 ký tự Base32 trực tiếp, không phụ thuộc hàm ngoài
  IF v_role = 'elderly' THEN
    SELECT string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', floor(random() * 32 + 1)::int, 1), '')
    INTO v_pairing_code
    FROM generate_series(1, 6);
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, phone, pairing_code)
  VALUES (
    NEW.id,
    NEW.email,
    v_full_name,
    v_role,
    v_phone,
    v_pairing_code
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      phone = EXCLUDED.phone,
      pairing_code = COALESCE(public.profiles.pairing_code, EXCLUDED.pairing_code);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Lỗi trong handle_new_user: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Gắn Trigger vào bảng auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. TRIGGER CHẶN TỰ Ý SỬA ROLE (Chống Privilege Escalation)
CREATE OR REPLACE FUNCTION public.prevent_role_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION 'Bảo mật: Không được phép tự ý thay đổi vai trò (role)!';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_prevent_role_change ON public.profiles;
CREATE TRIGGER tr_prevent_role_change
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_role_change();

-- 5. BẢNG FAMILY_LINKS (Quan hệ 1 Cụ - Nhiều Con Cháu)
CREATE TABLE IF NOT EXISTS public.family_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  elderly_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  caregiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  relationship VARCHAR(50) DEFAULT 'Người thân',
  status VARCHAR(20) NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'pending', 'revoked')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Ràng buộc 1: Chống kết nối trùng lặp
  CONSTRAINT unique_elderly_caregiver UNIQUE (elderly_id, caregiver_id),
  
  -- Ràng buộc 2: Chống tự liên kết với chính mình
  CONSTRAINT check_not_self_link CHECK (elderly_id <> caregiver_id)
);

CREATE INDEX IF NOT EXISTS idx_family_links_caregiver ON public.family_links(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_family_links_elderly ON public.family_links(elderly_id);

-- Bổ sung cột elderly_id vào bảng checkin_logs để gắn trực tiếp theo Cụ
ALTER TABLE public.checkin_logs
ADD COLUMN IF NOT EXISTS elderly_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_checkin_logs_elderly_date ON public.checkin_logs(elderly_id, log_date);

-- --------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) - BẢO VỆ DỮ LIỆU CẤP HÀNG
-- --------------------------------------------------------------------

-- 6.1. RLS trên bảng PROFILES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Ai cũng đọc được profile của chính mình
CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
USING (auth.uid() = id);

-- Caregiver được đọc profile của Cụ mà mình ĐÃ LIÊN KẾT (accepted)
CREATE POLICY "Caregivers can view linked elderly profile"
ON public.profiles FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.family_links
    WHERE family_links.caregiver_id = auth.uid()
      AND family_links.elderly_id = public.profiles.id
      AND family_links.status = 'accepted'
  )
);

-- Cụ được đọc profile của những Con cháu đang theo dõi mình
CREATE POLICY "Elderly can view linked caregivers"
ON public.profiles FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.family_links
    WHERE family_links.elderly_id = auth.uid()
      AND family_links.caregiver_id = public.profiles.id
      AND family_links.status = 'accepted'
  )
);

-- Người dùng chỉ được sửa thông tin cá nhân của chính mình (Tên, Avatar, Phone)
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- 6.2. RLS trên bảng FAMILY_LINKS
ALTER TABLE public.family_links ENABLE ROW LEVEL SECURITY;

-- Cụ hoặc Con cháu đều đọc được các link liên quan đến mình
CREATE POLICY "Users can view own family links"
ON public.family_links FOR SELECT
USING (auth.uid() = elderly_id OR auth.uid() = caregiver_id);

-- Cụ hoặc Con cháu có quyền xóa / hủy link của mình
CREATE POLICY "Users can delete own family links"
ON public.family_links FOR DELETE
USING (auth.uid() = elderly_id OR auth.uid() = caregiver_id);

-- 6.3. RLS trên bảng CHECKIN_LOGS
ALTER TABLE public.checkin_logs ENABLE ROW LEVEL SECURITY;

-- Cụ đọc được lịch sử của chính mình qua pairing_code
DROP POLICY IF EXISTS "Elderly view own checkin logs" ON public.checkin_logs;
CREATE POLICY "Elderly view own checkin logs"
ON public.checkin_logs FOR SELECT
USING (
  family_code IN (
    SELECT pairing_code FROM public.profiles WHERE id = auth.uid()
  )
);

-- Con cháu chỉ đọc được lịch sử của Cụ ĐÃ LIÊN KẾT
DROP POLICY IF EXISTS "Caregivers view linked elderly checkin logs" ON public.checkin_logs;
CREATE POLICY "Caregivers view linked elderly checkin logs"
ON public.checkin_logs FOR SELECT
USING (
  family_code IN (
    SELECT p.pairing_code 
    FROM public.profiles p
    JOIN public.family_links fl ON fl.elderly_id = p.id
    WHERE fl.caregiver_id = auth.uid()
      AND fl.status = 'accepted'
  )
);

-- --------------------------------------------------------------------
-- 7. RPC GHÉP NỐI GIA ĐÌNH (connect_family)
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.connect_family(
  p_pairing_code VARCHAR,
  p_relationship VARCHAR DEFAULT 'Người thân'
)
RETURNS JSON 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, auth
AS $$
DECLARE
  v_caregiver_id UUID := auth.uid();
  v_caregiver_role VARCHAR;
  v_elderly RECORD;
  v_clean_code VARCHAR;
BEGIN
  -- 1. Kiểm tra phiên đăng nhập
  IF v_caregiver_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Bạn chưa đăng nhập');
  END IF;

  -- 2. Kiểm tra vai trò của người gọi (phải là caregiver)
  SELECT role INTO v_caregiver_role FROM public.profiles WHERE id = v_caregiver_id;
  IF v_caregiver_role <> 'caregiver' THEN
    RETURN json_build_object('success', false, 'message', 'Chỉ tài khoản Người thân (Caregiver) mới có thể kết nối với Cụ');
  END IF;

  -- 3. Chuẩn hóa mã (Viết hoa, bỏ khoảng trắng)
  v_clean_code := UPPER(TRIM(p_pairing_code));
  IF length(v_clean_code) < 6 THEN
    RETURN json_build_object('success', false, 'message', 'Mã ghép nối phải gồm 6 ký tự');
  END IF;

  -- 4. Tìm kiếm Cụ sở hữu mã này
  SELECT id, full_name, avatar_url INTO v_elderly
  FROM public.profiles
  WHERE pairing_code = v_clean_code AND role = 'elderly';

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', 'Mã kết nối không chính xác hoặc không tồn tại');
  END IF;

  -- 5. Chặn tự kết nối chính mình (nếu có lỗi dữ liệu)
  IF v_elderly.id = v_caregiver_id THEN
    RETURN json_build_object('success', false, 'message', 'Không thể tự kết nối với chính mình');
  END IF;

  -- 6. Tạo hoặc cập nhật liên kết trong family_links
  INSERT INTO public.family_links (elderly_id, caregiver_id, relationship, status)
  VALUES (v_elderly.id, v_caregiver_id, COALESCE(p_relationship, 'Người thân'), 'accepted')
  ON CONFLICT (elderly_id, caregiver_id) 
  DO UPDATE SET status = 'accepted', relationship = EXCLUDED.relationship, updated_at = now();

  RETURN json_build_object(
    'success', true,
    'message', 'Đã kết nối thành công với ' || v_elderly.full_name,
    'elderly_id', v_elderly.id,
    'elderly_name', v_elderly.full_name,
    'avatar_url', v_elderly.avatar_url
  );
END;
$$;

-- --------------------------------------------------------------------
-- 8. CẬP NHẬT CÁC HÀM NGHIỆP VỤ ĐA GIA ĐÌNH / MÃ GHÉP NỐI ĐỘNG
-- --------------------------------------------------------------------

-- 8.0. Gỡ bỏ ràng buộc khóa ngoại cũ sang configurations để checkin_logs hoạt động độc lập
ALTER TABLE public.checkin_logs DROP CONSTRAINT IF EXISTS checkin_logs_family_code_fkey;

-- 8.1. Điểm danh: Ghi trực tiếp trạng thái Safe vào checkin_logs cho mã Cụ
CREATE OR REPLACE FUNCTION public.perform_checkin(p_family_code VARCHAR)
RETURNS JSON 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, auth
AS $$
DECLARE
  v_clean_code VARCHAR := UPPER(TRIM(p_family_code));
BEGIN
  INSERT INTO public.checkin_logs (family_code, log_date, status, checkin_time, source)
  VALUES (v_clean_code, CURRENT_DATE, 'Safe', now(), 'Daily_Button')
  ON CONFLICT (family_code, log_date)
  DO UPDATE SET status = 'Safe', checkin_time = now(), source = 'Daily_Button';

  RETURN json_build_object('success', true, 'message', 'Điểm danh an toàn thành công');
END;
$$;

-- 8.2. Kích hoạt SOS cho từng Cụ
CREATE OR REPLACE FUNCTION public.trigger_sos(p_family_code VARCHAR)
RETURNS JSON 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, auth
AS $$
DECLARE
  v_clean_code VARCHAR := UPPER(TRIM(p_family_code));
BEGIN
  INSERT INTO public.checkin_logs (family_code, log_date, status, source)
  VALUES (v_clean_code, CURRENT_DATE, 'Emergency', 'SOS')
  ON CONFLICT (family_code, log_date)
  DO UPDATE SET status = 'Emergency', source = 'SOS';

  RETURN json_build_object('success', true, 'message', 'Đã kích hoạt báo động khẩn cấp');
END;
$$;

-- 8.3. Gửi chuông kiểm tra (Ping)
CREATE OR REPLACE FUNCTION public.request_ping(p_family_code VARCHAR)
RETURNS JSON 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, auth
AS $$
DECLARE
  v_clean_code VARCHAR := UPPER(TRIM(p_family_code));
  v_last_ping TIMESTAMPTZ;
  v_caller_email VARCHAR;
  v_cooldown_interval INTERVAL := INTERVAL '15 minutes';
BEGIN
  -- Nếu người gọi là tester test01@gmail.com: giảm thời gian chờ xuống 10 giây để kiểm thử
  SELECT email INTO v_caller_email FROM public.profiles WHERE id = auth.uid();
  IF LOWER(v_caller_email) = 'test01@gmail.com' THEN
    v_cooldown_interval := INTERVAL '10 seconds';
  END IF;

  SELECT ping_requested_at INTO v_last_ping
  FROM public.checkin_logs
  WHERE family_code = v_clean_code AND log_date = CURRENT_DATE;

  IF v_last_ping IS NOT NULL AND (now() - v_last_ping) < v_cooldown_interval THEN
    RETURN json_build_object(
      'success', false, 
      'message', 'Đang trong thời gian chờ (cooldown ' || 
        CASE WHEN LOWER(v_caller_email) = 'test01@gmail.com' THEN '10 giây' ELSE '15 phút' END || ')'
    );
  END IF;

  INSERT INTO public.checkin_logs (family_code, log_date, status, ping_requested_at)
  VALUES (v_clean_code, CURRENT_DATE, 'Ping_Requested', now())
  ON CONFLICT (family_code, log_date)
  DO UPDATE SET status = 'Ping_Requested', ping_requested_at = now();

  RETURN json_build_object('success', true, 'message', 'Đã phát chuông kiểm tra tới máy Cụ');
END;
$$;

-- 8.4. Tắt báo động / Xác nhận an toàn
CREATE OR REPLACE FUNCTION public.resolve_alarm(p_family_code VARCHAR)
RETURNS JSON 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, auth
AS $$
DECLARE
  v_clean_code VARCHAR := UPPER(TRIM(p_family_code));
BEGIN
  INSERT INTO public.checkin_logs (family_code, log_date, status)
  VALUES (v_clean_code, CURRENT_DATE, 'Safe')
  ON CONFLICT (family_code, log_date)
  DO UPDATE SET status = 'Safe';

  RETURN json_build_object('success', true, 'message', 'Đã tắt báo động, xác nhận an toàn');
END;
$$;

-- 8.5. Cấp quyền thực thi (GRANT EXECUTE) cho authenticated và anon
GRANT EXECUTE ON FUNCTION public.connect_family(VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.perform_checkin(VARCHAR) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.trigger_sos(VARCHAR) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.request_ping(VARCHAR) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.resolve_alarm(VARCHAR) TO authenticated, anon;


