// ==============================================================================
// SafeCheck - Service Worker (sw.js)
// Xử lý thông báo đẩy khẩn cấp (Web Push API) & Điều hướng 1 chạm
// Tuân thủ: PRD_NotiSOS.md & implementation_plan.md
// ==============================================================================

self.addEventListener('install', (event) => {
  // Kích hoạt ngay service worker mới mà không cần chờ tab cũ đóng
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Giành quyền điều khiển tất cả các client tab hiện tại ngay lập tức
  event.waitUntil(self.clients.claim());
});

// 1. LẮNG NGHE SỰ KIỆN PUSH TỪ MÁY CHỦ APNs / FCM (ZERO-NETWORK & ZERO-PHANTOM-SOS)
self.addEventListener('push', (event) => {
  // 1.1. Kiểm tra sự tồn tại của payload
  if (!event.data) {
    console.warn('[SW-Push] Bỏ qua push event không có payload (Chống Phantom SOS)');
    return;
  }

  // 1.2. Giải mã JSON payload
  let data;
  try {
    data = event.data.json();
  } catch (e) {
    console.warn('[SW-Push] Bỏ qua push event có payload JSON hỏng (Chống Phantom SOS):', e);
    return;
  }

  // 1.3. Thẩm định định danh sự kiện SOS bắt buộc
  const sosEventId = (data.sos_event_id || '').trim();
  const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sosEventId);

  if (!sosEventId || !isValidUuid) {
    console.warn('[SW-Push] Bỏ qua push event thiếu sos_event_id hợp lệ (Chống Phantom SOS):', data);
    return;
  }

  // 1.4. Phân loại lượt gửi ban đầu vs lượt retry
  const isRetry = Boolean(data.is_retry);
  const isUpdate = Boolean(data.is_update);
  const elderlyName = (data.elderly_name || '').trim() || 'Người thân';

  const title = isUpdate
    ? `ℹ️ SafeCheck - Cập nhật trạng thái: ${elderlyName}`
    : `🚨 SafeCheck - BÁO ĐỘNG SOS: ${elderlyName}`;

  const body = data.body || `${elderlyName} vừa kích hoạt cảnh báo cứu hộ! Nhấn để kiểm tra ngay.`;
  const targetUrl = `/?sos=${encodeURIComponent(sosEventId)}`;

  // 1.5. Cấu hình Notification Options chuẩn W3C
  const options = {
    body,
    icon: '/apple-touch-icon.png',
    badge: '/icon-192.png',
    tag: `safecheck-sos-${sosEventId}`, // Tag ổn định để gom cụm và cập nhật theo từng ca SOS
    // Nếu là đợt retry (gửi bù), yêu cầu renotify = false để không reo chuông/rung lại trên các OS hỗ trợ
    renotify: isUpdate ? false : !isRetry,
    requireInteraction: true,
    vibrate: [500, 200, 500, 200, 500, 200, 1000],
    data: {
      sos_event_id: sosEventId,
      url: targetUrl,
      timestamp: data.timestamp || Date.now(),
      attempt_count: data.attempt_count || 1,
      is_retry: isRetry,
      schema_version: data.schema_version || 1,
    },
  };

  // 1.6. Chuỗi thực thi tuần tự Two-Way Delivery Handshake chuẩn PRD v3.2:
  // CHỈ KHI showNotification hiển thị thành công mới gọi hàm phụ trợ gửi Delivery ACK!
  const processPushEvent = async () => {
    try {
      await self.registration.showNotification(title, options);

      const subscriptionId = data.subscription_id;
      const deliveryToken = data.delivery_token;
      if (sosEventId && subscriptionId) {
        await sendDeliveryAckToServer(sosEventId, subscriptionId, data.schema_version, deliveryToken);
      }
    } catch (notifErr) {
      console.warn('[SW-Push] showNotification gặp lỗi từ chối:', notifErr);
      // TUYỆT ĐỐI KHÔNG gửi ACK giả nếu notification hiển thị thất bại!
    }
  };

  event.waitUntil(processPushEvent());
});

// Hàm phụ trợ gửi Delivery ACK ngầm ngoài Push Event Handler (Bảo toàn Zero-Network Display)
async function sendDeliveryAckToServer(sosEventId, subscriptionId, schemaVersion, deliveryToken) {
  if (typeof fetch === 'undefined') return;
  try {
    await fetch('/api/push-ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        sos_event_id: sosEventId,
        subscription_id: subscriptionId,
        delivery_token: deliveryToken || null,
        client_displayed_at: Date.now(),
        schema_version: schemaVersion || 1,
      }),
    });
  } catch (ackErr) {
    console.warn('[SW-Push] Gửi Delivery ACK ngầm thất bại (mạng chập chờn):', ackErr);
  }
}

