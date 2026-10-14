/**
 * ==============================================================================
 * SafeCheck - Safe Storage Adapter & Resilient Session Manager
 * Mục tiêu: 
 * 1. Đảm bảo phiên đăng nhập của Cụ tồn tại bền bỉ vĩnh cửu (Persistent Session).
 * 2. Chống crash trên Mobile / Edge / Safari khi Storage bị khóa hoặc quota đầy.
 * 3. Tự động phục hồi refresh token khi thiết bị bật mạng lại hoặc mở lại ứng dụng.
 * ==============================================================================
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// Bộ nhớ đệm in-memory dự phòng khi localStorage bị chặn
const memoryShadowStore = new Map<string, string>();

/**
 * Kiểm tra tính khả dụng thực tế của window.localStorage
 */
export function isLocalStorageAvailable(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return false;
    }
    const testKey = '__safecheck_storage_probe__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safe Storage Adapter đáp ứng chuẩn SupportedStorage của Supabase SDK
 */
export const safeStorageAdapter = {
  getItem(key: string): string | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const val = window.localStorage.getItem(key);
        if (val !== null) {
          // Đồng bộ vào shadow store
          memoryShadowStore.set(key, val);
          return val;
        }
      }
    } catch (err) {
      console.warn(`[SafeStorageAdapter] Không thể đọc key "${key}" từ localStorage, dùng memory fallback:`, err);
    }
    return memoryShadowStore.get(key) || null;
  },

  setItem(key: string, value: string): void {
    // Luôn ghi vào shadow store trước để đảm bảo không mất phiên
    memoryShadowStore.set(key, value);

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch (err) {
      console.warn(`[SafeStorageAdapter] Không thể ghi key "${key}" vào localStorage (quota hoặc bị chặn):`, err);
    }
  },

  removeItem(key: string): void {
    memoryShadowStore.delete(key);

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch (err) {
      console.warn(`[SafeStorageAdapter] Không thể xóa key "${key}" từ localStorage:`, err);
    }
  },

  /**
   * Phương thức hỗ trợ kiểm tra số lượng key đang lưu trữ an toàn
   */
  getDiagnostics() {
    return {
      storageAvailable: isLocalStorageAvailable(),
      memoryKeysCount: memoryShadowStore.size,
    };
  },
};

/**
 * Khởi tạo cơ chế tự động khôi phục và refresh token khi Mobile mở lại app hoặc có mạng
 */
export function initSessionLifecycle(supabase: SupabaseClient): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleOnline = () => {
    try {
      supabase.auth.startAutoRefresh();
    } catch (err) {
      console.warn('[SafeStorageAdapter] Lỗi auto-refresh khi online:', err);
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      try {
        supabase.auth.startAutoRefresh();
      } catch (err) {
        console.warn('[SafeStorageAdapter] Lỗi auto-refresh khi tab active:', err);
      }
    }
  };

  window.addEventListener('online', handleOnline);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Kích hoạt ngay lúc mount
  try {
    supabase.auth.startAutoRefresh();
  } catch {
    // Bỏ qua
  }

  return () => {
    window.removeEventListener('online', handleOnline);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    try {
      supabase.auth.stopAutoRefresh();
    } catch {
      // Bỏ qua
    }
  };
}
