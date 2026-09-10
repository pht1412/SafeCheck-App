-- ==============================================================================
-- Migration: 20260910000001_sos_push_helpers.sql
-- Mô tả: Thêm các RPC functions SECURITY DEFINER để phục vụ Web Push Dispatcher
--        hoạt động độc lập, không phụ thuộc vào SERVICE_ROLE_KEY.
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
        'elderly_id', v_event.elderly_id
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
