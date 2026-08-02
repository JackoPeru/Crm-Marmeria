const fs = require('fs');
const path = require('path');
const { writePrivateTextAtomically } = require('./runtime-files');

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const ROOT_FOLDER_NAME = 'CRM Marmeria - Backup automatici';
const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  intervalHours: 24,
  retentionCount: 30,
  rootFolderId: '',
  remoteBackups: [],
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastSnapshotName: null,
});

const integrationError = (message, status = 400) => Object.assign(new Error(message), { status });
const toIso = (value) => new Date(value).toISOString();
const validDate = (value) => Number.isFinite(new Date(value).getTime());

const validateInteger = (value, fallback, minimum, maximum, label) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw integrationError(`${label} non valido`);
  }
  return parsed;
};

const normalizedConfig = (raw = {}) => ({
  ...DEFAULT_CONFIG,
  enabled: raw.enabled === undefined ? DEFAULT_CONFIG.enabled : Boolean(raw.enabled),
  intervalHours: validateInteger(raw.intervalHours, DEFAULT_CONFIG.intervalHours, 1, 168, 'Intervallo backup'),
  retentionCount: validateInteger(raw.retentionCount, DEFAULT_CONFIG.retentionCount, 1, 90, 'Numero backup conservati'),
  rootFolderId: String(raw.rootFolderId || ''),
  remoteBackups: Array.isArray(raw.remoteBackups)
    ? raw.remoteBackups
      .filter((item) => item && typeof item === 'object' && item.folderId && item.name && validDate(item.createdAt))
      .map((item) => ({ folderId: String(item.folderId), name: String(item.name), createdAt: toIso(item.createdAt) }))
    : [],
  lastAttemptAt: validDate(raw.lastAttemptAt) ? toIso(raw.lastAttemptAt) : null,
  lastSuccessAt: validDate(raw.lastSuccessAt) ? toIso(raw.lastSuccessAt) : null,
  lastError: raw.lastError ? String(raw.lastError).slice(0, 500) : null,
  lastSnapshotName: raw.lastSnapshotName ? String(raw.lastSnapshotName) : null,
});

