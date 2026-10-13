// ==============================================================================
// SafeCheck - Vercel Serverless Function (/api/send-push)
// Dispatcher phát tán Web Push Notifications cứu hộ khẩn cấp cho con cháu
// Tuân thủ: PRD_Deep_v2.md (v2.1) & Implementation Plan Phase 1
// - Chuẩn Web Push RFC 8030: TTL = 300, Urgency = high, Topic <= 32 ký tự
// - Sổ cái Giao phát (Delivery Ledger): Lease có hạn & Fencing Token đơn điệu
// - Bounded Concurrency: Chunking 5 requests song song, Timeout kiểm soát
// - Soft-delete Subscriptions hết hạn (410 Gone) bảo toàn audit trail
// ==============================================================================

import crypto from 'crypto';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const rawPublicKey = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || '';
const rawPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
const rawSubject = process.env.VAPID_SUBJECT || '';

const VAPID_PUBLIC_KEY = rawPublicKey.trim().replace(/^["']|["']$/g, '');
const VAPID_PRIVATE_KEY = rawPrivateKey.trim().replace(/^["']|["']$/g, '');
const VAPID_SUBJECT = rawSubject.trim().replace(/^["']|["']$/g, '');

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// Bounded Concurrency Helper
async function runInChunks(items, chunkSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.allSettled(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}

// Timeout Wrapper cho webpush.sendNotification
function sendWithTimeout(subscription, payload, options, timeoutMs = 6000) {
  return Promise.race([
    webpush.sendNotification(subscription, payload, options),
    new Promise((_, reject) => {
      const timer = setTimeout(() => {
        const timeoutErr = new Error(`Push request timed out after ${timeoutMs}ms`);
        timeoutErr.name = 'TimeoutError';
        reject(timeoutErr);
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]);
}

export default async function handler(req, res) {
  // 0. Kiểm tra cấu hình môi trường bắt buộc
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration: Missing Supabase environment variables' });
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration: Missing VAPID keys in environment variables' });
  }

  // Chỉ chấp nhận method POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // 1. AUTHENTICATE CALLER
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(token);

  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }

  // Khởi tạo client gọi DB với Service Role Key để quản lý Lease & Fencing Token
  const clientKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const dbClient = createClient(SUPABASE_URL, clientKey);

  const { sos_event_id } = req.body || {};

  if (!sos_event_id) {
    return res.status(400).json({ error: 'Missing required field: sos_event_id' });
  }

  // Khởi tạo Worker ID duy nhất cho invocation này
  const workerId = process.env.VERCEL_INVOCATION_ID || crypto.randomUUID();

  try {
    // 2. XÁC MINH SỰ KIỆN SOS & QUYỀN HẠN CỦA CALLER
    const { data: sosEvent, error: sosError } = await dbClient
      .from('sos_events')
      .select('id, elderly_id, status')
      .eq('id', sos_event_id)
      .maybeSingle();

    if (sosError || !sosEvent) {
      return res.status(404).json({ error: 'SOS event not found' });
    }

    if (sosEvent.status !== 'active') {
      return res.status(400).json({ 
        error: `Cannot dispatch push: SOS event is ${sosEvent.status}`,
        sos_event_id,
        status: sosEvent.status 
      });
    }

    // Kiểm tra Caller phải là người cao tuổi của sự kiện hoặc con cháu liên kết accepted
    const isOwner = sosEvent.elderly_id === user.id;
    let isLinkedCaregiver = false;

    if (!isOwner) {
      const { data: link } = await dbClient
        .from('family_links')
        .select('id')
        .eq('elderly_id', sosEvent.elderly_id)
        .eq('caregiver_id', user.id)
        .eq('status', 'accepted')
        .maybeSingle();

      isLinkedCaregiver = Boolean(link);
    }

    if (!isOwner && !isLinkedCaregiver) {
      return res.status(403).json({ error: 'Forbidden: Caller is not authorized for this SOS event' });
    }

    // Lấy tên Người cao tuổi
    const { data: elderlyProfile } = await dbClient
      .from('profiles')
      .select('full_name')
      .eq('id', sosEvent.elderly_id)
      .maybeSingle();

    const elderlyName = elderlyProfile?.full_name?.trim() || 'Người thân';

    // 3. TRUY VẤN DANH SÁCH SUBSCRIPTIONS ĐANG HOẠT ĐỘNG
    const { data: subscriptions, error: rpcError } = await dbClient.rpc('get_caregiver_push_subscriptions', {
      p_elderly_id: sosEvent.elderly_id,
    });

    if (rpcError) {
      console.error('[Dispatcher] Lỗi lấy danh sách subscriptions:', rpcError);
      return res.status(500).json({ error: 'Failed to resolve subscriptions: ' + rpcError.message });
    }

    if (!subscriptions || subscriptions.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No active caregiver subscriptions found',
        sos_event_id,
        dispatched_count: 0,
        total_subscriptions: 0,
      });
    }

    // 4. CHUẨN HÓA PAYLOAD & RFC 8030 WEB PUSH OPTIONS
    // Topic: URL-safe Base64, giới hạn tối đa 32 ký tự theo chuẩn RFC 8030
    const hash = crypto.createHash('sha256').update(sos_event_id).digest('base64url');
    const webPushTopic = `sos_${hash.slice(0, 24)}`; // 4 + 24 = 28 ký tự (<= 32)

    // Payload Self-Contained để Service Worker hiển thị ngay (Zero-Network Fetch)
    const payload = JSON.stringify({
      title: '🚨 SafeCheck - BÁO ĐỘNG SOS KHẨN CẤP!',
      body: `${elderlyName} vừa kích hoạt cảnh báo cứu hộ! Nhấn để mở ứng dụng ngay.`,
      sos_event_id,
      elderly_name: elderlyName,
      url: `/?sos=${sos_event_id}`,
      timestamp: Date.now(),
    });

    const pushOptions = {
      TTL: 300, // 5 phút cho cảnh báo SOS ban đầu
      urgency: 'high',
      topic: webPushTopic,
    };

    // 5. PHÂN PHÁT TỪNG THIẾT BỊ VỚI BOUNDED CONCURRENCY & LEASE/FENCING
    const dispatchResults = [];
    const subscriptionsToDeactivate = [];

    const handleSubscription = async (sub) => {
      const endpointHash = crypto.createHash('sha256').update(sub.endpoint).digest('hex');

      // 5.1. Atomic Claim Lease trên Database
      const { data: leaseResult, error: leaseErr } = await dbClient.rpc('claim_push_delivery_lease', {
        p_sos_event_id: sos_event_id,
        p_caregiver_id: sub.caregiver_id,
        p_subscription_id: sub.subscription_id,
        p_endpoint_hash: endpointHash,
        p_worker_id: workerId,
        p_lease_duration_seconds: 15,
      });

      let deliveryId = null;
      let fenceToken = null;
      let attemptCount = 1;
      let isRetry = false;

      if (leaseErr) {
        console.warn(`[Dispatcher] Cảnh báo claim lease cho sub ${sub.subscription_id} thất bại, kích hoạt cơ chế gửi trực tiếp cứu mạng:`, leaseErr.message);
      } else if (leaseResult) {
        if (!leaseResult.can_send) {
          return {
            subscription_id: sub.subscription_id,
            success: false,
            status: 'skipped',
            reason: leaseResult.reason || 'LEASE_DENIED',
          };
        }
        deliveryId = leaseResult.delivery_id;
        fenceToken = leaseResult.fence_token;
        attemptCount = leaseResult.attempt_count || 1;
        isRetry = attemptCount > 1;
      }

      // 5.2. Tạo Payload gắn nhãn chẩn đoán và schema_version cho từng subscription
      const subPayload = JSON.stringify({
        title: '🚨 SafeCheck - BÁO ĐỘNG SOS KHẨN CẤP!',
        body: `${elderlyName} vừa kích hoạt cảnh báo cứu hộ! Nhấn để mở ứng dụng ngay.`,
        sos_event_id,
        elderly_name: elderlyName,
        url: `/?sos=${sos_event_id}`,
        timestamp: Date.now(),
        is_retry: isRetry,
        attempt_count: attemptCount,
        schema_version: 1,
      });

      // 5.3. Gửi Web Push qua Gateway
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        const sendResponse = await sendWithTimeout(pushSubscription, subPayload, pushOptions, 6000);

        // Ghi nhận thành công 201 vào Sổ cái nếu có deliveryId
        if (deliveryId) {
          await dbClient.rpc('complete_push_delivery_fenced', {
            p_delivery_id: deliveryId,
            p_worker_id: workerId,
            p_fence_token: fenceToken,
            p_status: 'accepted',
            p_http_status: sendResponse?.statusCode || 201,
            p_response_body: typeof sendResponse?.body === 'string' ? sendResponse.body : null,
            p_error_message: null,
            p_terminal_reason: null,
          }).catch((completeErr) => {
            console.warn('[Dispatcher] Cảnh báo ghi nhận thành công fenced:', completeErr);
          });
        }

        return {
          subscription_id: sub.subscription_id,
          success: true,
          status: 'accepted',
          http_status: sendResponse?.statusCode || 201,
          attempt_count: attemptCount,
          is_retry: isRetry,
        };
      } catch (err) {
        const statusCode = err.statusCode || (err.name === 'TimeoutError' ? 408 : null);
        let targetStatus = 'retryable';
        let terminalReason = null;

        if (statusCode === 404 || statusCode === 410) {
          targetStatus = 'expired';
          terminalReason = `SUBSCRIPTION_EXPIRED_${statusCode}`;
          subscriptionsToDeactivate.push(sub.subscription_id);
        } else if (statusCode === 429) {
          targetStatus = 'retryable';
          const retryAfterHeader = err.headers?.['retry-after'];
          const retryAfterSeconds = parseInt(retryAfterHeader, 10);
          terminalReason = Number.isFinite(retryAfterSeconds)
            ? `RATE_LIMITED_RETRY_AFTER_${retryAfterSeconds}S`
            : 'RATE_LIMITED';
        } else if (err.name === 'TimeoutError') {
          targetStatus = 'unknown';
          terminalReason = 'REQUEST_TIMEOUT_UNKNOWN_RESULT';
        } else if (statusCode && statusCode >= 500) {
          targetStatus = 'retryable';
          terminalReason = 'GATEWAY_SERVER_ERROR';
        } else {
          targetStatus = 'unknown';
          terminalReason = 'NETWORK_ERROR_UNKNOWN_RESULT';
        }

        // Cập nhật kết quả thất bại/unknown với Fencing Token nếu có deliveryId
        if (deliveryId) {
          await dbClient.rpc('complete_push_delivery_fenced', {
            p_delivery_id: deliveryId,
            p_worker_id: workerId,
            p_fence_token: fenceToken,
            p_status: targetStatus,
            p_http_status: statusCode,
            p_response_body: err.body || null,
            p_error_message: err.message,
            p_terminal_reason: terminalReason,
          }).catch((completeErr) => {
            console.warn('[Dispatcher] Lỗi ghi nhận thất bại fenced:', completeErr);
          });
        }

        return {
          subscription_id: sub.subscription_id,
          success: false,
          status: targetStatus,
          http_status: statusCode,
          error: err.message,
          terminal_reason: terminalReason,
        };
      }
    };

    // Chạy với giới hạn 5 subscriptions đồng thời
    const chunkResults = await runInChunks(subscriptions, 5, handleSubscription);
    for (const res of chunkResults) {
      if (res.status === 'fulfilled') {
        dispatchResults.push(res.value);
      } else {
        dispatchResults.push({ success: false, status: 'promise_rejected', error: res.reason?.message });
      }
    }

    // 6. SOFT-DELETE CÁC SUBSCRIPTION HẾT HẠN (410 GONE)
    if (subscriptionsToDeactivate.length > 0) {
      await Promise.allSettled(
        subscriptionsToDeactivate.map((subId) =>
          dbClient.rpc('deactivate_push_subscription', { p_subscription_id: subId })
        )
      );
    }

    // 7. CẬP NHẬT AUDIT METRICS TRÊN sos_events
    await dbClient
      .from('sos_events')
      .update({
        push_dispatched_at: new Date().toISOString(),
      })
      .eq('id', sos_event_id)
      .catch((e) => console.warn('[Dispatcher] Không thể cập nhật push_dispatched_at:', e));

    const acceptedCount = dispatchResults.filter((r) => r.status === 'accepted').length;

    return res.status(200).json({
      success: true,
      sos_event_id,
      worker_id: workerId,
      total_subscriptions: subscriptions.length,
      accepted_count: acceptedCount,
      expired_count: subscriptionsToDeactivate.length,
      deliveries: dispatchResults,
    });
  } catch (err) {
    console.error('[Dispatcher] Lỗi hệ thống ngoài dự kiến:', err);
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
}
