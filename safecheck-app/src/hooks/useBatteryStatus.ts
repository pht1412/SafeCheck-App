import { useState, useEffect } from 'react';

interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<BatteryManager>;
}

export interface BatteryStatus {
  batteryLevel: number | null;
  isCharging: boolean;
  isSupported: boolean;
}

export function useBatteryStatus(): BatteryStatus {
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [isCharging, setIsCharging] = useState<boolean>(false);
  const [isSupported, setIsSupported] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return;
    }

    const nav = navigator as NavigatorWithBattery;
    if (typeof nav.getBattery !== 'function') {
      // Trình duyệt không hỗ trợ Battery API (mặc định đã là null & false)
      return;
    }

    let isMounted = true;
    let batteryInstance: BatteryManager | null = null;

    const updateBattery = () => {
      if (!isMounted || !batteryInstance) return;
      setBatteryLevel(Math.round(batteryInstance.level * 100));
      setIsCharging(batteryInstance.charging);
    };

    nav
      .getBattery()
      .then((battery) => {
        if (!isMounted) return;
        batteryInstance = battery;
        setIsSupported(true);
        setBatteryLevel(Math.round(battery.level * 100));
        setIsCharging(battery.charging);

        battery.addEventListener('levelchange', updateBattery);
        battery.addEventListener('chargingchange', updateBattery);
      })
      .catch((err) => {
        console.warn('[useBatteryStatus] Không thể khởi tạo Battery API:', err);
      });

    return () => {
      isMounted = false;
      if (batteryInstance) {
        batteryInstance.removeEventListener('levelchange', updateBattery);
        batteryInstance.removeEventListener('chargingchange', updateBattery);
      }
    };
  }, []);

  return { batteryLevel, isCharging, isSupported };
}
