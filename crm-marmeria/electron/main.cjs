const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CentralCrmServer = require('./server.cjs');
const { discoverMasters } = require('./discovery.cjs');

const isDev = process.env.NODE_ENV === 'development';
let centralServer = null;
let mainWindow = null;
let quitAfterServerStop = false;

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

const defaultPrefs = () => ({
  mode: 'auto',
  masterPort: 3001,
  apiUrl: 'http://127.0.0.1:3001/api',
  backupPath: '',
});

const prefsPath = () => path.join(app.getPath('userData'), 'network-prefs.json');

const normalizeApiUrl = (value) => {
  const parsed = new URL(String(value).trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('L’indirizzo API deve usare http o https');
  }
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  if (!parsed.pathname.endsWith('/api')) {
    parsed.pathname = `${parsed.pathname}/api`.replace(/\/+/g, '/');
  }
  return parsed.toString().replace(/\/$/, '');
};

const validatePrefs = (incoming) => {
  const prefs = { ...defaultPrefs(), ...(incoming || {}) };
  if (!['auto', 'master', 'client'].includes(prefs.mode)) {
    throw new Error('Modalità rete non valida');
  }
  const masterPort = Number(prefs.masterPort || 3001);
  if (!Number.isInteger(masterPort) || masterPort < 1024 || masterPort > 65535) {
    throw new Error('La porta deve essere compresa tra 1024 e 65535');
  }
  return {
    ...prefs,
    masterPort,
    backupPath: prefs.backupPath ? path.resolve(String(prefs.backupPath)) : '',
    apiUrl: prefs.mode === 'client'
      ? normalizeApiUrl(prefs.apiUrl)
      : `http://127.0.0.1:${masterPort}/api`,
  };
};

const readPrefs = () => {
  try {
    if (!fs.existsSync(prefsPath())) return defaultPrefs();
    return validatePrefs(JSON.parse(fs.readFileSync(prefsPath(), 'utf8')));
  } catch (error) {
    console.error('Configurazione rete non valida, uso valori predefiniti:', error.message);
    return defaultPrefs();
  }
};

const savePrefs = (prefs) => {
  const filePath = prefsPath();
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(prefs, null, 2));
  fs.renameSync(temporary, filePath);
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    icon: path.join(__dirname, 'icon.ico'),
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
};

const applyNetworkMode = async (incomingPrefs) => {
  let prefs = validatePrefs(incomingPrefs);

  if (prefs.mode === 'auto') {
    const masters = await discoverMasters(1600);
    prefs = masters.length
      ? validatePrefs({
        ...prefs,
        mode: 'client',
        apiUrl: masters[0].apiUrl,
        discoveredServerId: masters[0].serverId,
      })
      : validatePrefs({ ...prefs, mode: 'master' });
  }

  if (prefs.mode === 'master') {
    const result = await centralServer.start(
      prefs.masterPort,
      prefs.backupPath || null,
      { force: Boolean(prefs.forceMaster) },
    );
    const resolvedPrefs = {
      ...prefs,
      forceMaster: false,
      apiUrl: result.localApiUrl || `http://127.0.0.1:${prefs.masterPort}/api`,
      backupPath: result.backupPath || prefs.backupPath || '',
    };
    return { success: true, ...result, prefs: resolvedPrefs };
  }

  if (centralServer.getStatus().isRunning) await centralServer.stop();
  return { success: true, mode: 'client', prefs };
};

const initializeNetwork = async () => {
  const prefs = readPrefs();
  try {
    const result = await applyNetworkMode(prefs);
    savePrefs(result.prefs);
  } catch (error) {
    console.error('Avvio automatico server centrale fallito:', error.message);
    const fallbackMaster = error.masters?.[0];
    const fallback = validatePrefs({
      ...prefs,
      mode: 'client',
      apiUrl: fallbackMaster?.apiUrl || prefs.apiUrl,
      lastServerError: error.message,
    });
    savePrefs(fallback);
  }
};

app.whenReady().then(async () => {
  centralServer = new CentralCrmServer();
  await initializeNetwork();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (quitAfterServerStop || !centralServer?.getStatus().isRunning) return;
  event.preventDefault();
  quitAfterServerStop = true;
  centralServer.stop()
    .catch((error) => console.error('Arresto server fallito:', error))
    .finally(() => app.quit());
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length > 0) return;
  const prefs = readPrefs();
  if (prefs.mode === 'master' && !centralServer.getStatus().isRunning) {
    try {
      const result = await applyNetworkMode(prefs);
      savePrefs(result.prefs);
    } catch (error) {
      console.error('Riavvio master fallito:', error);
    }
  }
  createWindow();
});

ipcMain.handle('network-get-prefs', () => ({ success: true, prefs: readPrefs() }));

ipcMain.handle('network-save-prefs', async (event, incoming) => {
  const previousPrefs = readPrefs();
  try {
    const result = await applyNetworkMode({ ...previousPrefs, ...incoming });
    savePrefs(result.prefs);
    return { success: true, prefs: result.prefs, server: result };
  } catch (error) {
    try {
      await applyNetworkMode(previousPrefs);
    } catch (rollbackError) {
      console.error('Ripristino configurazione precedente fallito:', rollbackError);
    }
    return {
      success: false,
      error: error.message,
      code: error.code,
      masters: error.masters,
      prefs: previousPrefs,
    };
  }
});

ipcMain.handle('server-start', async (event, port, backupPath, force = false) => {
  try {
    return await centralServer.start(port, backupPath, { force });
  } catch (error) {
    return {
      success: false,
      error: error.message,
      code: error.code,
      masters: error.masters,
    };
  }
});

ipcMain.handle('server-stop', async () => centralServer.stop());
ipcMain.handle('server-status', async () => centralServer.getStatus());
ipcMain.handle('network-discover-masters', async () => ({
  success: true,
  masters: await discoverMasters(1800),
}));

ipcMain.handle('network-pick-backup-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled
    ? { success: false }
    : { success: true, path: result.filePaths[0] };
});

ipcMain.handle('network-test-api', async (event, apiUrl) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const normalized = normalizeApiUrl(apiUrl);
    const response = await fetch(`${normalized}/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    return {
      success: response.ok,
      data: await response.json(),
      apiUrl: normalized,
    };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
});

ipcMain.handle('sync-with-master', async () => ({
  success: false,
  error: 'La sincronizzazione a copie è stata sostituita dal server centrale.',
}));
ipcMain.handle('push-to-master', async () => ({
  success: false,
  error: 'Le modifiche devono passare attraverso le API centrali.',
}));
