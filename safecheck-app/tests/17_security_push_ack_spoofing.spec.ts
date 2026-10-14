// ==============================================================================
// SafeCheck - Security Verification Test Suite: Vulnerability #2
// Kiểm chứng thực nghiệm: Chống tấn công giả mạo Delivery ACK (Silent Kill Attack)
// Tuân thủ: PRD_Deep_v3.md (v3.2) - Tiêu chuẩn TC-ACK-SEC
// ==============================================================================

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import pushAckHandler from '../api/push-ack.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://bozuzbmgnzzxyrioxzaa.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_ZQjFvvLTLywvw4rKJIPU9Q_5iR_78Rr';
const ackSecret = process.env.VAPID_PRIVATE_KEY || process.env.CRON_SECRET || 'safecheck_delivery_ack_hmac_secret';

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

test.describe('Security Audit - Lỗ hổng 2: Chống Fake Delivery ACK & Silent Kill', () => {
  const fakeSosId = crypto.randomUUID();
  const fakeSubId = crypto.randomUUID();

  // ---------------------------------------------------------------------------
  // SEC-ACK-01: Kẻ tấn công gửi ACK không có bất kỳ token xác thực nào -> BỊ TỪ CHỐI 401
  // ---------------------------------------------------------------------------
  test('SEC-ACK-01: Kẻ tấn công gửi POST /api/push-ack không có token -> Bị từ chối HTTP 401', async () => {
    const { req, res, getResponse } = createMockReqRes({
      method: 'POST',
      body: {
        sos_event_id: fakeSosId,
        subscription_id: fakeSubId,
      },
      headers: {},
    });

    await pushAckHandler(req, res);
    const response = getResponse();

    expect(response.statusCode).toBe(401);
    expect(response.data?.error).toMatch(/unauthorized|missing or invalid delivery credentials/i);
  });

  // ---------------------------------------------------------------------------
  // SEC-ACK-02: Kẻ tấn công bịa một delivery_token ngẫu nhiên -> BỊ TỪ CHỐI 401
  // ---------------------------------------------------------------------------
  test('SEC-ACK-02: Kẻ tấn công gửi delivery_token giả mạo -> Bị từ chối HTTP 401', async () => {
    const fakeToken = crypto.randomBytes(32).toString('hex');
    const { req, res, getResponse } = createMockReqRes({
      method: 'POST',
      body: {
        sos_event_id: fakeSosId,
        subscription_id: fakeSubId,
        delivery_token: fakeToken,
      },
      headers: {},
    });

    await pushAckHandler(req, res);
    const response = getResponse();

    expect(response.statusCode).toBe(401);
    expect(response.data?.error).toMatch(/unauthorized/i);
  });

  // ---------------------------------------------------------------------------
  // SEC-ACK-03: Kẻ tấn công gửi kèm Bearer JWT giả/hết hạn -> BỊ TỪ CHỐI 401
  // ---------------------------------------------------------------------------
  test('SEC-ACK-03: Kẻ tấn công gửi Bearer token không hợp lệ -> Bị từ chối HTTP 401', async () => {
    const { req, res, getResponse } = createMockReqRes({
      method: 'POST',
      body: {
        sos_event_id: fakeSosId,
        subscription_id: fakeSubId,
      },
      headers: {
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature',
      },
    });

    await pushAckHandler(req, res);
    const response = getResponse();

    expect(response.statusCode).toBe(401);
    expect(response.data?.error).toMatch(/unauthorized/i);
  });

  // ---------------------------------------------------------------------------
  // SEC-ACK-04: Service Worker có delivery_token chuẩn HMAC do máy chủ ký -> ĐƯỢC CHẤP NHẬN
  // ---------------------------------------------------------------------------
  test('SEC-ACK-04: Service Worker gửi đúng chữ ký HMAC delivery_token -> Vượt qua xác thực', async () => {
    // Tạo đúng chữ ký HMAC mà Dispatcher đã đính kèm trong gói Web Push mã hóa
    const validHmacToken = crypto
      .createHmac('sha256', ackSecret)
      .update(`${fakeSosId}:${fakeSubId}`)
      .digest('hex');

    const { req, res, getResponse } = createMockReqRes({
      method: 'POST',
      body: {
        sos_event_id: fakeSosId,
        subscription_id: fakeSubId,
        delivery_token: validHmacToken,
      },
      headers: {},
    });

    await pushAckHandler(req, res);
    const response = getResponse();

    // Vì fake UUID không tồn tại trong DB thực, API sẽ trả về 404 Delivery record not found,
    // TUYỆT ĐỐI KHÔNG BỊ CHẶN 401 Unauthorized (nghĩa là đã vượt qua cửa ải xác thực bảo mật thành công)
    expect(response.statusCode).not.toBe(401);
    expect([200, 404]).toContain(response.statusCode);
  });

  // ---------------------------------------------------------------------------
  // SEC-ACK-05: Gọi trực tiếp RPC record_push_delivery_ack_atomic bằng Anon Key -> BỊ CHẶN 42501
  // ---------------------------------------------------------------------------
  test('SEC-ACK-05: Kẻ tấn công bypass API gọi thẳng RPC Supabase bằng Anon Key -> Bị Database chặn đứng', async () => {
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });

    const { data, error } = await anonClient.rpc('record_push_delivery_ack_atomic', {
      p_sos_event_id: fakeSosId,
      p_subscription_id: fakeSubId,
      p_client_metadata: {},
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/permission denied/i);
  });
});
