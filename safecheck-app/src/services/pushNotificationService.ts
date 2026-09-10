// ==============================================================================
// SafeCheck - pushNotificationService.ts
// Quản lý đăng ký Web Push Notifications & Kích hoạt cảnh báo khẩn cấp
// Tuân thủ: PRD_NotiSOS.md & implementation_plan.md
// ==============================================================================

import { supabase } from '../supabaseClient';

const VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY ||
  'BBub7j1uGoSi39dIjFnM43eQZRcIL_j8iRNt035Uy0zbAC5whyylXiKKdmzECaH8YMHpIdqLpvhUmgx94zNXlYk';

/**
 * Chuyển đổi chuỗi VAPID public key Base64 URL-safe sang Uint8Array
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Phát hiện nền tảng thiết bị
 */
function detectPlatform(): 'ios' | 'android' | 'desktop' | 'unknown' {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  if (/windows|macintosh|linux/.test(ua)) return 'desktop';
  return 'unknown';
}

export const pushNotificationService = {
  /**
   * Kiểm tra trình duyệt có hỗ trợ Service Worker và Push API không
   */
  isPushSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  },

  /**
   * Kiểm tra xem ứng dụng có đang chạy ở chế độ PWA (Add to Home Screen) không
   * (Đặc biệt quan trọng trên iOS Safari vì iOS chỉ hỗ trợ Push trên Standalone PWA)
   */
  isStandalonePWA(): boolean {
    if (typeof window === 'undefined') return false;
    const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches;
    const isIOSStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
    return isStandaloneMode || isIOSStandalone;
  },

  /**
   * Lấy trạng thái cấp quyền thông báo hiện tại ('default' | 'granted' | 'denied')
   */
  getPermissionState(): NotificationPermission {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'denied';
    }
    return Notification.permission;
  },

  /**
   * Kiểm tra thiết bị hiện tại đã đăng ký push subscription chưa
   */
  async checkIsSubscribed(): Promise<boolean> {
    if (!this.isPushSupported()) return false;
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      return subscription !== null;
    } catch (err) {
      console.error('[PushNotification] Lỗi kiểm tra subscription:', err);
      return false;
    }
  },

  /**
   * Đăng ký Web Push Notification (bắt buộc từ Explicit User Gesture)
   * User_id được lấy tự động từ authenticated Supabase session, không nhận từ tham số UI.
   */
  async subscribeToPush(): Promise<{ success: boolean; message: string; subscription?: PushSubscription }> {
    if (!this.isPushSupported()) {
      return { success: false, message: 'Trình duyệt không hỗ trợ Web Push Notifications.' };
    }

    try {
      // 1. Kiểm tra session xác thực
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        return { success: false, message: 'Vui lòng đăng nhập trước khi bật thông báo khẩn cấp.' };
      }

      // 2. Xin quyền Notification từ người dùng
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        return {
          success: false,
          message:
            permission === 'denied'
              ? 'Thông báo đã bị chặn. Vui lòng mở Cài đặt thiết bị để cho phép thông báo SafeCheck.'
              : 'Quyền thông báo chưa được cấp.',
        };
      }

      // 3. Đợi Service Worker sẵn sàng và đăng ký với PushManager
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey as unknown as BufferSource,
        });
      }

      // 4. Trích xuất keys mã hóa theo chuẩn RFC 8292
      const rawKey = subscription.getKey('p256dh');
      const rawAuth = subscription.getKey('auth');

      if (!rawKey || !rawAuth) {
        return { success: false, message: 'Không thể trích xuất khóa mã hóa từ trình duyệt.' };
      }

      const p256dh = btoa(String.fromCharCode(...new Uint8Array(rawKey)));
      const auth = btoa(String.fromCharCode(...new Uint8Array(rawAuth)));

      // 5. Lưu subscription vào database Supabase (upsert theo endpoint)
      const { error: dbError } = await supabase.from('push_subscriptions').upsert(
        {
          user_id: user.id,
          endpoint: subscription.endpoint,
          p256dh,
          auth,
          platform: detectPlatform(),
          user_agent: navigator.userAgent,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' }
      );

      if (dbError) {
        console.error('[PushNotification] Lỗi lưu push_subscriptions:', dbError);
        return { success: false, message: 'Lỗi lưu thông tin thiết bị: ' + dbError.message };
      }

      return { success: true, message: 'Đã bật nhận cảnh báo khẩn cấp thành công!', subscription };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[PushNotification] Lỗi quy trình subscribe:', err);
      return { success: false, message: 'Lỗi đăng ký thông báo: ' + errorMsg };
    }
  },

  /**
   * Hủy đăng ký nhận thông báo trên thiết bị hiện tại
   */
  async unsubscribeFromPush(): Promise<{ success: boolean; message: string }> {
    if (!this.isPushSupported()) return { success: true, message: 'Không hỗ trợ.' };

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Xóa khỏi database Supabase
        await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
        // Hủy subscription trên trình duyệt
        await subscription.unsubscribe();
      }

      return { success: true, message: 'Đã tắt nhận cảnh báo khẩn cấp.' };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, message: 'Lỗi khi tắt thông báo: ' + errorMsg };
    }
  },

  /**
   * Kích hoạt phát tán Push Notification tới các Con cháu thông qua Serverless Dispatcher
   * Client chỉ truyền sos_event_id, server tự xác thực caller và resolve recipients.
   */
  async sendEmergencyPush(sosEventId: string): Promise<{ success: boolean; message: string; details?: unknown }> {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        return { success: false, message: 'Không có phiên đăng nhập hợp lệ.' };
      }

      const response = await fetch('/api/send-push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ sos_event_id: sosEventId }),
      });

      let result: any = null;
      const text = await response.text();
      try {
        result = JSON.parse(text);
      } catch {
        result = { error: 'Server returned non-JSON response', body: text.substring(0, 100) };
      }

      if (!response.ok) {
        console.warn('[PushNotification] Dispatcher phản hồi lỗi:', result);
        return { success: false, message: result?.error || 'Lỗi gửi cảnh báo đẩy', details: result };
      }

      return { success: true, message: 'Đã gửi cảnh báo đẩy tới người thân!', details: result };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[PushNotification] Lỗi gọi /api/send-push:', err);
      return { success: false, message: 'Không thể kết nối đến máy chủ gửi push: ' + errorMsg };
    }
  },
};
