const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.versions.electron,
  network: {
    getPreferences: () => ipcRenderer.invoke('network-get-prefs'),
    saveNetworkPrefs: (prefs) => ipcRenderer.invoke('network-save-prefs', prefs),
    startServer: (port, backupPath, force) => ipcRenderer.invoke('server-start', port, backupPath, force),
    stopServer: () => ipcRenderer.invoke('server-stop'),
    getServerStatus: () => ipcRenderer.invoke('server-status'),
    discoverMasters: () => ipcRenderer.invoke('network-discover-masters'),
    pickBackupFolder: () => ipcRenderer.invoke('network-pick-backup-folder'),
    testApi: (apiUrl) => ipcRenderer.invoke('network-test-api', apiUrl),
    testMasterConnection: (apiUrl) => ipcRenderer.invoke('network-test-api', apiUrl),
    syncWithMaster: (...args) => ipcRenderer.invoke('sync-with-master', ...args),
    pushToMaster: (...args) => ipcRenderer.invoke('push-to-master', ...args),
  },
});
