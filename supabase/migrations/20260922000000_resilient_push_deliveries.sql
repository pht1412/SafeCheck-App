-- ==============================================================================
-- Migration: 20260922000000_resilient_push_deliveries.sql
-- Mô tả: Khởi tạo Sổ cái Phân phát (push_deliveries) kèm cơ chế Lease & Fencing Token,
--        Sổ cái Tiếp nhận (sos_acknowledgements), và chiến lược Soft-delete Subscription.
-- Tuân thủ: PRD_Deep_v2.md (v2.1) & Implementation Plan Phase 1
-- ==============================================================================

-- 1. BỔ SUNG CỘT SOFT-DELETE CHO BẢNG push_subscriptions
ALTER TABLE public.push_subscriptions
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active ON public.push_subscriptions(user_id) 
WHERE is_active = true;

-- 2. TẠO BẢNG SỔ CÁI PHÂN PHÁT push_deliveries
CREATE TABLE IF NOT EXISTS public.push_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sos_event_id UUID NOT NULL REFERENCES public.sos_events(id) ON DELETE RESTRICT,
    caregiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    subscription_id UUID NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE RESTRICT,
    endpoint_hash TEXT NOT NULL,
    
    -- Khóa chống trùng nguyên tử ở cấp Database
    CONSTRAINT uq_push_deliveries_sos_subscription UNIQUE (sos_event_id, subscription_id),
    
    -- State Machine
    status VARCHAR(20) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'sending', 'accepted', 'retryable', 'unknown', 'expired')),
    terminal_reason TEXT,
    
    -- Cơ chế Lease & Fencing Token (Thế hệ tăng đơn điệu)
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    fence_token BIGINT NOT NULL DEFAULT 0,
    attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts INT NOT NULL DEFAULT 3,
    
    -- Dữ liệu chẩn đoán từ Push Gateway
    http_status INT,
    response_body TEXT,
    error_message TEXT,
    
    -- Mốc thời gian
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    accepted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_deliveries_sos ON public.push_deliveries(sos_event_id);
CREATE INDEX IF NOT EXISTS idx_push_deliveries_caregiver ON public.push_deliveries(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_push_deliveries_status ON public.push_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_push_deliveries_active_leases ON public.push_deliveries(lease_expires_at) 
WHERE status = 'sending';

-- Kích hoạt RLS cho push_deliveries
ALTER TABLE public.push_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Caregivers can view own push deliveries" ON public.push_deliveries;
CREATE POLICY "Caregivers can view own push deliveries"
ON public.push_deliveries FOR SELECT
USING (auth.uid() = caregiver_id);

-- 3. TẠO BẢNG SỔ CÁI TIẾP NHẬN sos_acknowledgements
CREATE TABLE IF NOT EXISTS public.sos_acknowledgements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sos_event_id UUID NOT NULL REFERENCES public.sos_events(id) ON DELETE RESTRICT,
    caregiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    channel VARCHAR(30) NOT NULL DEFAULT 'app_click' CHECK (channel IN ('app_click', 'voice_call', 'manual_confirmation')),
    client_metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT uq_sos_acknowledgements_event_caregiver UNIQUE (sos_event_id, caregiver_id)
);

CREATE INDEX IF NOT EXISTS idx_sos_ack_event ON public.sos_acknowledgements(sos_event_id);
CREATE INDEX IF NOT EXISTS idx_sos_ack_caregiver ON public.sos_acknowledgements(caregiver_id);

ALTER TABLE public.sos_acknowledgements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Family members can view acknowledgements" ON public.sos_acknowledgements;
CREATE POLICY "Family members can view acknowledgements"
ON public.sos_acknowledgements FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.sos_events se
        JOIN public.family_links fl ON fl.elderly_id = se.elderly_id
        WHERE se.id = sos_acknowledgements.sos_event_id
          AND (fl.caregiver_id = auth.uid() OR se.elderly_id = auth.uid())
          AND fl.status = 'accepted'
    )
);

-- 4. HÀM LẤY SUBSCRIPTIONS HOẠT ĐỘNG CỦA CON CHÁU (Nâng cấp trả về ID)
DROP FUNCTION IF EXISTS public.get_caregiver_push_subscriptions(UUID);

