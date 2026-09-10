import { test, expect } from '@playwright/test';

test.describe('Module 02: Nghiệp vụ Màn hình Người cao tuổi (Elderly Screen)', () => {

  // Trước mỗi testcase: Robot đăng nhập vào tài khoản Cụ mẫu 0123456789
  test.beforeEach(async ({ page }) => {
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
    // 1. Kiểm tra nút điểm danh (chỉ có khi hôm nay Cụ chưa bấm)
    const checkinBtn = page.getByTestId('checkin-button');
    
    // Nếu hôm nay Cụ chưa điểm danh thì bấm
    if (await checkinBtn.isVisible()) {
      await checkinBtn.click();
    }

    // 2. Kiểm chứng: Thẻ xanh "HÔM NAY ĐÃ ỔN" phải xuất hiện
    const safeCard = page.getByTestId('status-safe-card');
    await expect(safeCard).toBeVisible();
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
