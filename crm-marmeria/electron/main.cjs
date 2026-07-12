const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { pathToFileURL } = require('url');
const CentralCrmServer = require('./server.cjs');
const { discoverMasters } = require('./discovery.cjs');
const {
  defaultPrefs,
  normalizeApiUrl,
  resolveAutomaticMode,
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
let updateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  version: null,
  releaseNotes: '',
  percent: 0,
  message: '',
};

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
const probeApi = (apiUrl, expectedServerId = null, expectedTlsFingerprint = null, trustOnFirstUse = false) => probeCentralApi(
  apiUrl,
  expectedServerId,
  { normalizeApiUrl, expectedTlsFingerprint, trustOnFirstUse },
);
const assertTrustedSender = (event) => assertTrustedIpcSender(event, isTrustedRendererUrl);

const setUpdateState = (patch) => {
  updateState = { ...updateState, ...patch };
  mainWindow?.webContents.send('app-update-state', updateState);
  return updateState;
};

const checkForAppUpdate = async () => {
  if (!app.isPackaged) {
    return setUpdateState({
      status: 'unsupported',
      message: 'Gli aggiornamenti automatici funzionano nella versione installata.',
    });
  }
  try {
    setUpdateState({ status: 'checking', message: 'Controllo aggiornamenti...', percent: 0 });
    await autoUpdater.checkForUpdates();
    return updateState;
  } catch (error) {
    return setUpdateState({ status: 'error', message: error.message || 'Controllo aggiornamenti non riuscito' });
  }
};

const configureAppUpdater = () => {
  if (!app.isPackaged) {
    setUpdateState({
      status: 'unsupported',
      message: 'Gli aggiornamenti automatici funzionano nella versione installata.',
    });
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-available', (info) => setUpdateState({
    status: 'available',
    version: info.version,
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
    message: `Versione ${info.version} disponibile`,
  }));
  autoUpdater.on('update-not-available', () => setUpdateState({
    status: 'up-to-date',
    version: app.getVersion(),
    message: 'App giÃ  aggiornata',
  }));
  autoUpdater.on('download-progress', (progress) => setUpdateState({
    status: 'downloading',
    percent: Math.round(progress.percent || 0),
    message: 'Download aggiornamento in corso...',
  }));
  autoUpdater.on('update-downloaded', (info) => setUpdateState({
    status: 'downloaded',
    version: info.version,
    percent: 100,
    message: 'Aggiornamento pronto: riavvia per installarlo.',
  }));
  autoUpdater.on('error', (error) => setUpdateState({
    status: 'error',
    message: error.message || 'Aggiornamento non riuscito',
  }));
  setTimeout(() => { void checkForAppUpdate(); }, 10000);
};

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

const postToLocalServer = (apiUrl, endpoint, payload, setupSecret, expectedTlsFingerprint) => new Promise((resolve, reject) => {
  const target = new URL(`${apiUrl}${endpoint}`);
  const body = JSON.stringify(payload || {});
  const request = https.request(target, {
    method: 'POST',
    rejectUnauthorized: false,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-CRM-Setup-Secret': setupSecret,
    },
  }, (response) => {
    let raw = '';
    const received = String(response.socket?.getPeerCertificate?.().fingerprint || '').toLowerCase();
    response.setEncoding('utf8');
    response.on('data', (chunk) => { raw += chunk; });
    response.on('end', () => {
      if (!received || received !== String(expectedTlsFingerprint || '').toLowerCase()) {
        return reject(new Error('Certificato del server locale non corrispondente'));
      }
      try { resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, data: JSON.parse(raw) }); } catch (error) { reject(error); }
    });
  });
  request.on('error', reject);
  request.end(body);
});

