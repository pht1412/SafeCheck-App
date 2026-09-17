import { useEffect } from 'react';
import { offlineQueueService } from '../services/offlineQueueService';

export interface UseOfflineSyncOptions {
  /**
   * Gọi sau khi flushOfflineQueue() thành công với số lượng item đã sync.
   * Domain hook (useSos) quyết định callback này có ý nghĩa gì.
   *
   * Architecture note (correction #4):
   * useOfflineSync KHÔNG biết về SOS, Ping, hay Check-in.
   * useSos expose handleOfflineFlushSucceeded, ElderlyApp wires nó vào đây.
   *
   * Flow:
   *   useOfflineSync → gọi onFlushSucceeded(count)
   *   useSos.handleOfflineFlushSucceeded → setHasServerAck(true) nếu cần
   */
  onFlushSucceeded?: (count: number) => void;
}

/**
 * Infrastructure hook — flush offline SOS queue khi mạng phục hồi.
 *
 * Trách nhiệm:
 * - Đăng ký window.addEventListener('online', handler) on mount
 * - Gọi offlineQueueService.flushOfflineQueue() khi online
 * - Gọi onFlushSucceeded(count) nếu có item được sync thành công
 * - Cleanup listener on unmount
 *
 * KHÔNG biết SOS là gì. KHÔNG import useSos. Pure infrastructure.
 */
export function useOfflineSync(options?: UseOfflineSyncOptions): void {
  const { onFlushSucceeded } = options ?? {};

  useEffect(() => {
    const handleOnline = async () => {
      console.log('[useOfflineSync] Mạng Internet phục hồi → Kích hoạt flushOfflineQueue()');
      const res = await offlineQueueService.flushOfflineQueue();
      if (res.succeeded > 0) {
        onFlushSucceeded?.(res.succeeded);
      }
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [onFlushSucceeded]);
}
