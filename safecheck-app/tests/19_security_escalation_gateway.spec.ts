// ==============================================================================
// SafeCheck - Security Verification Test Suite: Vulnerability #4
// Kiểm chứng thực nghiệm: Chống tấn công DoS / Lạm dụng quét leo thang khẩn cấp
// Tuân thủ: P0-SEC-04 - Dual-Channel Authorization cho /api/check-escalation
// ==============================================================================

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
// @ts-ignore
import checkEscalationHandler from '../api/check-escalation.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://bozuzbmgnzzxyrioxzaa.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_ZQjFvvLTLywvw4rKJIPU9Q_5iR_78Rr';
const TEST_CRON_SECRET = 'safecheck_cron_test_secret_2026';

// Thiết lập tạm thời CRON_SECRET cho môi trường test
process.env.CRON_SECRET = TEST_CRON_SECRET;

// Mock Helper cho Vercel Serverless Function
function createMockReqRes({ body = {}, headers = {}, method = 'POST' }: { body?: any; headers?: Record<string, string>; method?: string }) {
  let statusCode = 200;
  let responseData: any = null;
  const resHeaders: Record<string, string> = {};

  const req: any = {
    method,
    headers,
    body,
  };

  const res: any = {
    setHeader: (key: string, val: string) => {
      resHeaders[key] = val;
      return res;
    },
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (data: any) => {
      responseData = data;
      return res;
    },
    end: () => res,
  };

  return {
    req,
    res,
    getResponse: () => ({ statusCode, data: responseData, headers: resHeaders }),
  };
}

test.describe('Security Audit - Lỗ hổng 4: Chống DoS API Gateway /api/check-escalation', () => {
  test.describe.configure({ mode: 'serial' });

  // ---------------------------------------------------------------------------
  // SEC-ESC-01: Kẻ tấn công gọi nặc danh (không có header Authorization) -> BỊ TỪ CHỐI 401
  // ---------------------------------------------------------------------------
  test('SEC-ESC-01: Kẻ tấn công spam gọi /api/check-escalation nặc danh -> Bị từ chối HTTP 401', async () => {
    const { req, res, getResponse } = createMockReqRes({
      method: 'POST',
      body: {},
      headers: {},
    });

    await checkEscalationHandler(req, res);
    const response = getResponse();

    expect(response.statusCode).toBe(401);
    expect(response.data?.error).toMatch(/unauthorized/i);
  });

  // ---------------------------------------------------------------------------
  // SEC-ESC-02: Kẻ tấn công gửi Bearer token rác/giả mạo -> BỊ TỪ CHỐI 401
  // ---------------------------------------------------------------------------
  test('SEC-ESC-02: Kẻ tấn công gửi Bearer token giả mạo -> Bị từ chối HTTP 401', async () => {
    const { req, res, getResponse } = createMockReqRes({
      method: 'POST',
      body: {},
      headers: {
        authorization: 'Bearer fake_random_cron_token_12345',
      },
    });

    await checkEscalationHandler(req, res);
    const response = getResponse();

    expect(response.statusCode).toBe(401);
    expect(response.data?.error).toMatch(/unauthorized/i);
  });

  // ---------------------------------------------------------------------------
  // SEC-ESC-03: Kênh 1 - Vercel Cron Job gửi đúng CRON_SECRET -> ĐƯỢC CHẤP NHẬN 200
  // ---------------------------------------------------------------------------
  test('SEC-ESC-03: Cron Job gửi đúng CRON_SECRET -> Vượt qua xác thực và thực thi quét (HTTP 200)', async () => {
    const { req, res, getResponse } = createMockReqRes({
      method: 'POST',
      body: {},
      headers: {
        authorization: `Bearer ${TEST_CRON_SECRET}`,
      },
    });

    await checkEscalationHandler(req, res);
    const response = getResponse();

    expect(response.statusCode).toBe(200);
    expect(response.data?.success).toBe(true);
    expect(response.data?.message).toMatch(/no overdue active sos events|processed/i);
  });

  // ---------------------------------------------------------------------------
  // SEC-ESC-04: Kênh 2 - Người dùng đã đăng nhập kích hoạt qua session access_token -> ĐƯỢC CHẤP NHẬN 200
  // ---------------------------------------------------------------------------
  test('SEC-ESC-04: Người dùng hợp lệ kích hoạt kèm session token -> Vượt qua xác thực (HTTP 200)', async () => {
    // 1. Đăng nhập tài khoản test (Caregiver)
    const clientCaregiver = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });

    const { data: authData, error: authErr } = await clientCaregiver.auth.signInWithPassword({
      email: 'test01@gmail.com',
      password: 'test01@gmail.com',
    });

    expect(authErr).toBeNull();
    const accessToken = authData.session?.access_token;
    expect(accessToken).toBeTruthy();

    // 2. Gửi request kèm Bearer accessToken của người dùng
    const { req, res, getResponse } = createMockReqRes({
      method: 'POST',
      body: { sos_event_id: crypto.randomUUID() },
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });

    await checkEscalationHandler(req, res);
    const response = getResponse();

    expect(response.statusCode).toBe(200);
    expect(response.data?.success).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // SEC-ESC-05: Kẻ tấn công gọi thẳng RPC get_overdue_sos_events bằng Anon Key -> BỊ DATABASE CHẶN
  // ---------------------------------------------------------------------------
  test('SEC-ESC-05: Kẻ tấn công bypass API gọi thẳng RPC get_overdue_sos_events bằng Anon Key -> Bị chặn 42501', async () => {
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });

    const { data, error } = await anonClient.rpc('get_overdue_sos_events', {
      p_now: new Date().toISOString(),
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/permission denied/i);
  });
});
