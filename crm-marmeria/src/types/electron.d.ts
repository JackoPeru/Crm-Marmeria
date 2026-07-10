export {};

declare global {
  interface Window {
    electronAPI?: {
      platform: string;
      version: string;
      network: {
        getPreferences: () => Promise<{
          success: boolean;
          prefs?: NetworkPreferences;
          error?: string;
        }>;
        saveNetworkPrefs: (prefs: NetworkPreferences) => Promise<{
          success: boolean;
          prefs?: NetworkPreferences;
          server?: unknown;
          error?: string;
          code?: string;
          masters?: DiscoveredMaster[];
        }>;
        startServer: (port: number, backupPath?: string, force?: boolean) => Promise<any>;
        stopServer: () => Promise<any>;
        getServerStatus: () => Promise<any>;
        discoverMasters: () => Promise<{
          success: boolean;
          masters: DiscoveredMaster[];
        }>;
        pickBackupFolder: () => Promise<{ success: boolean; path?: string }>;
        testApi: (apiUrl: string) => Promise<{
          success: boolean;
          data?: any;
          apiUrl?: string;
          error?: string;
        }>;
        testMasterConnection?: (apiUrl: string) => Promise<{
          success: boolean;
          data?: any;
          apiUrl?: string;
          error?: string;
        }>;
        syncWithMaster?: (...args: any[]) => Promise<any>;
        pushToMaster?: (...args: any[]) => Promise<any>;
      };
    };
  }

  interface NetworkPreferences {
    mode: 'auto' | 'master' | 'client';
    masterPort?: number;
    apiUrl?: string;
    backupPath?: string;
    forceMaster?: boolean;
    discoveredServerId?: string;
    lastServerError?: string;
  }

  interface DiscoveredMaster {
    serverId: string;
    name?: string;
    hostname?: string;
    address: string;
    port: number;
    apiUrl: string;
  }
}
