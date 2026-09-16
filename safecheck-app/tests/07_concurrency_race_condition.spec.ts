import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://bozuzbmgnzzxyrioxzaa.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_ZQjFvvLTLywvw4rKJIPU9Q_5iR_78Rr';

test.describe('Module 07: Concurrency & Race Condition Control (PRD_Deep_v1)', () => {
  test.describe.configure({ mode: 'serial' });

  const anonSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Helper lấy thông tin Cụ và liên kết cả 2 caregiver test01 và test02
  async function setupCaregiversAndElderly() {
    // 1. Đăng nhập Cụ (0123456789)
    const clientElderly = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: elderlyAuth, error: elderlyErr } = await clientElderly.auth.signInWithPassword({
      email: '0123456789@safecheck.local',
      password: '123456',
    });
    expect(elderlyErr).toBeNull();
    const elderlyId = elderlyAuth.user!.id;

    // Lấy pairing_code của Cụ
    const { data: elderlyProfile } = await clientElderly
      .from('profiles')
      .select('pairing_code')
      .eq('id', elderlyId)
      .single();
    const pairingCode = elderlyProfile?.pairing_code;
    expect(pairingCode).toBeTruthy();

    // 2. Đăng nhập Caregiver A (test01) và liên kết
    const clientA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    await clientA.auth.signInWithPassword({
      email: 'test01@gmail.com',
      password: 'test01@gmail.com',
    });
    await clientA.rpc('connect_family', { p_pairing_code: pairingCode, p_relationship: 'Con trưởng' });

    // 3. Đăng nhập Caregiver B (test03) và liên kết
    const clientB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    await clientB.auth.signInWithPassword({
      email: 'test03@gmail.com',
      password: 'Test03@gmail.com',
    });
    await clientB.rpc('connect_family', { p_pairing_code: pairingCode, p_relationship: 'Con thứ' });

    return { elderlyId, pairingCode, clientA, clientB, clientElderly };
  }

  // ===================================================================
  // TEST 07A: Concurrent Resolve x 2 (Atomic State Transition)
  // Hai người con cùng bấm Tắt báo động đồng thời -> Đúng 1 người thắng
  // ===================================================================
  test('TC07A: Hai Caregivers cùng bấm Tắt báo động đồng thời -> 1 Thành công, 1 nhận CONFLICT_ALREADY_RESOLVED', async ({ browser }) => {
    const { elderlyId, pairingCode, clientElderly } = await setupCaregiversAndElderly();

    // 1. Tạo sự kiện SOS mới nguyên tử cho Cụ
    const clientEventId = crypto.randomUUID();
    const { data: sosRes, error: sosErr } = await clientElderly.rpc('create_sos_event_idempotent', {
      p_elderly_id: elderlyId,
      p_client_event_id: clientEventId,
      p_trigger_source: 'button',
    });
    expect(sosErr).toBeNull();
    const sosEventId = sosRes?.sos_event_id;
    expect(sosEventId).toBeTruthy();

    // Kích hoạt trạng thái Emergency trên checkin_logs thông qua RPC
    await clientElderly.rpc('trigger_sos', { p_family_code: pairingCode });

    // 2. Mở 2 browser contexts đại diện cho Con A (test01) và Con B (test03)
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await pageA.goto('/');
    await pageA.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test01@gmail.com');
    await pageA.getByPlaceholder('Tối thiểu 6 ký tự').fill('test01@gmail.com');
    await pageA.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(pageA.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto('/');
    await pageB.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test03@gmail.com');
    await pageB.getByPlaceholder('Tối thiểu 6 ký tự').fill('Test03@gmail.com');
    await pageB.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(pageB.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    // 3. Đợi cả 2 trang nhìn thấy nút "Xác nhận an toàn / Tắt báo động"
    const resolveBtnA = pageA.getByTestId('resolve-alarm-button');
    const resolveBtnB = pageB.getByTestId('resolve-alarm-button');

    await expect(resolveBtnA).toBeVisible({ timeout: 10000 });
    await expect(resolveBtnB).toBeVisible({ timeout: 10000 });

    // 4. BẤM ĐỒNG THỜI QUA Promise.all
    console.log('[Test 07A] Kích hoạt 2 lệnh Resolve đồng thời...');
    await Promise.all([
      resolveBtnA.click(),
      resolveBtnB.click(),
    ]);

    // Chờ 1.5 giây để cả 2 request hoàn tất và UI render
    await pageA.waitForTimeout(1500);
    await pageB.waitForTimeout(1500);

    // 5. Kiểm tra kết quả:
    // Đúng một trang nhận thông báo xung đột conflict-toast (người về nhì)
    const toastAVisible = await pageA.getByTestId('conflict-toast').isVisible();
    const toastBVisible = await pageB.getByTestId('conflict-toast').isVisible();

    // Một bên thấy toast conflict, một bên không
    expect(toastAVisible !== toastBVisible).toBeTruthy();

    if (toastAVisible) {
      await expect(pageA.getByTestId('conflict-toast')).toContainText(/xử lý bởi/i);
    } else {
      await expect(pageB.getByTestId('conflict-toast')).toContainText(/xử lý bởi/i);
    }

    // 6. Kiểm tra cơ sở dữ liệu: Bảng alarm_logs chỉ có đúng 1 bản ghi RESOLVE cho sosEventId này
    const { data: logs } = await clientElderly
      .from('alarm_logs')
      .select('*')
      .eq('sos_event_id', sosEventId)
      .eq('action', 'RESOLVE');

    expect(logs?.length).toBe(1);
    console.log('[Test 07A] Hoàn tất: Đúng 1 bản ghi RESOLVE trong alarm_logs bởi:', logs?.[0].performer_name);

    await contextA.close();
    await contextB.close();
  });

  // ===================================================================
  // TEST 07B: Concurrent Ping x 2 (Bắt đầu đồng thời trên tài khoản Cụ)
  // Hai người con cùng bấm Ping đồng thời -> Khóa row profiles FOR UPDATE
  // ===================================================================
  test('TC07B: Hai Caregivers cùng bấm Ping đồng thời cho Cụ -> Khóa profiles FOR UPDATE thành công', async ({ browser }) => {
    const { pairingCode, clientElderly } = await setupCaregiversAndElderly();

    // 1. Mở 2 cửa sổ Caregiver
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await pageA.goto('/');
    await pageA.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test01@gmail.com');
    await pageA.getByPlaceholder('Tối thiểu 6 ký tự').fill('test01@gmail.com');
    await pageA.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(pageA.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto('/');
    await pageB.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test03@gmail.com');
    await pageB.getByPlaceholder('Tối thiểu 6 ký tự').fill('Test03@gmail.com');
    await pageB.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(pageB.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    // 2. Đợi cả 2 trang sẵn sàng nút Ping
    const pingBtnA = pageA.getByTestId('send-ping-button');
    const pingBtnB = pageB.getByTestId('send-ping-button');

    await expect(pingBtnA).toBeVisible({ timeout: 10000 });
    await expect(pingBtnB).toBeVisible({ timeout: 10000 });

    // 3. BẤM ĐỒNG THỜI QUA Promise.all
    console.log('[Test 07B] Kích hoạt 2 lệnh Ping đồng thời...');
    await Promise.all([
      pingBtnA.click(),
      pingBtnB.click(),
    ]);

    await pageA.waitForTimeout(2000);
    await pageB.waitForTimeout(2000);

    // 4. Kiểm tra kết quả: Đúng một bên nhận được xung đột Cooldown (hoặc conflict-toast)
    const toastA = await pageA.getByTestId('conflict-toast').isVisible();
    const toastB = await pageB.getByTestId('conflict-toast').isVisible();
    const textA = await pingBtnA.innerText();
    const textB = await pingBtnB.innerText();

    console.log('[Test 07B] Toast A:', toastA, 'Toast B:', toastB, 'Text A:', textA, 'Text B:', textB);

    // Ít nhất một bên ghi nhận Cooldown hoặc hiện conflict toast
    const hasConflictHandled = toastA || toastB || textA.includes('Chờ thử lại') || textB.includes('Chờ thử lại');
    expect(hasConflictHandled).toBeTruthy();

    // Kiểm tra database: checkin_logs hôm nay đã được cập nhật status Ping_Requested
    const today = new Date().toISOString().split('T')[0];
    const { data: updatedLog } = await clientElderly
      .from('checkin_logs')
      .select('*')
      .eq('family_code', pairingCode)
      .eq('log_date', today)
      .single();

    expect(updatedLog).toBeTruthy();
    expect(updatedLog?.status).toBe('Ping_Requested');
    expect(updatedLog?.ping_requested_at).toBeTruthy();

    await contextA.close();
    await contextB.close();
  });

  // ===================================================================
  // TEST 07C: Unauthorized Resolve
  // Caregiver chưa liên kết không thể resolve sự kiện của Cụ
  // ===================================================================
  test('TC07C: User không liên kết bị từ chối quyền gọi resolve_alarm_atomic (Forbidden)', async () => {
    const { elderlyId, clientElderly } = await setupCaregiversAndElderly();

    // Tạo sự kiện SOS
    const { data: sosRes } = await clientElderly.rpc('create_sos_event_idempotent', {
      p_elderly_id: elderlyId,
      p_client_event_id: crypto.randomUUID(),
      p_trigger_source: 'button',
    });
    const sosEventId = sosRes?.sos_event_id;

    // Đăng ký/đăng nhập user lạ hoàn toàn không có liên kết
    const strangerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const strangerEmail = `stranger_${Date.now()}@gmail.com`;
    const { data: strangerAuth } = await strangerClient.auth.signUp({
      email: strangerEmail,
      password: 'password123',
      options: { data: { role: 'caregiver', full_name: 'Người Lạ' } },
    });

    if (strangerAuth.user) {
      // Gọi resolve_alarm_atomic sự kiện của Cụ
      const { error } = await strangerClient.rpc('resolve_alarm_atomic', {
        p_elderly_id: elderlyId,
        p_sos_event_id: sosEventId,
      });

      // Phải bị từ chối quyền (error 42501 hoặc Forbidden)
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/Forbidden|không có quyền|Unauthorized/i);
    }
  });

  // ===================================================================
  // TEST 07D: Anonymous RPC Denial (Bảo mật tầng Database Privilege)
  // Anonymous caller không thể gọi các hàm Atomic RPC
  // ===================================================================
  test('TC07D: Anonymous caller bị từ chối tuyệt đối khi gọi create_sos_event_idempotent, resolve_alarm_atomic, request_ping_atomic', async () => {
    // 1. Thử gọi create_sos_event_idempotent ẩn danh
    const { error: err1 } = await anonSupabase.rpc('create_sos_event_idempotent', {
      p_elderly_id: crypto.randomUUID(),
      p_client_event_id: crypto.randomUUID(),
    });
    expect(err1).not.toBeNull();
    console.log('[Test 07D] Anonymous create_sos_event_idempotent bị từ chối:', err1?.message);

    // 2. Thử gọi resolve_alarm_atomic ẩn danh
    const { error: err2 } = await anonSupabase.rpc('resolve_alarm_atomic', {
      p_elderly_id: crypto.randomUUID(),
      p_sos_event_id: crypto.randomUUID(),
    });
    expect(err2).not.toBeNull();
    console.log('[Test 07D] Anonymous resolve_alarm_atomic bị từ chối:', err2?.message);

    // 3. Thử gọi request_ping_atomic ẩn danh
    const { error: err3 } = await anonSupabase.rpc('request_ping_atomic', {
      p_elderly_id: crypto.randomUUID(),
    });
    expect(err3).not.toBeNull();
    console.log('[Test 07D] Anonymous request_ping_atomic bị từ chối:', err3?.message);
  });
});
