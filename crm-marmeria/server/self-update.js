const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { readUpdateProgress, writeUpdateProgress } = require('./update-progress');

const REPOSITORY = 'github.com/jackoperu/crm-marmeria';
const defaultApplicationRoot = path.resolve(__dirname, '..');

const createServerUpdateService = ({
  applicationRoot = defaultApplicationRoot,
  repositoryRoot = path.resolve(applicationRoot, '..'),
  repository = REPOSITORY,
} = {}) => {
  const updateMarker = path.join(applicationRoot, '.crm-update-pending');
  const dataDir = path.join(applicationRoot, 'server', 'data');
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
  const pathsFromOutput = (output) => String(output || '')
    .split('\0')
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, '/'));
  const repositoryPath = (file) => {
    const resolved = path.resolve(repositoryRoot, file);
    const relative = path.relative(repositoryRoot, resolved);
    if (!relative || path.isAbsolute(relative) || relative.startsWith('..')) {
      throw updateError('Percorso aggiornamento Git non valido.');
    }
    return resolved;
  };

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

  const applyRemoteCode = async (branch) => {
    const remoteRef = `origin/${branch}`;
    const changed = pathsFromOutput(await command([
      'diff', '--no-renames', '--diff-filter=ACMRTUXB', '--name-only', '-z', 'HEAD', remoteRef,
    ], 30000, false)).filter((file) => !isRuntimeFile(file));
    const deleted = pathsFromOutput(await command([
      'diff', '--no-renames', '--diff-filter=D', '--name-only', '-z', 'HEAD', remoteRef,
    ], 30000, false)).filter((file) => !isRuntimeFile(file));

    for (const file of [...changed, ...deleted]) repositoryPath(file);

    // Il server continua a usare server/data mentre prepara il riavvio: non
    // spostare, staccare o ripristinare mai quei file durante l'aggiornamento.
    const batchSize = 80;
    for (let index = 0; index < changed.length; index += batchSize) {
      await command([
        'restore', '--source', remoteRef, '--staged', '--worktree', '--', ...changed.slice(index, index + batchSize),
      ], 60000);
    }
    for (const file of deleted) {
      fs.rmSync(repositoryPath(file), { force: true });
    }

    // Aggiorna branch e index senza toccare il working tree. Cosi anche le
    // installazioni storiche, dove users.json era tracciato, mantengono dati.
    await command(['reset', '--mixed', remoteRef], 30000);
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
    progress: readUpdateProgress(dataDir),
  };
  };

  const applyServerUpdate = async () => {
  if (updateInProgress) throw updateError('Aggiornamento gia in corso.', 409);
  updateInProgress = true;
  try {
    writeUpdateProgress(dataDir, { stage: 'checking', percent: 10, message: 'Controllo aggiornamento su GitHub...' });
    await workingTreeIsSafe();
    const status = await checkForServerUpdate({ refresh: true });
    if (!status.updateAvailable) {
      const progress = writeUpdateProgress(dataDir, { stage: 'ready', percent: 100, message: 'CRM già aggiornato e pronto per l’uso.' });
      return { ...status, progress, updated: false, restartRequired: false };
    }
    writeUpdateProgress(dataDir, { stage: 'installing', percent: 25, message: 'Scarico e installo nuovo codice...' });
    await applyRemoteCode(status.branch);
    const progress = writeUpdateProgress(dataDir, { stage: 'restarting', percent: 35, message: 'Codice aggiornato. Riavvio server...' });
    fs.writeFileSync(updateMarker, 'install dependencies after server update\n', 'utf8');
    const updated = await checkForServerUpdate({ refresh: false });
    return { ...updated, progress, updated: true, restartRequired: true };
  } catch (error) {
    writeUpdateProgress(dataDir, { stage: 'error', percent: 0, message: error.message || 'Aggiornamento non riuscito.', error: true });
    throw error;
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
