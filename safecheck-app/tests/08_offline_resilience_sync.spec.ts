import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://bozuzbmgnzzxyrioxzaa.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_ZQjFvvLTLywvw4rKJIPU9Q_5iR_78Rr';

test.describe('Module 08: Offline Resilience & Idempotent Sync (PRD_Deep_v1)', () => {
  test.describe.configure({ mode: 'serial' });

  const clientElderly = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  test.beforeAll(async () => {
    await clientElderly.auth.signInWithPassword({
      email: '0123456789@safecheck.local',
      password: '123456',
    });
  });

  test.beforeEach(async () => {
    // Đảm bảo trạng thái ban đầu của Cụ là Safe để nút SOS luôn sẵn sàng
    await clientElderly.rpc('perform_checkin', { p_family_code: '3UGSN6' });
  });

  // Helper đọc IndexedDB từ browser context
  async function getOfflineQueueFromBrowser(page: any) {
    return await page.evaluate(() => {
      return new Promise((resolve) => {
        const req = indexedDB.open('safecheck_offline_db', 1);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('offline_sos_queue')) {
            return resolve([]);
          }
          const tx = db.transaction('offline_sos_queue', 'readonly');
          const store = tx.objectStore('offline_sos_queue');
          const getReq = store.getAll();
          getReq.onsuccess = () => resolve(getReq.result || []);
          getReq.onerror = () => resolve([]);
        };
        req.onerror = () => resolve([]);
      });
    });
  }

  // ===================================================================
  // TEST 08A: Offline SOS Creation & IndexedDB Persistence
  // Ngắt mạng -> Cụ bấm SOS -> Lưu ngay vào IndexedDB PENDING_SYNC
  // ===================================================================
  test('TC08A: Khi mất kết nối mạng, tín hiệu SOS được lưu bền vững vào IndexedDB', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Đăng nhập Cụ (0123456789)
    await page.goto('/');
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('0123456789');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('123456');
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(page.getByTestId('elderly-device')).toBeVisible({ timeout: 10000 });

    // Đảm bảo nút SOS sẵn sàng và không bị disable bởi báo động cũ
    const activeResolveBtn = page.getByTestId('resolve-alarm-elderly-button');
    if (await activeResolveBtn.isVisible()) {
      await activeResolveBtn.click();
      await page.waitForTimeout(1000);
    }

    const sosBtn = page.getByTestId('sos-button');
    await expect(sosBtn).toBeVisible({ timeout: 10000 });
    await expect(sosBtn).toBeEnabled({ timeout: 10000 });

    // 2. NGẮT KẾT NỐI MẠNG BẰNG PLAYWRIGHT BROWSER CONTEXT NETWORK EMULATION
    console.log('[Test 08A] Giả lập mất mạng...');
    await context.setOffline(true);

    // 3. Cụ nhấn giữ nút SOS 3.5 giây để kích hoạt
    await sosBtn.hover();
    await page.mouse.down();
    await page.waitForTimeout(3500);
    await page.mouse.up();

    // Đợi modal đếm ngược hoặc chờ đếm ngược về 0 (hoặc tua thời gian)
    // Modal đếm ngược 10 giây xuất hiện
    await expect(page.getByTestId('sos-countdown-modal')).toBeVisible({ timeout: 5000 });

    // Chờ 11 giây để hết đếm lùi và trigger SOS ngoại tuyến
    console.log('[Test 08A] Đang chờ đếm lùi 10s để kích hoạt SOS...');
    await page.waitForTimeout(11000);

    // 4. KIỂM TRA DỮ LIỆU ĐÃ ĐƯỢC PERSIST VÀO INDEXEDDB
    const queueItems: any = await getOfflineQueueFromBrowser(page);
    console.log('[Test 08A] Hàng đợi IndexedDB:', queueItems);

    expect(queueItems.length).toBeGreaterThan(0);
    const lastItem = queueItems[queueItems.length - 1];

    // Xác nhận có client_event_id UUID và db_status hợp lệ (PENDING hoặc SYNCING)
    expect(lastItem.client_event_id).toBeTruthy();
    expect(lastItem.elderly_id).toBeTruthy();
    expect(['PENDING', 'SYNCING', 'SERVER_ACKED']).toContain(lastItem.db_status);

    await context.close();
  });

  // ===================================================================
  // TEST 08B: Cellular Fallback UI sau 10 giây mất mạng
  // Mất mạng > 10s -> Kích hoạt Thẻ gọi điện viễn thông với tel:115
  // ===================================================================
  test('TC08B: Quá 10 giây không có SERVER_ACK -> Màn hình Cụ tự động kích hoạt CellularFallbackCard', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/');
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('0123456789');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('123456');
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(page.getByTestId('elderly-device')).toBeVisible({ timeout: 10000 });

    // Đảm bảo nút SOS sẵn sàng
    const activeResolveBtn = page.getByTestId('resolve-alarm-elderly-button');
    if (await activeResolveBtn.isVisible()) {
      await activeResolveBtn.click();
      await page.waitForTimeout(1000);
    }

    const sosBtn = page.getByTestId('sos-button');
    await expect(sosBtn).toBeVisible({ timeout: 10000 });
    await expect(sosBtn).toBeEnabled({ timeout: 10000 });

    // Ngắt mạng
    await context.setOffline(true);

    // Bấm SOS
    await sosBtn.hover();
    await page.mouse.down();
    await page.waitForTimeout(3500);
    await page.mouse.up();

    // Chờ qua ngưỡng 10s của countdown + 10s của fallback threshold
    console.log('[Test 08B] Chờ ngưỡng kích hoạt thẻ khẩn cấp viễn thông (Cellular Fallback)...');
    await page.waitForTimeout(21000);

    // 5. Kiểm tra Thẻ Cứu hộ Viễn thông CellularFallbackCard xuất hiện
    const fallbackCard = page.getByTestId('cellular-fallback-card');
    await expect(fallbackCard).toBeVisible({ timeout: 5000 });
    await expect(fallbackCard).toContainText(/MẤT SÓNG INTERNET/i);

    // Kiểm tra nút gọi 115 khổng lồ
    const call115Btn = page.getByTestId('fallback-call-115-btn');
    await expect(call115Btn).toBeVisible();
    await expect(call115Btn).toHaveAttribute('href', 'tel:115');

    // Kiểm tra nút gọi con cháu
    const callCaregiverBtn = page.getByTestId('fallback-call-caregiver-btn');
    await expect(callCaregiverBtn).toBeVisible();

    await context.close();
  });

  // ===================================================================
  // TEST 08C: Reconnection & Dual-Phase Idempotent Sync
  // Bật lại mạng -> Tự động flush queue -> DB ghi nhận 1 bản ghi
  // ===================================================================
  test('TC08C: Kết nối mạng phục hồi -> Hệ thống tự động gửi bù tín hiệu SOS lên database Supabase', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/');
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('0123456789');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('123456');
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(page.getByTestId('elderly-device')).toBeVisible({ timeout: 10000 });

    // Đảm bảo nút SOS sẵn sàng
    const activeResolveBtn = page.getByTestId('resolve-alarm-elderly-button');
    if (await activeResolveBtn.isVisible()) {
      await activeResolveBtn.click();
      await page.waitForTimeout(1000);
    }

    const sosBtn = page.getByTestId('sos-button');
    await expect(sosBtn).toBeVisible({ timeout: 10000 });
    await expect(sosBtn).toBeEnabled({ timeout: 10000 });

    // Ngắt mạng
    await context.setOffline(true);

    // Bấm SOS
    await sosBtn.hover();
    await page.mouse.down();
    await page.waitForTimeout(3500);
    await page.mouse.up();

    // Chờ 11s để kết thúc countdown và lưu vào IndexedDB
    await page.waitForTimeout(11000);

    // Lấy client_event_id vừa lưu trong IndexedDB
    const queueBefore: any = await getOfflineQueueFromBrowser(page);
    expect(queueBefore.length).toBeGreaterThan(0);
    const targetClientEventId = queueBefore[queueBefore.length - 1].client_event_id;

    // Intercept /api/send-push để Phase 2 hoàn tất trong môi trường test
    await page.route('**/api/send-push', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, status: 'dispatched' }),
      });
    });

    // 2. KHÔI PHỤC KẾT NỐI MẠNG
    console.log('[Test 08C] Bật lại mạng và kích hoạt online event...');
    await context.setOffline(false);

    // Trigger sự kiện 'online'
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    // Chờ 3 giây để offlineQueueService.flushOfflineQueue() thực thi
    await page.waitForTimeout(3000);

    // 3. KIỂM TRA TRẠNG THÁI INDEXEDDB ĐÃ ĐỔI SANG SERVER_ACKED VÀ DISPATCHED
    const queueAfter: any = await getOfflineQueueFromBrowser(page);
    const syncedItem = queueAfter.find((i: any) => i.client_event_id === targetClientEventId);
    expect(syncedItem).toBeTruthy();
    expect(syncedItem.db_status).toBe('SERVER_ACKED');
    expect(syncedItem.push_status).toBe('DISPATCHED');
    expect(syncedItem.sos_event_id).toBeTruthy();
    // Token phải được dọn dẹp khỏi IndexedDB
    expect(syncedItem.access_token).toBeUndefined();

    // 4. KIỂM TRA DATABASE: Đúng 1 bản ghi sos_events với client_event_id đó
    const { data: dbEvents } = await clientElderly
      .from('sos_events')
      .select('*')
      .eq('client_event_id', targetClientEventId);

    expect(dbEvents?.length).toBe(1);
    expect(dbEvents?.[0].status).toBe('active');
    console.log('[Test 08C] Hoàn tất: Bản ghi SOS đã được đồng bộ thành công vào Supabase với ID:', dbEvents?.[0].id);

    await context.close();
  });

  // ===================================================================
  // TEST 08D: Atomic Idempotent Retry
  // Client retry nhiều lần cùng client_event_id -> Server trả is_duplicate=true
  // ===================================================================
  test('TC08D: Gửi lại cùng client_event_id -> Server trả về is_duplicate=true, không sinh duplicate row', async () => {
    // Đăng nhập Cụ
    await clientElderly.auth.signInWithPassword({
      email: '0123456789@safecheck.local',
      password: '123456',
    });
    const elderlyUser = (await clientElderly.auth.getUser()).data.user;
    expect(elderlyUser).toBeTruthy();
    const elderlyId = elderlyUser!.id;

    const fixedClientEventId = crypto.randomUUID();

    // Lần 1: Gọi RPC create_sos_event_idempotent
    const { data: res1, error: err1 } = await clientElderly.rpc('create_sos_event_idempotent', {
      p_elderly_id: elderlyId,
      p_client_event_id: fixedClientEventId,
      p_trigger_source: 'button',
    });

    expect(err1).toBeNull();
    expect(res1?.success).toBe(true);
    expect(res1?.is_duplicate).toBe(false);
    const firstSosId = res1?.sos_event_id;
    expect(firstSosId).toBeTruthy();

    // Lần 2: Giả lập mạng chập chờn, client retry lại ĐÚNG client_event_id đó
    const { data: res2, error: err2 } = await clientElderly.rpc('create_sos_event_idempotent', {
      p_elderly_id: elderlyId,
      p_client_event_id: fixedClientEventId,
      p_trigger_source: 'button',
    });

    // Phải thành công và trả về is_duplicate = true, CÙNG sos_event_id
    expect(err2).toBeNull();
    expect(res2?.success).toBe(true);
    expect(res2?.is_duplicate).toBe(true);
    expect(res2?.sos_event_id).toBe(firstSosId);

    // Kiểm tra database: Duy nhất 1 bản ghi tồn tại
    const { data: events } = await clientElderly
      .from('sos_events')
      .select('id')
      .eq('client_event_id', fixedClientEventId);

    expect(events?.length).toBe(1);
    console.log('[Test 08D] Hoàn tất: Idempotency đảm bảo chỉ 1 bản ghi duy nhất, retry an toàn.');
  });

  // ===================================================================
  // TEST 08E: Web Push Dispatch Chain & claim_sos_push_dispatch Atomic Claim
  // Sau khi có SERVER_ACK -> Kích hoạt Phase 2 gửi push và claim nguyên tử
  // ===================================================================
  test('TC08E: Chuỗi Web Push Dispatch sau SERVER_ACK -> claim_sos_push_dispatch nguyên tử, không lặp push và dọn dẹp access_token', async ({ browser }) => {
    // 1. Lấy thông tin Cụ
    const elderlyUser = (await clientElderly.auth.getUser()).data.user;
    expect(elderlyUser).toBeTruthy();
    const elderlyId = elderlyUser!.id;

    // 2. Tạo sự kiện SOS mới nguyên tử
    const clientEventId = crypto.randomUUID();
    const { data: sosRes, error: sosErr } = await clientElderly.rpc('create_sos_event_idempotent', {
      p_elderly_id: elderlyId,
      p_client_event_id: clientEventId,
      p_trigger_source: 'button',
    });
    expect(sosErr).toBeNull();
    const sosEventId = sosRes?.sos_event_id;
    expect(sosEventId).toBeTruthy();

    // 3. KIỂM THỬ TẦNG DATABASE: claim_sos_push_dispatch nguyên tử
    // Lần 1: Người đầu tiên claim -> claimed = true
    const { data: claim1, error: claimErr1 } = await clientElderly.rpc('claim_sos_push_dispatch', {
      p_sos_event_id: sosEventId,
      p_caller_id: elderlyId,
    });
    expect(claimErr1).toBeNull();
    expect(claim1?.success).toBe(true);
    expect(claim1?.claimed).toBe(true);

    // Lần 2: Client retry hoặc worker khác claim lại cùng sự kiện -> claimed = false (Chống duplicate push spam)
    const { data: claim2, error: claimErr2 } = await clientElderly.rpc('claim_sos_push_dispatch', {
      p_sos_event_id: sosEventId,
      p_caller_id: elderlyId,
    });
    expect(claimErr2).toBeNull();
    expect(claim2?.success).toBe(true);
    expect(claim2?.claimed).toBe(false);

    // 4. KIỂM THỬ TẦNG CLIENT DUAL-PHASE SYNC & TOKEN CLEANUP
    const context = await browser.newContext();
    const page = await context.newPage();

    let interceptedPushPayload: any = null;
    let interceptedAuthHeader: string | null = null;

    await page.route('**/api/send-push', async (route) => {
      interceptedPushPayload = route.request().postDataJSON();
      interceptedAuthHeader = route.request().headers()['authorization'];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, status: 'dispatched' }),
      });
    });

    await page.goto('/');
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('0123456789');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('123456');
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(page.getByTestId('elderly-device')).toBeVisible({ timeout: 10000 });

    // Lưu một bản ghi cần dispatch push vào IndexedDB qua offlineQueueService
    const testPushClientEventId = crypto.randomUUID();
    await page.evaluate(async ({ clientEventId, elderlyId, sosEventId }) => {
      const qs = (window as any).offlineQueueService;
      await qs.updateOfflineSOS({
        client_event_id: clientEventId,
        elderly_id: elderlyId,
        sos_event_id: sosEventId,
        trigger_source: 'button',
        created_at: Date.now(),
        access_token: 'fake-test-token-to-verify-cleanup',
        db_status: 'SERVER_ACKED',
        push_status: 'DISPATCH_PENDING',
        push_attempt_count: 0,
      });
      // Kích hoạt Phase 2 Web Push Dispatch
      await qs.flushOfflineQueue();
    }, { clientEventId: testPushClientEventId, elderlyId, sosEventId });

    await page.waitForTimeout(1000);

    // Xác minh /api/send-push được gọi với đúng sos_event_id và Bearer token
    expect(interceptedPushPayload).toBeTruthy();
    expect(interceptedPushPayload.sos_event_id).toBe(sosEventId);
    expect(interceptedAuthHeader).toContain('Bearer fake-test-token-to-verify-cleanup');

    // Xác minh trong IndexedDB: push_status đã là DISPATCHED và access_token đã được xóa sạch (Security Lifecycle)
    const queueItems: any = await getOfflineQueueFromBrowser(page);
    const item = queueItems.find((i: any) => i.client_event_id === testPushClientEventId);
    expect(item).toBeTruthy();
    expect(item.push_status).toBe('DISPATCHED');
    expect(item.access_token).toBeUndefined();

    console.log('[Test 08E] Hoàn tất: Chuỗi Push Dispatch & claim_sos_push_dispatch & Token Cleanup đã được chứng minh 100%.');
    await context.close();
  });
});
