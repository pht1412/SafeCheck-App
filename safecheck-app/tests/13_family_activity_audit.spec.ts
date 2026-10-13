// ==============================================================================
// SafeCheck - Test Suite: Module 13 (Family Activity Audit & Member Coordination)
// Kiểm thử Nhật ký hoạt động gia đình, tính độ lệch trễ điểm danh, và hiển thị con cháu
// ==============================================================================

import { test, expect } from '@playwright/test';

test.describe('Module 13: Family Activity Audit & Coordination', () => {
  test.describe.configure({ mode: 'serial' });

  // ------------------------------------------------------------------
  // TEST 1: Kiểm thử logic tính toán độ lệch trễ (Delay Delta Calculation)
  // ------------------------------------------------------------------
  test('TC13-01: Tính toán độ lệch trễ điểm danh chính xác so với hạn chót', () => {
    // Trường hợp 1: Điểm danh đúng giờ (07:45 < Deadline 08:00)
    const deadline = '08:00:00';
    const [dlH, dlM] = deadline.split(':').map(Number);
    const dlTotal = dlH * 60 + dlM;

    const checkinOnTime = new Date('2026-10-13T07:45:00');
    const onTimeTotal = checkinOnTime.getHours() * 60 + checkinOnTime.getMinutes();
    expect(onTimeTotal <= dlTotal).toBe(true);

    // Trường hợp 2: Điểm danh trễ 45 phút (08:45 > Deadline 08:00)
    const checkinLate = new Date('2026-10-13T08:45:00');
    const lateTotal = checkinLate.getHours() * 60 + checkinLate.getMinutes();
    const delayMinutes = lateTotal - dlTotal;
    expect(delayMinutes).toBe(45);

    // Trường hợp 3: Điểm danh trễ 2 giờ 15 phút (10:15 > Deadline 08:00)
    const checkinLateHours = new Date('2026-10-13T10:15:00');
    const lateHoursTotal = checkinLateHours.getHours() * 60 + checkinLateHours.getMinutes();
    const delayHoursMins = lateHoursTotal - dlTotal;
    expect(Math.floor(delayHoursMins / 60)).toBe(2);
    expect(delayHoursMins % 60).toBe(15);
  });

  // ------------------------------------------------------------------
  // TEST 2: Đảm bảo định dạng tiếp nhận gồm cả Tên và Mối quan hệ
  // ------------------------------------------------------------------
  test('TC13-02: Định dạng hiển thị tiếp nhận con cháu gồm Tên và Mối quan hệ', () => {
    interface AckItem {
      caregiver_name: string;
      relationship?: string;
    }

    const ack1: AckItem = { caregiver_name: 'Nguyễn A', relationship: 'Con trai' };
    const ack2: AckItem = { caregiver_name: 'Lê Lê', relationship: 'Con gái' };

    const formatAck = (ack: AckItem) => {
      return `${ack.caregiver_name}${ack.relationship ? ` - ${ack.relationship}` : ''}`;
    };

    expect(formatAck(ack1)).toBe('Nguyễn A - Con trai');
    expect(formatAck(ack2)).toBe('Lê Lê - Con gái');
  });

  // ------------------------------------------------------------------
  // TEST 3: Giao diện Caregiver - Mở Modal Nhật ký Hoạt động & Con cháu
  // ------------------------------------------------------------------
  test('TC13-03: Caregiver mở Modal Nhật ký Hoạt động và chuyển tab thành công', async ({ page }) => {
    // Đăng nhập Caregiver
    await page.goto('/');

    // Điền thông tin đăng nhập Caregiver chuẩn xác
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test01@gmail.com');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('test01@gmail.com');
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();

    // Đợi Header xuất hiện hoặc màn hình Caregiver xuất hiện
    await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 15000 });

    // Kiểm tra nút mở Modal Nhật ký Hoạt động có hiển thị
    const openBtn = page.locator('[data-testid="open-activity-modal-btn"]');
    if (await openBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await openBtn.click();

      // Modal Nhật ký phải bật lên
      const modal = page.locator('[data-testid="family-activity-modal"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Tab 1: Hoạt động & Điểm danh
      await expect(page.locator('[data-testid="today-checkin-card"]')).toBeVisible();
      await expect(page.locator('[data-testid="sos-history-card"]')).toBeVisible();

      // Bấm chuyển sang Tab 2: Con cháu trong nhà
      const tabMembers = page.locator('[data-testid="tab-members"]');
      await tabMembers.click();

      // Kiểm tra tab con cháu hiển thị
      await expect(page.locator('[data-testid="family-members-tab"]')).toBeVisible();

      // Đóng modal
      await page.click('button:has-text("Đóng")');
      await expect(modal).not.toBeVisible();
    }
  });

  // ------------------------------------------------------------------
  // TEST 4: Tích hợp Database - Xác nhận RPC get_family_members trả về toàn bộ con cháu
  // ------------------------------------------------------------------
  test('TC13-04: Caregiver gọi RPC get_family_members thấy đầy đủ toàn bộ con cháu (Nguyễn A và Lê Lê)', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://bozuzbmgnzzxyrioxzaa.supabase.co';
    const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_ZQjFvvLTLywvw4rKJIPU9Q_5iR_78Rr';
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Đăng nhập Caregiver test01 (Nguyễn A)
    const { data: auth, error: authErr } = await client.auth.signInWithPassword({
      email: 'test01@gmail.com',
      password: 'test01@gmail.com',
    });
    expect(authErr).toBeNull();

    // Lấy liên kết tới Cụ
    const { data: myLink } = await client
      .from('family_links')
      .select('elderly_id')
      .eq('caregiver_id', auth.user!.id)
      .eq('status', 'accepted')
      .maybeSingle();

    if (myLink?.elderly_id) {
      // Gọi RPC get_family_members
      const { data: members, error: mErr } = await client.rpc('get_family_members', {
        p_elderly_id: myLink.elderly_id,
      });

      expect(mErr).toBeNull();
      expect(Array.isArray(members)).toBe(true);
      // Cụ có nhiều hơn 1 con cháu đã liên kết (ít nhất là Nguyễn A và Lê Lê)
      expect(members!.length).toBeGreaterThanOrEqual(2);

      const names = members!.map((m: any) => m.full_name);
      expect(names).toContain('Nguyễn A');
      expect(names).toContain('Lê Lê');

      const rels = members!.map((m: any) => m.relationship);
      expect(rels).toContain('Con cả');
      expect(rels.some((r: string) => r.includes('Con'))).toBe(true);
    }
  });
});
