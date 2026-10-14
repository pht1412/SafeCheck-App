-- ==============================================================================
-- Migration: 20261014000000_push_delivery_ack_schema.sql
-- Mô tả: Khởi tạo schema cho Two-Way Push Delivery Handshake & Autonomous Fallback
--        - Bổ sung trạng thái delivery_acked, delivery_timeout cho push_deliveries
--        - Tạo bảng Sổ cái Outbox sos_fallbacks kèm cơ chế Lease & Fencing Token
--        - Hàm RPC nguyên tử record_push_delivery_ack_atomic (bảo toàn đơn điệu)
--        - Hàm RPC nguyên tử claim_sos_fallback_atomic (kiểm tra Human ACK & khóa đồng thời)
--        - Hàm RPC nguyên tử complete_sos_fallback_atomic (xác nhận phản hồi Provider)
-- Tuân thủ: PRD_Deep_v3.md (v3.2) & implementation_plan_v3.md (Chặng 1)
-- ==============================================================================

-- 1. NÂNG CẤP BẢNG push_deliveries (Gia tăng không phá vỡ)
ALTER TABLE public.push_deliveries
    DROP CONSTRAINT IF EXISTS push_deliveries_status_check;

ALTER TABLE public.push_deliveries
    ADD CONSTRAINT push_deliveries_status_check 
    CHECK (status IN ('pending', 'sending', 'accepted', 'delivery_acked', 'retryable', 'unknown', 'expired', 'delivery_timeout'));

ALTER TABLE public.push_deliveries
    ADD COLUMN IF NOT EXISTS delivery_acked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS client_ack_metadata JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_push_deliveries_acked 
    ON public.push_deliveries(sos_event_id, delivery_acked_at) 
    WHERE delivery_acked_at IS NOT NULL;


-- 2. TẠO BẢNG SỔ CÁI OUTBOX KÊNH DỰ PHÒNG sos_fallbacks
CREATE TABLE IF NOT EXISTS public.sos_fallbacks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sos_event_id UUID NOT NULL REFERENCES public.sos_events(id) ON DELETE RESTRICT,
    caregiver_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    
    -- Khóa Idempotency cấp doanh nghiệp chống gửi trùng
    -- Định dạng: sos_event_id || '_' || channel || '_' || tier || '_' || target_phone
    idempotency_key TEXT NOT NULL UNIQUE,
    
    channel VARCHAR(30) NOT NULL CHECK (channel IN ('sms_twilio', 'voice_call_aws', 'webhook_emergency')),
    tier INT NOT NULL DEFAULT 1 CHECK (tier >= 1),
    target_phone TEXT NOT NULL,
    recipient_name TEXT,
    
    trigger_reason VARCHAR(50) NOT NULL 
        CHECK (trigger_reason IN ('delivery_timeout', 'all_endpoints_dead', 'no_human_ack')),
    
    -- State Machine chuẩn Outbox
    status VARCHAR(25) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'claimed', 'provider_accepted', 'delivery_confirmed', 'failed', 'unknown', 'retryable')),
    
    -- Cơ chế Lease & Fencing Token cho Worker
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    fence_token BIGINT NOT NULL DEFAULT 0,
    attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts INT NOT NULL DEFAULT 3,
    
    -- Dữ liệu phản hồi & kiểm toán Provider
    provider_message_id TEXT,
    provider_request_payload JSONB DEFAULT '{}'::jsonb,
    provider_response JSONB DEFAULT '{}'::jsonb,
    error_message TEXT,
    
    -- Mốc thời gian
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    accepted_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sos_fallbacks_event ON public.sos_fallbacks(sos_event_id);
CREATE INDEX IF NOT EXISTS idx_sos_fallbacks_lease ON public.sos_fallbacks(lease_expires_at) 
    WHERE status IN ('pending', 'claimed', 'unknown');

-- Kích hoạt RLS cho sos_fallbacks
ALTER TABLE public.sos_fallbacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Caregivers and elderly can view fallbacks" ON public.sos_fallbacks;
CREATE POLICY "Caregivers and elderly can view fallbacks"
ON public.sos_fallbacks FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.sos_events se
        JOIN public.family_links fl ON fl.elderly_id = se.elderly_id
        WHERE se.id = sos_fallbacks.sos_event_id
          AND (fl.caregiver_id = auth.uid() OR se.elderly_id = auth.uid())
          AND fl.status = 'accepted'
    )
);


