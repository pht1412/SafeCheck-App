import { useSyncExternalStore } from 'react';

export type NetworkStatus = 'online' | 'offline';

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);

  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getSnapshot(): NetworkStatus {
  if (typeof navigator !== 'undefined') {
    return navigator.onLine ? 'online' : 'offline';
  }
  return 'online';
}

function getServerSnapshot(): NetworkStatus {
  return 'online';
}

export function useNetworkStatus(): NetworkStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
