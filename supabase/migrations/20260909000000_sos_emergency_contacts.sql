-- ====================================================================
-- SafeCheck - Migration v3.0: SOS Emergency Contacts, Triggers & RLS
-- ====================================================================

-- 1. BẢNG EMERGENCY_CONTACTS (Danh bạ cứu hộ khẩn cấp cho người cao tuổi)
CREATE TABLE IF NOT EXISTS public.emergency_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  elderly_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  contact_type VARCHAR(20) NOT NULL CHECK (contact_type IN ('neighbor', 'relative', 'authority', 'medical', 'other')),
  note VARCHAR(255),
  priority_order INT NOT NULL CHECK (priority_order BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  -- Ràng buộc thứ tự ưu tiên duy nhất cho mỗi Cụ (hoãn kiểm tra cuối lệnh để hỗ trợ đổi vị trí)
  CONSTRAINT uq_elderly_priority UNIQUE (elderly_id, priority_order) DEFERRABLE INITIALLY DEFERRED
);

-- Index tra cứu danh bạ khẩn cấp theo Cụ và sắp xếp theo độ ưu tiên
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_elderly 
ON public.emergency_contacts(elderly_id, priority_order ASC);

-- --------------------------------------------------------------------
-- 2. TRIGGERS BẢO VỆ DỮ LIỆU & QUY TẮC NGHIỆP VỤ
-- --------------------------------------------------------------------

-- Trigger 1: Khóa cứng elderly_id (Immutable - Chống tráo đổi danh bạ giữa các Cụ)
CREATE OR REPLACE FUNCTION public.prevent_elderly_id_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.elderly_id IS DISTINCT FROM NEW.elderly_id THEN
    RAISE EXCEPTION 'Bảo mật: Không được phép thay đổi elderly_id của liên hệ khẩn cấp!';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_prevent_elderly_id_change ON public.emergency_contacts;
CREATE TRIGGER tr_prevent_elderly_id_change
BEFORE UPDATE ON public.emergency_contacts
FOR EACH ROW EXECUTE FUNCTION public.prevent_elderly_id_change();

-- Trigger 2: Chặn vượt quá 5 liên hệ cho mỗi Cụ (Chỉ kiểm tra khi INSERT mới)
CREATE OR REPLACE FUNCTION public.check_emergency_contacts_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.emergency_contacts WHERE elderly_id = NEW.elderly_id) >= 5 THEN
    RAISE EXCEPTION 'Nghiệp vụ SafeCheck: Mỗi Cụ chỉ được lưu tối đa 5 liên hệ cứu hộ khẩn cấp!';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_check_emergency_contacts_limit ON public.emergency_contacts;
CREATE TRIGGER tr_check_emergency_contacts_limit
BEFORE INSERT ON public.emergency_contacts
FOR EACH ROW EXECUTE FUNCTION public.check_emergency_contacts_limit();

-- Trigger 3: Tự động chuẩn hóa lại thứ tự ưu tiên (Priority Normalization) sau khi XÓA
CREATE OR REPLACE FUNCTION public.normalize_emergency_contacts_priority()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.emergency_contacts
  SET priority_order = sub.new_order,
      updated_at = timezone('utc'::text, now())
  FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY priority_order ASC, created_at ASC) as new_order
    FROM public.emergency_contacts
    WHERE elderly_id = OLD.elderly_id
  ) sub
  WHERE public.emergency_contacts.id = sub.id
    AND public.emergency_contacts.priority_order <> sub.new_order;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_normalize_priority_after_delete ON public.emergency_contacts;
CREATE TRIGGER tr_normalize_priority_after_delete
AFTER DELETE ON public.emergency_contacts
FOR EACH ROW EXECUTE FUNCTION public.normalize_emergency_contacts_priority();

-- --------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY (RLS) - BẢO MẬT PHÂN QUYỀN ĐA TẦNG
-- --------------------------------------------------------------------
ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;

-- 3.1. SELECT: Cụ xem của mình, Con cháu xem của Cụ đã liên kết hợp lệ (status = 'accepted')
DROP POLICY IF EXISTS "View emergency contacts" ON public.emergency_contacts;
CREATE POLICY "View emergency contacts"
ON public.emergency_contacts FOR SELECT
USING (
  elderly_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.family_links fl
    WHERE fl.elderly_id = emergency_contacts.elderly_id
      AND fl.caregiver_id = auth.uid()
      AND fl.status = 'accepted'
  )
);

-- 3.2. INSERT: Chỉ Con cháu đã liên kết mới được tạo liên hệ cho Cụ đó
DROP POLICY IF EXISTS "Caregiver insert emergency contacts" ON public.emergency_contacts;
CREATE POLICY "Caregiver insert emergency contacts"
ON public.emergency_contacts FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.family_links fl
    WHERE fl.elderly_id = emergency_contacts.elderly_id
      AND fl.caregiver_id = auth.uid()
      AND fl.status = 'accepted'
  )
);

-- 3.3. UPDATE: Chỉ Con cháu đã liên kết mới được cập nhật liên hệ của Cụ
DROP POLICY IF EXISTS "Caregiver update emergency contacts" ON public.emergency_contacts;
CREATE POLICY "Caregiver update emergency contacts"
ON public.emergency_contacts FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.family_links fl
    WHERE fl.elderly_id = emergency_contacts.elderly_id
      AND fl.caregiver_id = auth.uid()
      AND fl.status = 'accepted'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.family_links fl
    WHERE fl.elderly_id = emergency_contacts.elderly_id
      AND fl.caregiver_id = auth.uid()
      AND fl.status = 'accepted'
  )
);

-- 3.4. DELETE: Chỉ Con cháu đã liên kết mới được xóa liên hệ
DROP POLICY IF EXISTS "Caregiver delete emergency contacts" ON public.emergency_contacts;
CREATE POLICY "Caregiver delete emergency contacts"
ON public.emergency_contacts FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.family_links fl
    WHERE fl.elderly_id = emergency_contacts.elderly_id
      AND fl.caregiver_id = auth.uid()
      AND fl.status = 'accepted'
  )
);
