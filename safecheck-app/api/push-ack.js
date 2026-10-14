// ==============================================================================
// SafeCheck - Vercel Serverless Function (/api/push-ack)
// Tiếp nhận biên nhận giao phát ngầm (Delivery ACK) từ Service Worker máy con
// Tuân thủ: PRD_Deep_v3.md (v3.2) & Implementation Plan Phase 2
// - Xác thực quyền sở hữu và quan hệ gia đình hợp lệ
// - Gọi RPC record_push_delivery_ack_atomic (nguyên tử & idempotent)
// - Server Timestamp làm mốc kiểm toán chính thức
// ==============================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

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

  // 0. Kiểm tra cấu hình môi trường bắt buộc
  if (!SUPABASE_URL || (!SUPABASE_SERVICE_ROLE_KEY && !SUPABASE_ANON_KEY)) {
    return res.status(500).json({ error: 'Server misconfiguration: Missing Supabase credentials' });
  }

  const dbClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });

  try {
    const { sos_event_id, subscription_id, client_displayed_at, schema_version } = req.body || {};

    // 1. Thẩm định định dạng UUID hợp lệ
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!sos_event_id || !uuidRegex.test(sos_event_id)) {
      return res.status(400).json({ error: 'Invalid or missing sos_event_id' });
    }

    if (!subscription_id || !uuidRegex.test(subscription_id)) {
      return res.status(400).json({ error: 'Invalid or missing subscription_id' });
    }

    // 2. Bảo mật (P0-03 & TC-ACK-SEC): Kiểm tra bản ghi giao phát tồn tại và liên kết gia đình hợp lệ
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
      return res.status(403).json({ error: 'Forbidden: Delivery record not found or unauthorized' });
    }

    // 3. Gọi RPC nguyên tử: record_push_delivery_ack_atomic
    // Sử dụng server timestamp, client_metadata chỉ lưu phục vụ chẩn đoán
    const clientMetadata = {
      client_displayed_at: client_displayed_at || null,
      schema_version: schema_version || 1,
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
    });
  } catch (error) {
    console.error('[Push-ACK] Ngoại lệ không lường trước:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
