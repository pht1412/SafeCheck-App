-- ==============================================================================
-- Migration: 20261014000001_fix_pairing_code_and_connect.sql
-- Mô tả: Sửa lỗi độ dài chuỗi ký tự alphabet (31 chars vs random * 32)
--        và nới lỏng kiểm tra connect_family để chấp nhận cả mã 5 và 6 ký tự
-- ==============================================================================

-- 1. CẬP NHẬT TRIGGER handle_new_user TỰ SINH MÃ ĐỦ 6 KÝ TỰ 100%
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
  -- Bảng chữ cái gồm đúng 32 ký tự (Base32 loại trừ O, I, L, 0, 1 để chống nhầm lẫn)
  -- 23456789 (8) + ABCDEFGH (8) + JKMNPQRS (8) + TUVWXYZ2 (8) = 32 ký tự
  v_alphabet CONSTANT TEXT := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
BEGIN
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'elderly');
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', 'Người dùng');
  v_phone := NEW.raw_user_meta_data->>'phone';

  -- Nếu là Cụ (elderly), tự sinh mã đúng 6 ký tự từ alphabet có độ dài 32
  IF v_role = 'elderly' THEN
    SELECT string_agg(substr(v_alphabet, floor(random() * length(v_alphabet) + 1)::int, 1), '')
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
END;
$$;


-- 2. CẬP NHẬT RPC connect_family: CHẤP NHẬN CẢ MÃ 5 VÀ 6 KÝ TỰ
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
  -- Cho phép độ dài từ 5 ký tự trở lên (tương thích cả mã cũ 5 ký tự)
  IF length(v_clean_code) < 5 THEN
    RETURN json_build_object('success', false, 'message', 'Mã ghép nối phải có ít nhất 5 ký tự');
  END IF;

  -- 4. Tìm kiếm Cụ sở hữu mã này
  SELECT id, full_name, avatar_url INTO v_elderly
  FROM public.profiles
  WHERE pairing_code = v_clean_code AND role = 'elderly';

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', 'Mã kết nối không chính xác hoặc không tồn tại');
  END IF;

  -- 5. Chặn tự kết nối chính mình
  IF v_elderly.id = v_caregiver_id THEN
    RETURN json_build_object('success', false, 'message', 'Không thể tự kết nối với chính mình');
  END IF;

  -- 6. Tạo hoặc cập nhật liên kết gia đình (idempotent)
  INSERT INTO public.family_links (elderly_id, caregiver_id, relationship, status)
  VALUES (v_elderly.id, v_caregiver_id, COALESCE(p_relationship, 'Người thân'), 'accepted')
  ON CONFLICT (elderly_id, caregiver_id) 
  DO UPDATE SET 
    relationship = EXCLUDED.relationship,
    status = 'accepted',
    updated_at = now();

  RETURN json_build_object(
    'success', true, 
    'message', 'Kết nối thành công với ' || v_elderly.full_name,
    'elderly', json_build_object(
      'id', v_elderly.id,
      'full_name', v_elderly.full_name,
      'avatar_url', v_elderly.avatar_url
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.connect_family(VARCHAR, VARCHAR) TO authenticated;
