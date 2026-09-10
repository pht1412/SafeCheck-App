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
