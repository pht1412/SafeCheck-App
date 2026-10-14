// ==============================================================================
// SafeCheck - Security Verification Test Suite: Vulnerability #3
// Kiểm chứng thực nghiệm: Chống tấn công dò mã kết nối Cụ già (Brute-Force Pairing Code)
// Tuân thủ: P0-SEC-03 - Giới hạn 5 lần thử sai, khóa 15 phút & Đổi mã Cụ chủ động
// ==============================================================================

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://bozuzbmgnzzxyrioxzaa.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_ZQjFvvLTLywvw4rKJIPU9Q_5iR_78Rr';

test.describe('Security Audit - Lỗ hổng 3: Chống Brute-Force Pairing Code & Rate Limiting', () => {
  test.describe.configure({ mode: 'serial' });

  // ---------------------------------------------------------------------------
  // SEC-PAIR-01: Nhập sai 5 lần liên tiếp -> Bị khóa (RATE_LIMITED) trong 15 phút
  // ---------------------------------------------------------------------------
  test('SEC-PAIR-01: Kẻ tấn công thử sai 5 lần liên tiếp -> Lần thứ 5 và 6 bị khóa cứng RATE_LIMITED', async () => {
    // Tạo tài khoản Caregiver độc lập của kẻ tấn công để kiểm thử
    const attackerEmail = `attacker_${Date.now()}@safecheck.test`;
    const attackerPassword = 'AttackerPassword123!';

    const clientAttacker = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });

    const { data: signUpData, error: signUpErr } = await clientAttacker.auth.signUp({
      email: attackerEmail,
      password: attackerPassword,
      options: {
        data: {
          role: 'caregiver',
          full_name: 'Attacker Bot',
        },
      },
    });

    expect(signUpErr).toBeNull();
    expect(signUpData.user).not.toBeNull();

    // Đăng nhập tài khoản kẻ tấn công
    await clientAttacker.auth.signInWithPassword({
      email: attackerEmail,
      password: attackerPassword,
    });

    // Thử 4 lần đầu tiên với mã sai: Phải trả về INVALID_CODE kèm số lần thử còn lại giảm dần
    for (let attempt = 1; attempt <= 4; attempt++) {
      const fakeCode = `WRONG${attempt}`;
      const { data, error } = await clientAttacker.rpc('connect_family', {
        p_pairing_code: fakeCode,
        p_relationship: 'Kẻ lạ mặt',
      });

      expect(error).toBeNull();
      expect(data?.success).toBe(false);
      expect(data?.error).toBe('INVALID_CODE');
      expect(data?.remaining_attempts).toBe(5 - attempt);
      expect(data?.message).toContain(`Còn ${5 - attempt} lần thử`);
    }

    // Lần thử thứ 5 với mã sai: Kích hoạt khóa tài khoản 15 phút
    const { data: attempt5, error: err5 } = await clientAttacker.rpc('connect_family', {
      p_pairing_code: 'WRONG5',
      p_relationship: 'Kẻ lạ mặt',
    });

    expect(err5).toBeNull();
    expect(attempt5?.success).toBe(false);
    expect(attempt5?.error).toBe('RATE_LIMITED');
    expect(attempt5?.retry_after_minutes).toBe(15);
    expect(attempt5?.message).toContain('tạm khóa kết nối trong 15 phút');

    // Lần thử thứ 6 (khi đang bị khóa): Bị chặn ngay từ bước đầu
    const { data: attempt6, error: err6 } = await clientAttacker.rpc('connect_family', {
      p_pairing_code: 'WRONG6',
      p_relationship: 'Kẻ lạ mặt',
    });

    expect(err6).toBeNull();
    expect(attempt6?.success).toBe(false);
    expect(attempt6?.error).toBe('RATE_LIMITED');
    expect(attempt6?.retry_after_minutes).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // SEC-PAIR-02: Nhập đúng mã kết nối -> Kết nối thành công & Reset bộ đếm thử sai về 0
  // ---------------------------------------------------------------------------
  test('SEC-PAIR-02: Caregiver nhập sai 2 lần sau đó nhập đúng -> Kết nối thành công & Reset bộ đếm', async () => {
    // 1. Đăng nhập Cụ (0123456789)
    const clientElderly = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data: elderlyAuth, error: elderlyErr } = await clientElderly.auth.signInWithPassword({
      email: '0123456789@safecheck.local',
      password: '123456',
    });
    expect(elderlyErr).toBeNull();

    // Lấy pairing_code hiện tại của Cụ
    const { data: elderlyProfile } = await clientElderly
      .from('profiles')
      .select('id, pairing_code')
      .eq('id', elderlyAuth.user!.id)
      .single();
    const legitimateCode = elderlyProfile?.pairing_code;
    expect(legitimateCode).toBeTruthy();

    // 2. Tạo một Caregiver hợp lệ mới
    const caregiverEmail = `caregiver_${Date.now()}@safecheck.test`;
    const caregiverPassword = 'CaregiverPassword123!';

    const clientCaregiver = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });

    await clientCaregiver.auth.signUp({
      email: caregiverEmail,
      password: caregiverPassword,
      options: {
        data: {
          role: 'caregiver',
          full_name: 'Con Gái Thật',
        },
      },
    });

    await clientCaregiver.auth.signInWithPassword({
      email: caregiverEmail,
      password: caregiverPassword,
    });

    // Thử sai 2 lần
    await clientCaregiver.rpc('connect_family', { p_pairing_code: 'TYPO1' });
    await clientCaregiver.rpc('connect_family', { p_pairing_code: 'TYPO2' });

    // Lần thứ 3 nhập ĐÚNG mã của Cụ
    const { data: connectRes, error: connectErr } = await clientCaregiver.rpc('connect_family', {
      p_pairing_code: legitimateCode,
      p_relationship: 'Con gái út',
    });

    expect(connectErr).toBeNull();
    expect(connectRes?.success).toBe(true);
    expect(connectRes?.elderly?.id).toBe(elderlyAuth.user!.id);

    // Xác minh bảng pairing_attempts đã được reset về failed_attempts = 0
    const { data: attemptRecord } = await clientCaregiver
      .from('pairing_attempts')
      .select('failed_attempts, locked_until')
      .single();

    expect(attemptRecord?.failed_attempts).toBe(0);
    expect(attemptRecord?.locked_until).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // SEC-PAIR-03: Cụ đổi mã bằng regenerate_pairing_code() -> Mã cũ bị hủy tức thì
  // ---------------------------------------------------------------------------
  test('SEC-PAIR-03: Cụ gọi regenerate_pairing_code() -> Mã cũ bị vô hiệu hóa, mã mới hoạt động', async () => {
    // 1. Đăng nhập Cụ
    const clientElderly = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    await clientElderly.auth.signInWithPassword({
      email: '0123456789@safecheck.local',
      password: '123456',
    });

    // Lấy mã cũ
    const { data: oldProfile } = await clientElderly
      .from('profiles')
      .select('pairing_code')
      .eq('phone', '0123456789')
      .single();
    const oldCode = oldProfile?.pairing_code;
    expect(oldCode).toBeTruthy();

    // Cụ yêu cầu đổi mã mới
    const { data: regenData, error: regenErr } = await clientElderly.rpc('regenerate_pairing_code');
    expect(regenErr).toBeNull();
    expect(regenData?.success).toBe(true);
    const newCode = regenData?.pairing_code;

    expect(newCode).toBeTruthy();
    expect(newCode).toHaveLength(6);
    expect(newCode).not.toBe(oldCode);

    // 2. Tạo một Caregiver khác để thử
    const clientNewCaregiver = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    const email = `test_rotate_${Date.now()}@safecheck.test`;
    await clientNewCaregiver.auth.signUp({
      email,
      password: 'Password123!',
      options: { data: { role: 'caregiver', full_name: 'Caregiver Rotate' } },
    });
    await clientNewCaregiver.auth.signInWithPassword({ email, password: 'Password123!' });

    // Thử kết nối bằng mã CŨ -> BỊ TỪ CHỐI
    const { data: oldConnectRes } = await clientNewCaregiver.rpc('connect_family', {
      p_pairing_code: oldCode,
    });
    expect(oldConnectRes?.success).toBe(false);
    expect(oldConnectRes?.error).toBe('INVALID_CODE');

    // Thử kết nối bằng mã MỚI -> THÀNH CÔNG
    const { data: newConnectRes } = await clientNewCaregiver.rpc('connect_family', {
      p_pairing_code: newCode,
      p_relationship: 'Cháu ngoại',
    });
    expect(newConnectRes?.success).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // SEC-PAIR-04: Khách vãng lai (Anon) hoặc chưa đăng nhập không thể gọi connect_family
  // ---------------------------------------------------------------------------
  test('SEC-PAIR-04: Chưa đăng nhập gọi connect_family -> Bị từ chối UNAUTHORIZED', async () => {
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });

    const { data } = await anonClient.rpc('connect_family', {
      p_pairing_code: 'ABCDEF',
    });

    expect(data?.success).toBe(false);
    expect(data?.message).toMatch(/chưa đăng nhập|unauthorized/i);
  });
});
