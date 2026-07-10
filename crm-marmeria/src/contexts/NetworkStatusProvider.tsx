import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { cacheService } from '../services/cache';
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
  const [isForceOffline, setIsForceOffline] = useState(
    () => localStorage.getItem('forceOfflineMode') === 'true',
  );
  const forceOfflineRef = useRef(isForceOffline);
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
    try {
      const queuedOperations = await offlineQueue.count();
      setNetworkStatus((previous) => ({ ...previous, queuedOperations }));
    } catch (error) {
      console.error('Conteggio coda offline fallito:', error);
    }
  }, []);

  const checkConnection = useCallback(async (): Promise<boolean> => {
    if (forceOfflineRef.current || !navigator.onLine) {
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

    if (reachable && localStorage.getItem('crm_auth_token')) {
      realtimeService.connectFromStorage();
    } else {
      realtimeService.disconnect(false);
    }
    await refreshQueueCount();
    return reachable;
  }, [refreshQueueCount]);

  const setApiUrl = useCallback(async (url: string) => {
    const previousUrl = apiClient.getBaseURL();
    apiClient.setBaseURL(url);
    const nextUrl = apiClient.getBaseURL();
    if (previousUrl !== nextUrl) {
      realtimeService.disconnect();
      await Promise.allSettled([
        cacheService.clear('customers'),
        cacheService.clear('materials'),
      ]);
      window.dispatchEvent(new CustomEvent('crm-data-refresh-requested'));
    }
    setNetworkStatus((previous) => ({ ...previous, apiUrl: nextUrl }));
    return checkConnection();
  }, [checkConnection]);

  const forceOfflineMode = useCallback(() => {
    forceOfflineRef.current = true;
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
    forceOfflineRef.current = false;
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
            setNetworkStatus((previous) => ({
              ...previous,
              apiUrl: result.prefs?.apiUrl || previous.apiUrl,
            }));
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
    const authChanged = () => {
      void refreshQueueCount();
      if (localStorage.getItem('crm_auth_token')) void checkConnection();
      else realtimeService.disconnect();
    };
    const queueChanged = () => void refreshQueueCount();

    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('crm-realtime-status', realtimeStatus);
    window.addEventListener('crm-api-url-changed', apiChanged);
    window.addEventListener('crm-auth-changed', authChanged);
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
      window.removeEventListener('crm-auth-changed', authChanged);
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
  }), [
    networkStatus,
    checkConnection,
    setApiUrl,
    forceOfflineMode,
    exitOfflineMode,
    isForceOffline,
  ]);

  return (
    <NetworkStatusContext.Provider value={value}>
      {children}
    </NetworkStatusContext.Provider>
  );
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
