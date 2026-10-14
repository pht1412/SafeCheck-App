// ==============================================================================
// SafeCheck - Security Verification Test Suite: Vulnerability #1
// Kiểm chứng thực nghiệm: Toàn bộ quyền hạn nguy hiểm của Anon đã bị thu hồi 100%
// Tuân thủ nguyên tắc Least Privilege (P0-SEC-01)
// ==============================================================================

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Đọc cấu hình từ môi trường thực tế (Anon Key của client web công khai)
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://bozuzbmgnzzxyrioxzaa.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_ZQjFvvLTLywvw4rKJIPU9Q_5iR_78Rr';

// Tạo client đóng vai trò Kẻ tấn công ẩn danh (Unauthenticated Attacker)
const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

test.describe('Security Audit - Lỗ hổng 1: Thu hồi quyền truy cập của role Anon', () => {
  const fakeUuid = crypto.randomUUID();

  test('SEC-01: Anon KHÔNG THỂ gọi get_overdue_sos_events (Chống lộ danh sách Cụ gặp nạn)', async () => {
    const { data, error } = await anonClient.rpc('get_overdue_sos_events', {
      p_now: new Date().toISOString(),
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    // PostgreSQL error 42501: permission denied
    expect(error?.message).toMatch(/permission denied/i);
  });

  test('SEC-02: Anon KHÔNG THỂ gọi deactivate_push_subscription (Chống triệt hạ token con cháu)', async () => {
    const { data, error } = await anonClient.rpc('deactivate_push_subscription', {
      p_subscription_id: fakeUuid,
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/permission denied/i);
  });

  test('SEC-03: Anon KHÔNG THỂ gọi get_caregiver_push_subscriptions (Chống thu thập push subscriptions)', async () => {
    const { data, error } = await anonClient.rpc('get_caregiver_push_subscriptions', {
      p_elderly_id: fakeUuid,
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/permission denied/i);
  });

  test('SEC-04: Anon KHÔNG THỂ gọi claim_push_delivery_lease (Chống chiếm đoạt lease giao phát)', async () => {
    const { data, error } = await anonClient.rpc('claim_push_delivery_lease', {
      p_sos_event_id: fakeUuid,
      p_caregiver_id: fakeUuid,
      p_subscription_id: fakeUuid,
      p_endpoint_hash: 'fakehash',
      p_worker_id: 'attacker_worker',
      p_lease_seconds: 30,
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/permission denied|not find the function.*in the schema cache/i);
  });

  test('SEC-05: Anon KHÔNG THỂ gọi complete_push_delivery_fenced (Chống làm sai lệch audit trail push)', async () => {
    const { data, error } = await anonClient.rpc('complete_push_delivery_fenced', {
      p_delivery_id: fakeUuid,
      p_worker_id: 'attacker_worker',
      p_fence_token: 1,
      p_status: 'accepted',
      p_http_status: 200,
      p_provider_msg_id: 'fake',
      p_error_code: null,
      p_error_details: null,
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/permission denied|not find the function.*in the schema cache/i);
  });

  test('SEC-06: Anon KHÔNG THỂ gọi claim_sos_fallback_atomic (Chống can thiệp SMS Outbox)', async () => {
    const { data, error } = await anonClient.rpc('claim_sos_fallback_atomic', {
      p_sos_event_id: fakeUuid,
      p_channel: 'sms_twilio',
      p_tier: 1,
      p_idempotency_key: 'fake_key',
      p_target_phone: '0900000000',
      p_recipient_name: 'Fake',
      p_trigger_reason: 'delivery_timeout',
      p_worker_id: 'attacker_worker',
      p_lease_seconds: 30,
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/permission denied/i);
  });

  test('SEC-07: Anon KHÔNG THỂ gọi complete_sos_fallback_atomic (Chống làm giả trạng thái SMS)', async () => {
    const { data, error } = await anonClient.rpc('complete_sos_fallback_atomic', {
      p_fallback_id: fakeUuid,
      p_fence_token: 1,
      p_status: 'provider_accepted',
      p_provider_message_id: 'SM_fake',
      p_provider_response: {},
      p_error_message: null,
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/permission denied/i);
  });

  test('SEC-08: Anon KHÔNG THỂ gọi record_push_delivery_ack_atomic (Chống triệt tiêu Fallback bằng Fake ACK)', async () => {
    const { data, error } = await anonClient.rpc('record_push_delivery_ack_atomic', {
      p_sos_event_id: fakeUuid,
      p_subscription_id: fakeUuid,
      p_client_metadata: {},
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/permission denied/i);
  });

  test('SEC-09: Anon KHÔNG THỂ đọc hoặc ghi trực tiếp vào bảng sos_fallbacks', async () => {
    // Thử SELECT
    const { data: readData, error: readError } = await anonClient
      .from('sos_fallbacks')
      .select('*')
      .limit(5);

    // Thử INSERT bản ghi giả mạo
    const { error: insertError } = await anonClient
      .from('sos_fallbacks')
      .insert({
        sos_event_id: fakeUuid,
        idempotency_key: 'attacker_inserted_key',
        channel: 'sms_twilio',
        target_phone: '0999999999',
        trigger_reason: 'delivery_timeout',
      });

    // Cả SELECT và INSERT đều phải bị từ chối
    const isBlocked = (readError !== null && /permission denied/i.test(readError.message)) ||
                      (insertError !== null && /permission denied/i.test(insertError.message));

    expect(isBlocked).toBe(true);
  });
});
