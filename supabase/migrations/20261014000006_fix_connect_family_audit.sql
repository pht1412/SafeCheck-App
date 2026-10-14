-- ==============================================================================
-- Migration: 20261014000006_fix_connect_family_audit.sql
-- Mô tả: Điều chỉnh RPC connect_family loại bỏ ghi đè sai check constraint trên alarm_logs
-- ==============================================================================

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
  v_attempt RECORD;
  v_failed_count INT;
  v_lock_remaining_minutes INT;
BEGIN
  -- 1. Kiểm tra phiên đăng nhập
  IF v_caregiver_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Bạn chưa đăng nhập');
  END IF;

  -- 2. Kiểm tra vai trò của người gọi (phải là caregiver)
  SELECT role INTO v_caregiver_role 
  FROM public.profiles 
  WHERE id = v_caregiver_id;

  IF v_caregiver_role <> 'caregiver' THEN
    RETURN json_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Chỉ tài khoản Người thân (Caregiver) mới có thể kết nối với Cụ');
  END IF;

  -- 3. KIỂM TRA RATE LIMITING & KHÓA TÀI KHOẢN (P0-SEC-03)
  SELECT failed_attempts, locked_until INTO v_attempt
  FROM public.pairing_attempts
  WHERE caregiver_id = v_caregiver_id;

  IF v_attempt.locked_until IS NOT NULL AND v_attempt.locked_until > now() THEN
    v_lock_remaining_minutes := GREATEST(1, ceil(extract(epoch from (v_attempt.locked_until - now())) / 60)::INT);
    RETURN json_build_object(
      'success', false,
      'error', 'RATE_LIMITED',
      'message', 'Bạn đã nhập sai mã quá 5 lần. Tính năng ghép nối bị tạm khóa, vui lòng thử lại sau ' || v_lock_remaining_minutes || ' phút.',
      'retry_after_minutes', v_lock_remaining_minutes
    );
  END IF;

  -- 4. Chuẩn hóa mã (Viết hoa, bỏ khoảng trắng)
  v_clean_code := UPPER(TRIM(p_pairing_code));
  IF length(v_clean_code) < 5 THEN
    RETURN json_build_object('success', false, 'error', 'INVALID_LENGTH', 'message', 'Mã ghép nối phải có ít nhất 5 ký tự');
  END IF;

  -- 5. Tìm kiếm Cụ sở hữu mã này
  SELECT id, full_name, avatar_url INTO v_elderly
  FROM public.profiles
  WHERE pairing_code = v_clean_code AND role = 'elderly';

  -- NẾU NHẬP SAI MÃ: TĂNG BỘ ĐẾM THỬ SAI & KHÓA NẾU >= 5 LẦN
  IF NOT FOUND THEN
    INSERT INTO public.pairing_attempts (caregiver_id, failed_attempts, last_failed_at, locked_until, updated_at)
    VALUES (v_caregiver_id, 1, now(), NULL, now())
    ON CONFLICT (caregiver_id) DO UPDATE SET
      failed_attempts = CASE 
        WHEN public.pairing_attempts.locked_until IS NOT NULL AND public.pairing_attempts.locked_until <= now() THEN 1
        ELSE public.pairing_attempts.failed_attempts + 1
      END,
      last_failed_at = now(),
      locked_until = CASE
        WHEN (CASE 
          WHEN public.pairing_attempts.locked_until IS NOT NULL AND public.pairing_attempts.locked_until <= now() THEN 1
          ELSE public.pairing_attempts.failed_attempts + 1
        END) >= 5 THEN now() + INTERVAL '15 minutes'
        ELSE NULL
      END,
      updated_at = now()
    RETURNING failed_attempts, locked_until INTO v_attempt;

    IF v_attempt.locked_until IS NOT NULL AND v_attempt.locked_until > now() THEN
      RETURN json_build_object(
        'success', false,
        'error', 'RATE_LIMITED',
        'message', 'Bạn đã nhập sai mã 5 lần liên tiếp. Tài khoản bị tạm khóa kết nối trong 15 phút.',
        'retry_after_minutes', 15
      );
    ELSE
      v_failed_count := 5 - v_attempt.failed_attempts;
      RETURN json_build_object(
        'success', false,
        'error', 'INVALID_CODE',
        'message', 'Mã kết nối không chính xác hoặc không tồn tại (Còn ' || v_failed_count || ' lần thử)',
        'remaining_attempts', v_failed_count
      );
    END IF;
  END IF;

  -- 6. Chặn tự kết nối chính mình
  IF v_elderly.id = v_caregiver_id THEN
    RETURN json_build_object('success', false, 'error', 'SELF_CONNECT', 'message', 'Không thể tự kết nối với chính mình');
  END IF;

  -- 7. KHI NHẬP ĐÚNG MÃ: RESET BỘ ĐẾM THỬ SAI VỀ 0
  INSERT INTO public.pairing_attempts (caregiver_id, failed_attempts, last_failed_at, locked_until, updated_at)
  VALUES (v_caregiver_id, 0, now(), NULL, now())
  ON CONFLICT (caregiver_id) DO UPDATE SET
    failed_attempts = 0,
    locked_until = NULL,
    updated_at = now();

  -- 8. Tạo hoặc cập nhật liên kết gia đình (idempotent)
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
