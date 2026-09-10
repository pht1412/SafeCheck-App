-- ==============================================================================
-- Migration: 20260910000000_sos_push_schema.sql
-- Mô tả: Khởi tạo bảng sos_events (Source of Truth) và push_subscriptions
--        cho hệ thống Web Push Notifications ngoại tuyến của SafeCheck.
-- Tuân thủ: PRD_NotiSOS.md & implementation_plan.md
-- ==============================================================================

-- 1. BẢNG SỰ KIỆN SOS KHẨN CẤP (sos_events - SOURCE OF TRUTH)
CREATE TABLE IF NOT EXISTS public.sos_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    elderly_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'cancelled')),
    trigger_source TEXT NOT NULL DEFAULT 'button' CHECK (trigger_source IN ('button', 'timeout', 'fall_detection')),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    address TEXT,
    push_dispatched_at TIMESTAMPTZ,
    push_dispatched_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_sos_events_elderly ON public.sos_events(elderly_id);
CREATE INDEX IF NOT EXISTS idx_sos_events_status ON public.sos_events(status);

-- 2. BẢNG LƯU TRỮ WEB PUSH SUBSCRIPTIONS (push_subscriptions)
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'unknown' CHECK (platform IN ('ios', 'android', 'desktop', 'unknown')),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions(user_id);

-- 3. THIẾT LẬP ROW LEVEL SECURITY (RLS)
ALTER TABLE public.sos_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- 3.1. RLS cho sos_events:
-- Elderly INSERT chính sự kiện của mình
DROP POLICY IF EXISTS "Elderly can insert own sos_events" ON public.sos_events;
CREATE POLICY "Elderly can insert own sos_events"
    ON public.sos_events FOR INSERT
    WITH CHECK (auth.uid() = elderly_id);

-- Elderly và linked Caregivers (status = 'accepted') có quyền SELECT
DROP POLICY IF EXISTS "Elderly and linked caregivers can view sos_events" ON public.sos_events;
CREATE POLICY "Elderly and linked caregivers can view sos_events"
    ON public.sos_events FOR SELECT
    USING (
        auth.uid() = elderly_id OR
        EXISTS (
            SELECT 1 FROM public.family_links fl
            WHERE fl.elderly_id = sos_events.elderly_id
              AND fl.caregiver_id = auth.uid()
              AND fl.status = 'accepted'
        )
    );

-- Caregiver CHỈ được phép UPDATE khi status = 'active', chỉ đổi status = 'resolved' và resolved_by = auth.uid()
DROP POLICY IF EXISTS "Linked caregivers can resolve active sos_events" ON public.sos_events;
CREATE POLICY "Linked caregivers can resolve active sos_events"
    ON public.sos_events FOR UPDATE
    USING (
        status = 'active' AND
        EXISTS (
            SELECT 1 FROM public.family_links fl
            WHERE fl.elderly_id = sos_events.elderly_id
              AND fl.caregiver_id = auth.uid()
              AND fl.status = 'accepted'
        )
    )
    WITH CHECK (
        status = 'resolved' AND
        resolved_by = auth.uid()
    );

-- 3.2. RLS cho push_subscriptions:
-- Chỉ người sở hữu mới được SELECT / INSERT / UPDATE / DELETE subscription của chính mình.
-- Tuyệt đối không cho phép thành viên khác xem endpoint (Secret Capability URL).
DROP POLICY IF EXISTS "Users can manage own subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can manage own subscriptions"
    ON public.push_subscriptions FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
