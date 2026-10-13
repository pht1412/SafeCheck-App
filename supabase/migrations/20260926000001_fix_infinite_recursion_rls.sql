-- ==============================================================================
-- SAFECHECK MIGRATION: 20260926000001_fix_infinite_recursion_rls.sql
-- Khắc phục lỗi "infinite recursion detected in policy for relation family_links"
-- Sử dụng SECURITY DEFINER functions để ngắt vòng lặp đệ quy RLS
-- ==============================================================================

-- 1. Hàm helper lấy danh sách elderly_id của người gọi (SECURITY DEFINER ngắt RLS)
CREATE OR REPLACE FUNCTION public.get_my_elderly_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT elderly_id 
  FROM public.family_links 
  WHERE caregiver_id = auth.uid() AND status = 'accepted';
$$;

-- 2. Hàm helper lấy danh sách user_id trong cùng gia đình (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.get_my_family_user_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  -- Cụ của mình
  SELECT elderly_id FROM public.family_links WHERE caregiver_id = auth.uid() AND status = 'accepted'
  UNION
  -- Con cháu của Cụ (nếu mình là Cụ)
  SELECT caregiver_id FROM public.family_links WHERE elderly_id = auth.uid() AND status = 'accepted'
  UNION
  -- Anh chị em con cháu khác cùng chăm sóc Cụ
  SELECT fl_other.caregiver_id 
  FROM public.family_links fl_other 
  WHERE fl_other.elderly_id IN (
    SELECT elderly_id FROM public.family_links WHERE caregiver_id = auth.uid() AND status = 'accepted'
  ) AND fl_other.status = 'accepted';
$$;

-- 3. Khôi phục RLS trên family_links với hàm helper không đệ quy
DROP POLICY IF EXISTS "Family members can view all links of their elderly" ON public.family_links;
DROP POLICY IF EXISTS "Users can view own family links" ON public.family_links;

CREATE POLICY "Family members can view all links of their elderly"
ON public.family_links FOR SELECT
USING (
  auth.uid() = elderly_id 
  OR auth.uid() = caregiver_id
  OR elderly_id IN (SELECT public.get_my_elderly_ids())
);

-- 4. Khôi phục RLS trên profiles với hàm helper không đệ quy
DROP POLICY IF EXISTS "Users can view own and linked family profiles" ON public.profiles;

CREATE POLICY "Users can view own and linked family profiles"
ON public.profiles FOR SELECT
USING (
  auth.uid() = id
  OR id IN (SELECT public.get_my_family_user_ids())
);
