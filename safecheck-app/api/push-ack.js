// ==============================================================================
// SafeCheck - Vercel Serverless Function (/api/push-ack)
// Tiếp nhận biên nhận giao phát ngầm (Delivery ACK) từ Service Worker máy con
// Tuân thủ: PRD_Deep_v3.md (v3.2) & Implementation Plan Phase 2
// - Xác thực quyền sở hữu và quan hệ gia đình hợp lệ (TC-ACK-SEC)
// - Chống giả mạo ACK: Dual Authentication (HMAC Delivery Token + Bearer JWT)
// - Gọi RPC record_push_delivery_ack_atomic (nguyên tử & idempotent)
// - Server Timestamp làm mốc kiểm toán chính thức
// ==============================================================================

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://bozuzbmgnzzxyrioxzaa.supabase.co';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_ZQjFvvLTLywvw4rKJIPU9Q_5iR_78Rr';
  const ackSecret = process.env.VAPID_PRIVATE_KEY || process.env.CRON_SECRET || 'safecheck_delivery_ack_hmac_secret';

  // 0. Kiểm tra cấu hình môi trường bắt buộc
  if (!supabaseUrl || (!serviceRoleKey && !anonKey)) {
    return res.status(500).json({ error: 'Server misconfiguration: Missing Supabase credentials' });
  }

  const dbClient = createClient(supabaseUrl, serviceRoleKey || anonKey, {
    auth: { persistSession: false },
  });

  try {
    const { sos_event_id, subscription_id, delivery_token, client_displayed_at, schema_version } = req.body || {};

    // 1. Thẩm định định dạng UUID hợp lệ
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!sos_event_id || !uuidRegex.test(sos_event_id)) {
      return res.status(400).json({ error: 'Invalid or missing sos_event_id' });
    }

    if (!subscription_id || !uuidRegex.test(subscription_id)) {
      return res.status(400).json({ error: 'Invalid or missing subscription_id' });
    }

    // 2. Bảo mật (P0-03 & TC-ACK-SEC): Xác thực danh tính người gửi (Dual Authentication)
    let isAuthorized = false;
    let authMethod = 'none';

    // Phương thức 1: Xác thực chữ ký HMAC mật mã delivery_token (từ Service Worker giải mã gói Web Push)
    if (delivery_token && typeof delivery_token === 'string') {
      const expectedToken = crypto
        .createHmac('sha256', ackSecret)
        .update(`${sos_event_id}:${subscription_id}`)
        .digest('hex');

      if (
        delivery_token.length === expectedToken.length &&
        crypto.timingSafeEqual(Buffer.from(delivery_token), Buffer.from(expectedToken))
      ) {
        isAuthorized = true;
        authMethod = 'hmac_delivery_token';
      }
    }

    // Phương thức 2: Xác thực qua Bearer JWT Token của người thân
    const authHeader = req.headers.authorization || req.headers.Authorization;
    let authUser = null;
    if (!isAuthorized && authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const authClient = createClient(supabaseUrl, anonKey);
      const { data, error: authErr } = await authClient.auth.getUser(token);

      if (!authErr && data?.user) {
        authUser = data.user;
        authMethod = 'bearer_jwt';
      }
    }

    // Nếu không thỏa mãn bất kỳ phương thức xác thực nào -> Từ chối 401
    if (!isAuthorized && authMethod !== 'bearer_jwt') {
      return res.status(401).json({
        error: 'Unauthorized: Missing or invalid delivery credentials (Valid HMAC delivery_token or Bearer token required)',
      });
    }

    // 3. Kiểm tra bản ghi giao phát tồn tại trong sổ cái push_deliveries
    const { data: delivery, error: fetchErr } = await dbClient
      .from('push_deliveries')
      .select('id, sos_event_id, caregiver_id, status')
      .eq('sos_event_id', sos_event_id)
      .eq('subscription_id', subscription_id)
      .maybeSingle();

    if (fetchErr) {
      console.error('[Push-ACK] Lỗi truy vấn push_deliveries:', fetchErr);
      return res.status(500).json({ error: 'Database query failed' });
    }

    if (!delivery) {
      return res.status(404).json({ error: 'Delivery record not found' });
    }

    // Nếu xác thực qua Bearer JWT, kiểm tra người gọi phải đúng là Caregiver sở hữu bản ghi delivery này
    if (authMethod === 'bearer_jwt') {
      if (!authUser || authUser.id !== delivery.caregiver_id) {
        return res.status(403).json({
          error: 'Forbidden: Caller is not the authorized caregiver for this delivery record',
        });
      }
      isAuthorized = true;
    }

    // 4. Gọi RPC nguyên tử: record_push_delivery_ack_atomic (bảo toàn đơn điệu & idempotent)
    const clientMetadata = {
      client_displayed_at: client_displayed_at || null,
      schema_version: schema_version || 1,
      auth_method: authMethod,
      received_at: new Date().toISOString(),
    };

    const { data: rpcResult, error: rpcErr } = await dbClient.rpc('record_push_delivery_ack_atomic', {
      p_sos_event_id: sos_event_id,
      p_subscription_id: subscription_id,
      p_client_metadata: clientMetadata,
    });

    if (rpcErr) {
      console.error('[Push-ACK] RPC record_push_delivery_ack_atomic thất bại:', rpcErr);
      return res.status(500).json({ error: rpcErr.message });
    }

    if (!rpcResult.success) {
      if (rpcResult.error === 'SOS_EVENT_ALREADY_TERMINATED') {
        return res.status(409).json({
          success: false,
          error: 'SOS_EVENT_ALREADY_TERMINATED',
          message: 'Sự kiện SOS đã được hoàn tất hoặc hủy bỏ từ trước',
        });
      }
      return res.status(400).json(rpcResult);
    }

    return res.status(200).json({
      success: true,
      idempotent: rpcResult.idempotent || false,
      delivery_acked_at: rpcResult.delivery_acked_at,
      caregiver_id: rpcResult.caregiver_id,
      auth_method: authMethod,
    });
  } catch (error) {
    console.error('[Push-ACK] Ngoại lệ không lường trước:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