CREATE OR REPLACE FUNCTION public.get_caregiver_push_subscriptions(
    p_elderly_id UUID
)
RETURNS TABLE (
    subscription_id UUID,
    caregiver_id UUID,
    endpoint TEXT,
    p256dh TEXT,
    auth TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ps.id AS subscription_id,
        ps.user_id AS caregiver_id,
        ps.endpoint,
        ps.p256dh,
        ps.auth
    FROM public.push_subscriptions ps
    JOIN public.family_links fl ON fl.caregiver_id = ps.user_id
    WHERE fl.elderly_id = p_elderly_id
      AND fl.status = 'accepted'
      AND ps.is_active = true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_caregiver_push_subscriptions(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_caregiver_push_subscriptions(UUID) TO service_role;

-- 5. RPC NGUYÊN TỬ: claim_push_delivery_lease
CREATE OR REPLACE FUNCTION public.claim_push_delivery_lease(
    p_sos_event_id UUID,
    p_caregiver_id UUID,
    p_subscription_id UUID,
    p_endpoint_hash TEXT,
    p_worker_id TEXT,
    p_lease_duration_seconds INT DEFAULT 15
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_delivery RECORD;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
    v_lease_expiry TIMESTAMPTZ := v_now + (p_lease_duration_seconds || ' seconds')::INTERVAL;
    v_new_attempt INT;
    v_new_fence BIGINT;
BEGIN
    -- 1. Xác minh nghiệp vụ: SOS event active, quan hệ family_links accepted, subscription active thuộc caregiver
    IF NOT EXISTS (
        SELECT 1 FROM public.sos_events se
        JOIN public.family_links fl ON fl.elderly_id = se.elderly_id
        JOIN public.push_subscriptions ps ON ps.id = p_subscription_id AND ps.user_id = p_caregiver_id
        WHERE se.id = p_sos_event_id
          AND fl.caregiver_id = p_caregiver_id
          AND fl.status = 'accepted'
          AND se.status = 'active'
          AND ps.is_active = true
    ) THEN
        RETURN jsonb_build_object(
            'can_send', false,
            'reason', 'INVALID_RELATION_OR_INACTIVE_SOS'
        );
    END IF;

    -- 2. Thử chèn bản ghi mới với fence_token = 1 và attempt_count = 1
    INSERT INTO public.push_deliveries (
        sos_event_id,
        caregiver_id,
        subscription_id,
        endpoint_hash,
        status,
        lease_owner,
        lease_expires_at,
        fence_token,
        attempt_count,
        created_at,
        updated_at
    )
    VALUES (
        p_sos_event_id,
        p_caregiver_id,
        p_subscription_id,
        p_endpoint_hash,
        'sending',
        p_worker_id,
        v_lease_expiry,
        1,
        1,
        v_now,
        v_now
    )
    ON CONFLICT (sos_event_id, subscription_id) DO NOTHING
    RETURNING * INTO v_delivery;

    -- 3. Nếu chèn thành công hàng mới -> Đã cấp Lease đầu tiên
    IF v_delivery.id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'can_send', true,
            'delivery_id', v_delivery.id,
            'fence_token', 1,
            'lease_expires_at', v_lease_expiry,
            'attempt_count', 1,
            'reason', 'NEW_LEASE_ACQUIRED'
        );
    END IF;

    -- 4. Nếu bản ghi đã tồn tại, khóa hàng (FOR UPDATE) để thẩm định
    SELECT * INTO v_delivery
    FROM public.push_deliveries
    WHERE sos_event_id = p_sos_event_id 
      AND subscription_id = p_subscription_id
    FOR UPDATE;

    -- Không gửi lại nếu đã ở trạng thái kết thúc
    IF v_delivery.status IN ('accepted', 'expired') THEN
        RETURN jsonb_build_object(
            'can_send', false,
            'delivery_id', v_delivery.id,
            'reason', 'TERMINAL_STATE_' || v_delivery.status
        );
    END IF;

    -- Kiểm tra vượt ngưỡng retry tối đa
    IF v_delivery.attempt_count >= v_delivery.max_attempts THEN
        RETURN jsonb_build_object(
            'can_send', false,
            'delivery_id', v_delivery.id,
            'reason', 'MAX_ATTEMPTS_EXCEEDED'
        );
    END IF;

    -- Kiểm tra nếu worker khác đang giữ lease còn hạn
    IF v_delivery.status = 'sending' AND v_delivery.lease_expires_at > v_now THEN
        RETURN jsonb_build_object(
            'can_send', false,
            'delivery_id', v_delivery.id,
            'reason', 'LEASE_HELD_BY_ANOTHER_WORKER'
        );
    END IF;

    -- Cấp lease mới: Tăng fence_token và attempt_count
    v_new_attempt := v_delivery.attempt_count + 1;
    v_new_fence := v_delivery.fence_token + 1;

    UPDATE public.push_deliveries
    SET status = 'sending',
        lease_owner = p_worker_id,
        lease_expires_at = v_lease_expiry,
        fence_token = v_new_fence,
        attempt_count = v_new_attempt,
        updated_at = v_now
    WHERE id = v_delivery.id;

    RETURN jsonb_build_object(
        'can_send', true,
        'delivery_id', v_delivery.id,
        'fence_token', v_new_fence,
        'lease_expires_at', v_lease_expiry,
        'attempt_count', v_new_attempt,
        'reason', 'LEASE_RENEWED'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_push_delivery_lease(UUID, UUID, UUID, TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_delivery_lease(UUID, UUID, UUID, TEXT, TEXT, INT) TO service_role;

-- 6. RPC NGUYÊN TỬ: complete_push_delivery_fenced
CREATE OR REPLACE FUNCTION public.complete_push_delivery_fenced(
    p_delivery_id UUID,
    p_worker_id TEXT,
    p_fence_token BIGINT,
    p_status VARCHAR(20),
    p_http_status INT DEFAULT NULL,
    p_response_body TEXT DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL,
    p_terminal_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_delivery RECORD;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    IF p_status NOT IN ('accepted', 'retryable', 'unknown', 'expired') THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_TARGET_STATUS');
    END IF;

    -- Cập nhật với điều kiện Fencing Token và Lease Owner bắt buộc
    UPDATE public.push_deliveries
    SET status = p_status,
        http_status = p_http_status,
        response_body = p_response_body,
        error_message = p_error_message,
        terminal_reason = p_terminal_reason,
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = v_now,
        accepted_at = CASE WHEN p_status = 'accepted' THEN v_now ELSE accepted_at END
    WHERE id = p_delivery_id
      AND lease_owner = p_worker_id
      AND fence_token = p_fence_token
      AND status = 'sending';

    IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'status', p_status);
    END IF;

    -- Nếu không cập nhật được, kiểm tra nguyên nhân để trả về lỗi có cấu trúc
    SELECT * INTO v_delivery FROM public.push_deliveries WHERE id = p_delivery_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'DELIVERY_NOT_FOUND');
    END IF;

    IF v_delivery.fence_token != p_fence_token OR v_delivery.lease_owner != p_worker_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'FENCING_REJECTED',
            'current_fence_token', v_delivery.fence_token,
            'provided_fence_token', p_fence_token
        );
    END IF;

    RETURN jsonb_build_object(
        'success', false,
        'error', 'INVALID_STATE_TRANSITION',
        'current_status', v_delivery.status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_push_delivery_fenced(UUID, TEXT, BIGINT, VARCHAR, INT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_push_delivery_fenced(UUID, TEXT, BIGINT, VARCHAR, INT, TEXT, TEXT, TEXT) TO service_role;

-- 7. RPC TIẾP NHẬN SOS: acknowledge_sos_event
CREATE OR REPLACE FUNCTION public.acknowledge_sos_event(
    p_sos_event_id UUID,
    p_channel VARCHAR(30) DEFAULT 'app_click',
    p_client_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_event RECORD;
    v_ack RECORD;
BEGIN
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
    END IF;

    -- Kiểm tra sự kiện SOS
    SELECT * INTO v_event FROM public.sos_events WHERE id = p_sos_event_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'SOS_EVENT_NOT_FOUND');
    END IF;

    -- Xác minh quyền: Caller phải là caregiver có family_links accepted với elderly của SOS event
    IF NOT EXISTS (
        SELECT 1 FROM public.family_links
        WHERE elderly_id = v_event.elderly_id
          AND caregiver_id = v_caller_id
          AND status = 'accepted'
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN_NOT_LINKED_CAREGIVER');
    END IF;

    -- Ghi nhận acknowledgement (Idempotent)
    INSERT INTO public.sos_acknowledgements (
        sos_event_id,
        caregiver_id,
        channel,
        client_metadata
    )
    VALUES (
        p_sos_event_id,
        v_caller_id,
        p_channel,
        p_client_metadata
    )
    ON CONFLICT (sos_event_id, caregiver_id) DO NOTHING
    RETURNING * INTO v_ack;

    RETURN jsonb_build_object(
        'success', true,
        'sos_event_id', p_sos_event_id,
        'caregiver_id', v_caller_id,
        'acknowledged_at', COALESCE(v_ack.acknowledged_at, now()),
        'is_new', (v_ack.id IS NOT NULL)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.acknowledge_sos_event(UUID, VARCHAR, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_sos_event(UUID, VARCHAR, JSONB) TO authenticated, service_role;

-- 8. RPC SOFT-DELETE SUBSCRIPTION HẾT HẠN (410 GONE)
CREATE OR REPLACE FUNCTION public.deactivate_push_subscription(
    p_subscription_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.push_subscriptions
    SET is_active = false,
        revoked_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_subscription_id;
END;
$$;

REVOKE ALL ON FUNCTION public.deactivate_push_subscription(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_push_subscription(UUID) TO service_role;
