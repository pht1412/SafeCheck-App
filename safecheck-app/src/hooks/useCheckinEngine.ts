import { useState, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { supabase } from '../supabaseClient';
import { checkinScheduleService } from '../services/checkinScheduleService';
import type { SystemState, CheckinSchedule } from '../types';
import type { UserProfile } from '../types';
import type { LinkedElderly } from './useFamilyLink';
import type { RealtimeStatus } from './useDeviceStatus';

export interface UseCheckinEngineReturn {
  systemState: SystemState;
  /** Exposed để useSos có thể mutate state (Emergency trigger, resolve). */
  setSystemState: Dispatch<SetStateAction<SystemState>>;
  checkInTime: string | null;
  checkinSchedule: CheckinSchedule | null;
  isLoading: boolean;
  realtimeStatus: RealtimeStatus;
  performCheckIn: () => Promise<void>;
  /** Async fetch status + schedule. Caller có thể await để chắc chắn state đã cập nhật. */
  refreshCheckin: () => Promise<void>;
}

/**
 * Hook quản lý trạng thái điểm danh và lịch điểm danh.
 *
 * Trách nhiệm:
 * - Fetch trạng thái hôm nay từ checkin_logs (by family_code + log_date)
 * - Fetch lịch điểm danh (checkin_schedules)
 * - Realtime channel room-{activeFamilyCode} → checkin_logs → update state
 * - Realtime channel sched-{activeFamilyCode} → checkin_schedules → update
 * - Revalidate trên online/visibilitychange/focus
 * - performCheckIn(): gọi checkinScheduleService.performCheckin() [atomic v2]
 *   → Legacy perform_checkin đã bị xóa hoàn toàn (dead code)
 *
 * KHÔNG chứa SOS, Ping, hay auth logic.
 */
export function useCheckinEngine(params: {
  userProfile: UserProfile | null;
  linkedElderly: LinkedElderly | null;
  activeFamilyCode: string | null;
  onFeedback: (message: string) => void;
}): UseCheckinEngineReturn {
  const { userProfile, linkedElderly, activeFamilyCode, onFeedback } = params;

  const [systemState, setSystemState] = useState<SystemState>('Waiting');
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [checkinSchedule, setCheckinSchedule] = useState<CheckinSchedule | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');

  const getTodayDate = () => new Date().toISOString().split('T')[0];

  // ─── Fetch status + schedule ──────────────────────────────────────────────

  const refreshCheckin = async (): Promise<void> => {
    if (!activeFamilyCode) return;

    const today = getTodayDate();
    const targetElderlyId =
      userProfile?.role === 'elderly' ? userProfile.id : linkedElderly?.id;

    // Fetch schedule (không block status fetch)
    if (targetElderlyId) {
      checkinScheduleService.getSchedule(targetElderlyId).then(({ data: schedData }) => {
        if (schedData) setCheckinSchedule(schedData);
      });
    }

    const { data, error } = await supabase
      .from('checkin_logs')
      .select('*')
      .eq('family_code', activeFamilyCode)
      .eq('log_date', today)
      .maybeSingle();

    if (data && !error) {
      setSystemState(data.status as SystemState);
      if (data.checkin_time) {
        const time = new Date(data.checkin_time).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        setCheckInTime(time);
      } else {
        setCheckInTime(null);
      }
    } else {
      setSystemState('Waiting');
      setCheckInTime(null);
    }
  };

  // ─── Effect: initial fetch + realtime + revalidation ──────────────────────

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!activeFamilyCode) {
      setSystemState('Waiting');
      setCheckInTime(null);
      setRealtimeStatus(supabase.realtime.isConnected() ? 'connected' : 'connecting');
      return;
    }
    /* eslint-enable react-hooks/set-state-in-effect */

    setRealtimeStatus('connecting');
    setIsLoading(true);

    refreshCheckin().finally(() => setIsLoading(false));

    // Revalidate khi mạng phục hồi hoặc user mở lại tab
    const handleRevalidate = () => { void refreshCheckin(); };
    window.addEventListener('online', handleRevalidate);
    window.addEventListener('visibilitychange', handleRevalidate);
    window.addEventListener('focus', handleRevalidate);

    // Realtime: trạng thái điểm danh hôm nay
    const channel = supabase
      .channel(`room-${activeFamilyCode}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'checkin_logs',
          filter: `family_code=eq.${activeFamilyCode}`,
        },
        (payload) => {
          const newRow = payload.new as { log_date?: string; status?: string; checkin_time?: string } | undefined;
          if (newRow && newRow.log_date === getTodayDate() && newRow.status) {
            setSystemState(newRow.status as SystemState);
            if (newRow.checkin_time) {
              const time = new Date(newRow.checkin_time).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });
              setCheckInTime(time);
            } else {
              setCheckInTime(null);
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          setRealtimeStatus('disconnected');
        }
      });

    // Realtime: thay đổi cấu hình lịch điểm danh
    const schedChannel = supabase
      .channel(`sched-${activeFamilyCode}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'checkin_schedules',
        },
        (payload) => {
          if (payload.new) {
            setCheckinSchedule(payload.new as CheckinSchedule);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(schedChannel);
      window.removeEventListener('online', handleRevalidate);
      window.removeEventListener('visibilitychange', handleRevalidate);
      window.removeEventListener('focus', handleRevalidate);
    };
  }, [activeFamilyCode, userProfile?.id, linkedElderly?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── performCheckIn ───────────────────────────────────────────────────────

  const performCheckIn = async (): Promise<void> => {
    if (!userProfile?.id || userProfile.role !== 'elderly') {
      console.warn('[useCheckinEngine] performCheckIn chỉ dành cho Elderly role');
      return;
    }

    console.log('[useCheckinEngine] Gọi perform_checkin_atomic_v2 cho Cụ:', userProfile.id);
    const res = await checkinScheduleService.performCheckin(userProfile.id);

    if (!res.success) {
      alert(res.message || 'Không thể điểm danh!');
      return;
    }

    console.log('[useCheckinEngine] Điểm danh atomic v2 thành công:', res);
    onFeedback('Điểm danh thành công, con cháu đã nhận được tin');
  };

  return {
    systemState,
    setSystemState,
    checkInTime,
    checkinSchedule,
    isLoading,
    realtimeStatus,
    performCheckIn,
    refreshCheckin,
  };
}
