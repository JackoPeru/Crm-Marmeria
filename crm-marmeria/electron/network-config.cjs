const path = require('path');

const defaultPrefs = () => ({
  mode: 'auto',
  masterPort: 3001,
  apiUrl: 'http://127.0.0.1:3001/api',
  backupPath: '',
});

const normalizeApiUrl = (value) => {
  const parsed = new URL(String(value || '').trim());
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

const safeClientPrefs = (error) => ({
  ...defaultPrefs(),
  mode: 'client',
  lastServerError: error?.message || String(error || 'Configurazione rete non valida'),
});

const selectSingleMaster = (masters, expectedServerId = null) => {
  const candidates = expectedServerId
    ? masters.filter((master) => String(master.serverId) === String(expectedServerId))
    : masters;
  return candidates.length === 1 ? candidates[0] : null;
};

module.exports = {
  defaultPrefs,
  normalizeApiUrl,
  safeClientPrefs,
  selectSingleMaster,
  validatePrefs,
};
