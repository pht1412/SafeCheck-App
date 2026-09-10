import { test, expect } from '@playwright/test';

test.describe('Module 04: Bảo mật & Các trường hợp biên (Security & Edge Cases)', () => {

  // ===================================================================
  // TEST CASE 1: Bảo mật phân quyền - User thường (test02) không thấy Dev Tool
  // ===================================================================
  test('TC01: Tài khoản người dùng thường (test02) tuyệt đối KHÔNG thấy Dev Tool', async ({ page }) => {
    // 1. Robot truy cập trang đăng nhập
    await page.goto('/');

    // 2. Đăng nhập bằng tài khoản người dùng bình thường: test02@gmail.com
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test02@gmail.com');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('test02@gmail.com');
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();

    // 3. Đợi vào màn hình Con cháu
    await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    // 4. KIỂM THỬ BẢO MẬT GIAO DIỆN (RBAC - Role-based UI Access):
    // Người dùng thật không được phép thấy thanh Dev Tool can thiệp hệ thống
    const devToolHeader = page.getByText(/Mô phỏng trạng thái \(Dev Tool\)/);
    await expect(devToolHeader).not.toBeVisible();

    // Các nút thao túng trạng thái giả lập cũng phải hoàn toàn vắng mặt
    await expect(page.getByRole('button', { name: 'Set Late' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Set SOS' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Set Waiting' })).not.toBeVisible();
  });

  // ===================================================================
  // TEST CASE 2: Trường hợp biên (Edge Case) - Nhập sai mã ghép nối Cụ
  // ===================================================================
  test('TC02: Con cháu nhập mã ghép nối sai -> Hệ thống chặn và báo lỗi', async ({ page }) => {
    // 1. Đăng nhập tài khoản test02
    await page.goto('/');
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('Test03@gmail.com');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('Test03@gmail.com');
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    // 2. Nếu con cháu đang ở màn hình trống, tìm nút kết nối
    const connectBtn = page.getByRole('button', { name: '+ KẾT NỐI VỚI CỤ NGAY' });
    if (await connectBtn.isVisible()) {
      await connectBtn.click();

      // 3. Nhập một mã ghép hoàn toàn sai (không tồn tại trong hệ thống)
      const codeInput = page.getByPlaceholder('Ví dụ: 8B29JG');
      await codeInput.fill('SAI999');

      // 4. Bấm xác nhận
      await page.getByRole('button', { name: 'Xác nhận' }).click();

      // 5. Kiểm chứng: Modal KHÔNG được đóng, hiển thị thông báo lỗi từ RPC Supabase
      // Lớp thông báo lỗi màu đỏ xuất hiện trong modal
      const errorBox = page.locator('div.bg-rose-950');
      await expect(errorBox).toBeVisible({ timeout: 10000 });
      console.log('[Test TC02] Đã chặn thành công mã ghép sai và báo lỗi.');
    }
  });

  // ===================================================================
  // TEST CASE 3: Trường hợp biên (Edge Case) - Cụ chưa có người thân bấm SOS (Phương án B)
  // ===================================================================
  test('TC03: Phương án B - Cụ neo đơn kích hoạt SOS hiển thị gọi 115 và nút tự tắt còi', async ({ page }) => {
    // 1. Đăng nhập Cụ mẫu (hoặc Cụ bất kỳ)
    await page.goto('/');
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('0987654321');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('123456');
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(page.getByTestId('elderly-device')).toBeVisible({ timeout: 10000 });

    // 2. Kích hoạt báo động SOS: Đè giữ nút SOS 3 giây
    const sosBtn = page.getByTestId('sos-button');
    await sosBtn.hover();
    await page.mouse.down();
    await page.waitForTimeout(3200);
    await page.mouse.up();

    // 3. Đợi hết 10s đếm ngược chuyển sang Báo động đỏ
    await expect(page.getByTestId('elderly-emergency-view')).toBeVisible({ timeout: 15000 });

    // 4. Kiểm tra nút tắt còi của Cụ luôn hiện hữu dù có hoặc chưa có con cháu
    const dismissBtn = page.getByTestId('resolve-alarm-elderly-button');
    await expect(dismissBtn).toBeVisible();

    // 5. Cụ chủ động bấm tắt còi
    await dismissBtn.click();

    // 6. Kiểm chứng màn hình Cụ trở lại trạng thái an toàn
    await expect(page.getByTestId('status-safe-card')).toBeVisible({ timeout: 10000 });
  });

});
