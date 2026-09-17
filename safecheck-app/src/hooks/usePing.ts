import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import type { SystemState } from '../types';
import type { UserProfile } from '../types';
import type { LinkedElderly } from './useFamilyLink';

export interface UsePingReturn {
  pingCooldown: number;
  isPingAllowed: boolean;
  /** Toast hiển thị khi Ping bị conflict (CONFLICT_PING_ALREADY_SENT). Độc lập với SOS conflict toast. */
  conflictToast: string | null;
  sendPing: () => Promise<void>;
}

/**
 * Hook quản lý Ping (chuông kiểm tra an toàn) từ Caregiver gửi cho Cụ.
 *
 * Trách nhiệm:
 * - isPingAllowed: ['Waiting', 'Late', 'Safe'].includes(systemState)
 * - sendPing(): request_ping_atomic → xử lý CONFLICT_PING_ALREADY_SENT → set cooldown
 * - Cooldown countdown: tester = 10s, thường = 15min
 * - conflictToast auto-clear sau 8s
 *
 * Ping_Requested sensory feedback (correction #5):
 * - Khi Elderly nhận được Ping (systemState === 'Ping_Requested'):
 *   → onPlayChime() (ding-dong ngay lập tức)
 *   → sau 700ms: onFeedback('Con cháu đang hỏi thăm...')
 * - Domain ownership rõ ràng: Ping state + Ping_Requested detection + Ping sound/voice = usePing.
 *   useSos không biết Ping_Requested tồn tại.
 *
 * KHÔNG xử lý: SOS, Check-in, Auth, Family linking.
 */
export function usePing(params: {
  systemState: SystemState;
  linkedElderly: LinkedElderly | null;
  userProfile: UserProfile | null;
  onFeedback: (message: string) => void;
  onPlayChime: () => void;
}): UsePingReturn {
  const { systemState, linkedElderly, userProfile, onFeedback, onPlayChime } = params;

  const [pingCooldown, setPingCooldown] = useState<number>(0);
  const [conflictToast, setConflictToast] = useState<string | null>(null);

  // ─── Ping_Requested → chime + delayed speech (correction #5) ─────────────

  useEffect(() => {
    if (systemState === 'Ping_Requested' && userProfile?.role === 'elderly') {
      onPlayChime();
      const timer = setTimeout(() => {
        onFeedback('Con cháu đang hỏi thăm, Cụ hãy chạm vào màn hình để con yên tâm nhé');
      }, 700);
      return () => clearTimeout(timer);
    }
  }, [systemState, userProfile?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Cooldown countdown ───────────────────────────────────────────────────

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (pingCooldown > 0) {
      interval = setInterval(() => setPingCooldown((prev) => prev - 1), 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [pingCooldown]);

  // ─── Derived ──────────────────────────────────────────────────────────────

  const isPingAllowed = ['Waiting', 'Late', 'Safe'].includes(systemState);

  // ─── sendPing ─────────────────────────────────────────────────────────────

  const sendPing = async (): Promise<void> => {
    const targetElderlyId = linkedElderly?.id;
    if (!isPingAllowed || pingCooldown > 0 || !targetElderlyId) return;

    const { data, error } = await supabase.rpc('request_ping_atomic', {
      p_elderly_id: targetElderlyId,
    });

    if (error) {
      console.error('[usePing] Lỗi request_ping_atomic:', error);
      alert(error.message || 'Không thể gửi chuông');
      return;
    }

    if (data?.error === 'CONFLICT_PING_ALREADY_SENT') {
      console.log('[usePing] Xung đột Ping:', data);
      setConflictToast(data.message || 'Chuông vừa được gửi bởi thành viên khác.');
      if (data.remaining_seconds) {
        setPingCooldown(data.remaining_seconds);
      }
      setTimeout(() => setConflictToast(null), 8000);
      return;
    }

    if (!data?.success) {
      alert(data?.message || 'Không thể gửi chuông');
      return;
    }

    const isTester = userProfile?.email?.toLowerCase() === 'test01@gmail.com';
    setPingCooldown(isTester ? 10 : 15 * 60);
    onFeedback('Đã phát chuông kiểm tra tới máy Cụ');
  };

  return { pingCooldown, isPingAllowed, conflictToast, sendPing };
}