-- 3. RPC NGUYÊN TỬ: GHI NHẬN DELIVERY ACK (record_push_delivery_ack_atomic)
-- Khắc phục race condition, bảo đảm tính đơn điệu và chặn ACK sau khi SOS đã đóng
CREATE OR REPLACE FUNCTION public.record_push_delivery_ack_atomic(
    p_sos_event_id UUID,
    p_subscription_id UUID,
    p_client_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_event_status VARCHAR(20);
    v_delivery_record RECORD;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
    v_updated_count INT;
BEGIN
    -- 1. Kiểm tra vòng đời của Sự kiện SOS (Chặn đứng ACK khi SOS đã hoàn tất hoặc bị hủy)
    SELECT status INTO v_event_status
    FROM public.sos_events
    WHERE id = p_sos_event_id;

    IF v_event_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'SOS_EVENT_NOT_FOUND');
    END IF;

    IF v_event_status IN ('resolved', 'cancelled') THEN
        RETURN jsonb_build_object(
            'success', false, 
            'error', 'SOS_EVENT_ALREADY_TERMINATED', 
            'current_status', v_event_status
        );
    END IF;

    -- 2. Đối chiếu tính toàn vẹn: Tìm bản ghi phân phát
    SELECT id, status, caregiver_id, delivery_acked_at 
    INTO v_delivery_record
    FROM public.push_deliveries
    WHERE sos_event_id = p_sos_event_id 
      AND subscription_id = p_subscription_id;

    IF v_delivery_record.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'DELIVERY_RECORD_NOT_FOUND');
    END IF;

    -- 3. Idempotency Check: Nếu đã delivery_acked từ trước thì trả về success không ghi đè
    IF v_delivery_record.status = 'delivery_acked' THEN
        RETURN jsonb_build_object(
            'success', true, 
            'idempotent', true, 
            'delivery_acked_at', v_delivery_record.delivery_acked_at
        );
    END IF;

    -- 4. Chuyển trạng thái đơn điệu:
    -- Chỉ cho phép chuyển từ pending / sending / accepted / unknown
    -- TUYỆT ĐỐI KHÔNG ghi đè nếu bản ghi đã bị expired (410/404)
    UPDATE public.push_deliveries
    SET status = 'delivery_acked',
        delivery_acked_at = v_now,
        client_ack_metadata = p_client_metadata,
        updated_at = v_now
    WHERE id = v_delivery_record.id
      AND status IN ('pending', 'sending', 'accepted', 'unknown');

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count = 0 THEN
        RETURN jsonb_build_object(
            'success', false, 
            'error', 'TRANSITION_REJECTED', 
            'current_status', v_delivery_record.status
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'sos_event_id', p_sos_event_id,
        'caregiver_id', v_delivery_record.caregiver_id,
        'delivery_acked_at', v_now
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_push_delivery_ack_atomic FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_push_delivery_ack_atomic TO service_role;


-- 4. RPC NGUYÊN TỬ: QUYẾT ĐỊNH & CẤP QUYỀN GỬI FALLBACK (claim_sos_fallback_atomic)
-- Kiểm tra Human ACK, kiểm tra deadline và cấp Lease trong CÙNG MỘT TRANSACTION có khóa FOR UPDATE
CREATE OR REPLACE FUNCTION public.claim_sos_fallback_atomic(
    p_sos_event_id UUID,
    p_channel TEXT,
    p_tier INT,
    p_idempotency_key TEXT,
    p_target_phone TEXT,
    p_recipient_name TEXT,
    p_trigger_reason TEXT,
    p_worker_id TEXT,
    p_lease_seconds INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_event RECORD;
    v_human_ack_count INT;
    v_fallback RECORD;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    -- 1. Kiểm tra sự kiện SOS (Khóa hàng FOR UPDATE để chống Race Condition)
    SELECT * INTO v_event
    FROM public.sos_events
    WHERE id = p_sos_event_id
    FOR UPDATE;

    IF v_event.id IS NULL THEN
        RETURN jsonb_build_object('can_send', false, 'reason', 'SOS_EVENT_NOT_FOUND');
    END IF;

    IF v_event.status IN ('resolved', 'cancelled') THEN
        RETURN jsonb_build_object('can_send', false, 'reason', 'SOS_EVENT_ALREADY_TERMINATED');
    END IF;

    -- 2. ĐIỀU KIỆN SỐNG CÒN (P0-01): Kiểm tra đã có người chăm sóc nào bấm tiếp nhận chưa
    SELECT COUNT(*) INTO v_human_ack_count
    FROM public.sos_acknowledgements
    WHERE sos_event_id = p_sos_event_id;

    IF v_human_ack_count > 0 THEN
        RETURN jsonb_build_object('can_send', false, 'reason', 'HUMAN_ALREADY_ACKNOWLEDGED');
    END IF;

    -- 3. Kiểm tra hạn chót SLA (Trừ trường hợp khẩn cấp Fail-Fast: all_endpoints_dead)
    IF p_trigger_reason <> 'all_endpoints_dead' AND v_event.escalation_deadline > v_now THEN
        RETURN jsonb_build_object('can_send', false, 'reason', 'SLA_DEADLINE_NOT_REACHED');
    END IF;

    -- 4. Tìm hoặc tạo bản ghi Fallback Outbox (Khóa hàng FOR UPDATE)
    SELECT * INTO v_fallback
    FROM public.sos_fallbacks
    WHERE idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF v_fallback.id IS NULL THEN
        INSERT INTO public.sos_fallbacks (
            sos_event_id, channel, tier, idempotency_key, target_phone, recipient_name,
            trigger_reason, status, lease_owner, lease_expires_at, fence_token, attempt_count
        ) VALUES (
            p_sos_event_id, p_channel, p_tier, p_idempotency_key, p_target_phone, p_recipient_name,
            p_trigger_reason, 'claimed', p_worker_id, v_now + (p_lease_seconds || ' seconds')::INTERVAL, 1, 1
        )
        RETURNING * INTO v_fallback;

        RETURN jsonb_build_object(
            'can_send', true,
            'fallback_id', v_fallback.id,
            'fence_token', 1,
            'target_phone', v_fallback.target_phone,
            'recipient_name', v_fallback.recipient_name
        );
    END IF;

    -- Nếu đã được Provider tiếp nhận hoặc đã giao thành công -> CHẶN ĐỨNG GỬI LẶP
    IF v_fallback.status IN ('provider_accepted', 'delivery_confirmed') THEN
        RETURN jsonb_build_object('can_send', false, 'reason', 'ALREADY_SENT_TO_PROVIDER');
    END IF;

    -- Nếu đang có worker khác nắm Lease còn hạn -> CHẶN ĐỨNG TRANH CHẤP
    IF v_fallback.status = 'claimed' AND v_fallback.lease_expires_at > v_now THEN
        RETURN jsonb_build_object('can_send', false, 'reason', 'LEASE_HELD_BY_ANOTHER_WORKER');
    END IF;

    -- Quá số lần thử tối đa -> Khóa lại
    IF v_fallback.attempt_count >= v_fallback.max_attempts THEN
        RETURN jsonb_build_object('can_send', false, 'reason', 'MAX_ATTEMPTS_EXCEEDED');
    END IF;

    -- Worker trước bị crash hoặc Lease hết hạn -> Cấp Lease mới kèm tăng fence_token
    UPDATE public.sos_fallbacks
    SET status = 'claimed',
        lease_owner = p_worker_id,
        lease_expires_at = v_now + (p_lease_seconds || ' seconds')::INTERVAL,
        fence_token = fence_token + 1,
        attempt_count = attempt_count + 1,
        updated_at = v_now
    WHERE id = v_fallback.id
    RETURNING * INTO v_fallback;

    RETURN jsonb_build_object(
        'can_send', true,
        'fallback_id', v_fallback.id,
        'fence_token', v_fallback.fence_token,
        'target_phone', v_fallback.target_phone,
        'recipient_name', v_fallback.recipient_name
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_sos_fallback_atomic FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_sos_fallback_atomic TO service_role;


-- 5. RPC NGUYÊN TỬ: HOÀN TẤT GIAO PHÁT FALLBACK (complete_sos_fallback_atomic)
-- Đối chiếu Fencing Token để ngăn worker cũ (bị timeout) ghi đè kết quả của worker mới
CREATE OR REPLACE FUNCTION public.complete_sos_fallback_atomic(
    p_fallback_id UUID,
    p_fence_token BIGINT,
    p_status TEXT, -- 'provider_accepted', 'delivery_confirmed', 'failed', 'unknown'
    p_provider_message_id TEXT DEFAULT NULL,
    p_provider_response JSONB DEFAULT '{}'::jsonb,
    p_error_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_fallback RECORD;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    SELECT * INTO v_fallback
    FROM public.sos_fallbacks
    WHERE id = p_fallback_id;

    IF v_fallback.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'FALLBACK_RECORD_NOT_FOUND');
    END IF;

    -- Kiểm tra Fencing Token đơn điệu
    IF v_fallback.fence_token <> p_fence_token THEN
        RETURN jsonb_build_object(
            'success', false, 
            'error', 'FENCING_TOKEN_MISMATCH', 
            'current_token', v_fallback.fence_token,
            'provided_token', p_fence_token
        );
    END IF;

    UPDATE public.sos_fallbacks
    SET status = p_status,
        provider_message_id = COALESCE(p_provider_message_id, v_fallback.provider_message_id),
        provider_response = p_provider_response,
        error_message = p_error_message,
        accepted_at = CASE WHEN p_status IN ('provider_accepted', 'delivery_confirmed') THEN v_now ELSE v_fallback.accepted_at END,
        confirmed_at = CASE WHEN p_status = 'delivery_confirmed' THEN v_now ELSE v_fallback.confirmed_at END,
        lease_expires_at = NULL,
        lease_owner = NULL,
        updated_at = v_now
    WHERE id = p_fallback_id;

    RETURN jsonb_build_object('success', true, 'status', p_status, 'completed_at', v_now);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_sos_fallback_atomic FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_sos_fallback_atomic TO service_role;
