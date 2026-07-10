import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { offlineQueue } from '../services/offlineQueue';
import { realtimeService } from '../services/realtime';

interface NetworkStatus {
  isOnline: boolean;
  isOffline: boolean;
  serverReachable: boolean;
  apiUrl: string;
  lastOnline: Date | null;
  lastOffline: Date | null;
  queuedOperations: number;
  realtimeStatus: 'disconnected' | 'connecting' | 'connected';
}
interface NetworkStatusContextType {
  networkStatus: NetworkStatus;
  checkConnection: () => Promise<boolean>;
  setApiUrl: (url: string) => Promise<boolean>;
  forceOfflineMode: () => void;
  exitOfflineMode: () => void;
  isForceOffline: boolean;
}
const NetworkStatusContext = createContext<NetworkStatusContextType | undefined>(undefined);

export const NetworkStatusProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isForceOffline, setIsForceOffline] = useState(() => localStorage.getItem('forceOfflineMode') === 'true');
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    isOnline: navigator.onLine,
    isOffline: !navigator.onLine,
    serverReachable: false,
    apiUrl: apiClient.getBaseURL(),
    lastOnline: null,
    lastOffline: null,
    queuedOperations: 0,
    realtimeStatus: 'disconnected',
  });

  const refreshQueueCount = useCallback(async () => {
    const queuedOperations = await offlineQueue.count();
    setNetworkStatus((previous) => ({ ...previous, queuedOperations }));
  }, []);

  const checkConnection = useCallback(async (): Promise<boolean> => {
    if (isForceOffline || !navigator.onLine) {
      setNetworkStatus((previous) => ({
        ...previous,
        isOnline: false,
        isOffline: true,
        serverReachable: false,
        lastOffline: new Date(),
      }));
      realtimeService.disconnect();
      await refreshQueueCount();
      return false;
    }
    const reachable = await apiClient.checkHealth();
    setNetworkStatus((previous) => ({
      ...previous,
      isOnline: reachable,
      isOffline: !reachable,
      serverReachable: reachable,
      apiUrl: apiClient.getBaseURL(),
      lastOnline: reachable ? new Date() : previous.lastOnline,
      lastOffline: reachable ? previous.lastOffline : new Date(),
    }));
    if (reachable) realtimeService.connectFromStorage();
    else realtimeService.disconnect(false);
    await refreshQueueCount();
    return reachable;
  }, [isForceOffline, refreshQueueCount]);

  const setApiUrl = useCallback(async (url: string) => {
    apiClient.setBaseURL(url);
    setNetworkStatus((previous) => ({ ...previous, apiUrl: apiClient.getBaseURL() }));
    return checkConnection();
  }, [checkConnection]);

  const forceOfflineMode = useCallback(() => {
    setIsForceOffline(true);
    localStorage.setItem('forceOfflineMode', 'true');
    realtimeService.disconnect();
    setNetworkStatus((previous) => ({
      ...previous,
      isOnline: false,
      isOffline: true,
      serverReachable: false,
      lastOffline: new Date(),
    }));
    toast('Modalità offline forzata attivata');
  }, []);

  const exitOfflineMode = useCallback(() => {
    setIsForceOffline(false);
    localStorage.setItem('forceOfflineMode', 'false');
    void checkConnection();
  }, [checkConnection]);

  useEffect(() => {
    const initialize = async () => {
      if (window.electronAPI?.network.getPreferences) {
        try {
          const result = await window.electronAPI.network.getPreferences();
          if (result.success && result.prefs?.apiUrl) {
            apiClient.setBaseURL(result.prefs.apiUrl);
            setNetworkStatus((previous) => ({ ...previous, apiUrl: result.prefs?.apiUrl || previous.apiUrl }));
          }
        } catch (error) {
          console.error('Caricamento configurazione rete fallito:', error);
        }
      }
      await checkConnection();
    };
    const online = () => void checkConnection();
    const offline = () => {
      realtimeService.disconnect();
      setNetworkStatus((previous) => ({
        ...previous,
        isOnline: false,
        isOffline: true,
        serverReachable: false,
        lastOffline: new Date(),
      }));
    };
    const realtimeStatus = (event: Event) => {
      setNetworkStatus((previous) => ({
        ...previous,
        realtimeStatus: (event as CustomEvent<NetworkStatus['realtimeStatus']>).detail,
      }));
    };
    const apiChanged = () => void checkConnection();
    const queueChanged = () => void refreshQueueCount();

    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('crm-realtime-status', realtimeStatus);
    window.addEventListener('crm-api-url-changed', apiChanged);
    window.addEventListener('crm-offline-queue-changed', queueChanged);
    void initialize();
    const interval = window.setInterval(checkConnection, 10000);

    return () => {
      window.clearInterval(interval);
      realtimeService.disconnect();
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener('crm-realtime-status', realtimeStatus);
      window.removeEventListener('crm-api-url-changed', apiChanged);
      window.removeEventListener('crm-offline-queue-changed', queueChanged);
    };
  }, [checkConnection, refreshQueueCount]);

  const value = useMemo(() => ({
    networkStatus,
    checkConnection,
    setApiUrl,
    forceOfflineMode,
    exitOfflineMode,
    isForceOffline,
  }), [networkStatus, checkConnection, setApiUrl, forceOfflineMode, exitOfflineMode, isForceOffline]);

  return <NetworkStatusContext.Provider value={value}>{children}</NetworkStatusContext.Provider>;
};

export const useNetworkStatus = () => {
  const context = useContext(NetworkStatusContext);
  if (!context) throw new Error('useNetworkStatus deve essere utilizzato dentro NetworkStatusProvider');
  return context;
};
export const useIsOnline = () => useNetworkStatus().networkStatus.isOnline;
export const useConnectionInfo = () => {
  const { networkStatus } = useNetworkStatus();
  return {
    type: networkStatus.serverReachable ? 'lan' : 'offline',
    effectiveType: networkStatus.realtimeStatus,
    downlink: 0,
    rtt: 0,
    quality: networkStatus.serverReachable ? 'good' : 'poor',
  };
};
export default NetworkStatusProvider;