// 2. LẮNG NGHE THAO TÁC CHẠM VÀO THÔNG BÁO (NOTIFICATION CLICK & SAFE DEEP-LINK)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawUrl = event.notification.data?.url || '/';
  let targetPath = '/';

  // Thẩm định an toàn origin của URL
  try {
    const parsed = new URL(rawUrl, self.location.origin);
    if (parsed.origin === self.location.origin) {
      targetPath = parsed.pathname + parsed.search + parsed.hash;
    }
  } catch (e) {
    targetPath = '/';
  }

  const fullTargetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Nếu đã có tab/cửa sổ SafeCheck đang mở, focus vào và điều hướng
        for (const client of clientList) {
          if ('focus' in client) {
            client.focus();
            if ('navigate' in client && targetPath !== '/') {
              return client.navigate(fullTargetUrl);
            }
            return client;
          }
        }
        // Nếu chưa có cửa sổ nào đang mở, mở cửa sổ mới
        if (self.clients.openWindow) {
          return self.clients.openWindow(fullTargetUrl);
        }
      })
      .catch((err) => {
        console.warn('[SW-Click] Lỗi điều hướng notificationclick:', err);
      })
  );
});

// ==============================================================================
// 3. LẮNG NGHE SỰ KIỆN BACKGROUND SYNC (W3C SYNC API)
// Tự động gửi bù tín hiệu SOS khi thiết bị bắt lại kết nối Internet
// Tuân thủ: PRD_Deep_v1.md (v3.0) & implementation_plan.md
// ==============================================================================
const SW_SUPABASE_URL = 'https://bozuzbmgnzzxyrioxzaa.supabase.co';
const SW_SUPABASE_ANON_KEY = 'sb_publishable_ZQjFvvLTLywvw4rKJIPU9Q_5iR_78Rr';
const SW_DB_NAME = 'safecheck_offline_db';
const SW_STORE_NAME = 'offline_sos_queue';

function swOpenDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) return reject(new Error('IndexedDB không tồn tại trong SW'));
    const req = indexedDB.open(SW_DB_NAME, 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function flushPendingOfflineSOSFromSW() {
  let db;
  try {
    db = await swOpenDB();
  } catch (err) {
    console.warn('[SW-Sync] Không thể mở IndexedDB:', err);
    return;
  }

  const items = await new Promise((resolve) => {
    const tx = db.transaction(SW_STORE_NAME, 'readonly');
    const store = tx.objectStore(SW_STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });

  const pending = items.filter(
    (item) =>
      item.db_status !== 'FAILED_PERMANENTLY' &&
      (item.db_status !== 'SERVER_ACKED' || item.push_status !== 'DISPATCHED')
  );

  for (const item of pending) {
    try {
      let sosEventId = item.sos_event_id;

      // Pha 1: Đồng bộ Database nếu chưa nhận SERVER_ACK
      if (item.db_status !== 'SERVER_ACKED' && item.access_token) {
        const rpcRes = await fetch(`${SW_SUPABASE_URL}/rest/v1/rpc/create_sos_event_idempotent`, {
          method: 'POST',
          headers: {
            apikey: SW_SUPABASE_ANON_KEY,
            Authorization: `Bearer ${item.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            p_elderly_id: item.elderly_id,
            p_client_event_id: item.client_event_id,
            p_trigger_source: item.trigger_source,
          }),
        });

        if (rpcRes.ok) {
          const rpcData = await rpcRes.json();
          sosEventId = rpcData?.sos_event_id;
          item.db_status = 'SERVER_ACKED';
          item.server_ack_at = Date.now();
          item.sos_event_id = sosEventId;
          item.push_status = 'DISPATCH_PENDING';
        } else if (rpcRes.status === 400 || rpcRes.status === 403) {
          item.db_status = 'FAILED_PERMANENTLY';
        }
      }

      // Pha 2: Gửi Web Push nếu đã nhận SERVER_ACK và chưa dispatch
      if (item.db_status === 'SERVER_ACKED' && item.push_status !== 'DISPATCHED' && sosEventId && item.access_token) {
        const pushRes = await fetch('/api/send-push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${item.access_token}`,
          },
          body: JSON.stringify({ sos_event_id: sosEventId }),
        });

        if (pushRes.ok) {
          item.push_status = 'DISPATCHED';
        } else {
          item.push_status = 'FAILED';
        }
      }

      // Cập nhật lại vào IndexedDB
      await new Promise((resolve) => {
        const tx = db.transaction(SW_STORE_NAME, 'readwrite');
        const store = tx.objectStore(SW_STORE_NAME);
        const req = store.put(item);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    } catch (e) {
      console.warn('[SW-Sync] Lỗi xử lý item:', e);
    }
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-sos-event') {
    event.waitUntil(flushPendingOfflineSOSFromSW());
  }
});
