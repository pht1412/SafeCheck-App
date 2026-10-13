-- ==============================================================================
-- Migration: 20260925000000_fix_push_rpc_permissions.sql
-- Mô tả: Cấp quyền thực thi các RPC phân phát Web Push cho authenticated và anon,
--        đảm bảo Vercel Dispatcher hoạt động tin cậy 100% ngay cả khi môi trường
--        chỉ có Anon Key, không bị lỗi Permission Denied chặn phát thông báo khẩn cấp.
-- ==============================================================================

GRANT EXECUTE ON FUNCTION public.get_caregiver_push_subscriptions(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_push_delivery_lease(UUID, UUID, UUID, TEXT, TEXT, INT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.complete_push_delivery_fenced(UUID, TEXT, BIGINT, VARCHAR, INT, TEXT, TEXT, TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_push_subscription(UUID) TO authenticated, anon, service_role;
