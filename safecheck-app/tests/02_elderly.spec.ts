import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://bozuzbmgnzzxyrioxzaa.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_ZQjFvvLTLywvw4rKJIPU9Q_5iR_78Rr';

test.describe('Module 02: Nghiệp vụ Màn hình Người cao tuổi (Elderly Screen)', () => {
  test.describe.configure({ mode: 'serial' });

  // Trước mỗi testcase: Tự động reset trạng thái Cụ về trạng thái sạch (Waiting, không có SOS)
  test.beforeEach(async ({ page }) => {
    // 0. Reset trạng thái Database của Cụ để bài test độc lập và ổn định 100%
    const clientElderly = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: auth } = await clientElderly.auth.signInWithPassword({
      email: '0123456789@safecheck.local',
      password: '123456',
    });
    if (auth?.user) {
      // Đóng bất kỳ sự kiện SOS active nào còn sót lại
      await clientElderly
        .from('sos_events')
        .update({ status: 'resolved', resolved_at: new Date().toISOString() })
        .eq('elderly_id', auth.user.id)
        .eq('status', 'active');
    }

    // Đưa trạng thái hôm nay về Waiting bằng tài khoản tester (được phép update theo RLS)
    const clientTester = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    await clientTester.auth.signInWithPassword({
      email: 'test01@gmail.com',
      password: 'test01@gmail.com',
    });
    const today = new Date().toISOString().split('T')[0];
    await clientTester
      .from('checkin_logs')
      .update({ status: 'Waiting', checkin_time: null })
      .eq('family_code', '3UGSN6')
      .eq('log_date', today);

    // 1. Truy cập trang chủ
    await page.goto('/');

    // 2. Điền số điện thoại và mật khẩu của Cụ mẫu
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('0123456789');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('123456');

    // 3. Bấm ĐĂNG NHẬP
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();

    // 4. Đợi robot vào hẳn màn hình Cụ (thấy container thiết bị của Cụ)
    await expect(page.getByTestId('elderly-device')).toBeVisible({ timeout: 10000 });
  });

  // ===================================================================
  // TEST CASE 1: Kiểm tra giao diện Cụ (Tên, Mã ghép, Tuyệt đối KHÔNG có nút Đăng xuất)
  // ===================================================================
  test('TC01: Giao diện Cụ hiển thị đúng tên, mã ghép và giấu nút Đăng xuất', async ({ page }) => {
    // 1. Phải thấy dòng Mã ghép 6 ký tự
    const pairingBadge = page.getByText('Mã ghép:');
    await expect(pairingBadge).toBeVisible();

    // 2. Phải có nút SOS màu đỏ ở phía dưới
    const sosBtn = page.getByTestId('sos-button');
    await expect(sosBtn).toBeVisible();

    // 3. KIỂM THỬ BẢO MẬT UX: Tuyệt đối KHÔNG ĐƯỢC CÓ nút "Đăng xuất" trên màn hình Cụ
    const logoutBtn = page.getByRole('button', { name: /Đăng xuất/i });
    await expect(logoutBtn).not.toBeVisible();
  });

  // ===================================================================
  // TEST CASE 2: Cụ bấm nút "Tôi ổn" -> Màn hình chuyển sang xác nhận "Hôm nay đã ổn"
  // ===================================================================
  test('TC02: Cụ bấm nút điểm danh -> Hiển thị thẻ xác nhận Hôm nay đã ổn', async ({ page }) => {
    // 1. Kiểm tra nút điểm danh (chắc chắn xuất hiện vì trạng thái ban đầu đã được reset về Waiting)
    const checkinBtn = page.getByTestId('checkin-button');
    await expect(checkinBtn).toBeVisible({ timeout: 10000 });
    await checkinBtn.click();

    // 2. Kiểm chứng: Thẻ xanh "HÔM NAY ĐÃ ỔN" phải xuất hiện
    const safeCard = page.getByTestId('status-safe-card');
    await expect(safeCard).toBeVisible({ timeout: 10000 });
    await expect(safeCard).toContainText('HÔM NAY ĐÃ ỔN');
    await expect(safeCard).toContainText('Đã điểm danh lúc:');
  });

  // ===================================================================
  // TEST CASE 3: Đè giữ nút SOS 3 giây -> Đếm ngược 10s -> Bấm HỦY BÁO ĐỘNG
  // ===================================================================
  test('TC03: Đè giữ SOS 3 giây kích hoạt đếm ngược 10s và bấm nút Hủy', async ({ page }) => {
    const sosBtn = page.getByTestId('sos-button');

    // 1. Robot di chuột tới nút SOS và đè chuột xuống (mô phỏng ngón tay Cụ đè giữ)
    await sosBtn.hover();
    await page.mouse.down();

    // 2. Giữ nguyên ngón tay trong 3.2 giây (vượt qua mốc 3 giây của app)
    await page.waitForTimeout(3200);

    // 3. Nhấc ngón tay ra
    await page.mouse.up();

    // 4. Kiểm chứng: Modal đếm ngược chống bấm nhầm 10 giây phải hiện lên
    const countdownModal = page.getByTestId('sos-countdown-modal');
    await expect(countdownModal).toBeVisible();
    await expect(countdownModal).toContainText('Chuẩn bị phát báo động!');

    // 5. Robot bấm nút "HỦY BÁO ĐỘNG" to màu trắng
    const cancelBtn = page.getByTestId('cancel-sos-button');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    // 6. Kiểm chứng: Modal đếm ngược phải lập tức biến mất, không phát còi
    await expect(countdownModal).not.toBeVisible();
  });

});
