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
  preflightUpdate = async () => {},
  launchUpdateRunner = null,
} = {}) => {
  const dataDir = path.join(applicationRoot, 'server', 'data');
  const transactionPath = path.join(dataDir, '.update-transaction.json');
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
  const atomicJson = (target, value) => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, target);
  };
  const readTransaction = () => {
    try {
      const value = JSON.parse(fs.readFileSync(transactionPath, 'utf8'));
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
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
    if (updateInProgress) throw updateError('Aggiornamento già in corso.', 409);
    const previousTransaction = readTransaction();
    if (previousTransaction && !['completed', 'rolled_back'].includes(String(previousTransaction.state || ''))) {
      throw updateError('Esiste già un aggiornamento da completare o recuperare.', 409);
    }

    updateInProgress = true;
    let transactionCreated = false;
    try {
      writeUpdateProgress(dataDir, { stage: 'checking', percent: 5, message: 'Controllo aggiornamento su GitHub...' });
      await workingTreeIsSafe();
      const status = await checkForServerUpdate({ refresh: true });
      if (!status.updateAvailable) {
        const progress = writeUpdateProgress(dataDir, { stage: 'ready', percent: 100, message: 'CRM già aggiornato e pronto per l’uso.' });
        return { ...status, progress, updated: false, restartRequired: false };
      }

      const fromRevision = await command(['rev-parse', 'HEAD']);
      const targetRevision = await command(['rev-parse', `origin/${status.branch}`]);
      writeUpdateProgress(dataDir, {
        stage: 'preflight',
        percent: 15,
        message: 'Verifico la nuova versione prima di fermare il server...',
      });
      await preflightUpdate({
        applicationRoot,
        repositoryRoot,
        branch: status.branch,
        fromRevision,
        targetRevision,
      });

      const transaction = {
        schemaVersion: 1,
        state: 'prepared',
        branch: status.branch,
        fromRevision,
        targetRevision,
        applicationRoot,
        repositoryRoot,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        parentPid: process.pid,
      };
      atomicJson(transactionPath, transaction);
      transactionCreated = true;

      const progress = writeUpdateProgress(dataDir, {
        stage: 'restarting',
        percent: 30,
        message: 'Preflight completato. Riavvio controllato del server...',
      });

      if (typeof launchUpdateRunner !== 'function') {
        throw updateError('Supervisore aggiornamento non disponibile.');
      }
      launchUpdateRunner({
        applicationRoot,
        repositoryRoot,
        dataDir,
        transactionPath,
        transaction,
      });

      return {
        ...status,
        progress,
        updated: true,
        restartRequired: true,
        transaction: {
          state: transaction.state,
          fromRevision,
          targetRevision,
        },
      };
    } catch (error) {
      if (transactionCreated) {
        try { fs.rmSync(transactionPath, { force: true }); } catch { /* best effort */ }
      }
      writeUpdateProgress(dataDir, {
        stage: 'error',
        percent: 0,
        message: error.message || 'Aggiornamento non riuscito.',
        error: true,
      });
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
