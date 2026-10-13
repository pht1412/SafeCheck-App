-- ==============================================================================
-- SAFECHECK MIGRATION: 20260926000000_family_activity_and_acks_fix.sql
-- Giải quyết triệt để 2 vấn đề:
-- 1. Hiển thị chính xác Tên và Mối quan hệ của TẤT CẢ con cháu khi tiếp nhận SOS
--    (Ví dụ: Nguyễn A - Con cả, Lê Lê - Con thứ, không còn bị Người thân - Người thân)
-- 2. Cho phép con cháu trong cùng một gia đình xem đầy đủ danh sách toàn bộ con cháu
--    cùng chăm sóc Cụ trong Modal Nhật ký Hoạt động.
-- ==============================================================================

-- 1. NÂNG CẤP RLS CHO BẢNG family_links:
-- Cho phép bất kỳ con cháu nào đã liên kết accepted với Cụ xem toàn bộ con cháu khác của Cụ
DROP POLICY IF EXISTS "Users can view own family links" ON public.family_links;
DROP POLICY IF EXISTS "Family members can view all links of their elderly" ON public.family_links;

CREATE POLICY "Family members can view all links of their elderly"
ON public.family_links FOR SELECT
USING (
  auth.uid() = elderly_id 
  OR auth.uid() = caregiver_id
  OR elderly_id IN (
    SELECT fl_sub.elderly_id 
    FROM public.family_links fl_sub 
    WHERE fl_sub.caregiver_id = auth.uid() AND fl_sub.status = 'accepted'
  )
);

-- 2. NÂNG CẤP RLS CHO BẢNG profiles:
-- Cho phép con cháu cùng một gia đình xem thông tin (full_name, phone) của nhau
DROP POLICY IF EXISTS "Users can view own and linked family profiles" ON public.profiles;

CREATE POLICY "Users can view own and linked family profiles"
ON public.profiles FOR SELECT
USING (
  auth.uid() = id
  OR id IN (
    -- Profile của Cụ mà mình đang chăm sóc
    SELECT fl.elderly_id FROM public.family_links fl WHERE fl.caregiver_id = auth.uid() AND fl.status = 'accepted'
  )
  OR id IN (
    -- Profile của các anh chị em con cháu khác cùng chăm sóc Cụ của mình
    SELECT fl_peer.caregiver_id 
    FROM public.family_links fl_peer
    JOIN public.family_links fl_mine ON fl_mine.elderly_id = fl_peer.elderly_id
    WHERE fl_mine.caregiver_id = auth.uid() AND fl_mine.status = 'accepted' AND fl_peer.status = 'accepted'
  )
  OR id IN (
    -- Cụ xem profile toàn bộ con cháu của mình
    SELECT fl_eld.caregiver_id FROM public.family_links fl_eld WHERE fl_eld.elderly_id = auth.uid() AND fl_eld.status = 'accepted'
  )
);

-- 3. TẠO RPC get_family_members:
-- Trả về toàn bộ con cháu liên kết với Cụ cho Modal Nhật ký Hoạt động
CREATE OR REPLACE FUNCTION public.get_family_members(
    p_elderly_id UUID
)
RETURNS TABLE (
    id UUID,
    caregiver_id UUID,
    full_name TEXT,
    relationship TEXT,
    phone TEXT,
    status TEXT,
    created_at TIMESTAMPTZ,
    has_push_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    -- Kiểm tra quyền: Người gọi phải là Cụ hoặc là con cháu đã liên kết accepted
    IF NOT EXISTS (
        SELECT 1 FROM public.family_links fl
        WHERE fl.elderly_id = p_elderly_id
          AND (fl.caregiver_id = auth.uid() OR fl.elderly_id = auth.uid())
          AND fl.status = 'accepted'
    ) AND auth.uid() <> p_elderly_id THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT 
        fl.id,
        fl.caregiver_id,
        COALESCE(p.full_name, 'Người thân')::TEXT AS full_name,
        COALESCE(fl.relationship, 'Con cháu')::TEXT AS relationship,
        p.phone::TEXT,
        fl.status::TEXT,
        fl.created_at,
        EXISTS (
            SELECT 1 FROM public.push_subscriptions ps
            WHERE ps.user_id = fl.caregiver_id AND ps.is_active = true
        ) AS has_push_active
    FROM public.family_links fl
    LEFT JOIN public.profiles p ON p.id = fl.caregiver_id
    WHERE fl.elderly_id = p_elderly_id
      AND fl.status = 'accepted'
    ORDER BY fl.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_family_members(UUID) TO authenticated, service_role;

-- 4. TẠO RPC get_sos_acknowledgements:
-- Trả về danh sách tiếp nhận SOS kèm Tên & Mối quan hệ chính xác của từng con cháu
CREATE OR REPLACE FUNCTION public.get_sos_acknowledgements(
    p_sos_event_id UUID
)
RETURNS TABLE (
    id UUID,
    sos_event_id UUID,
    caregiver_id UUID,
    caregiver_name TEXT,
    relationship TEXT,
    acknowledged_at TIMESTAMPTZ,
    channel TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_elderly_id UUID;
BEGIN
    SELECT se.elderly_id INTO v_elderly_id
    FROM public.sos_events se
    WHERE se.id = p_sos_event_id;

    IF v_elderly_id IS NULL THEN
        RETURN;
    END IF;

    -- Kiểm tra quyền: Người gọi phải là Cụ hoặc là con cháu liên kết với Cụ
    IF auth.uid() <> v_elderly_id AND NOT EXISTS (
        SELECT 1 FROM public.family_links fl
        WHERE fl.elderly_id = v_elderly_id
          AND fl.caregiver_id = auth.uid()
          AND fl.status = 'accepted'
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT 
        sa.id,
        sa.sos_event_id,
        sa.caregiver_id,
        COALESCE(sa.client_metadata->>'caregiver_name', p.full_name, 'Người thân')::TEXT AS caregiver_name,
        COALESCE(sa.client_metadata->>'relationship', fl.relationship, 'Người thân')::TEXT AS relationship,
        sa.acknowledged_at,
        sa.channel::TEXT,
        sa.created_at
    FROM public.sos_acknowledgements sa
    LEFT JOIN public.profiles p ON p.id = sa.caregiver_id
    LEFT JOIN public.family_links fl ON fl.caregiver_id = sa.caregiver_id AND fl.elderly_id = v_elderly_id
    WHERE sa.sos_event_id = p_sos_event_id
    ORDER BY sa.acknowledged_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sos_acknowledgements(UUID) TO authenticated, service_role;
