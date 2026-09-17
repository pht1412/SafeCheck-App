import { useDeviceStatus, deriveConnectionHealth } from '../../hooks/useDeviceStatus';
import { useSensoryFeedback } from '../../hooks/useSensoryFeedback';
import { useFamilyLink } from '../../hooks/useFamilyLink';
import { useCheckinEngine } from '../../hooks/useCheckinEngine';
import { useSos } from '../../hooks/useSos';
import { usePing } from '../../hooks/usePing';
import AppLoadingScreen from './AppLoadingScreen';
import CaregiverScreen from '../CaregiverScreen';
import { supabase } from '../../supabaseClient';
import { pushNotificationService } from '../../services/pushNotificationService';
import type { SystemState, UserProfile } from '../../types';

interface CaregiverAppProps {
  userProfile: UserProfile;
  signOut: () => Promise<void>;
}

/**
 * Composition component cho Caregiver role.
 *
 * Trách nhiệm:
 * - Gọi domain hooks theo dependency order (correction #7)
 * - Không dùng useOfflineSync (SOS offline flow chỉ trên Elderly side)
 * - setManualStatus (DevTool) giữ inline — gọi trực tiếp supabase + pushNotificationService
 * - Truyền props xuống CaregiverScreen — giữ nguyên 100% props API
 *
 * Hook call order theo dependency graph:
 * 1. useDeviceStatus + useSensoryFeedback (không phụ thuộc ai)
 * 2. useFamilyLink (phụ thuộc userProfile)
 * 3. useCheckinEngine (phụ thuộc family data)
 * 4. useSos (phụ thuộc systemState + family data)
 * 5. usePing (phụ thuộc systemState + family data)
 */
export default function CaregiverApp({ userProfile, signOut }: CaregiverAppProps) {
  // 1. Cross-cutting utilities
  const { batteryLevel, isCharging, networkStatus } = useDeviceStatus();
  const { triggerFeedback, playChime } = useSensoryFeedback();

  // 2. Family linking (phụ thuộc userProfile)
  const {
    linkedElderly,
    activeFamilyCode,
    connectFamily,
  } = useFamilyLink(userProfile);

  // 3. Check-in engine (phụ thuộc family data)
  const {
    systemState,
    setSystemState,
    checkInTime,
    isLoading,
    realtimeStatus,
  } = useCheckinEngine({
    userProfile,
    linkedElderly,
    activeFamilyCode,
    onFeedback: triggerFeedback,
  });

  // 4. SOS lifecycle (phụ thuộc systemState + family data)
  const sos = useSos({
    userProfile,
    systemState,
    setSystemState,
    activeFamilyCode,
    linkedElderly,
    onFeedback: triggerFeedback,
  });

  // 5. Ping (phụ thuộc systemState + family data)
  const ping = usePing({
    systemState,
    linkedElderly,
    userProfile,
    onFeedback: triggerFeedback,
    onPlayChime: playChime,
  });

  // ─── DevTool: Cập nhật trực tiếp trạng thái (chỉ dùng để test) ────────────
  // Giữ inline trong CaregiverApp — không cần hook riêng

  const getTodayDate = () => new Date().toISOString().split('T')[0];

  const setManualStatus = async (status: SystemState) => {
    if (!activeFamilyCode) return;
    await supabase
      .from('checkin_logs')
      .update({ status })
      .eq('family_code', activeFamilyCode)
      .eq('log_date', getTodayDate());

    if (status === 'Emergency') {
      const targetElderlyId = linkedElderly?.id;
      if (targetElderlyId) {
        const clientEventId = crypto.randomUUID();
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('create_sos_event_idempotent', {
          p_elderly_id: targetElderlyId,
          p_client_event_id: clientEventId,
          p_trigger_source: 'button',
        });

        const sosId = rpcRes?.sos_event_id;
        if (sosId) {
          await pushNotificationService.sendEmergencyPush(sosId);
        } else if (rpcErr) {
          console.warn('[CaregiverApp DevTool] Lỗi create_sos_event_idempotent:', rpcErr);
        }
      }
    }
  };

  const connectionHealth = deriveConnectionHealth(networkStatus, realtimeStatus);

  // Data loading state
  if (isLoading && activeFamilyCode) {
    return <AppLoadingScreen message="Đang đồng bộ dữ liệu hôm nay..." />;
  }

  return (
    <CaregiverScreen
      systemState={systemState}
      checkInTime={checkInTime}
      batteryLevel={batteryLevel}
      isCharging={isCharging}
      connectionHealth={connectionHealth}
      pingCooldown={ping.pingCooldown}
      isPingAllowed={ping.isPingAllowed}
      isSirenMuted={sos.isSirenMuted}
      caregiverName={userProfile.full_name}
      linkedElderly={linkedElderly}
      isTester={userProfile.email?.toLowerCase() === 'test01@gmail.com'}
      conflictToast={ping.conflictToast ?? sos.conflictToast}
      onSendPing={ping.sendPing}
      onResolveAlarm={sos.resolveAlarm}
      onToggleMuteSiren={sos.toggleMuteSiren}
      onManualStatus={setManualStatus}
      onSignOut={signOut}
      onConnectFamily={connectFamily}
    />
  );
}
