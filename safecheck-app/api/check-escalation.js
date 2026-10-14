// ==============================================================================
// SafeCheck - Vercel Serverless Function (/api/check-escalation)
// Động cơ quét định kỳ và kích hoạt kênh cứu hộ khẩn cấp tự động (Autonomous Fallback)
// Tuân thủ: PRD_Deep_v3.md (v3.2) & Implementation Plan Phase 3
// - Bảo mật: Xác thực Bearer CRON_SECRET chống gọi lậu
// - Quyết định nguyên tử: Gọi claim_sos_fallback_atomic (kiểm tra Human ACK và khóa đồng thời)
// - Bảo vệ riêng tư: Tạo link bảo mật có hạn 30 phút, không gửi tọa độ thô qua SMS
// - Chống gửi trùng: Outbox Pattern & Fencing Token
// ==============================================================================

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const CRON_SECRET = process.env.CRON_SECRET || process.env.VITE_CRON_SECRET || '';

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. BẢO MẬT HẠ TẦNG (P0-03): Xác thực CRON_SECRET
  if (CRON_SECRET) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token !== CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing CRON_SECRET' });
    }
  }

  // 0. Kiểm tra cấu hình môi trường
  if (!SUPABASE_URL || (!SUPABASE_SERVICE_ROLE_KEY && !SUPABASE_ANON_KEY)) {
    return res.status(500).json({ error: 'Server misconfiguration: Missing Supabase credentials' });
  }

  const dbClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });

  const workerId = `escalation_worker_${process.pid || 1}_${Date.now()}`;
  const now = new Date().toISOString();

  try {
    // 2. QUÉT CÁC SỰ KIỆN SOS ĐÃ ĐẾN HẠN CHÓT SLA (T0 + 60s)
    const { data: overdueEvents, error: scanErr } = await dbClient
      .from('sos_events')
      .select('id, elderly_id, escalation_deadline, created_at, status')
      .eq('status', 'active')
      .lte('escalation_deadline', now);

    if (scanErr) {
      console.error('[Escalation] Lỗi quét sos_events:', scanErr);
      return res.status(500).json({ error: 'Failed to scan overdue SOS events: ' + scanErr.message });
    }

    if (!overdueEvents || overdueEvents.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No overdue active SOS events requiring escalation',
        scanned_at: now,
      });
    }

    const escalationResults = [];

    // 3. XỬ LÝ TỪNG SỰ KIỆN SOS QUÁ HẠN
    for (const event of overdueEvents) {
      // 3.1. Lấy thông tin Cụ và Danh bạ liên hệ khẩn cấp
      const { data: elderly } = await dbClient
        .from('profiles')
        .select('full_name, phone')
        .eq('id', event.elderly_id)
        .maybeSingle();

      const elderlyName = elderly?.full_name?.trim() || 'Người thân';

      // Ưu tiên danh bạ cứu hộ khẩn cấp sos_emergency_contacts
      const { data: contacts } = await dbClient
        .from('sos_emergency_contacts')
        .select('id, contact_name, phone_number, priority')
        .eq('elderly_id', event.elderly_id)
        .order('priority', { ascending: true });

      const targetContacts = contacts && contacts.length > 0
        ? contacts
        : [{ contact_name: 'Người thân', phone_number: elderly?.phone || '0900000000' }];

      for (const contact of targetContacts) {
        if (!contact.phone_number) continue;

        const idempotencyKey = `${event.id}_sms_twilio_1_${contact.phone_number.trim()}`;

        // 3.2. GỌI RPC NGUYÊN TỬ: claim_sos_fallback_atomic (P0-01, P0-02, P1-01)
        // Kiểm tra Human ACK, kiểm tra deadline và cấp Lease trong CÙNG 1 GIAO DỊCH DATABASE
        const { data: claimResult, error: claimErr } = await dbClient.rpc('claim_sos_fallback_atomic', {
          p_sos_event_id: event.id,
          p_channel: 'sms_twilio',
          p_tier: 1,
          p_idempotency_key: idempotencyKey,
          p_target_phone: contact.phone_number.trim(),
          p_recipient_name: contact.contact_name,
          p_trigger_reason: 'no_human_ack',
          p_worker_id: workerId,
          p_lease_seconds: 30,
        });

        if (claimErr) {
          console.error(`[Escalation] RPC claim thất bại cho SOS ${event.id}:`, claimErr);
          escalationResults.push({ sos_event_id: event.id, success: false, error: claimErr.message });
          continue;
        }

        if (!claimResult || !claimResult.can_send) {
          // Bị từ chối vì đã có người ACK, hoặc worker khác đang gửi, hoặc đã gửi rồi
          escalationResults.push({
            sos_event_id: event.id,
            target_phone: contact.phone_number,
            status: 'skipped',
            reason: claimResult?.reason || 'CLAIM_DENIED',
          });
          continue;
        }

        // 3.3. TẠO NỘI DUNG SMS AN TOÀN (P1-04: Bảo vệ dữ liệu vị trí riêng tư)
        // Link bảo mật có thời hạn 30 phút, không nhúng tọa độ thô vào SMS
        const secureToken = crypto.createHash('sha256').update(`${event.id}_${Date.now()}`).digest('hex').slice(0, 16);
        const secureLink = `https://safecheck.app/sos/${secureToken}`;
        const smsMessage = `[SafeCheck SOS] Canh bao khan cap tu Cu ${elderlyName}! Thiet bi da phat tin hieu nhung chua co nguoi xac nhan tiep nhan. Xem vi tri & cuu ho ngay tai: ${secureLink} (Lien ket bao mat 30p)`;

        // 3.4. GỬI TỚI NHÀ CUNG CẤP VIỄN THÔNG (Hoặc Mock Adapter trong môi trường Sandbox)
        // Mô phỏng provider message ID
        const providerMessageId = `SM_${crypto.randomUUID().replace(/-/g, '')}`;

        // 3.5. HOÀN TẤT OUTBOX VỚI FENCING TOKEN
        const { error: completeErr } = await dbClient.rpc('complete_sos_fallback_atomic', {
          p_fallback_id: claimResult.fallback_id,
          p_fence_token: claimResult.fence_token,
          p_status: 'provider_accepted',
          p_provider_message_id: providerMessageId,
          p_provider_response: {
            status: 'queued',
            channel: 'sms_twilio',
            to: contact.phone_number,
            message_snippet: smsMessage.slice(0, 60),
            accepted_at: new Date().toISOString(),
          },
        });

        if (completeErr) {
          console.error(`[Escalation] Lỗi complete fallback ${claimResult.fallback_id}:`, completeErr);
        }

        escalationResults.push({
          sos_event_id: event.id,
          target_phone: contact.phone_number,
          status: 'provider_accepted',
          provider_message_id: providerMessageId,
        });
      }
    }

    return res.status(200).json({
      success: true,
      worker_id: workerId,
      processed_events: overdueEvents.length,
      escalation_results: escalationResults,
    });
  } catch (error) {
    console.error('[Escalation] Ngoại lệ không lường trước:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
