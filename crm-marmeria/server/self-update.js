const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPOSITORY = 'github.com/jackoperu/crm-marmeria';
const defaultApplicationRoot = path.resolve(__dirname, '..');

const createServerUpdateService = ({
  applicationRoot = defaultApplicationRoot,
  repositoryRoot = path.resolve(applicationRoot, '..'),
  repository = REPOSITORY,
} = {}) => {
  const updateMarker = path.join(applicationRoot, '.crm-update-pending');
  const runtimeDataPath = path.relative(repositoryRoot, path.join(applicationRoot, 'server', 'data'))
    .replace(/\\/g, '/')
    .toLowerCase();
  let updateInProgress = false;

  const command = (args, timeout = 20000, trim = true) => new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repositoryRoot, timeout, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      error.message = String(stderr || error.message || 'Comando Git non riuscito').trim();
      reject(error);
      return;
    }
    const output = String(stdout || '');
    resolve(trim ? output.trim() : output);
    });
  });

  const localVersion = () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(applicationRoot, 'package.json'), 'utf8')).version || 'sconosciuta';
    } catch {
      return 'sconosciuta';
    }
  };

  const isRuntimeFile = (file) => {
    const normalized = file.replace(/\\/g, '/').toLowerCase();
    return normalized === runtimeDataPath || normalized.startsWith(`${runtimeDataPath}/`);
  };
  const updateError = (message, status = 503) => Object.assign(new Error(message), { status });

  const ensureRepository = async () => {
    if (!fs.existsSync(path.join(repositoryRoot, '.git'))) {
      throw updateError('Aggiornamento server disponibile solo per installazioni collegate a GitHub.');
    }
    const remote = (await command(['remote', 'get-url', 'origin'])).toLowerCase().replace(/\.git$/, '');
    if (!remote.includes(String(repository).toLowerCase().replace(/\.git$/, ''))) {
      throw updateError('Origine Git del server non riconosciuta.');
    }
  };

  const workingTreeIsSafe = async () => {
    const changes = (await command(['status', '--porcelain'], 20000, false)).split(/\r?\n/).filter(Boolean);
    const unsafe = changes
      .map((line) => line.slice(3).replace(/^"|"$/g, '').replace(/\\/g, '/'))
      .filter((file) => !isRuntimeFile(file));
    if (unsafe.length) {
      throw updateError(`Aggiornamento bloccato da modifiche locali: ${unsafe.slice(0, 3).join(', ')}`, 409);
    }
  };

  const checkForServerUpdate = async ({ refresh = false } = {}) => {
  await ensureRepository();
  const branch = await command(['branch', '--show-current']);
  if (!branch || branch === 'HEAD') throw updateError('Branch Git del server non valido.');
  if (refresh) await command(['fetch', '--quiet', 'origin', branch], 60000);
  const localRevision = await command(['rev-parse', '--short', 'HEAD']);
  let remoteRevision = localRevision;
  let pendingCommits = 0;
  try {
    remoteRevision = await command(['rev-parse', '--short', `origin/${branch}`]);
    pendingCommits = Number(await command(['rev-list', '--count', `HEAD..origin/${branch}`])) || 0;
  } catch {
    // Primo avvio offline o branch non ancora tracciato: nessun update applicabile.
  }
  return {
    supported: true,
    version: localVersion(),
    branch,
    localRevision,
    remoteRevision,
    updateAvailable: pendingCommits > 0,
    pendingCommits,
  };
  };

  const applyServerUpdate = async () => {
  if (updateInProgress) throw updateError('Aggiornamento gia in corso.', 409);
  updateInProgress = true;
  try {
    await workingTreeIsSafe();
    const status = await checkForServerUpdate({ refresh: true });
    if (!status.updateAvailable) return { ...status, updated: false, restartRequired: false };
    await command(['pull', '--ff-only', 'origin', status.branch], 90000);
    fs.writeFileSync(updateMarker, 'install dependencies after server update\n', 'utf8');
    const updated = await checkForServerUpdate({ refresh: false });
    return { ...updated, updated: true, restartRequired: true };
  } finally {
    updateInProgress = false;
  }
  };

  return { checkForServerUpdate, applyServerUpdate };
};

const defaultService = createServerUpdateService();

module.exports = {
  ...defaultService,
  createServerUpdateService,
};
