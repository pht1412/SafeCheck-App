-- ==============================================================================
-- Migration: 20260924000000_enable_realtime_acknowledgements.sql
-- Kích hoạt Supabase Realtime cho bảng sos_acknowledgements
-- Giúp đồng bộ tức thì danh sách người thân tiếp nhận cứu hộ giữa Cụ và Con cháu
-- ==============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'sos_acknowledgements'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sos_acknowledgements;
  END IF;
END $$;
