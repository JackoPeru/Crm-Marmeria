const path = require('path');

const defaultPrefs = () => ({
  mode: 'auto',
  masterPort: 3001,
  apiUrl: 'https://127.0.0.1:3001/api',
  backupPath: '',
});

const isLoopbackHostname = (hostname) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

const normalizeApiUrl = (value) => {
  const parsed = new URL(String(value || '').trim());
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname))) {
    throw new Error('I server remoti devono usare https');
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
      : `https://127.0.0.1:${masterPort}/api`,
  };
};

const resolveAutomaticMode = (incomingPrefs, masters) => {
  const prefs = validatePrefs(incomingPrefs);
  if (!Array.isArray(masters) || masters.length === 0) {
    const error = new Error('Nessun server principale trovato. Avvia il PC principale o configura esplicitamente questa postazione come server.');
    error.code = 'NO_MASTER_FOUND';
    throw error;
  }
  if (masters.length > 1) {
    const error = new Error('Sono stati trovati più server principali nella rete');
    error.code = 'MULTIPLE_MASTERS';
    error.masters = masters;
    throw error;
  }
  return validatePrefs({
    ...prefs,
    mode: 'client',
    apiUrl: masters[0].apiUrl,
    discoveredServerId: masters[0].serverId,
    tlsFingerprint: masters[0].tlsFingerprint,
  });
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
  resolveAutomaticMode,
  safeClientPrefs,
  selectSingleMaster,
  validatePrefs,
};
