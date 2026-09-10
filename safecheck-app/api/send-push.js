// ==============================================================================
// SafeCheck - Vercel Serverless Function (/api/send-push)
// Dispatcher phát tán Web Push Notifications cho con cháu khi Cụ bà kích hoạt SOS
// Tuân thủ nghiêm ngặt 8 bước bảo mật trong PRD_NotiSOS.md & implementation_plan.md
// ==============================================================================

import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://bozuzbmgnzzxyrioxzaa.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_ZQjFvvLTLywvw4rKJIPU9Q_5iR_78Rr';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || 'BBub7j1uGoSi39dIjFnM43eQZRcIL_j8iRNt035Uy0zbAC5whyylXiKKdmzECaH8YMHpIdqLpvhUmgx94zNXlYk';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'EbZfOAThsGUEkwY56PUI5ChUKOOBcmKSEgcpV25kVx8';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:contact@safecheck.app';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export default async function handler(req, res) {
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
  
  // Khởi tạo client xác thực người gọi
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(token);

  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }

  // Khởi tạo client gọi RPC (Sử dụng Service Role nếu có, hoặc Anon Key kết hợp RPC SECURITY DEFINER)
  const clientKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const dbClient = createClient(SUPABASE_URL, clientKey);

  const { sos_event_id } = req.body || {};
  if (!sos_event_id) {
    return res.status(400).json({ error: 'Missing required field: sos_event_id' });
  }

  try {
    // 2 & 3. ATOMIC CLAIM & AUTHORIZE CALLER (via SECURITY DEFINER RPC)
    const { data: claimResult, error: claimRpcError } = await dbClient.rpc('claim_sos_push_dispatch', {
      p_sos_event_id: sos_event_id,
      p_caller_id: user.id,
    });

    if (claimRpcError) {
      console.error('[Dispatcher] Lỗi gọi claim_sos_push_dispatch:', claimRpcError);
      return res.status(500).json({ error: 'Failed to claim dispatch: ' + claimRpcError.message });
    }

    if (!claimResult || !claimResult.success) {
      const isForbidden = claimResult?.error?.includes('Forbidden');
      const statusCode = isForbidden ? 403 : 404;
      return res.status(statusCode).json({ error: claimResult?.error || 'SOS event not found or unauthorized' });
    }

    // Nếu sự kiện đã từng được dispatch trước đó -> Bỏ qua tránh gửi trùng lặp
    if (!claimResult.claimed) {
      return res.status(200).json({
        success: true,
        status: 'already_dispatched',
        message: 'SOS push alert was already dispatched for this event',
        sos_event_id,
      });
    }

    const elderlyId = claimResult.elderly_id;
    const elderlyName = claimResult.elderly_name || 'Người thân';

    // 4 & 5. RESOLVE CAREGIVERS & SUBSCRIPTIONS (via SECURITY DEFINER RPC)
    const { data: subscriptions, error: rpcError } = await dbClient.rpc('get_caregiver_push_subscriptions', {
      p_elderly_id: elderlyId,
    });

    if (rpcError) {
      console.error('[Dispatcher] Lỗi lấy danh sách subscriptions:', rpcError);
      return res.status(500).json({ error: 'Failed to resolve subscriptions: ' + rpcError.message });
    }

    if (!subscriptions || subscriptions.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Caregivers found, but none have enabled Web Push notifications yet',
        dispatched_count: 0,
      });
    }

    // 6. DISPATCH VIA WEB-PUSH (Apple APNs / Google FCM)
    const payload = JSON.stringify({
      title: '🚨 SafeCheck - BÁO ĐỘNG SOS KHẨN CẤP!',
      body: `${elderlyName} vừa kích hoạt báo động cứu hộ! Nhấn để kiểm tra ngay.`,
      sos_event_id,
      url: `/?sos=${sos_event_id}`,
      timestamp: Date.now(),
    });

    const expiredEndpoints = [];
    const dispatchPromises = subscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, payload, {
          TTL: 60 * 60, // 1 giờ
          urgency: 'high',
        });
        return { success: true, endpoint: sub.endpoint };
      } catch (err) {
        // 7. HOUSEKEEPING: Thu thập các token đã hết hạn (404/410)
        if (err.statusCode === 404 || err.statusCode === 410) {
          expiredEndpoints.push(sub.endpoint);
        }
        return { success: false, endpoint: sub.endpoint, error: err.message, statusCode: err.statusCode };
      }
    });

    const results = await Promise.all(dispatchPromises);
    const successCount = results.filter((r) => r.success).length;

    // Xóa các subscription rác khỏi database nếu có
    if (expiredEndpoints.length > 0) {
      await dbClient.rpc('remove_expired_push_subscriptions', {
        p_endpoints: expiredEndpoints,
      }).catch((e) => console.warn('[Dispatcher] Lỗi xóa endpoint rác:', e));
    }

    // 8. PHẢN HỒI KẾT QUẢ
    return res.status(200).json({
      success: true,
      sos_event_id,
      dispatched_count: successCount,
      total_subscriptions: subscriptions.length,
      expired_removed: expiredEndpoints.length,
    });
  } catch (err) {
    console.error('[Dispatcher] Lỗi không mong đợi:', err);
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
}
