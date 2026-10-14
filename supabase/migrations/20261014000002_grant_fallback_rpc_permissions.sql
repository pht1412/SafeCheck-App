-- ==============================================================================
-- Migration: 20261014000002_grant_fallback_rpc_permissions.sql
-- Mô tả: Cấp quyền thực thi các RPC Fallback và Push ACK cho authenticated, anon, service_role
--        đảm bảo Vercel Dispatcher & Service Worker hoạt động 100% không bị lỗi Permission Denied
--        khi gọi claim_sos_fallback_atomic, complete_sos_fallback_atomic, record_push_delivery_ack_atomic.
-- ==============================================================================

GRANT EXECUTE ON FUNCTION public.record_push_delivery_ack_atomic(UUID, UUID, JSONB) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_sos_fallback_atomic(UUID, TEXT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, INT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.complete_sos_fallback_atomic(UUID, BIGINT, TEXT, TEXT, JSONB, TEXT) TO authenticated, anon, service_role;

-- Cấp quyền truy cập bảng sos_fallbacks cho các vai trò để RPC SECURITY DEFINER và client view hoạt động trơn tru
GRANT SELECT, INSERT, UPDATE ON TABLE public.sos_fallbacks TO authenticated, anon, service_role;