const trustManualTlsServer = async (prefs) => {
  const verified = await probeApi(prefs.apiUrl, prefs.discoveredServerId || null, null, true);
  const choice = await dialog.showMessageBox({
    type: 'warning',
    title: 'Conferma server CRM',
    message: 'Certificato del server da confermare',
    detail: `Indirizzo: ${verified.apiUrl}\nID installazione: ${verified.data.serverId}\nImpronta certificato: ${verified.tlsFingerprint}\n\nConfronta impronta con PC principale. Conferma soltanto se coincide.`,
    buttons: ['Conferma server', 'Annulla'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (choice.response !== 0) {
    const error = new Error('Server non confermato');
    error.code = 'TLS_NOT_CONFIRMED';
    throw error;
  }
  return { ...prefs, apiUrl: verified.apiUrl, discoveredServerId: verified.data.serverId, tlsFingerprint: verified.tlsFingerprint };
};

app.on('certificate-error', (event, _webContents, url, _error, certificate, callback) => {
  const prefs = readPrefs();
  const configured = String(prefs.tlsFingerprint || '').replace(/:/g, '').toLowerCase();
  const received = String(certificate?.fingerprint || '').replace(/:/g, '').toLowerCase();
  if (url.startsWith('https:') && received && configured === received) {
    event.preventDefault();
    callback(true);
    return;
  }
  callback(false);
});

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
    prefs = resolveAutomaticMode(prefs, await discoverMasters(1600));
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
      tlsFingerprint: result.tlsFingerprint,
      apiUrl: result.localApiUrl || `https://127.0.0.1:${prefs.masterPort}/api`,
      backupPath: result.backupPath || prefs.backupPath || '',
    };
    return { success: true, ...result, prefs: resolvedPrefs };
  }

  const verified = await probeApi(
    prefs.apiUrl,
    prefs.discoveredServerId || null,
    prefs.tlsFingerprint || null,
  );
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
      tlsFingerprint: prefs.tlsFingerprint || verified.data.tlsFingerprint || null,
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
    tlsFingerprint: recovered.tlsFingerprint,
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
        detail: `${master.name || master.hostname || 'CRM Marmeria'}\n${master.apiUrl}\nID installazione: ${master.serverId}\nImpronta certificato: ${master.tlsFingerprint}\n\nConfronta impronta con PC principale, poi conferma.`,
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
      tlsFingerprint: fallbackMaster?.tlsFingerprint || prefs.tlsFingerprint,
      lastServerError: error.message,
    });
    savePrefs(fallback);
  }
};

app.whenReady().then(async () => {
  centralServer = new CentralCrmServer();
  await initializeNetwork();
  if (!app.isQuiting) {
    createWindow();
    configureAppUpdater();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  app.isQuiting = true;
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

ipcMain.handle('network-get-prefs', (event) => {
  assertTrustedSender(event);
  return { success: true, prefs: readPrefs() };
});

ipcMain.handle('app-update-status', (event) => {
  assertTrustedSender(event);
  return updateState;
});
ipcMain.handle('app-update-check', (event) => {
  assertTrustedSender(event);
  return checkForAppUpdate();
});
ipcMain.handle('app-update-download', async (event) => {
  assertTrustedSender(event);
  if (!app.isPackaged) return checkForAppUpdate();
  try {
    setUpdateState({ status: 'downloading', percent: 0, message: 'Avvio download aggiornamento...' });
    await autoUpdater.downloadUpdate();
    return updateState;
  } catch (error) {
    return setUpdateState({ status: 'error', message: error.message || 'Download aggiornamento non riuscito' });
  }
});
ipcMain.handle('app-update-install', (event) => {
  assertTrustedSender(event);
  if (updateState.status !== 'downloaded') {
    return { success: false, error: 'Nessun aggiornamento pronto da installare' };
  }
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return { success: true };
});

ipcMain.handle('network-save-prefs', (event, incoming) => {
  assertTrustedSender(event);
  return serializeNetworkOperation(async () => {
    const previousPrefs = readPrefs();
    try {
      let nextPrefs = validatePrefs({ ...previousPrefs, ...incoming });
      if (nextPrefs.mode === 'client' && nextPrefs.apiUrl.startsWith('https:') && !nextPrefs.tlsFingerprint) {
        nextPrefs = await trustManualTlsServer(nextPrefs);
      }
      const result = await applyNetworkMode(nextPrefs);
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
    const prefs = readPrefs();
    const result = await probeApi(apiUrl, expectedServerId, prefs.apiUrl === normalizeApiUrl(apiUrl) ? prefs.tlsFingerprint : null);
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
    const response = await postToLocalServer(
      status.localApiUrl,
      '/auth/login',
      credentials,
      centralServer.getSetupSecret(),
      status.tlsFingerprint,
    );
    return response.ok
      ? { success: true, data: response.data }
      : { success: false, error: response.data?.error || 'Configurazione iniziale non riuscita' };
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
