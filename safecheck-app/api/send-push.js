// ==============================================================================
// SafeCheck - Vercel Serverless Function (/api/send-push)
// Dispatcher phát tán Web Push Notifications cho con cháu khi Cụ bà kích hoạt SOS
// Tuân thủ nghiêm ngặt 8 bước bảo mật trong PRD_NotiSOS.md & implementation_plan.md
// ==============================================================================

import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://bozuzbmgnzzxyrioxzaa.supabase.co';
// Khóa Service Role có quyền bypass RLS để truy vấn subscriptions và cập nhật push_dispatched_at
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
// Khóa Anon dùng để xác thực Bearer token của caller
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

  // Khởi tạo admin client (Service Role) để thực hiện các thao tác hạ tầng
  const adminKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const adminClient = createClient(SUPABASE_URL, adminKey);

  const { sos_event_id } = req.body || {};
  if (!sos_event_id) {
    return res.status(400).json({ error: 'Missing required field: sos_event_id' });
  }

  try {
    // 2. AUTHORIZE SOS OWNER
    const { data: sosEvent, error: eventError } = await adminClient
      .from('sos_events')
      .select('*')
      .eq('id', sos_event_id)
      .maybeSingle();

    if (eventError || !sosEvent) {
      return res.status(404).json({ error: 'SOS event not found' });
    }

    // Caller bắt buộc phải là Cụ bà sở hữu sự kiện HOẶC Con cháu đã liên kết (phục vụ test và báo động chéo)
    const isOwner = user.id === sosEvent.elderly_id;
    let isAuthorized = isOwner;
    if (!isOwner) {
      const { data: linkCheck } = await adminClient
        .from('family_links')
        .select('id')
        .eq('elderly_id', sosEvent.elderly_id)
        .eq('caregiver_id', user.id)
        .eq('status', 'accepted')
        .maybeSingle();
      if (linkCheck) isAuthorized = true;
    }

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Forbidden: Caller is not authorized for this SOS event' });
    }

    // 3. ATOMIC IDEMPOTENCY CLAIM
    // Sử dụng UPDATE có điều kiện push_dispatched_at IS NULL để khóa sự kiện nguyên tử
    const { data: claimedEvent, error: claimError } = await adminClient
      .from('sos_events')
      .update({
        push_dispatched_at: new Date().toISOString(),
        push_dispatched_count: (sosEvent.push_dispatched_count || 0) + 1,
      })
      .eq('id', sos_event_id)
      .is('push_dispatched_at', null)
      .select('*')
      .maybeSingle();

    if (claimError) {
      console.error('[Dispatcher] Lỗi cập nhật idempotency:', claimError);
      return res.status(500).json({ error: 'Failed to claim dispatch idempotency: ' + claimError.message });
    }

    // Nếu không cập nhật được dòng nào -> Sự kiện này đã được dispatch trước đó!
    if (!claimedEvent) {
      return res.status(200).json({
        success: true,
        status: 'already_dispatched',
        message: 'SOS push alert was already dispatched for this event',
        sos_event_id,
      });
    }

    // 4 & 5. RESOLVE CAREGIVERS & SUBSCRIPTIONS
    // Ưu tiên 1: Gọi RPC get_caregiver_push_subscriptions (bypasses RLS an toàn bằng SECURITY DEFINER)
    let subscriptions = [];
    const { data: rpcSubs, error: rpcError } = await adminClient.rpc('get_caregiver_push_subscriptions', {
      p_elderly_id: sosEvent.elderly_id,
    });

    if (!rpcError && Array.isArray(rpcSubs) && rpcSubs.length > 0) {
      subscriptions = rpcSubs;
    } else {
      // Ưu tiên 2 (Fallback): Truy vấn trực tiếp qua bảng nếu có service_role
      const { data: links } = await adminClient
        .from('family_links')
        .select('caregiver_id')
        .eq('elderly_id', sosEvent.elderly_id)
        .eq('status', 'accepted');

      if (links && links.length > 0) {
        const caregiverIds = links.map((l) => l.caregiver_id);
        const { data: directSubs } = await adminClient
          .from('push_subscriptions')
          .select('*')
          .in('user_id', caregiverIds);
        if (directSubs) subscriptions = directSubs;
      }
    }

    if (!subscriptions || subscriptions.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Caregivers found, but none have enabled Web Push notifications yet',
        dispatched_count: 0,
      });
    }

    // Lấy tên thân thiện của Cụ bà
    const { data: profile } = await adminClient
      .from('profiles')
      .select('full_name')
      .eq('id', sosEvent.elderly_id)
      .maybeSingle();

    const elderlyName = profile?.full_name || 'Người thân';

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
      await adminClient.from('push_subscriptions').delete().in('endpoint', expiredEndpoints);
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
