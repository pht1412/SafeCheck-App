import { useBatteryStatus } from './useBatteryStatus';
import { useNetworkStatus, type NetworkStatus } from './useNetworkStatus';

export type { NetworkStatus };
export type RealtimeStatus = 'connected' | 'connecting' | 'disconnected';
export type ConnectionHealth = 'healthy' | 'connecting' | 'reconnecting' | 'offline';

/**
 * Hàm suy luận trạng thái kết nối hợp nhất (Derived Connection Health).
 * - network === 'offline': Luôn là 'offline'
 * - realtime === 'connected': 'healthy'
 * - realtime === 'connecting': 'connecting'
 * - network online nhưng realtime disconnected: Derived state 'reconnecting'
 */
export function deriveConnectionHealth(
  network: NetworkStatus,
  realtime: RealtimeStatus
): ConnectionHealth {
  if (network === 'offline') return 'offline';
  if (realtime === 'connected') return 'healthy';
  if (realtime === 'connecting') return 'connecting';
  return 'reconnecting';
}

export interface DeviceStatus {
  batteryLevel: number | null;
  isCharging: boolean;
  isBatterySupported: boolean;
  networkStatus: NetworkStatus;
}

export function useDeviceStatus(): DeviceStatus {
  const { batteryLevel, isCharging, isSupported: isBatterySupported } = useBatteryStatus();
  const networkStatus = useNetworkStatus();

  return {
    batteryLevel,
    isCharging,
    isBatterySupported,
    networkStatus,
  };
}
