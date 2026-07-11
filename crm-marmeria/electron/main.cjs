const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const CentralCrmServer = require('./server.cjs');
const { discoverMasters } = require('./discovery.cjs');
const {
  defaultPrefs,
  normalizeApiUrl,
  safeClientPrefs,
  selectSingleMaster,
  validatePrefs,
} = require('./network-config.cjs');
const {
  assertTrustedSender: assertTrustedIpcSender,
  createRendererTrustChecker,
  createSerializedExecutor,
  probeApi: probeCentralApi,
} = require('./main-helpers.cjs');

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

const prefsPath = () => path.join(app.getPath('userData'), 'network-prefs.json');
const productionEntryUrl = () => pathToFileURL(path.join(__dirname, '../dist/index.html')).toString();
const isTrustedRendererUrl = createRendererTrustChecker({
  isDev,
  productionFile: productionEntryUrl(),
});
const serializeNetworkOperation = createSerializedExecutor();
const probeApi = (apiUrl, expectedServerId = null) => probeCentralApi(
  apiUrl,
  expectedServerId,
  { normalizeApiUrl },
);
const assertTrustedSender = (event) => assertTrustedIpcSender(event, isTrustedRendererUrl);

const readPrefs = () => {
  try {
    if (!fs.existsSync(prefsPath())) return defaultPrefs();
    return validatePrefs(JSON.parse(fs.readFileSync(prefsPath(), 'utf8')));
  } catch (error) {
    console.error('Configurazione rete non valida, avvio sicuro come client:', error.message);
    try {
      if (fs.existsSync(prefsPath())) {
        fs.renameSync(prefsPath(), `${prefsPath()}.corrupt-${Date.now()}`);
      }
    } catch (renameError) {
      console.error('Archiviazione configurazione corrotta fallita:', renameError.message);
    }
    return safeClientPrefs(error);
  }
};

const savePrefs = (prefs) => {
  const filePath = prefsPath();
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify(prefs, null, 2));
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch { /* Windows */ }
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
    if (masters.length > 1) {
      const error = new Error('Sono stati trovati più server principali nella rete');
      error.code = 'MULTIPLE_MASTERS';
      error.masters = masters;
      throw error;
    }
    prefs = masters.length === 1
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

const recoverClientByIdentity = async (prefs) => {
  if (prefs.mode !== 'client') return null;
  const masters = await discoverMasters(2200);
  const recovered = selectSingleMaster(masters, prefs.discoveredServerId || null);
  if (!recovered) return null;
  return applyNetworkMode({
    ...prefs,
    mode: 'client',
    apiUrl: recovered.apiUrl,
    discoveredServerId: recovered.serverId,
  });
};

const configureFirstLaunch = async (prefs) => {
  while (true) {
    const masters = await discoverMasters(2000);
    if (masters.length === 1) {
      const master = masters[0];
      const choice = await dialog.showMessageBox({
        type: 'question',
        title: 'Configurazione rete CRM Marmeria',
        message: 'Server principale trovato',
        detail: `${master.name || master.hostname || 'CRM Marmeria'}\n${master.apiUrl}\nID installazione: ${master.serverId}\n\nConferma che questo sia il PC principale della marmeria.`,
        buttons: ['Connetti', 'Cerca di nuovo', 'Chiudi'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      if (choice.response === 0) {
        return applyNetworkMode({
          ...prefs,
          mode: 'client',
          apiUrl: master.apiUrl,
          discoveredServerId: master.serverId,
        });
      }
      if (choice.response === 2) return null;
      continue;
    }

    if (masters.length > 1) {
      const choice = await dialog.showMessageBox({
        type: 'error',
        title: 'Configurazione rete CRM Marmeria',
        message: 'Rilevati più server principali',
        detail: `Sono stati trovati ${masters.length} server o indirizzi concorrenti. Arresta quelli duplicati prima di continuare.`,
        buttons: ['Cerca di nuovo', 'Chiudi'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (choice.response === 1) return null;
      continue;
    }

    const choice = await dialog.showMessageBox({
      type: 'question',
      title: 'Configurazione rete CRM Marmeria',
      message: 'Nessun server principale trovato',
      detail: 'Scegli “PC principale” soltanto sul computer che deve conservare il database della marmeria.',
      buttons: ['Questo è il PC principale', 'Cerca di nuovo', 'Chiudi'],
      defaultId: 1,
      cancelId: 2,
      noLink: true,
    });
    if (choice.response === 0) return applyNetworkMode({ ...prefs, mode: 'master' });
    if (choice.response === 2) return null;
  }
};

const initializeNetwork = async () => {
  const firstLaunch = !fs.existsSync(prefsPath());
  const prefs = readPrefs();

  if (firstLaunch && prefs.mode === 'auto') {
    const result = await configureFirstLaunch(prefs);
    if (result) savePrefs(result.prefs);
    else app.quit();
    return;
  }

  try {
    const result = await applyNetworkMode(prefs);
    savePrefs(result.prefs);
  } catch (error) {
    console.error('Avvio automatico server centrale fallito:', error.message);

    try {
      const recovered = await recoverClientByIdentity(prefs);
      if (recovered) {
        savePrefs(recovered.prefs);
        return;
      }
    } catch (recoveryError) {
      console.error('Recupero del server tramite identità fallito:', recoveryError.message);
    }

    const fallbackMaster = selectSingleMaster(error.masters || [], prefs.discoveredServerId || null);
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
  if (!app.isQuiting) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  app.isQuiting = true;
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

ipcMain.handle('setup-first-admin', async (event, credentials) => {
  assertTrustedSender(event);
  const status = centralServer.getStatus();
  if (!status.isRunning || !status.localApiUrl) {
    return { success: false, error: 'Il server principale locale non è attivo' };
  }
  try {
    const response = await fetch(`${status.localApiUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CRM-Setup-Secret': centralServer.getSetupSecret(),
      },
      body: JSON.stringify(credentials || {}),
    });
    const data = await response.json();
    return response.ok
      ? { success: true, data }
      : { success: false, error: data?.error || 'Configurazione iniziale non riuscita' };
  } catch (error) {
    return { success: false, error: error.message };
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
