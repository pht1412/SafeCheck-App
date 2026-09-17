import { useState, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { supabase } from '../supabaseClient';
import { SirenPlayer } from '../utils/sirenPlayer';
import { offlineQueueService } from '../services/offlineQueueService';
import type { SystemState } from '../types';
import type { UserProfile } from '../types';
import type { LinkedElderly } from './useFamilyLink';

export interface UseSosReturn {
  sosHolding: boolean;
  sosCountdown: number | null;
  isSirenMuted: boolean;
  activeSosEventId: string | null;
  showCellularFallback: boolean;
  startSosHold: () => void;
  cancelSosHold: () => void;
  abortSosCountdown: () => void;
  resolveAlarm: () => Promise<void>;
  toggleMuteSiren: () => void;
  /**
   * Callback để useOfflineSync gọi khi flush thành công.
   * useSos quyết định ý nghĩa: nếu Emergency + flush > 0 → setHasServerAck(true).
   *
   * Architecture (correction #4):
   * ElderlyApp wires: useOfflineSync({ onFlushSucceeded: sos.handleOfflineFlushSucceeded })
   * useOfflineSync không biết SOS là gì — chỉ gọi callback khi cần.
   */
  handleOfflineFlushSucceeded: (count: number) => void;
  /** Exposed để CaregiverApp có thể set isSirenMuted khi cần từ UI */
  conflictToast: string | null;
}

/**
 * Hook quản lý toàn bộ vòng đời SOS.
 *
 * Trách nhiệm:
 * - SOS deep-link (?sos=<id> từ Push Notification)
 * - SOS hold 3s → countdown 10s → trigger Emergency
 * - Siren lifecycle (SirenPlayer start/stop theo state)
 * - Auto-find activeSosEventId khi Emergency
 * - Cellular Fallback (10s không có server ACK)
 * - resolveAlarm() với full post-resolution state transition
 * - handleOfflineFlushSucceeded (callback cho useOfflineSync)
 *
 * KHÔNG xử lý: Ping_Requested sensory (thuộc usePing — correction #5)
 * KHÔNG biết: Check-in logic, Family linking, Auth
 * SOS RPC signature: KHÔNG tự đổi trong refactor này
 */
export function useSos(params: {
  userProfile: UserProfile | null;
  systemState: SystemState;
  setSystemState: Dispatch<SetStateAction<SystemState>>;
  activeFamilyCode: string | null;
  linkedElderly: LinkedElderly | null;
  onFeedback: (message: string) => void;
}): UseSosReturn {
  const { userProfile, systemState, setSystemState, activeFamilyCode, linkedElderly, onFeedback } =
    params;

  const [sosHolding, setSosHolding] = useState<boolean>(false);
  const [sosCountdown, setSosCountdown] = useState<number | null>(null);
  const [isSirenMuted, setIsSirenMuted] = useState<boolean>(false);
  const [activeSosEventId, setActiveSosEventId] = useState<string | null>(null);
  const [sosStartTime, setSosStartTime] = useState<number | null>(null);
  const [hasServerAck, setHasServerAck] = useState<boolean>(false);
  const [now, setNow] = useState<number>(() => Date.now()); // lazy initializer — avoids calling Date.now during render
  const [conflictToast, setConflictToast] = useState<string | null>(null);

  const sosHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sosCountdownIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sirenRef = useRef<SirenPlayer | null>(null);

  // ─── A. SOS Deep-link từ Web Push Notification (?sos=<id>) ────────────────

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const sosId = urlParams.get('sos');
    if (sosId) {
      supabase
        .from('sos_events')
        .select('*')
        .eq('id', sosId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!error && data && data.status === 'active') {
            console.log('[useSos] Deep-link: Kích hoạt Emergency từ URL SOS ID:', sosId);
            setSystemState('Emergency');
            setIsSirenMuted(false);
          }
        });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── B. Siren lifecycle ───────────────────────────────────────────────────

  useEffect(() => {
    if (!sirenRef.current) {
      sirenRef.current = new SirenPlayer();
    }
    if (
      systemState === 'Emergency' &&
      !isSirenMuted &&
      userProfile?.role === 'caregiver' &&
      linkedElderly
    ) {
      sirenRef.current.start();
    } else {
      sirenRef.current.stop();
    }
    return () => {
      sirenRef.current?.stop();
    };
  }, [systemState, isSirenMuted, userProfile, linkedElderly]);

  // ─── C. Auto-find activeSosEventId khi Emergency ─────────────────────────

  useEffect(() => {
    const targetElderlyId =
      userProfile?.role === 'caregiver' ? linkedElderly?.id : userProfile?.id;

    if (systemState === 'Emergency' && targetElderlyId) {
      supabase
        .from('sos_events')
        .select('id, created_at')
        .eq('elderly_id', targetElderlyId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            setActiveSosEventId(data.id);
            if (!sosStartTime) {
              setSosStartTime(new Date(data.created_at).getTime());
            }
          }
        });
    } else if (systemState !== 'Emergency') {
      /* eslint-disable react-hooks/set-state-in-effect */
      setActiveSosEventId(null);
      setSosStartTime(null);
      setHasServerAck(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [systemState, linkedElderly, userProfile]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── D. `now` ticker + showCellularFallback ───────────────────────────────

  useEffect(() => {
    if (systemState !== 'Emergency' || hasServerAck) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    const handleVis = () => setNow(Date.now());
    window.addEventListener('visibilitychange', handleVis);
    return () => {
      clearInterval(interval);
      window.removeEventListener('visibilitychange', handleVis);
    };
  }, [systemState, hasServerAck]);

  const showCellularFallback =
    systemState === 'Emergency' &&
    !hasServerAck &&
    sosStartTime !== null &&
    now - sosStartTime >= 10000;

  // ─── E. SOS Countdown state machine (10s → 0 → trigger Emergency) ─────────

  useEffect(() => {
    if (sosCountdown !== null && sosCountdown > 0) {
      sosCountdownIntervalRef.current = setTimeout(() => {
        setSosCountdown(sosCountdown - 1);
      }, 1000);
    } else if (sosCountdown === 0) {
      // Hết 10s mà Cụ không hủy → Kích hoạt Emergency
      /* eslint-disable react-hooks/set-state-in-effect */
      setSystemState('Emergency');
      setSosCountdown(null);
      setIsSirenMuted(false);
      setSosStartTime(Date.now());
      setHasServerAck(false);
      /* eslint-enable react-hooks/set-state-in-effect */
      onFeedback('Báo động khẩn cấp đã được gửi tới người thân');

      // Gửi SOS lên server + IndexedDB dự phòng offline
      if (userProfile?.id && userProfile.role === 'elderly') {
        const elderlyId = userProfile.id;

        supabase.auth.getSession().then(async ({ data: sessionData }) => {
          const token = sessionData?.session?.access_token;
          await offlineQueueService.enqueueOfflineSOS(elderlyId, 'button', token);

          if (!navigator.onLine) {
            console.log('[useSos] Offline: Đã lưu SOS vào IndexedDB, đăng ký Background Sync');
            await offlineQueueService.registerBackgroundSync();
          } else {
            console.log('[useSos] Online: Tiến hành đồng bộ ngay lập tức');
            const syncRes = await offlineQueueService.flushOfflineQueue();
            if (syncRes.succeeded > 0) {
              setHasServerAck(true);
            }
          }
        });
      }

      // Trigger Realtime update cho family room
      if (activeFamilyCode) {
        supabase.rpc('trigger_sos', { p_family_code: activeFamilyCode }).then(({ error }) => {
          if (error) console.error('[useSos] Lỗi trigger_sos:', error);
        });
      }
    }

    return () => {
      if (sosCountdownIntervalRef.current) clearTimeout(sosCountdownIntervalRef.current);
    };
  }, [sosCountdown, activeFamilyCode, userProfile]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── F. SOS Hold controls ─────────────────────────────────────────────────

  const startSosHold = () => {
    if (sosCountdown !== null) return;
    setSosHolding(true);
    sosHoldTimerRef.current = setTimeout(() => {
      setSosHolding(false);
      setSosCountdown(10);
      onFeedback('Đang chuẩn bị gửi báo động. Bạn có 10 giây để bấm hủy nếu chạm nhầm');
    }, 3000);
  };

  const cancelSosHold = () => {
    setSosHolding(false);
    if (sosHoldTimerRef.current) clearTimeout(sosHoldTimerRef.current);
  };

  const abortSosCountdown = () => {
    setSosCountdown(null);
    if (sosCountdownIntervalRef.current) clearTimeout(sosCountdownIntervalRef.current);
    onFeedback('Đã hủy báo động');
  };

  // ─── G. resolveAlarm — full post-resolution state transition ─────────────
  // (correction #6: giữ nguyên TOÀN BỘ state transition từ App.tsx lines 621–673)

  const resolveAlarm = async (): Promise<void> => {
    const targetElderlyId =
      userProfile?.role === 'caregiver' ? linkedElderly?.id : userProfile?.id;
    if (!targetElderlyId) return;

    // Fallback tìm sos_event_id nếu chưa có trong state
    let sosIdToResolve = activeSosEventId;
    if (!sosIdToResolve) {
      const { data: latestEvent } = await supabase
        .from('sos_events')
        .select('id')
        .eq('elderly_id', targetElderlyId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      sosIdToResolve = latestEvent?.id || null;
    }

    if (!sosIdToResolve) {
      console.warn('[useSos] Không có active sos_event_id để resolve — fallback reset');
      // Fallback: reset UI state về Safe dù không có event
      setSystemState('Safe');
      setIsSirenMuted(false);
      return;
    }

    const { data, error } = await supabase.rpc('resolve_alarm_atomic', {
      p_elderly_id: targetElderlyId,
      p_sos_event_id: sosIdToResolve,
      p_note:
        userProfile?.role === 'caregiver'
          ? 'Xác nhận an toàn từ Con cháu'
          : 'Cụ xác nhận an toàn tại chỗ',
    });

    if (error) {
      console.error('[useSos] Lỗi resolve_alarm_atomic:', error);
      // Error path: vẫn reset UI (siren stops via state transition)
      setSystemState('Safe');
      setIsSirenMuted(false);
      return;
    }

    if (data?.error === 'CONFLICT_ALREADY_RESOLVED') {
      console.log('[useSos] Conflict: Báo động đã được giải quyết bởi thành viên khác:', data);
      // Conflict path: full state reset + conflict toast
      setConflictToast(data.message || 'Báo động này đã được xử lý bởi thành viên khác.');
      setSystemState('Safe');
      setIsSirenMuted(false);
      setActiveSosEventId(null);
      setTimeout(() => setConflictToast(null), 8000);
      return;
    }

    // Success path: full state reset
    // Siren tự dừng vì systemState → 'Safe' → siren effect sẽ gọi stop()
    setSystemState('Safe');
    setIsSirenMuted(false);
    setActiveSosEventId(null);
    onFeedback('Đã tắt báo động, xác nhận an toàn');
  };

  // ─── H. handleOfflineFlushSucceeded (callback từ useOfflineSync) ──────────

  const handleOfflineFlushSucceeded = (count: number): void => {
    if (count > 0 && systemState === 'Emergency') {
      setHasServerAck(true);
    }
  };

  // ─── I. toggleMuteSiren ───────────────────────────────────────────────────

  const toggleMuteSiren = () => setIsSirenMuted((prev) => !prev);

  return {
    sosHolding,
    sosCountdown,
    isSirenMuted,
    activeSosEventId,
    showCellularFallback,
    startSosHold,
    cancelSosHold,
    abortSosCountdown,
    resolveAlarm,
    toggleMuteSiren,
    handleOfflineFlushSucceeded,
    conflictToast,
  };
}
