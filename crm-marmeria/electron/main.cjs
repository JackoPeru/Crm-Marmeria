const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const CentralCrmServer = require('./server.cjs');
const { discoverMasters } = require('./discovery.cjs');

const isDev = process.env.NODE_ENV === 'development';
let centralServer = null;
let mainWindow = null;
let quitAfterServerStop = false;
let networkOperationQueue = Promise.resolve();

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
const productionEntryUrl = () => pathToFileURL(path.join(__dirname, '../dist/index.html')).toString();

const isTrustedRendererUrl = (value) => {
  const url = String(value || '');
  if (isDev) {
    return url.startsWith('http://localhost:5173/')
      || url === 'http://localhost:5173'
      || url.startsWith('http://127.0.0.1:5173/')
      || url === 'http://127.0.0.1:5173';
  }
  const entry = productionEntryUrl();
  return url === entry || url.startsWith(`${entry}#`) || url.startsWith(`${entry}?`);
};

const assertTrustedSender = (event) => {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || '';
  if (!isTrustedRendererUrl(senderUrl)) {
    const error = new Error('Richiesta IPC rifiutata da una pagina non autorizzata');
    error.code = 'UNTRUSTED_RENDERER';
    throw error;
  }
};

const serializeNetworkOperation = (operation) => {
  const task = networkOperationQueue.then(operation, operation);
  networkOperationQueue = task.catch(() => undefined);
  return task;
};

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

const probeApi = async (apiUrl, expectedServerId = null, timeoutMs = 5000) => {
  const normalized = normalizeApiUrl(apiUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${normalized}/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      const error = new Error(`Il server ha risposto con stato ${response.status}`);
      error.code = 'SERVER_UNREACHABLE';
      throw error;
    }
    const data = await response.json();
    if (data?.mode !== 'central-server' || !data?.serverId) {
      const error = new Error('L’indirizzo non appartiene a un server CRM Marmeria valido');
      error.code = 'INVALID_CRM_SERVER';
      throw error;
    }
    if (expectedServerId && String(data.serverId) !== String(expectedServerId)) {
      const error = new Error('L’identità del server non corrisponde a quella salvata');
      error.code = 'SERVER_ID_MISMATCH';
      throw error;
    }
    return { apiUrl: normalized, data };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Il server non ha risposto entro il tempo previsto');
      timeoutError.code = 'SERVER_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    icon: path.join(__dirname, 'icon.ico'),
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('Processo grafico terminato:', details.reason);
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
      discoveredServerId: result.serverId,
      apiUrl: result.localApiUrl || `http://127.0.0.1:${prefs.masterPort}/api`,
      backupPath: result.backupPath || prefs.backupPath || '',
    };
    return { success: true, ...result, prefs: resolvedPrefs };
  }

  const verified = await probeApi(prefs.apiUrl, prefs.discoveredServerId || null);
  if (
    centralServer.getStatus().isRunning
    && String(verified.data.serverId) === String(centralServer.getStatus().serverId)
  ) {
    const error = new Error('Questa postazione non può collegarsi come client al proprio server locale');
    error.code = 'CLIENT_POINTS_TO_LOCAL_MASTER';
    throw error;
  }

  if (centralServer.getStatus().isRunning) await centralServer.stop();
  return {
    success: true,
    mode: 'client',
    prefs: {
      ...prefs,
      apiUrl: verified.apiUrl,
      discoveredServerId: String(verified.data.serverId),
      lastServerError: undefined,
    },
    health: verified.data,
  };
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
      discoveredServerId: fallbackMaster?.serverId || prefs.discoveredServerId,
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
  Promise.race([
    centralServer.stop(),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ])
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

ipcMain.handle('network-get-prefs', (event) => {
  assertTrustedSender(event);
  return { success: true, prefs: readPrefs() };
});

ipcMain.handle('network-save-prefs', (event, incoming) => {
  assertTrustedSender(event);
  return serializeNetworkOperation(async () => {
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
});

ipcMain.handle('server-start', (event, port, backupPath, force = false) => {
  assertTrustedSender(event);
  return serializeNetworkOperation(async () => {
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
});

ipcMain.handle('server-stop', (event) => {
  assertTrustedSender(event);
  return serializeNetworkOperation(() => centralServer.stop());
});
ipcMain.handle('server-status', (event) => {
  assertTrustedSender(event);
  return centralServer.getStatus();
});
ipcMain.handle('network-discover-masters', async (event) => {
  assertTrustedSender(event);
  return { success: true, masters: await discoverMasters(1800) };
});

ipcMain.handle('network-pick-backup-folder', async (event) => {
  assertTrustedSender(event);
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled
    ? { success: false }
    : { success: true, path: result.filePaths[0] };
});

ipcMain.handle('network-test-api', async (event, apiUrl, expectedServerId = null) => {
  assertTrustedSender(event);
  try {
    const result = await probeApi(apiUrl, expectedServerId);
    return { success: true, data: result.data, apiUrl: result.apiUrl };
  } catch (error) {
    return { success: false, error: error.message, code: error.code };
  }
});

ipcMain.handle('sync-with-master', (event) => {
  assertTrustedSender(event);
  return {
    success: false,
    error: 'La sincronizzazione a copie è stata sostituita dal server centrale.',
  };
});
ipcMain.handle('push-to-master', (event) => {
  assertTrustedSender(event);
  return {
    success: false,
    error: 'Le modifiche devono passare attraverso le API centrali.',
  };
});
