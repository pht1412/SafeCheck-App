import { test, expect } from '@playwright/test';

/**
 * ==============================================================================
 * Test Suite 20: Kiểm thử An ninh Rate Limiting Đăng nhập (Brute-Force & Credential Stuffing)
 * Tiêu chuẩn: P0-SEC-05 - Giới hạn 5 lần đăng nhập sai, khóa 15 phút, reset khi đăng nhập đúng
 * ==============================================================================
 */
test.describe('Module 20: Bảo mật Đăng nhập - Login Rate Limiting & Anti Brute-Force', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Clear localStorage to ensure clean slate per test
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  // ===================================================================
  // TEST CASE 1: Nhập sai mật khẩu đếm lùi số lần thử từ 4 về 0 và khóa ở lần thứ 5
  // ===================================================================
  test('TC01: Nhập sai mật khẩu liên tiếp hiển thị số lần thử còn lại giảm dần và khóa sau 5 lần', async ({ page }) => {
    const testIdentifier = `victim_${Date.now()}@safecheck.local`;

    await page.getByTestId('auth-identifier-input').fill(testIdentifier);
    await page.getByTestId('auth-password-input').fill('wrong_password_1');

    // Lần 1: Còn 4 lần thử
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-error-alert')).toContainText('Còn 4 lần thử', { timeout: 10000 });

    // Lần 2: Còn 3 lần thử
    await page.getByTestId('auth-password-input').fill('wrong_password_2');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-error-alert')).toContainText('Còn 3 lần thử', { timeout: 10000 });

    // Lần 3: Còn 2 lần thử
    await page.getByTestId('auth-password-input').fill('wrong_password_3');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-error-alert')).toContainText('Còn 2 lần thử', { timeout: 10000 });

    // Lần 4: Còn 1 lần thử
    await page.getByTestId('auth-password-input').fill('wrong_password_4');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-error-alert')).toContainText('Còn 1 lần thử', { timeout: 10000 });

    // Lần 5: Đạt ngưỡng khóa 15 phút
    await page.getByTestId('auth-password-input').fill('wrong_password_5');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-error-alert')).toContainText('Tài khoản bị tạm khóa trong 15 phút', { timeout: 10000 });
  });

  // ===================================================================
  // TEST CASE 2: Lần thử thứ 6 bị chặn ngay lập tức tại Gateway/Client
  // ===================================================================
  test('TC02: Sau khi bị khóa, lần thử tiếp theo bị chặn lập tức mà không gọi xác thực lên máy chủ', async ({ page }) => {
    const testIdentifier = `lockout_${Date.now()}@safecheck.local`;

    await page.getByTestId('auth-identifier-input').fill(testIdentifier);

    // Thực hiện 5 lần sai
    for (let i = 1; i <= 5; i++) {
      await page.getByTestId('auth-password-input').fill(`wrong_attempt_${i}`);
      await page.getByTestId('auth-submit-btn').click();
      await page.waitForTimeout(500);
    }

    await expect(page.getByTestId('auth-error-alert')).toContainText('Tài khoản bị tạm khóa', { timeout: 10000 });

    // Lần 6: Bấm đăng nhập lại kể cả khi nhập bất kỳ mật khẩu nào
    await page.getByTestId('auth-password-input').fill('even_if_correct_or_wrong');
    await page.getByTestId('auth-submit-btn').click();

    // Hệ thống chặn ngay lập tức với thông báo khóa
    await expect(page.getByTestId('auth-error-alert')).toContainText('Tài khoản bị tạm khóa do nhập sai mật khẩu quá 5 lần. Vui lòng thử lại sau 15 phút.');
  });

  // ===================================================================
  // TEST CASE 3: Đăng nhập thành công trước khi bị khóa sẽ reset bộ đếm thử sai
  // ===================================================================
  test('TC03: Đăng nhập thành công với mật khẩu đúng trước ngưỡng khóa sẽ reset bộ đếm về ban đầu', async ({ page }) => {
    const randomEmail = `user_reset_${Date.now()}@gmail.com`;
    const correctPassword = 'Password123!';

    // 1. Tạo tài khoản người dùng thực tế
    await page.getByRole('button', { name: 'Tạo tài khoản mới' }).click();
    await page.getByTestId('role-caregiver-btn').click();
    await page.getByTestId('auth-fullname-input').fill('Người Dùng Test Rate');
    await page.getByTestId('auth-identifier-input').fill(randomEmail);
    await page.getByTestId('auth-password-input').fill(correctPassword);
    await page.getByTestId('auth-submit-btn').click();

    // Chờ vào được Dashboard
    await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    // 2. Đăng xuất ra màn hình Auth
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await expect(page.getByTestId('auth-submit-btn')).toBeVisible({ timeout: 10000 });

    // 3. Cố tình nhập sai 2 lần
    await page.getByTestId('auth-identifier-input').fill(randomEmail);
    await page.getByTestId('auth-password-input').fill('wrong_pw_1');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-error-alert')).toContainText('Còn 4 lần thử', { timeout: 10000 });

    await page.getByTestId('auth-password-input').fill('wrong_pw_2');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-error-alert')).toContainText('Còn 3 lần thử', { timeout: 10000 });

    // 4. Nhập đúng mật khẩu -> Đăng nhập thành công
    await page.getByTestId('auth-password-input').fill(correctPassword);
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    // 5. Đăng xuất lần nữa và kiểm tra xem bộ đếm đã được reset chưa
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await expect(page.getByTestId('auth-submit-btn')).toBeVisible({ timeout: 10000 });

    // Thử sai 1 lần: Nếu đã reset, thông báo phải hiển thị "Còn 4 lần thử" thay vì "Còn 2 lần thử"
    await page.getByTestId('auth-identifier-input').fill(randomEmail);
    await page.getByTestId('auth-password-input').fill('wrong_after_reset');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-error-alert')).toContainText('Còn 4 lần thử', { timeout: 10000 });
  });

  // ===================================================================
  // TEST CASE 4: Rate Limiting được cô lập độc lập theo từng tài khoản
  // ===================================================================
  test('TC04: Tài khoản A bị khóa không làm ảnh hưởng đến lượt đăng nhập của Tài khoản B', async ({ page }) => {
    const accountA = `victim_a_${Date.now()}@safecheck.local`;
    const accountB = `victim_b_${Date.now()}@safecheck.local`;

    // Khóa tài khoản A bằng 5 lần thử sai
    await page.getByTestId('auth-identifier-input').fill(accountA);
    for (let i = 1; i <= 5; i++) {
      await page.getByTestId('auth-password-input').fill(`wrong_${i}`);
      await page.getByTestId('auth-submit-btn').click();
      await page.waitForTimeout(400);
    }
    await expect(page.getByTestId('auth-error-alert')).toContainText('Tài khoản bị tạm khóa', { timeout: 10000 });

    // Chuyển sang thử Tài khoản B: Phải còn nguyên 4 lần thử sau lần sai đầu tiên
    await page.getByTestId('auth-identifier-input').fill(accountB);
    await page.getByTestId('auth-password-input').fill('wrong_b');
    await page.getByTestId('auth-submit-btn').click();
    await expect(page.getByTestId('auth-error-alert')).toContainText('Còn 4 lần thử', { timeout: 10000 });
  });

});
