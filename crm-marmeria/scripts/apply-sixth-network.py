from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if old not in text:
        raise RuntimeError(f'Pattern not found in {path}: {old[:160]!r}')
    path.write_text(text.replace(old, new, 1))


(ROOT / 'electron/network-config.cjs').write_text(r'''const path = require('path');

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
''')

main = ROOT / 'electron/main.cjs'
replace_once(main, "  normalizeApiUrl,\n  safeClientPrefs,", "  normalizeApiUrl,\n  resolveAutomaticMode,\n  safeClientPrefs,")
replace_once(
    main,
    """  if (prefs.mode === 'auto') {
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
""",
    """  if (prefs.mode === 'auto') {
    prefs = resolveAutomaticMode(prefs, await discoverMasters(1600));
  }
""",
)

component = ROOT / 'src/components/ServerConnectionSettings.tsx'
text = component.read_text()
text = text.replace('            {window.electronAPI && <option value="auto">Automatico al primo avvio</option>}\n', '')
text = text.replace("{prefs.mode === 'master' || prefs.mode === 'auto' ? (", "{prefs.mode === 'master' ? (")
text = text.replace("{(prefs.mode === 'master' || prefs.mode === 'auto') && window.electronAPI && (", "{prefs.mode === 'master' && window.electronAPI && (")
component.write_text(text)

settings = ROOT / 'src/pages/SettingsPage.jsx'
replace_once(settings, "import UserManagement from '../components/UserManagement';\n", "import UserManagement from '../components/UserManagement';\nimport ServerConnectionSettings from '../components/ServerConnectionSettings';\n")
replace_once(settings, "      {user?.role === 'admin' && <UserManagement />}\n", "      {user?.role === 'admin' && <ServerConnectionSettings />}\n      {user?.role === 'admin' && <UserManagement />}\n")
