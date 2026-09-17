import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://bozuzbmgnzzxyrioxzaa.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_ZQjFvvLTLywvw4rKJIPU9Q_5iR_78Rr';

test.describe('Module 09: Custom Check-in Schedule & Dynamic Engine (PRD_CHECKIN_SCHEDULE v1.2)', () => {
  test.describe.configure({ mode: 'serial' });

  async function setupCaregiverAndElderly() {
    // 1. Đăng nhập Elderly (Cụ)
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
      .select('pairing_code, full_name')
      .eq('id', elderlyId)
      .single();
    const pairingCode = elderlyProfile?.pairing_code;
    expect(pairingCode).toBeTruthy();

    // 2. Đăng nhập Caregiver (test01)
    const clientCaregiver = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: caregiverAuth, error: caregiverErr } = await clientCaregiver.auth.signInWithPassword({
      email: 'test01@gmail.com',
      password: 'test01@gmail.com',
    });
    expect(caregiverErr).toBeNull();
    const caregiverId = caregiverAuth.user!.id;

    // Đảm bảo kết nối gia đình đã accepted
    await clientCaregiver.rpc('connect_family', {
      p_pairing_code: pairingCode,
      p_relationship: 'Con trưởng',
    });

    return { elderlyId, pairingCode, elderlyName: elderlyProfile?.full_name, clientCaregiver, clientElderly, caregiverId };
  }

  // ===================================================================
  // TEST 1: Caregiver Cập nhật Schedule & Validation DB + UI Card
  // ===================================================================
  test('TC09A: Caregiver cập nhật khung giờ thành công -> DB lưu đúng 3 mốc, UI card hiển thị chuẩn', async ({ page }) => {
    const { elderlyId, clientCaregiver } = await setupCaregiverAndElderly();

    // 1. Cập nhật lịch qua RPC: 06:00 -> 08:30, buffer 30 phút
    const { data: res, error: err } = await clientCaregiver.rpc('update_checkin_schedule', {
      p_elderly_id: elderlyId,
      p_start: '06:00:00',
      p_deadline: '08:30:00',
      p_buffer_minutes: 30,
    });

    expect(err).toBeNull();
    expect(res?.success).toBe(true);
    expect(res?.schedule?.checkin_start).toBe('06:00:00');
    expect(res?.schedule?.checkin_deadline).toBe('08:30:00');
    expect(res?.schedule?.emergency_buffer_minutes).toBe(30);

    // 2. Kiểm tra database table checkin_schedules
    const { data: schedRow, error: fetchErr } = await clientCaregiver
      .from('checkin_schedules')
      .select('*')
      .eq('elderly_id', elderlyId)
      .single();

    expect(fetchErr).toBeNull();
    expect(schedRow?.checkin_start).toBe('06:00:00');
    expect(schedRow?.checkin_deadline).toBe('08:30:00');
    expect(schedRow?.emergency_buffer_minutes).toBe(30);
    expect(schedRow?.timezone).toBe('Asia/Ho_Chi_Minh');

    // 3. Đăng nhập Caregiver trên giao diện web và kiểm tra Card
    await page.goto('/');
    await page.getByPlaceholder('0901234567 hoặc conchau@gmail.com').fill('test01@gmail.com');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('test01@gmail.com');
    await page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 10000 });

    const scheduleCard = page.getByTestId('schedule-status-card');
    await expect(scheduleCard).toBeVisible();
    await expect(page.getByTestId('schedule-start-display')).toContainText('06:00');
    await expect(page.getByTestId('schedule-deadline-display')).toContainText('08:30');
    await expect(page.getByTestId('schedule-buffer-display')).toContainText('+30p');
  });

  // ===================================================================
  // TEST 2: Day Boundary Epoch Invariant & Range Validation
  // ===================================================================
  test('TC09B: Kiểm tra tính toán không tràn ngày (Day Boundary Epoch) và Start < Deadline', async () => {
    const { elderlyId, clientCaregiver } = await setupCaregiverAndElderly();

    // 1. Start >= Deadline: 09:00 -> 08:30 -> Bị từ chối INVALID_RANGE
    const { data: res1 } = await clientCaregiver.rpc('update_checkin_schedule', {
      p_elderly_id: elderlyId,
      p_start: '09:00:00',
      p_deadline: '08:30:00',
      p_buffer_minutes: 30,
    });
    expect(res1?.success).toBe(false);
    expect(res1?.error).toBe('INVALID_RANGE');

    // 2. Buffer ngoài khoảng 5-120 phút -> Bị từ chối INVALID_BUFFER
    const { data: res2 } = await clientCaregiver.rpc('update_checkin_schedule', {
      p_elderly_id: elderlyId,
      p_start: '07:00:00',
      p_deadline: '09:00:00',
      p_buffer_minutes: 150,
    });
    expect(res2?.success).toBe(false);
    expect(res2?.error).toBe('INVALID_BUFFER');

    // 3. Test biên tràn ngày: 23:30 + 31 phút = 1441 phút = 86460s >= 86400s -> Bị từ chối DAY_OVERFLOW
    const { data: resOverflow } = await clientCaregiver.rpc('update_checkin_schedule', {
      p_elderly_id: elderlyId,
      p_start: '23:00:00',
      p_deadline: '23:30:00',
      p_buffer_minutes: 31,
    });
    expect(resOverflow?.success).toBe(false);
    expect(resOverflow?.error).toBe('DAY_OVERFLOW');

    // 4. Test mép: 23:30 + 30 phút = 1440 phút = 86400s -> Bị từ chối (>= 86400s)
    const { data: resEdge } = await clientCaregiver.rpc('update_checkin_schedule', {
      p_elderly_id: elderlyId,
      p_start: '23:00:00',
      p_deadline: '23:30:00',
      p_buffer_minutes: 30,
    });
    expect(resEdge?.success).toBe(false);
    expect(resEdge?.error).toBe('DAY_OVERFLOW');

    // 5. Test hợp lệ trước mép: 23:00 + 29 phút = 23:29 (84540s < 86400s) -> Hợp lệ
    const { data: resValid } = await clientCaregiver.rpc('update_checkin_schedule', {
      p_elderly_id: elderlyId,
      p_start: '22:00:00',
      p_deadline: '23:00:00',
      p_buffer_minutes: 29,
    });
    expect(resValid?.success).toBe(true);
  });

  // ===================================================================
  // TEST 3: RLS Security Enforcements (Chặn DELETE, Chặn Elderly Update)
  // ===================================================================
  test('TC09C: RLS chặn Caregiver DELETE schedule, chặn Elderly tự sửa schedule, chặn direct mutation checkin_logs', async () => {
    const { elderlyId, clientCaregiver, clientElderly } = await setupCaregiverAndElderly();

    // 1. Caregiver thử xóa (DELETE) record trong checkin_schedules -> Bị RLS chặn
    const { data: delRes } = await clientCaregiver
      .from('checkin_schedules')
      .delete()
      .eq('elderly_id', elderlyId)
      .select();

    // Do không có policy DELETE, Postgres RLS không cho xóa bất kỳ hàng nào (0 rows affected)
    expect(delRes?.length || 0).toBe(0);

    // Xác nhận record vẫn tồn tại nguyên vẹn
    const { data: checkRow } = await clientCaregiver
      .from('checkin_schedules')
      .select('elderly_id')
      .eq('elderly_id', elderlyId)
      .maybeSingle();
    expect(checkRow?.elderly_id).toBe(elderlyId);

    // 2. Elderly thử gọi RPC update_checkin_schedule -> Bị từ chối FORBIDDEN
    const { data: elderlyRpcRes } = await clientElderly.rpc('update_checkin_schedule', {
      p_elderly_id: elderlyId,
      p_start: '05:00:00',
      p_deadline: '07:00:00',
      p_buffer_minutes: 30,
    });
    expect(elderlyRpcRes?.success).toBe(false);
    expect(elderlyRpcRes?.error).toBe('FORBIDDEN');

    // 3. Client thử direct DELETE bảng checkin_logs -> Bị RLS chặn (0 hàng bị xóa)
    const today = new Date().toISOString().split('T')[0];
    const { data: directDeleteRes } = await clientElderly
      .from('checkin_logs')
      .delete()
      .eq('elderly_id', elderlyId)
      .eq('log_date', today)
      .select();
    expect(directDeleteRes?.length || 0).toBe(0);
  });

  // ===================================================================
  // TEST 4: Snapshot Immutability Trigger Enforcements
  // ===================================================================
  test('TC09D: Trigger DB bảo vệ tính bất biến của Snapshot khi ngày đã Safe/Emergency hoặc ngày quá khứ', async () => {
    const { elderlyId, clientCaregiver, clientElderly } = await setupCaregiverAndElderly();

    // Đưa schedule về khung giờ chuẩn 06:00 - 08:30 - 30p
    await clientCaregiver.rpc('update_checkin_schedule', {
      p_elderly_id: elderlyId,
      p_start: '06:00:00',
      p_deadline: '08:30:00',
      p_buffer_minutes: 30,
    });

    // 1. Cụ điểm danh thành công -> Chuyển trạng thái sang Safe
    const { data: checkinRes } = await clientElderly.rpc('perform_checkin_atomic_v2', {
      p_elderly_id: elderlyId,
    });
    // Lưu ý: nếu giờ hiện tại < 06:00, ta tạm set start thành 00:01 để test
    if (checkinRes?.error === 'TOO_EARLY') {
      await clientCaregiver.rpc('update_checkin_schedule', {
        p_elderly_id: elderlyId,
        p_start: '00:01:00',
        p_deadline: '23:00:00',
        p_buffer_minutes: 30,
      });
      await clientElderly.rpc('perform_checkin_atomic_v2', { p_elderly_id: elderlyId });
    }

    // 2. Caregiver đổi schedule hiện hành thành 09:30
    await clientCaregiver.rpc('update_checkin_schedule', {
      p_elderly_id: elderlyId,
      p_start: '07:30:00',
      p_deadline: '09:30:00',
      p_buffer_minutes: 30,
    });

    // 3. Bản ghi hôm nay đã Safe -> Snapshot mốc giờ KHÔNG bị ghi đè thành 07:30/09:30
    const today = new Date().toISOString().split('T')[0];
    const { data: todayLog } = await clientCaregiver
      .from('checkin_logs')
      .select('*')
      .eq('elderly_id', elderlyId)
      .eq('log_date', today)
      .single();

    expect(todayLog?.status).toBe('Safe');
    // Snapshot vẫn giữ nguyên cấu hình lúc điểm danh, không bị đổi thành 07:30:00
    expect(todayLog?.scheduled_deadline).not.toBe('09:30:00');
  });

  // ===================================================================
  // TEST 5: Elderly UI & Server Time Authority (Early_Waiting & Emergency Block)
  // ===================================================================
  test('TC09E: Server Time quyết định trạng thái (TOO_EARLY, Early_Waiting) và chặn điểm danh khi Emergency', async () => {
    const { elderlyId, clientCaregiver, clientElderly } = await setupCaregiverAndElderly();

    // 1. Cài đặt giờ bắt đầu vào cuối ngày (22:00 -> 23:00) để mô phỏng trạng thái chưa đến giờ
    await clientCaregiver.rpc('update_checkin_schedule', {
      p_elderly_id: elderlyId,
      p_start: '22:00:00',
      p_deadline: '23:00:00',
      p_buffer_minutes: 30,
    });

    // Cụ thử gọi perform_checkin_atomic_v2 lúc này -> Server Time từ chối với TOO_EARLY
    const { data: earlyRes } = await clientElderly.rpc('perform_checkin_atomic_v2', {
      p_elderly_id: elderlyId,
    });
    expect(earlyRes?.success).toBe(false);
    expect(earlyRes?.error).toBe('TOO_EARLY');

    // 2. Khôi phục giờ mở nút hợp lệ và kích hoạt trạng thái Emergency (SOS)
    await clientCaregiver.rpc('update_checkin_schedule', {
      p_elderly_id: elderlyId,
      p_start: '00:01:00',
      p_deadline: '23:00:00',
      p_buffer_minutes: 30,
    });

    const clientEventId = crypto.randomUUID();
    await clientElderly.rpc('create_sos_event_idempotent', {
      p_elderly_id: elderlyId,
      p_client_event_id: clientEventId,
      p_trigger_source: 'button',
    });
    const today = new Date().toISOString().split('T')[0];
    await clientCaregiver
      .from('checkin_logs')
      .update({ status: 'Emergency', emergency_reason: 'SOS' })
      .eq('elderly_id', elderlyId)
      .eq('log_date', today);

    // Khi đang trong Emergency: Nút điểm danh thông thường bị chặn (Bất biến 7)
    const { data: emergCheckinRes } = await clientElderly.rpc('perform_checkin_atomic_v2', {
      p_elderly_id: elderlyId,
    });
    expect(emergCheckinRes?.success).toBe(false);
    expect(emergCheckinRes?.error).toBe('STATE_IN_EMERGENCY');

    // Caregiver giải tỏa báo động
    const { data: sosEvents } = await clientCaregiver
      .from('sos_events')
      .select('id')
      .eq('elderly_id', elderlyId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1);

    if (sosEvents && sosEvents.length > 0) {
      await clientCaregiver.rpc('resolve_alarm_atomic', {
        p_elderly_id: elderlyId,
        p_sos_event_id: sosEvents[0].id,
      });
    }
  });

  // ===================================================================
  // TEST 6: Deterministic Multi-Elderly Dynamic Cron & Materialization
  // ===================================================================
  test('TC09F: check_overdue_routine_v2 tự động materialize today log và quét chuyển trạng thái độc lập', async () => {
    const { elderlyId, clientCaregiver } = await setupCaregiverAndElderly();

    // 1. Gọi trực tiếp RPC check_overdue_routine_v2
    const { error: cronErr } = await clientCaregiver.rpc('check_overdue_routine_v2');
    expect(cronErr).toBeNull();

    // 2. Xác nhận bản ghi ngày hôm nay đã được materialize trong checkin_logs
    const today = new Date().toISOString().split('T')[0];
    const { data: logRow, error: logErr } = await clientCaregiver
      .from('checkin_logs')
      .select('*')
      .eq('elderly_id', elderlyId)
      .eq('log_date', today)
      .maybeSingle();

    expect(logErr).toBeNull();
    expect(logRow).not.toBeNull();
    expect(logRow?.scheduled_start).toBeTruthy();
    expect(logRow?.scheduled_deadline).toBeTruthy();
    expect(logRow?.buffer_minutes).toBeGreaterThanOrEqual(5);
  });
});
