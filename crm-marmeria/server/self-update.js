const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readUpdateProgress, writeUpdateProgress } = require('./update-progress');

const REPOSITORY = 'github.com/jackoperu/crm-marmeria';
const defaultApplicationRoot = path.resolve(__dirname, '..');

const execCommand = (command, args, { cwd, timeout = 10 * 60 * 1000 } = {}) => new Promise((resolve, reject) => {
  execFile(command, args, { cwd, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      error.message = String(stderr || stdout || error.message || `${command} non riuscito`).trim();
      reject(error);
      return;
    }
    resolve(String(stdout || '').trim());
  });
});

const defaultVerifyTarget = async ({ applicationRoot }) => {
  await execCommand(process.execPath, ['verifica-dipendenze.cjs', '--force'], { cwd: applicationRoot });
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  await execCommand(npmCommand, ['run', 'build'], { cwd: applicationRoot });
};

const createTargetPreflight = ({ verifyTarget = defaultVerifyTarget } = {}) => async ({
  applicationRoot,
  repositoryRoot,
  targetRevision,
}) => {
  const relativeApplication = path.relative(repositoryRoot, applicationRoot);
  if (!relativeApplication || path.isAbsolute(relativeApplication) || relativeApplication.startsWith('..')) {
    throw new Error('Percorso applicazione non valido per il preflight.');
  }
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-update-preflight-'));
  const worktreeRoot = path.join(temporaryRoot, 'worktree');
  try {
    await execCommand('git', ['worktree', 'add', '--detach', worktreeRoot, targetRevision], {
      cwd: repositoryRoot,
      timeout: 120000,
    });
    const candidateApplication = path.join(worktreeRoot, relativeApplication);
    await verifyTarget({
      applicationRoot: candidateApplication,
      repositoryRoot: worktreeRoot,
      targetRevision,
    });
  } finally {
    try {
      await execCommand('git', ['worktree', 'remove', '--force', worktreeRoot], {
        cwd: repositoryRoot,
        timeout: 120000,
      });
    } catch {
      // Se git non ha registrato la worktree o la pulizia fallisce, rimuoviamo
      // comunque il contenuto temporaneo senza toccare l'installazione live.
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
};

const createRuntimeRunnerLauncher = ({ spawnRunner = spawn } = {}) => ({
  applicationRoot,
  dataDir,
  transactionPath,
}) => {
  const runtimeDir = path.join(dataDir, '.update-runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const runtimeRunner = path.join(runtimeDir, 'update-runner.cjs');
  const runtimeProgress = path.join(runtimeDir, 'update-progress.js');
  fs.copyFileSync(path.join(applicationRoot, 'server', 'update-runner.js'), runtimeRunner);
  fs.copyFileSync(path.join(applicationRoot, 'server', 'update-progress.js'), runtimeProgress);

  const logPath = path.join(dataDir, 'update-runner.log');
  const output = fs.openSync(logPath, 'a');
  let child;
  try {
    child = spawnRunner(process.execPath, [runtimeRunner, transactionPath], {
      cwd: applicationRoot,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', output, output],
      env: { ...process.env },
    });
  } finally {
    try { fs.closeSync(output); } catch { /* best effort */ }
  }
  if (!child || !Number(child.pid)) throw new Error('Avvio supervisore aggiornamento non riuscito.');
  if (typeof child.unref === 'function') child.unref();
  return { pid: child.pid, runtimeRunner };
};

const defaultPreflightUpdate = createTargetPreflight();
const defaultLaunchUpdateRunner = createRuntimeRunnerLauncher();


const createServerUpdateService = ({
  applicationRoot = defaultApplicationRoot,
  repositoryRoot = path.resolve(applicationRoot, '..'),
  repository = REPOSITORY,
  preflightUpdate = defaultPreflightUpdate,
  launchUpdateRunner = defaultLaunchUpdateRunner,
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
        launcherPid: process.ppid,
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
  createTargetPreflight,
  createRuntimeRunnerLauncher,
};