const createGoogleDriveBackupService = ({
  dataDir,
  google,
  fetchImpl = global.fetch,
  now = () => new Date(),
} = {}) => {
  if (!dataDir) throw new Error('Cartella dati backup Google Drive mancante');
  if (!google || typeof google.getDriveAccessToken !== 'function' || typeof google.status !== 'function') {
    throw new Error('Integrazione Google Drive non disponibile');
  }
  if (typeof fetchImpl !== 'function') throw new Error('fetch non disponibile per Google Drive');
  const configPath = path.join(dataDir, 'google-drive-backups.json');

  const readConfig = () => {
    try { return normalizedConfig(JSON.parse(fs.readFileSync(configPath, 'utf8'))); } catch { return { ...DEFAULT_CONFIG }; }
  };
  const writeConfig = (config) => {
    const normalized = normalizedConfig(config);
    writePrivateTextAtomically(configPath, `${JSON.stringify(normalized, null, 2)}\n`);
    return normalized;
  };
  const publicStatus = (config = readConfig()) => {
    const googleStatus = google.status();
    return {
      enabled: config.enabled,
      intervalHours: config.intervalHours,
      retentionCount: config.retentionCount,
      connected: Boolean(googleStatus.driveBackupReady),
      accountEmail: googleStatus.email || null,
      lastAttemptAt: config.lastAttemptAt,
      lastSuccessAt: config.lastSuccessAt,
      lastError: config.lastError,
      lastSnapshotName: config.lastSnapshotName,
      remoteBackupCount: config.remoteBackups.length,
    };
  };
  const configure = (input = {}) => {
    const current = readConfig();
    return publicStatus(writeConfig({
      ...current,
      enabled: input.enabled === undefined ? current.enabled : Boolean(input.enabled),
      intervalHours: input.intervalHours === undefined ? current.intervalHours : input.intervalHours,
      retentionCount: input.retentionCount === undefined ? current.retentionCount : input.retentionCount,
    }));
  };
  const isDue = () => {
    const config = readConfig();
    if (!config.enabled || !google.status().driveBackupReady) return false;
    if (!config.lastAttemptAt) return true;
    const elapsed = now().getTime() - new Date(config.lastAttemptAt).getTime();
    const retryHours = config.lastError ? Math.min(config.intervalHours, 1) : config.intervalHours;
    return elapsed >= retryHours * 60 * 60 * 1000;
  };
  const driveError = async (response, fallback) => {
    let message = '';
    try { message = (await response.json()).error?.message || ''; } catch { /* risposta vuota */ }
    throw integrationError(message ? `${fallback}: ${message}` : fallback, response.status || 502);
  };
  const requestJson = async (url, options, fallback) => {
    const response = await fetchImpl(url, options);
    if (!response.ok) await driveError(response, fallback);
    try { return await response.json(); } catch { return null; }
  };
  const driveHeaders = (token, extra = {}) => ({ Authorization: `Bearer ${token}`, ...extra });
  const createFolder = (token, name, parentId = null) => requestJson(
    `${DRIVE_FILES_URL}?fields=id,name`,
    {
      method: 'POST',
      headers: driveHeaders(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    },
    'Google Drive non ha creato cartella backup',
  );
  const fileExists = async (token, fileId) => {
    try {
      await requestJson(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?fields=id`, {
        headers: driveHeaders(token),
      }, 'Cartella backup Google Drive non disponibile');
      return true;
    } catch (error) {
      if (error.status === 404) return false;
      throw error;
    }
  };
  const ensureRootFolder = async (token, config) => {
    if (config.rootFolderId && await fileExists(token, config.rootFolderId)) return config;
    const root = await createFolder(token, ROOT_FOLDER_NAME);
    return writeConfig({ ...config, rootFolderId: String(root?.id || '') });
  };
  const uploadFile = async (token, parentId, name, filePath) => {
    const sizeBytes = fs.statSync(filePath).size;
    const session = await fetchImpl(`${DRIVE_UPLOAD_URL}?uploadType=resumable&fields=id,name,size`, {
      method: 'POST',
      headers: driveHeaders(token, {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/octet-stream',
        'X-Upload-Content-Length': String(sizeBytes),
      }),
      body: JSON.stringify({ name, parents: [parentId], mimeType: 'application/octet-stream' }),
    });
    if (!session.ok) await driveError(session, `Google Drive non ha preparato upload ${name}`);
    const uploadUrl = session.headers.get('location');
    if (!uploadUrl) throw integrationError('Google Drive non ha restituito URL upload', 502);
    const uploaded = await fetchImpl(uploadUrl, {
      method: 'PUT',
      headers: driveHeaders(token, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(sizeBytes),
      }),
      body: fs.createReadStream(filePath),
      duplex: 'half',
    });
    if (!uploaded.ok) await driveError(uploaded, `Google Drive non ha caricato ${name}`);
  };
  const uploadTree = async (token, parentId, directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) throw integrationError(`Link simbolico non consentito nel backup: ${entry.name}`);
      if (stat.isDirectory()) {
        const folder = await createFolder(token, entry.name, parentId);
        await uploadTree(token, String(folder?.id || ''), fullPath);
      } else if (stat.isFile()) {
        await uploadFile(token, parentId, entry.name, fullPath);
      }
    }
  };
  const listChildren = async (token, folderId) => {
    const children = [];
    let pageToken = '';
    do {
      const url = new URL(DRIVE_FILES_URL);
      url.searchParams.set('q', `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`);
      url.searchParams.set('fields', 'nextPageToken,files(id)');
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const page = await requestJson(url.toString(), { headers: driveHeaders(token) }, 'Google Drive non ha elencato backup');
      children.push(...(page?.files || []).map((item) => String(item.id || '')).filter(Boolean));
      pageToken = String(page?.nextPageToken || '');
    } while (pageToken);
    return children;
  };
  const deleteTree = async (token, folderId) => {
    for (const childId of await listChildren(token, folderId)) await deleteTree(token, childId);
    await requestJson(`${DRIVE_FILES_URL}/${encodeURIComponent(folderId)}`, {
      method: 'DELETE', headers: driveHeaders(token),
    }, 'Google Drive non ha eliminato vecchio backup');
  };
  const pruneRemoteBackups = async (token, config) => {
    const ordered = [...config.remoteBackups].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
    const retained = ordered.slice(0, config.retentionCount);
    for (const backup of ordered.slice(config.retentionCount)) await deleteTree(token, backup.folderId);
    return writeConfig({ ...config, remoteBackups: retained });
  };
  const uploadSnapshot = async ({ snapshot, snapshotDirectory }) => {
    const name = String(snapshot?.name || '');
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw integrationError('Nome snapshot Google Drive non valido');
    if (!snapshotDirectory || !fs.statSync(snapshotDirectory).isDirectory()) {
      throw integrationError('Snapshot locale non disponibile per Google Drive', 404);
    }
    let config = readConfig();
    if (!config.enabled) throw integrationError('Backup Google Drive disattivato', 409);
    const attemptAt = toIso(now());
    config = writeConfig({ ...config, lastAttemptAt: attemptAt, lastError: null });
    let accessToken = '';
    let uploadedFolderId = '';
    let snapshotRecorded = false;
    try {
      const account = await google.getDriveAccessToken();
      accessToken = account.token;
      config = await ensureRootFolder(accessToken, config);
      const folder = await createFolder(accessToken, name, config.rootFolderId);
      if (!folder?.id) throw integrationError('Google Drive non ha restituito cartella backup', 502);
      uploadedFolderId = String(folder.id);
      await uploadTree(accessToken, uploadedFolderId, snapshotDirectory);
      const completedAt = toIso(now());
      config = writeConfig({
        ...config,
        remoteBackups: [...config.remoteBackups, { folderId: uploadedFolderId, name, createdAt: completedAt }],
        lastSuccessAt: completedAt,
        lastError: null,
        lastSnapshotName: name,
      });
      snapshotRecorded = true;
      config = await pruneRemoteBackups(accessToken, config);
      return { snapshot: name, uploadedAt: completedAt, status: publicStatus(config) };
    } catch (error) {
      if (accessToken && uploadedFolderId && !snapshotRecorded) {
        await deleteTree(accessToken, uploadedFolderId).catch(() => undefined);
      }
      writeConfig({ ...readConfig(), lastAttemptAt: attemptAt, lastError: String(error.message || 'Backup Google Drive fallito') });
      throw error;
    }
  };
  return { status: () => publicStatus(), configure, isDue, uploadSnapshot };
};

module.exports = { createGoogleDriveBackupService };
