-- ==============================================================================
-- Migration: 20261014000002_grant_fallback_rpc_permissions.sql
-- Mô tả: Cấp quyền thực thi các RPC Fallback và Push ACK cho service_role
--        đảm bảo Vercel Dispatcher & Escalation Worker hoạt động bảo mật,
--        không cấp quyền cho anon để bảo vệ dữ liệu cứu hộ khẩn cấp.
-- ==============================================================================

GRANT EXECUTE ON FUNCTION public.record_push_delivery_ack_atomic(UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_sos_fallback_atomic(UUID, TEXT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_sos_fallback_atomic(UUID, BIGINT, TEXT, TEXT, JSONB, TEXT) TO service_role;

-- Cấp quyền bảng sos_fallbacks cho service_role (người dùng chỉ xem qua RLS policy)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sos_fallbacks TO service_role;
