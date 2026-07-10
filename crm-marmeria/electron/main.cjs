const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const CentralCrmServer = require('./server.cjs');
const { discoverMasters } = require('./discovery.cjs');

const isDev = process.env.NODE_ENV === 'development';
let centralServer = null;
let mainWindow = null;

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

const defaultPrefs = () => ({
  mode: 'auto',
  masterPort: 3001,
  apiUrl: 'http://127.0.0.1:3001/api',
});
const prefsPath = () => path.join(app.getPath('userData'), 'network-prefs.json');
const readPrefs = () => {
  try {
    return fs.existsSync(prefsPath())
      ? { ...defaultPrefs(), ...JSON.parse(fs.readFileSync(prefsPath(), 'utf8')) }
      : defaultPrefs();
  } catch {
    return defaultPrefs();
  }
};
const savePrefs = (prefs) => {
  const temporary = `${prefsPath()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(prefs, null, 2));
  fs.renameSync(temporary, prefsPath());
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
      preload: path.join(__dirname, 'preload.cjs'),
    },
    icon: path.join(__dirname, 'icon.ico'),
  });
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
};

const applyNetworkMode = async (incomingPrefs) => {
  let prefs = { ...defaultPrefs(), ...incomingPrefs };
  if (prefs.mode === 'auto') {
    const masters = await discoverMasters(1600);
    prefs = masters.length
      ? { ...prefs, mode: 'client', apiUrl: masters[0].apiUrl, discoveredServerId: masters[0].serverId }
      : { ...prefs, mode: 'master', apiUrl: `http://127.0.0.1:${Number(prefs.masterPort || 3001)}/api` };
    savePrefs(prefs);
  }
  if (prefs.mode === 'master') {
    const result = await centralServer.start(prefs.masterPort || 3001, prefs.backupPath || null, { force: Boolean(prefs.forceMaster) });
    const resolved = { ...prefs, apiUrl: result.localApiUrl || `http://127.0.0.1:${Number(prefs.masterPort || 3001)}/api` };
    savePrefs(resolved);
    return { ...result, prefs: resolved };
  }
  if (centralServer.getStatus().isRunning) await centralServer.stop();
  savePrefs(prefs);
  return { success: true, mode: 'client', prefs };
};

app.whenReady().then(async () => {
  centralServer = new CentralCrmServer();
  const prefs = readPrefs();
  try {
    await applyNetworkMode(prefs);
  } catch (error) {
    console.error('Avvio automatico server centrale fallito:', error.message);
    const fallbackMaster = error.masters?.[0];
    savePrefs({
      ...prefs,
      mode: 'client',
      apiUrl: fallbackMaster?.apiUrl || prefs.apiUrl,
      lastServerError: error.message,
    });
  }
  createWindow();
});
app.on('window-all-closed', async () => {
  if (centralServer) await centralServer.stop().catch(() => undefined);
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('network-get-prefs', () => ({ success: true, prefs: readPrefs() }));
ipcMain.handle('network-save-prefs', async (event, incoming) => {
  try {
    const prefs = { ...readPrefs(), ...incoming };
    savePrefs(prefs);
    const result = await applyNetworkMode(prefs);
    return { success: true, prefs: result.prefs || readPrefs(), server: result };
  } catch (error) {
    return { success: false, error: error.message, code: error.code, masters: error.masters };
  }
});
ipcMain.handle('server-start', async (event, port, backupPath, force = false) => {
  try {
    return await centralServer.start(port, backupPath, { force });
  } catch (error) {
    return { success: false, error: error.message, code: error.code, masters: error.masters };
  }
});
ipcMain.handle('server-stop', async () => centralServer.stop());
ipcMain.handle('server-status', async () => centralServer.getStatus());
ipcMain.handle('network-discover-masters', async () => ({ success: true, masters: await discoverMasters(1800) }));
ipcMain.handle('network-pick-backup-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? { success: false } : { success: true, path: result.filePaths[0] };
});
ipcMain.handle('network-test-api', async (event, apiUrl) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${String(apiUrl).replace(/\/$/, '')}/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    return { success: response.ok, data: await response.json() };
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
