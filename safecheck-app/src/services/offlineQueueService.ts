// ==============================================================================
// SafeCheck - offlineQueueService.ts
// Quản lý hàng đợi ngoại tuyến SOS trong IndexedDB, phục hồi mạng & Idempotent Sync
// Tuân thủ: PRD_Deep_v1.md (v3.0) & implementation_plan.md
// ==============================================================================

import { supabase } from '../supabaseClient';
import type { OfflineSOSEvent } from '../types';

const DB_NAME = 'safecheck_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'offline_sos_queue';

/**
 * Mở hoặc khởi tạo cơ sở dữ liệu IndexedDB
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      return reject(new Error('IndexedDB không được hỗ trợ trên môi trường này'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'client_event_id' });
        store.createIndex('db_status', 'db_status', { unique: false });
        store.createIndex('created_at', 'created_at', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const offlineQueueService = {
  /**
   * Lưu một yêu cầu SOS mới vào hàng đợi IndexedDB cục bộ
   */
  async enqueueOfflineSOS(
    elderlyId: string,
    triggerSource: 'button' | 'timeout' = 'button',
    accessToken?: string
  ): Promise<OfflineSOSEvent> {
    const db = await openDB();

    // Nếu không truyền accessToken, thử lấy từ phiên Supabase hiện tại
    let token = accessToken;
    if (!token) {
      try {
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token;
      } catch {
        // bỏ qua nếu lỗi
      }
    }

    const event: OfflineSOSEvent = {
      client_event_id: crypto.randomUUID(),
      elderly_id: elderlyId,
      trigger_source: triggerSource,
      created_at: Date.now(),
      access_token: token,
      db_status: 'PENDING',
      push_status: 'NOT_REQUESTED',
      push_attempt_count: 0,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(event);

      req.onsuccess = () => resolve(event);
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Lấy danh sách các bản ghi SOS chưa hoàn thành đồng bộ
   */
  async getPendingOfflineSOS(): Promise<OfflineSOSEvent[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const list: OfflineSOSEvent[] = req.result || [];
        // Lấy các bản ghi chưa hoàn tất cả DB và Push, và không phải FAILED_PERMANENTLY
        const pending = list.filter(
          (item) =>
            item.db_status !== 'FAILED_PERMANENTLY' &&
            (item.db_status !== 'SERVER_ACKED' || item.push_status !== 'DISPATCHED')
        );
        resolve(pending);
      };
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Lấy toàn bộ bản ghi trong hàng đợi
   */
  async getAllOfflineSOS(): Promise<OfflineSOSEvent[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Cập nhật một bản ghi trong IndexedDB
   */
  async updateOfflineSOS(event: OfflineSOSEvent): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(event);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Đánh dấu bản ghi đã nhận SERVER_ACK từ database
   */
  async markServerAck(clientEventId: string, sosEventId: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(clientEventId);

      getReq.onsuccess = () => {
        const item: OfflineSOSEvent | undefined = getReq.result;
        if (!item) return resolve();

        item.db_status = 'SERVER_ACKED';
        item.server_ack_at = Date.now();
        item.sos_event_id = sosEventId;
        if (item.push_status === 'NOT_REQUESTED') {
          item.push_status = 'DISPATCH_PENDING';
        }

        const putReq = store.put(item);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  },

  /**
   * Đánh dấu Web Push đã được phát tán thành công
   */
  async markPushDispatched(clientEventId: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(clientEventId);

      getReq.onsuccess = () => {
        const item: OfflineSOSEvent | undefined = getReq.result;
        if (!item) return resolve();

        item.push_status = 'DISPATCHED';
        // SECURITY LIFECYCLE: Thu hồi/xóa access_token khỏi IndexedDB ngay khi hoàn thành push
        delete item.access_token;

        const putReq = store.put(item);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  },

  /**
   * Đánh dấu lỗi vĩnh viễn (400, 403) dừng retry
   */
  async markPermanentFailure(clientEventId: string, errorMessage: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(clientEventId);

      getReq.onsuccess = () => {
        const item: OfflineSOSEvent | undefined = getReq.result;
        if (!item) return resolve();

        item.db_status = 'FAILED_PERMANENTLY';
        item.error_message = errorMessage;
        // Xóa access_token khi gặp lỗi vĩnh viễn
        delete item.access_token;

        const putReq = store.put(item);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  },

  /**
   * Đăng ký Service Worker Background Sync (nếu nền tảng hỗ trợ SyncManager)
   */
  async registerBackgroundSync(): Promise<boolean> {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        if ('sync' in reg && typeof (reg as any).sync?.register === 'function') {
          await (reg as any).sync.register('sync-sos-event');
          return true;
        }
      } catch (err) {
        console.warn('[OfflineQueue] Không thể đăng ký Background Sync:', err);
      }
    }
    return false;
  },

  /**
   * Xử lý gửi bù toàn bộ hàng đợi khi có kết nối mạng (Flush Queue)
   */
  async flushOfflineQueue(): Promise<{ processed: number; succeeded: number; failed: number }> {
    let items: OfflineSOSEvent[] = [];
    try {
      items = await this.getPendingOfflineSOS();
    } catch (e) {
      console.warn('[OfflineQueue] Không thể đọc IndexedDB để flush:', e);
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    if (items.length === 0) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    let succeeded = 0;
    let failed = 0;

    for (const item of items) {
      try {
        let sosEventId = item.sos_event_id;

        // -------------------------------------------------------------
        // PHA 1: ĐỒNG BỘ CƠ SỞ DỮ LIỆU (IDEMPOTENT RPC)
        // -------------------------------------------------------------
        if (item.db_status !== 'SERVER_ACKED') {
          item.db_status = 'SYNCING';
          await this.updateOfflineSOS(item);

          const { data, error } = await supabase.rpc('create_sos_event_idempotent', {
            p_elderly_id: item.elderly_id,
            p_client_event_id: item.client_event_id,
            p_trigger_source: item.trigger_source,
          });

          if (error) {
            console.error('[OfflineQueue] Lỗi gọi create_sos_event_idempotent:', error);
            const status = (error as any).status || 500;
            if (status === 400 || status === 403 || error.code === '42501') {
              await this.markPermanentFailure(item.client_event_id, error.message);
              failed++;
              continue;
            }
            // Lỗi mạng hoặc 5xx: giữ PENDING để retry lần sau
            item.db_status = 'PENDING';
            item.last_attempt_at = Date.now();
            item.error_message = error.message;
            await this.updateOfflineSOS(item);
            failed++;
            continue;
          }

          // Thành công: nhận được SERVER_ACK (kể cả is_duplicate = true)
          sosEventId = data?.sos_event_id;
          if (sosEventId) {
            await this.markServerAck(item.client_event_id, sosEventId);
            item.db_status = 'SERVER_ACKED';
            item.sos_event_id = sosEventId;
            item.push_status = 'DISPATCH_PENDING';
          }
        }

        // -------------------------------------------------------------
        // PHA 2: PHÁT TÁN WEB PUSH (KỂ CẢ KHI RETRY DUPLICATE)
        // -------------------------------------------------------------
        if (item.db_status === 'SERVER_ACKED' && item.push_status !== 'DISPATCHED' && sosEventId) {
          item.push_attempt_count = (item.push_attempt_count || 0) + 1;
          item.last_attempt_at = Date.now();

          // Lấy token xác thực
          let token = item.access_token;
          if (!token) {
            const { data: sessionData } = await supabase.auth.getSession();
            token = sessionData.session?.access_token;
          }

          if (token) {
            const pushRes = await fetch('/api/send-push', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ sos_event_id: sosEventId }),
            });

            if (pushRes.ok) {
              await this.markPushDispatched(item.client_event_id);
              succeeded++;
            } else {
              console.warn('[OfflineQueue] Gửi Web Push thất bại:', pushRes.status);
              item.push_status = 'FAILED';
              await this.updateOfflineSOS(item);
              // DB đã sync thành công thì vẫn tính là thành công pha cốt lõi
              succeeded++;
            }
          } else {
            // Không có token nhưng DB đã lưu
            succeeded++;
          }
        } else if (item.db_status === 'SERVER_ACKED') {
          succeeded++;
        }
      } catch (err: unknown) {
        console.error('[OfflineQueue] Ngoại lệ khi flush item:', err);
        failed++;
      }
    }

    return { processed: items.length, succeeded, failed };
  },
};

if (typeof window !== 'undefined') {
  (window as any).offlineQueueService = offlineQueueService;
}
