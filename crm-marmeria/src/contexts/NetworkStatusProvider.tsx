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
  setApiUrl: (url: string, expectedServerId?: string) => Promise<boolean>;
  forceOfflineMode: () => void;
  exitOfflineMode: () => void;
  isForceOffline: boolean;
}

const NetworkStatusContext = createContext<NetworkStatusContextType | undefined>(undefined);

const clearStoredServerIdentity = () => {
  localStorage.removeItem('crm_server_id');
  localStorage.removeItem('crm_server_identity_url');
  localStorage.removeItem('crm_data_epoch');
};

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

  const setApiUrl = useCallback(async (url: string, expectedServerId?: string) => {
    const previousUrl = apiClient.getBaseURL();
    const previousServerId = apiClient.getServerId();
    const normalizedExpectedId = String(expectedServerId || '').trim() || null;
    const sameVerifiedServer = Boolean(
      previousServerId
      && normalizedExpectedId
      && previousServerId === normalizedExpectedId,
    );

    apiClient.setBaseURL(url);
    const nextUrl = apiClient.getBaseURL();
    const addressChanged = previousUrl !== nextUrl;
    const identityChanged = Boolean(
      normalizedExpectedId
      && previousServerId
      && previousServerId !== normalizedExpectedId,
    );
    const unknownIdentityChange = addressChanged && !sameVerifiedServer;

    if (identityChanged || unknownIdentityChange) clearStoredServerIdentity();
    if (normalizedExpectedId) localStorage.setItem('crm_server_id', normalizedExpectedId);

    if (addressChanged) realtimeService.disconnect();
    if (identityChanged || unknownIdentityChange) {
      await cacheService.clearAll();
      window.dispatchEvent(new CustomEvent('crm-auth-reset-for-server-change'));
      window.dispatchEvent(new CustomEvent('crm-data-refresh-requested'));
    }

    setNetworkStatus((previous) => ({
      ...previous,
      apiUrl: nextUrl,
      serverReachable: false,
    }));
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
    const initialize = async () => { await checkConnection(); };

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
    const apiChanged = (event: Event) => {
      const apiUrl = String((event as CustomEvent<string>).detail || apiClient.getBaseURL());
      setNetworkStatus((previous) => ({ ...previous, apiUrl }));
    };
    const authChanged = () => {
      void refreshQueueCount();
      if (localStorage.getItem('crm_auth_token')) void checkConnection();
      else realtimeService.disconnect();
    };
    const queueChanged = () => void refreshQueueCount();
    const identityChanged = () => void refreshQueueCount();

    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('crm-realtime-status', realtimeStatus);
    window.addEventListener('crm-api-url-changed', apiChanged);
    window.addEventListener('crm-auth-changed', authChanged);
    window.addEventListener('crm-offline-queue-changed', queueChanged);
    window.addEventListener('crm-server-identity-changed', identityChanged);
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
      window.removeEventListener('crm-server-identity-changed', identityChanged);
    };
  }, [checkConnection, refreshQueueCount, setApiUrl]);

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
