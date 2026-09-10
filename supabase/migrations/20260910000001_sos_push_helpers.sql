-- ==============================================================================
-- Migration: 20260910000001_sos_push_helpers.sql
-- Mô tả: Thêm các RPC functions SECURITY DEFINER để phục vụ Web Push Dispatcher
--        hoạt động độc lập, không phụ thuộc vào SERVICE_ROLE_KEY trên Vercel.
-- ==============================================================================

-- 1. Hàm nguyên tử khóa và xác thực quyền gửi push (Atomic Idempotency Claim)
CREATE OR REPLACE FUNCTION public.claim_sos_push_dispatch(
    p_sos_event_id UUID,
    p_caller_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_event RECORD;
    v_claimed BOOLEAN := FALSE;
    v_elderly_name TEXT;
BEGIN
    -- Lấy thông tin sự kiện
    SELECT * INTO v_event FROM public.sos_events WHERE id = p_sos_event_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'SOS event not found');
    END IF;
    
    -- Kiểm tra người gọi phải là Cụ bà sở hữu sự kiện, hoặc con cháu đã liên kết (hỗ trợ test)
    IF v_event.elderly_id != p_caller_id AND NOT EXISTS (
        SELECT 1 FROM public.family_links 
        WHERE elderly_id = v_event.elderly_id 
          AND caregiver_id = p_caller_id 
          AND status = 'accepted'
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Forbidden: Caller is not authorized for this SOS event');
    END IF;
    
    -- Lấy tên Cụ bà
    SELECT full_name INTO v_elderly_name FROM public.profiles WHERE id = v_event.elderly_id;
    IF v_elderly_name IS NULL OR v_elderly_name = '' THEN
        v_elderly_name := 'Người thân';
    END IF;

    -- Khóa nguyên tử: Đánh dấu đã dispatch nếu chưa từng dispatch
    UPDATE public.sos_events
    SET push_dispatched_at = now(),
        push_dispatched_count = push_dispatched_count + 1
    WHERE id = p_sos_event_id
      AND push_dispatched_at IS NULL;
      
    IF FOUND THEN
        v_claimed := TRUE;
    END IF;
    
    RETURN jsonb_build_object(
        'success', true, 
        'claimed', v_claimed, 
        'elderly_id', v_event.elderly_id,
        'elderly_name', v_elderly_name
    );
END;
$$;

-- 2. Hàm lấy danh sách subscriptions của con cháu đã liên kết với Cụ bà
CREATE OR REPLACE FUNCTION public.get_caregiver_push_subscriptions(
    p_elderly_id UUID
)
RETURNS TABLE (
    endpoint TEXT,
    p256dh TEXT,
    auth TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT ps.endpoint, ps.p256dh, ps.auth
    FROM public.push_subscriptions ps
    JOIN public.family_links fl ON fl.caregiver_id = ps.user_id
    WHERE fl.elderly_id = p_elderly_id
      AND fl.status = 'accepted';
END;
$$;

-- 3. Hàm tạo sự kiện SOS an toàn cho Cụ bà hoặc Con cháu đã liên kết (hỗ trợ Dev Tool và test chéo)
CREATE OR REPLACE FUNCTION public.create_sos_event(
    p_elderly_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_new_id UUID;
    v_pairing_code VARCHAR;
BEGIN
    IF v_caller_id != p_elderly_id AND NOT EXISTS (
        SELECT 1 FROM public.family_links 
        WHERE elderly_id = p_elderly_id 
          AND caregiver_id = v_caller_id 
          AND status = 'accepted'
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Forbidden: Caller not authorized');
    END IF;

    SELECT pairing_code INTO v_pairing_code FROM public.profiles WHERE id = p_elderly_id;
    IF v_pairing_code IS NOT NULL THEN
        INSERT INTO public.checkin_logs (family_code, log_date, status, source)
        VALUES (v_pairing_code, CURRENT_DATE, 'Emergency', 'SOS')
        ON CONFLICT (family_code, log_date)
        DO UPDATE SET status = 'Emergency', source = 'SOS';
    END IF;

    INSERT INTO public.sos_events (elderly_id, status, trigger_source)
    VALUES (p_elderly_id, 'active', 'button')
    RETURNING id INTO v_new_id;

    RETURN jsonb_build_object('success', true, 'sos_event_id', v_new_id);
END;
$$;

-- 4. Cập nhật RLS Policy để cho phép cả Cụ bà và Con cháu đã liên kết INSERT / SELECT vào sos_events
DROP POLICY IF EXISTS "Elderly can insert own sos_events" ON public.sos_events;
DROP POLICY IF EXISTS "Elderly and linked caregivers can insert sos_events" ON public.sos_events;
CREATE POLICY "Elderly and linked caregivers can insert sos_events"
    ON public.sos_events FOR INSERT
    WITH CHECK (
        auth.uid() = elderly_id OR
        EXISTS (
            SELECT 1 FROM public.family_links
            WHERE elderly_id = sos_events.elderly_id
              AND caregiver_id = auth.uid()
              AND status = 'accepted'
        )
    );

-- 5. Hàm dọn dẹp subscription hết hạn (Housekeeping)
CREATE OR REPLACE FUNCTION public.remove_expired_push_subscriptions(
    p_endpoints TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.push_subscriptions
    WHERE endpoint = ANY(p_endpoints);
END;
$$;
