-- ==============================================================================
-- Migration: 20261014000004_revoke_anon_and_secure_rpc.sql
-- Mô tả: Thu hồi toàn bộ quyền thực thi và truy cập nhạy cảm khỏi role anon
--        Khắc phục các lỗ hổng cấp quyền quá mức trong 20260925000000
--        Đảm bảo chỉ service_role mới được phép gọi các RPC nội bộ của hạ tầng
-- ==============================================================================

-- 1. Thu hồi quyền trên các hàm phân phát Web Push (chỉ dành cho service_role)
REVOKE ALL ON FUNCTION public.get_caregiver_push_subscriptions(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_caregiver_push_subscriptions(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.claim_push_delivery_lease(UUID, UUID, UUID, TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_delivery_lease(UUID, UUID, UUID, TEXT, TEXT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.complete_push_delivery_fenced(UUID, TEXT, BIGINT, VARCHAR, INT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_push_delivery_fenced(UUID, TEXT, BIGINT, VARCHAR, INT, TEXT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.deactivate_push_subscription(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_push_subscription(UUID) TO service_role;

-- 2. Đảm bảo thu hồi an toàn tuyệt đối từ anon trên các RPC Fallback & Scanner
REVOKE ALL ON FUNCTION public.record_push_delivery_ack_atomic(UUID, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_push_delivery_ack_atomic(UUID, UUID, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.claim_sos_fallback_atomic(UUID, TEXT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sos_fallback_atomic(UUID, TEXT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.complete_sos_fallback_atomic(UUID, BIGINT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sos_fallback_atomic(UUID, BIGINT, TEXT, TEXT, JSONB, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.get_overdue_sos_events(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_overdue_sos_events(TIMESTAMPTZ) TO service_role;

-- 3. Thu hồi quyền trực tiếp trên bảng sos_fallbacks từ anon (chỉ service_role có toàn quyền, user xem qua RLS policy)
REVOKE ALL ON TABLE public.sos_fallbacks FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sos_fallbacks TO service_role;
