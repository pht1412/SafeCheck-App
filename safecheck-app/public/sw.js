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

// 1. LẮNG NGHE SỰ KIỆN PUSH TỪ MÁY CHỦ APNs / FCM
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { body: event.data.text() };
    }
  }

  const sosEventId = data.sos_event_id || '';
  const title = data.title || '🚨 SafeCheck - CẢNH BÁO SOS KHẨN CẤP!';
  const targetUrl = data.url || (sosEventId ? `/?sos=${sosEventId}` : '/');

  const options = {
    body: data.body || 'Người thân vừa kích hoạt báo động cứu hộ! Nhấn để kiểm tra ngay.',
    icon: '/apple-touch-icon.png',
    badge: '/icon-192.png',
    tag: `safecheck-sos-${sosEventId || 'general'}`,
    renotify: true,
    vibrate: [500, 200, 500, 200, 500, 200, 1000],
    data: {
      sos_event_id: sosEventId,
      url: targetUrl,
      timestamp: data.timestamp || Date.now(),
    },
  };

  event.waitUntil(
    self.registration.showNotification(title, options).catch((err) => {
      console.warn('[SW] showNotification lỗi, dùng fallback tối giản:', err);
      return self.registration.showNotification(title, {
        body: options.body,
        icon: '/apple-touch-icon.png',
      });
    })
  );
});

// 2. LẮNG NGHE THAO TÁC CHẠM VÀO THÔNG BÁO (NOTIFICATION CLICK)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Nếu đã có tab/cửa sổ SafeCheck đang mở, focus vào và điều hướng
        for (const client of clientList) {
          if ('focus' in client) {
            client.focus();
            if ('navigate' in client && targetUrl) {
              return client.navigate(targetUrl);
            }
            return client;
          }
        }
        // Nếu chưa có cửa sổ nào đang mở, mở cửa sổ mới
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
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
