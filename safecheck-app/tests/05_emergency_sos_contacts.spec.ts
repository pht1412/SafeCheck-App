import { test, expect } from '@playwright/test';

test.describe('Module 05: Nghiệp vụ Báo động SOS & Danh bạ Cứu hộ (Emergency SOS & Contacts)', () => {
  // Chạy tuần tự để tránh xung đột tài nguyên danh bạ và trạng thái SOS của cùng tài khoản test
  test.describe.configure({ mode: 'serial' });

  test('TC01: Màn hình Cụ có nút SOS và cơ chế đếm ngược 10s', async ({ page }) => {
    // 1. Đăng nhập tài khoản Cụ
    await page.goto('/');
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('0123456789');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('123456');
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();

    // 2. Chờ màn hình Cụ hiển thị
    await expect(page.getByTestId('elderly-device')).toBeVisible({ timeout: 10000 });

    // Tắt báo động nếu còn sót
    const activeResolveBtn = page.getByTestId('resolve-alarm-elderly-button');
    if (await activeResolveBtn.isVisible()) {
      await activeResolveBtn.click();
      await page.waitForTimeout(500);
    }

    // 3. Đè giữ SOS 3 giây kích hoạt đếm ngược 10s
    const sosBtn = page.getByTestId('sos-button');
    await expect(sosBtn).toBeVisible({ timeout: 10000 });
    await sosBtn.hover();
    await page.mouse.down();
    await page.waitForTimeout(3500);
    await page.mouse.up();

    // 4. Modal đếm ngược 10s xuất hiện
    const countdownModal = page.getByTestId('sos-countdown-modal');
    await expect(countdownModal).toBeVisible({ timeout: 5000 });

    // 5. Kiểm tra nút HỦY BÁO ĐỘNG
    const cancelBtn = page.getByTestId('cancel-sos-button');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();
    await expect(countdownModal).not.toBeVisible();
  });

  test('TC02: Màn hình Con cháu hiển thị nút mở danh bạ cứu hộ khẩn cấp khi có Emergency', async ({ page }) => {
    // 1. Đăng nhập Con cháu
    await page.goto('/');
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test01@gmail.com');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('test01@gmail.com');
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();

    // 2. Chờ Dashboard hiển thị
    await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    // 3. Chuyển sang trạng thái Emergency bằng Dev Tool của tester
    const setSosBtn = page.getByRole('button', { name: 'Set SOS' });
    await expect(setSosBtn).toBeVisible();
    await setSosBtn.click();

    // 4. Banner Báo động đỏ xuất hiện
    const emergencyAlert = page.getByTestId('caregiver-emergency-alert');
    await expect(emergencyAlert).toBeVisible();

    // 5. Nút MỞ DANH BẠ CỨU HỘ KHẨN CẤP xuất hiện
    const openDirectoryBtn = page.getByTestId('open-emergency-directory-btn');
    await expect(openDirectoryBtn).toBeVisible();
    await expect(openDirectoryBtn).toHaveText(/MỞ DANH BẠ CỨU HỘ KHẨN CẤP/i);

    // 6. Click mở Modal
    await openDirectoryBtn.click();

    // 7. Modal xuất hiện kèm nút gọi 115 hệ thống
    const contactsModal = page.getByTestId('emergency-contacts-modal');
    await expect(contactsModal).toBeVisible();

    const call115Action = page.getByTestId('call-115-action');
    await expect(call115Action).toBeVisible();
    await expect(call115Action).toHaveAttribute('href', 'tel:115');

    // 8. Đóng modal
    await page.getByRole('button', { name: 'Đóng bảng danh bạ' }).click();
    await expect(contactsModal).not.toBeVisible();

    // Đưa về an toàn
    const resolveBtn = page.getByTestId('resolve-alarm-button');
    if (await resolveBtn.isVisible()) {
      await resolveBtn.click();
    }
  });

  test('TC03: Giao diện Cài đặt Danh bạ Cứu hộ hiển thị nút Thêm liên hệ cứu hộ', async ({ page }) => {
    // 1. Đăng nhập Con cháu
    await page.goto('/');
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test01@gmail.com');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('test01@gmail.com');
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();

    // 2. Chờ Dashboard hiển thị
    await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    // 3. Nút toggle Cài đặt Danh bạ Cứu hộ hiển thị
    const toggleSettingsBtn = page.getByTestId('toggle-contacts-settings-btn');
    await expect(toggleSettingsBtn).toBeVisible();
    await toggleSettingsBtn.click();

    // 4. Nút "+ THÊM LIÊN HỆ CỨU HỘ" xuất hiện
    const addContactBtn = page.getByTestId('add-emergency-contact-btn');
    await expect(addContactBtn).toBeVisible();
  });

  // ===================================================================
  // TEST CASE 4: End-to-End CRUD Danh bạ Cứu hộ (CREATE -> UPDATE -> DELETE)
  // ===================================================================
  test('TC04: End-to-End CRUD Danh bạ Cứu hộ (CREATE -> UPDATE -> DELETE)', async ({ page }) => {
    // 1. Đăng nhập Con cháu test01
    await page.goto('/');
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test01@gmail.com');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('test01@gmail.com');
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    // 2. Mở Cài đặt Danh bạ Cứu hộ
    await page.getByTestId('toggle-contacts-settings-btn').click();
    await expect(page.getByTestId('add-emergency-contact-btn')).toBeVisible();

    // Đăng ký tự động chấp thuận dialog xác nhận xóa (Comment 1.4)
    page.on('dialog', (dialog) => dialog.accept());

    // Dọn dẹp sơ bộ nếu danh sách đang đầy 5/5
    const existingCount = await page.locator('div[data-testid^="contact-item-"]').count();
    if (existingCount >= 5) {
      const firstDelete = page.locator('button[data-testid^="delete-contact-"]').first();
      await firstDelete.click();
      await page.waitForTimeout(500);
    }

    // Dọn dẹp nếu có contact test cũ sót lại
    const oldTestItem = page.locator('div[data-testid^="contact-item-"]').filter({ hasText: 'E2E_Test_Bac_Tu' });
    if (await oldTestItem.count() > 0) {
      await oldTestItem.first().locator('button[data-testid^="delete-contact-"]').click();
      await page.waitForTimeout(500);
    }

    // BƯỚC 1: CREATE (Comment 1.2)
    await page.getByTestId('add-emergency-contact-btn').click();
    await page.getByTestId('contact-name-input').fill('E2E_Test_Bac_Tu');
    await page.getByTestId('contact-phone-input').fill('0912345678');
    await page.getByTestId('contact-type-select').selectOption('neighbor');
    await page.getByTestId('contact-note-input').fill('Có chìa khóa dự phòng');
    await page.getByTestId('save-contact-btn').click();

    // Kiểm chứng sau khi CREATE: Form tự đóng, contact xuất hiện đầy đủ thông tin
    await expect(page.getByTestId('contact-name-input')).not.toBeVisible();
    const createdItem = page.locator('div[data-testid^="contact-item-"]').filter({ hasText: 'E2E_Test_Bac_Tu' });
    await expect(createdItem).toBeVisible();
    await expect(createdItem).toContainText('0912345678');
    await expect(createdItem).toContainText('Hàng xóm');
    await expect(createdItem).toContainText('Có chìa khóa dự phòng');

    // BƯỚC 2: UPDATE (Comment 1.3 - Dùng đúng record vừa tạo)
    const editBtn = createdItem.locator('button[data-testid^="edit-contact-"]');
    await editBtn.click();
    await expect(page.getByTestId('contact-note-input')).toBeVisible();
    await page.getByTestId('contact-note-input').fill('Có mặt sau 2 phút');
    await page.getByTestId('save-contact-btn').click();

    // Kiểm chứng sau khi UPDATE: Hiển thị note mới, không tạo thêm record trùng lặp
    await expect(createdItem).toContainText('Có mặt sau 2 phút');
    expect(await page.locator('div[data-testid^="contact-item-"]').filter({ hasText: 'E2E_Test_Bac_Tu' }).count()).toBe(1);

    // BƯỚC 3: DELETE (Comment 1.4 & 1.5)
    const deleteBtn = createdItem.locator('button[data-testid^="delete-contact-"]');
    await deleteBtn.click();

    // Kiểm chứng sau khi DELETE: Contact biến mất hoàn toàn
    await expect(page.locator('div[data-testid^="contact-item-"]').filter({ hasText: 'E2E_Test_Bac_Tu' })).not.toBeVisible();
  });

  // ===================================================================
  // TEST CASE 5: Giới hạn tối đa 5 liên hệ cứu hộ (Frontend Guard & Database Guard)
  // ===================================================================
  test('TC05: Giới hạn tối đa 5 liên hệ cứu hộ (Frontend Guard & Database Guard)', async ({ page }) => {
    // 1. Đăng nhập Con cháu test01
    await page.goto('/');
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test01@gmail.com');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('test01@gmail.com');
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    // 2. Mở Cài đặt Danh bạ
    await page.getByTestId('toggle-contacts-settings-btn').click();
    page.on('dialog', (dialog) => dialog.accept());

    const countBadge = page.getByTestId('contacts-count-badge');
    await expect(countBadge).toBeVisible();

    // Đảm bảo đủ 5 liên hệ bằng cách thêm các slot test tạm nếu chưa đủ (Comment 2.3)
    let currentCount = await page.locator('div[data-testid^="contact-item-"]').count();
    const createdTempNames: string[] = [];

    while (currentCount < 5) {
      const tempName = `Test_Slot_${Date.now().toString().slice(-4)}_${currentCount + 1}`;
      createdTempNames.push(tempName);
      await page.getByTestId('add-emergency-contact-btn').click();
      await page.getByTestId('contact-name-input').fill(tempName);
      await page.getByTestId('contact-phone-input').fill(`090000000${currentCount + 1}`);
      await page.getByTestId('save-contact-btn').click();
      await page.waitForTimeout(500);
      currentCount = await page.locator('div[data-testid^="contact-item-"]').count();
    }

    // A. KIỂM THỬ FRONTEND GUARD (Comment 2.1 & 2.4):
    // Badge hiển thị 5/5
    await expect(countBadge).toContainText('5/5');
    // Nút Thêm bị disabled kèm chữ (Đã đủ 5)
    const addBtn = page.getByTestId('add-emergency-contact-btn');
    await expect(addBtn).toBeDisabled();
    await expect(addBtn).toContainText('(Đã đủ 5)');

    // B. KIỂM THỬ DATABASE GUARD (Comment 2.2):
    // Cố tình gửi lệnh INSERT liên hệ thứ 6 trực tiếp xuống CSDL (Bypass UI hoàn toàn)
    const dbResult = await page.evaluate(async () => {
      const helper = (window as any).__safecheck;
      if (!helper || !helper.elderlyId) return { error: { message: 'Không tìm thấy elderlyId' } };
      return await helper.emergencyContactsService.createContact({
        elderly_id: helper.elderlyId,
        name: 'Illegal_Contact_6',
        phone: '0999999999',
        contact_type: 'neighbor',
        note: 'Bypass test',
      });
    });

    // CSDL kích hoạt trigger tr_check_emergency_contacts_limit và từ chối
    expect(dbResult.error).not.toBeNull();
    expect(dbResult.error.message).toMatch(/tối đa 5 liên hệ/i);

    // Dọn dẹp các slot tạm vừa tạo để không để lại rác (Comment 1.5)
    for (const tempName of createdTempNames) {
      const tempItem = page.locator('div[data-testid^="contact-item-"]').filter({ hasText: tempName });
      if (await tempItem.count() > 0) {
        await tempItem.first().locator('button[data-testid^="delete-contact-"]').click();
        await page.waitForTimeout(400);
      }
    }
  });

  // ===================================================================
  // TEST CASE 6: Cụ đã có con cháu kết nối kích hoạt SOS vẫn luôn có nút gọi 115
  // ===================================================================
  test('TC06: Cụ đã có con cháu kết nối kích hoạt SOS vẫn luôn có nút gọi 115', async ({ page }) => {
    // 1. Đăng nhập Cụ mẫu (0123456789 - đã có con cháu test01 liên kết)
    await page.goto('/');
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('0123456789');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('123456');
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(page.getByTestId('elderly-device')).toBeVisible({ timeout: 10000 });

    // Đảm bảo reset trạng thái nếu máy đang bị Emergency từ test trước
    const activeResolveBtn = page.getByTestId('resolve-alarm-elderly-button');
    if (await activeResolveBtn.isVisible()) {
      await activeResolveBtn.click();
      await page.waitForTimeout(500);
    }

    // 2. Xác thực điều kiện tiên quyết: Cụ đã có con cháu kết nối (Comment 6.3)
    await expect(page.getByText('Đã kết nối người thân')).toBeVisible();

    // 3. Đè giữ nút SOS 3 giây (Comment 7.1 & 7.2)
    const sosBtn = page.getByTestId('sos-button');
    await sosBtn.hover();
    await page.mouse.down();
    await page.waitForTimeout(3200);
    await page.mouse.up();

    // 4. Modal đếm ngược xuất hiện, chờ đếm xong 10s chuyển sang Emergency
    await expect(page.getByTestId('sos-countdown-modal')).toBeVisible();
    await expect(page.getByTestId('elderly-emergency-view')).toBeVisible({ timeout: 15000 });

    // 5. Kiểm chứng đồng thời (Comment 6.2 & 6.3):
    // - Thông báo đã phát còi và báo động khẩn cấp tới con cháu
    await expect(page.getByText(/báo động khẩn cấp tới con cháu/i)).toBeVisible();

    // - Nút Gọi 115 hiển thị và có href="tel:115"
    const call115Btn = page.getByTestId('elderly-call-115-btn');
    await expect(call115Btn).toBeVisible();
    await expect(call115Btn).toHaveAttribute('href', 'tel:115');

    // 6. Cụ chủ động tắt còi để dọn dẹp trạng thái an toàn
    const resolveBtn = page.getByTestId('resolve-alarm-elderly-button');
    await resolveBtn.click();
    await expect(page.getByTestId('status-safe-card')).toBeVisible({ timeout: 10000 });
  });
});
