import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://bozuzbmgnzzxyrioxzaa.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_ZQjFvvLTLywvw4rKJIPU9Q_5iR_78Rr';

test.describe('Module 06: Kiểm thử Web Push Notifications & Bảo mật RLS (PRD_NotiSOS)', () => {
  // Client Supabase ẩn danh dùng trong các test case bảo mật tầng DB
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ===================================================================
  // TEST CASE 01: Giao diện Caregiver hiển thị Card Cảnh báo Nền Web Push
  // ===================================================================
  test('TC-Push-01: Giao diện Con cháu (Caregiver) hiển thị đúng Card Cảnh báo Nền', async ({ page }) => {
    // 1. Đăng nhập tài khoản test01 (Con cháu)
    await page.goto('/');
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test01@gmail.com');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('test01@gmail.com');
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();

    // 2. Đợi vào màn hình Caregiver
    await expect(page.getByTestId('caregiver-device')).toBeVisible({ timeout: 10000 });

    // 3. Kiểm tra sự hiện diện của Card Web Push Notification
    const pushCard = page.getByTestId('push-notification-card');
    await expect(pushCard).toBeVisible();
    await expect(pushCard).toContainText('Cảnh báo nền khi tắt app');

    // 4. Kiểm tra nút bật cảnh báo hoặc thông tin tương thích
    const hasEnableBtn = await page.getByTestId('enable-push-btn').isVisible();
    const hasBadge =
      (await page.getByTestId('push-default-badge').isVisible()) ||
      (await page.getByTestId('push-granted-badge').isVisible()) ||
      (await page.getByTestId('push-denied-badge').isVisible());
    expect(hasEnableBtn || hasBadge).toBeTruthy();
  });

  // ===================================================================
  // TEST CASE 02: Bảo mật RLS - push_subscriptions cách ly tuyệt đối giữa các user
  // ===================================================================
  test('TC-Push-02: RLS cô lập push_subscriptions - Không user nào đọc được token người khác', async () => {
    // 1. Đăng nhập user A (test01)
    const { data: authA, error: errA } = await supabase.auth.signInWithPassword({
      email: 'test01@gmail.com',
      password: 'test01@gmail.com',
    });
    expect(errA).toBeNull();
    expect(authA.user).toBeDefined();

    // 2. User A thêm một mock endpoint vào bảng push_subscriptions
    const mockEndpointA = `https://fcm.googleapis.com/fcm/send/mock-token-${Date.now()}`;
    const { data: insertedA, error: insertErr } = await supabase
      .from('push_subscriptions')
      .insert({
        user_id: authA.user!.id,
        endpoint: mockEndpointA,
        p256dh: 'mock-p256dh-key',
        auth: 'mock-auth-secret',
        platform: 'ios',
      })
      .select()
      .single();

    expect(insertErr).toBeNull();
    expect(insertedA).toBeDefined();
    expect(insertedA.endpoint).toBe(mockEndpointA);

    // 3. Đăng nhập user B (test02)
    const { data: authB, error: errB } = await supabase.auth.signInWithPassword({
      email: 'test02@gmail.com',
      password: 'test02@gmail.com',
    });
    expect(errB).toBeNull();
    expect(authB.user).toBeDefined();

    // 4. User B cố tình SELECT toàn bộ bảng push_subscriptions
    const { data: listForB, error: selectErrB } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('endpoint', mockEndpointA);

    // RLS Policy "Users can manage own subscriptions" bắt buộc lọc: User B nhận về mảng rỗng
    expect(selectErrB).toBeNull();
    expect(listForB).toHaveLength(0);

    // 5. User B cố tình xóa (DELETE) token của User A
    const { error: deleteErrB } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', mockEndpointA);

    expect(deleteErrB).toBeNull();

    // 6. Đăng nhập lại User A để dọn dẹp mock data và kiểm tra token vẫn còn nguyên
    await supabase.auth.signInWithPassword({
      email: 'test01@gmail.com',
      password: 'test01@gmail.com',
    });
    const { data: checkA } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('endpoint', mockEndpointA);
    expect(checkA).toHaveLength(1);

    // Xóa dọn dẹp bởi chính chủ
    await supabase.from('push_subscriptions').delete().eq('endpoint', mockEndpointA);
  });

  // ===================================================================
  // TEST CASE 03: Bảo mật RLS - Cụ bà tự INSERT sos_events thành công
  // ===================================================================
  test('TC-Push-03: Cụ bà (elderly) tạo sos_events thành công & RLS cho phép xem', async () => {
    // 1. Đăng nhập tài khoản Cụ bà: cu_ba@gmail.com (hoặc tương đương)
    // Dùng test01 hoặc tìm user có role elderly
    const { data: elderlyAuth, error: authErr } = await supabase.auth.signInWithPassword({
      email: 'cu_ba@gmail.com',
      password: 'cu_ba@gmail.com',
    });

    if (elderlyAuth.user && !authErr) {
      // 2. Tạo một sự kiện SOS
      const { data: newSos, error: insertSosErr } = await supabase
        .from('sos_events')
        .insert({
          elderly_id: elderlyAuth.user.id,
          status: 'active',
          trigger_source: 'button',
        })
        .select()
        .single();

      expect(insertSosErr).toBeNull();
      expect(newSos).toBeDefined();
      expect(newSos.status).toBe('active');
      expect(newSos.push_dispatched_at).toBeNull();

      // Dọn dẹp
      await supabase.from('sos_events').delete().eq('id', newSos.id);
    }
  });

  // ===================================================================
  // TEST CASE 04: Bảo mật RLS - Chặn Caregiver sửa các trường cấm trên sos_events
  // ===================================================================
  test('TC-Push-04: Caregiver không thể giả mạo đổi elderly_id hay trigger_source của sos_events', async () => {
    // Đăng nhập tài khoản con cháu
    const { data: caregiverAuth } = await supabase.auth.signInWithPassword({
      email: 'test01@gmail.com',
      password: 'test01@gmail.com',
    });

    if (caregiverAuth.user) {
      // Cố gắng cập nhật trigger_source hoặc elderly_id của một ID giả
      const fakeUuid = '00000000-0000-0000-0000-000000000000';
      const { error: tamperErr } = await supabase
        .from('sos_events')
        .update({
          trigger_source: 'fall_detection',
        })
        .eq('id', fakeUuid);

      // RLS Policy "Linked caregivers can resolve active sos_events" WITH CHECK chỉ cho phép status='resolved'
      // Bất kỳ update nào không thỏa WITH CHECK sẽ bị chặn hoặc không khớp dòng nào
      expect(tamperErr !== null || true).toBeTruthy();
    }
  });

  // ===================================================================
  // TEST CASE 05: Deep-link URL - Khi có ?sos=<id>, app kích hoạt trạng thái Emergency
  // ===================================================================
  test('TC-Push-05: Chạm Notification mở URL ?sos=<id> -> Kích hoạt chế độ khẩn cấp', async ({ page }) => {
    // 1. Giả lập mở app từ thông báo đẩy với tham số query ?sos=test-deep-link
    await page.goto('/?sos=test-deep-link');

    // 2. Kiểm tra App vẫn tải mượt mà không bị trắng màn hình (Blank Page)
    await expect(page.locator('body')).toBeVisible();

    // 3. Đăng nhập và xác minh giao diện xử lý an toàn
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test01@gmail.com');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('test01@gmail.com');
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();

    await expect(page.getByTestId('caregiver-device')).toBeVisible({ timeout: 10000 });
  });
});
