import { useDeviceStatus } from '../../hooks/useDeviceStatus';
import { useSensoryFeedback } from '../../hooks/useSensoryFeedback';
import { useFamilyLink } from '../../hooks/useFamilyLink';
import { useCheckinEngine } from '../../hooks/useCheckinEngine';
import { useSos } from '../../hooks/useSos';
import { usePing } from '../../hooks/usePing';
import { useOfflineSync } from '../../hooks/useOfflineSync';
import AppLoadingScreen from './AppLoadingScreen';
import ElderlyScreen from '../ElderlyScreen';
import type { UserProfile } from '../../types';

interface ElderlyAppProps {
  userProfile: UserProfile;
}

/**
 * Composition component cho Elderly role.
 *
 * Trách nhiệm:
 * - Gọi domain hooks theo dependency order (correction #7)
 * - Wire useOfflineSync với sos.handleOfflineFlushSucceeded (correction #4)
 * - Truyền props xuống ElderlyScreen — giữ nguyên 100% props API
 *
 * Hook call order theo dependency graph:
 * 1. useDeviceStatus + useSensoryFeedback (không phụ thuộc ai)
 * 2. useFamilyLink (phụ thuộc userProfile)
 * 3. useCheckinEngine (phụ thuộc family data + activeFamilyCode)
 * 4. useSos (phụ thuộc systemState + family data)
 * 5. usePing (phụ thuộc systemState + family data)
 * 6. useOfflineSync (nhận callback từ useSos)
 */
export default function ElderlyApp({ userProfile }: ElderlyAppProps) {
  // 1. Cross-cutting utilities (không phụ thuộc ai)
  const { batteryLevel, isCharging } = useDeviceStatus();
  const { triggerFeedback, playChime } = useSensoryFeedback();

  // 2. Family linking (phụ thuộc userProfile)
  const {
    linkedElderly,
    hasLinkedCaregivers,
    primaryCaregiver,
    activeFamilyCode,
  } = useFamilyLink(userProfile);

  // 3. Check-in engine (phụ thuộc family data + activeFamilyCode)
  const {
    systemState,
    setSystemState,
    checkInTime,
    checkinSchedule,
    isLoading,
    performCheckIn,
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
  usePing({
    systemState,
    linkedElderly,
    userProfile,
    onFeedback: triggerFeedback,
    onPlayChime: playChime,
  });

  // 6. Offline infrastructure (callback từ SOS — correction #4)
  useOfflineSync({ onFlushSucceeded: sos.handleOfflineFlushSucceeded });

  // Data loading state (isLoading từ useCheckinEngine, không phải App.tsx)
  if (isLoading && activeFamilyCode) {
    return <AppLoadingScreen message="Đang đồng bộ dữ liệu hôm nay..." />;
  }

  return (
    <ElderlyScreen
      systemState={systemState}
      checkInTime={checkInTime}
      checkinStart={checkinSchedule?.checkin_start}
      batteryLevel={batteryLevel}
      isCharging={isCharging}
      sosHolding={sos.sosHolding}
      sosCountdown={sos.sosCountdown}
      elderlyName={userProfile.full_name}
      pairingCode={userProfile.pairing_code}
      hasLinkedCaregivers={hasLinkedCaregivers}
      showCellularFallback={sos.showCellularFallback}
      primaryCaregiverName={primaryCaregiver?.name}
      primaryCaregiverPhone={primaryCaregiver?.phone}
      onCheckIn={performCheckIn}
      onStartSosHold={sos.startSosHold}
      onCancelSosHold={sos.cancelSosHold}
      onAbortSosCountdown={sos.abortSosCountdown}
      onResolveAlarm={sos.resolveAlarm}
    />
  );
}
