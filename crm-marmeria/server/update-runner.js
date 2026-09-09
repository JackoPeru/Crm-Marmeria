'use strict';

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { writeUpdateProgress } = require('./update-progress');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const execFilePromise = (command, args, options = {}) => new Promise((resolve, reject) => {
  execFile(command, args, {
    cwd: options.cwd,
    timeout: options.timeout || 120000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  }, (error, stdout, stderr) => {
    if (error) {
      error.message = String(stderr || error.message || `${command} non riuscito`).trim();
      reject(error);
      return;
    }
    resolve(String(stdout || ''));
  });
});

const atomicJson = (target, value) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, target);
};

const readJson = (target) => JSON.parse(fs.readFileSync(target, 'utf8'));

const normalized = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();

const isInside = (parent, child) => {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!path.isAbsolute(relative) && !relative.startsWith('..'));
};

const pathsFromOutput = (output) => String(output || '')
  .split('\0')
  .filter(Boolean)
  .map((file) => file.replace(/\\/g, '/'));

const readVersion = (applicationRoot) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'server', 'package.json'), 'utf8'));
  return String(manifest.version || '').trim();
};

const git = (repositoryRoot, args, timeout = 120000, raw = false) => execFilePromise('git', args, {
  cwd: repositoryRoot,
  timeout,
}).then((output) => raw ? output : output.trim());

const materializeRevision = async ({
  repositoryRoot,
  applicationRoot,
  fromRevision,
  toRevision,
}) => {
  const runtimeRoot = path.join(applicationRoot, 'server', 'data');
  const runtimeRelative = normalized(path.relative(repositoryRoot, runtimeRoot));
  const isRuntimeFile = (file) => {
    const candidate = normalized(file);
    return candidate === runtimeRelative || candidate.startsWith(`${runtimeRelative}/`);
  };
  const assertRepositoryPath = (file) => {
    const target = path.resolve(repositoryRoot, file);
    if (!isInside(repositoryRoot, target) || target === path.resolve(repositoryRoot)) {
      throw new Error('Percorso Git non valido durante aggiornamento.');
    }
    return target;
  };

  const changed = pathsFromOutput(await git(repositoryRoot, [
    'diff', '--no-renames', '--diff-filter=ACMRTUXB', '--name-only', '-z', fromRevision, toRevision,
  ], 120000, true)).filter((file) => !isRuntimeFile(file));

  const deleted = pathsFromOutput(await git(repositoryRoot, [
    'diff', '--no-renames', '--diff-filter=D', '--name-only', '-z', fromRevision, toRevision,
  ], 120000, true)).filter((file) => !isRuntimeFile(file));

  for (const file of [...changed, ...deleted]) assertRepositoryPath(file);

  const batchSize = 80;
  for (let index = 0; index < changed.length; index += batchSize) {
    await git(repositoryRoot, [
      'restore', '--source', toRevision, '--staged', '--worktree', '--',
      ...changed.slice(index, index + batchSize),
    ], 180000);
  }
  for (const file of deleted) fs.rmSync(assertRepositoryPath(file), { recursive: true, force: true });

  // Allinea branch/index alla revisione scelta senza ripristinare il working tree:
  // in questo modo server/data resta esattamente com'era anche nelle installazioni
  // storiche in cui alcuni file runtime erano tracciati da Git.
  await git(repositoryRoot, ['reset', '--mixed', toRevision], 120000);
};

const defaultStopLegacyLauncher = async ({ launcherPid }) => {
  const pid = Number(launcherPid);
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  const script = [
    `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction SilentlyContinue`,
    "if (-not $p) { exit 0 }",
    "if ($p.Name -ne 'cmd.exe') { exit 0 }",
    "if ($p.CommandLine -notmatch 'avvia-server-lan\\.cmd.*--serve') { exit 0 }",
    `Stop-Process -Id ${pid} -Force -ErrorAction Stop`,
  ].join('; ');
  await execFilePromise('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    timeout: 10000,
  });
};

const defaultWaitForParentExit = async ({ parentPid, timeoutMs = 30000 }) => {
  const deadline = Date.now() + timeoutMs;
  while (Number(parentPid) > 0 && Date.now() < deadline) {
    try {
      process.kill(Number(parentPid), 0);
      await delay(250);
    } catch {
      return;
    }
  }
  if (Number(parentPid) > 0) throw new Error('Il vecchio server non si è arrestato entro il tempo previsto.');
};

const runCommandInherited = (command, args, cwd, timeout = 10 * 60 * 1000) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd,
    windowsHide: true,
    stdio: 'inherit',
    shell: false,
  });
  const timer = setTimeout(() => {
    try { child.kill(); } catch { /* best effort */ }
    reject(new Error(`Timeout eseguendo ${command} ${args.join(' ')}`));
  }, timeout);
  child.once('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once('exit', (code) => {
    clearTimeout(timer);
    if (code === 0) resolve();
    else reject(new Error(`${command} terminato con codice ${code}`));
  });
});

const defaultVerifyApplication = async ({ applicationRoot }) => {
  fs.writeFileSync(path.join(applicationRoot, '.crm-update-pending'), 'transactional update\n', 'utf8');
  await runCommandInherited(process.execPath, ['verifica-dipendenze.cjs'], applicationRoot);
};

const defaultStartServer = async ({ applicationRoot, revision }) => {
  const logDir = path.join(applicationRoot, 'server', 'data');
  fs.mkdirSync(logDir, { recursive: true });
  const output = fs.openSync(path.join(logDir, 'server-update-start.log'), 'a');
  const child = spawn(process.execPath, [path.join(applicationRoot, 'server', 'index.js')], {
    cwd: applicationRoot,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', output, output],
    env: {
      ...process.env,
      CRM_WEB_ROOT: path.join(applicationRoot, 'dist'),
      CRM_ENABLE_TLS: process.env.CRM_ENABLE_TLS || '1',
      CRM_UPDATE_CHILD: '1',
      CRM_RUNTIME_REVISION: String(revision || ''),
    },
  });
  child.once('error', () => {
    try { fs.closeSync(output); } catch { /* best effort */ }
  });
  try { fs.closeSync(output); } catch { /* best effort */ }
  return child;
};

const healthRequest = ({ port = 3001, secure = true, timeoutMs = 3000 }) => new Promise((resolve) => {
  const transport = secure ? https : http;
  const request = transport.get({
    hostname: '127.0.0.1',
    port,
    path: '/api/health',
    timeout: timeoutMs,
    rejectUnauthorized: false,
    agent: false,
  }, (response) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => {
      try {
        resolve({ statusCode: response.statusCode, body: JSON.parse(body) });
      } catch {
        resolve({ statusCode: response.statusCode, body: null });
      }
    });
  });
  request.on('timeout', () => request.destroy());
  request.on('error', () => resolve(null));
});

const healthIsValid = ({ health, expectedVersion, expectedRevision }) => health?.statusCode === 200
  && health.body?.mode === 'central-server'
  && health.body?.status === 'ok'
  && String(health.body?.version || '') === String(expectedVersion || '')
  && String(health.body?.revision || '') === String(expectedRevision || '');

const defaultWaitForHealthy = async ({
  expectedVersion,
  expectedRevision,
  timeoutMs = 90000,
  port = Number(process.env.PORT || 3001),
}) => {
  const deadline = Date.now() + timeoutMs;
  let consecutive = 0;
  while (Date.now() < deadline) {
    const secure = await healthRequest({ port, secure: true });
    const plain = secure || await healthRequest({ port, secure: false });
    const health = plain;
    const valid = healthIsValid({ health, expectedVersion, expectedRevision });
    consecutive = valid ? consecutive + 1 : 0;
    if (consecutive >= 2) return true;
    await delay(1000);
  }
  return false;
};

const defaultStartWatchdog = async ({ applicationRoot, server }) => {
  if (process.platform !== 'win32') return null;
  if (!server || typeof server.once !== 'function') {
    throw new Error('Processo server non monitorabile dal watchdog.');
  }
  const command = process.env.ComSpec || 'cmd.exe';
  const launcher = path.join(applicationRoot, 'avvia-server-lan.cmd');
  if (!fs.existsSync(launcher)) throw new Error('Launcher CRM non trovato dopo update.');

  server.once('exit', () => {
    try {
      const child = spawn(command, ['/d', '/c', launcher, '--serve'], {
        cwd: applicationRoot,
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
        env: { ...process.env },
      });
      if (typeof child.unref === 'function') child.unref();
    } catch {
      // Il server è già terminato: il successivo avvio manuale del launcher
      // resta comunque disponibile. Non riapriamo qui la transazione conclusa.
    }
  });
  return { watchingPid: server.pid };
};

const defaultStopServer = async (server) => {
  if (!server) return;
  if (typeof server.kill === 'function') {
    try { server.kill('SIGTERM'); } catch { /* best effort */ }
    await delay(1000);
    if (server.exitCode == null) {
      try { server.kill('SIGKILL'); } catch { /* best effort */ }
    }
    return;
  }
  if (Number(server.pid) > 0) {
    try { process.kill(Number(server.pid), 'SIGTERM'); } catch { /* best effort */ }
  }
};

const runUpdateTransaction = async (transactionPath, dependencies = {}) => {
  const transaction = readJson(transactionPath);
  const applicationRoot = path.resolve(transaction.applicationRoot);
  const repositoryRoot = path.resolve(transaction.repositoryRoot);
  const dataDir = path.dirname(path.resolve(transactionPath));
  const marker = path.join(applicationRoot, '.crm-update-pending');
  const waitForParentExit = dependencies.waitForParentExit || defaultWaitForParentExit;
  const stopLegacyLauncher = dependencies.stopLegacyLauncher || defaultStopLegacyLauncher;
  const verifyApplication = dependencies.verifyApplication || defaultVerifyApplication;
  const startServer = dependencies.startServer || defaultStartServer;
  const waitForHealthy = dependencies.waitForHealthy || defaultWaitForHealthy;
  const stopServer = dependencies.stopServer || defaultStopServer;
  const startWatchdog = dependencies.startWatchdog || defaultStartWatchdog;
  let targetServer = null;

  if (!isInside(repositoryRoot, applicationRoot) || !isInside(applicationRoot, dataDir)) {
    throw new Error('Percorsi transazione aggiornamento non validi.');
  }

  const updateTransaction = (state, extra = {}) => {
    Object.assign(transaction, extra, { state, updatedAt: new Date().toISOString() });
    atomicJson(transactionPath, transaction);
  };

  const verifyRevision = async (revision, progressMessage) => {
    writeUpdateProgress(dataDir, {
      stage: 'verifying',
      percent: revision === transaction.targetRevision ? 65 : 35,
      message: progressMessage,
    });
    await verifyApplication({ applicationRoot, repositoryRoot, revision, transaction });
  };

  const startAndCheck = async (revision, progressMessage) => {
    const expectedVersion = readVersion(applicationRoot);
    writeUpdateProgress(dataDir, {
      stage: 'restarting',
      percent: revision === transaction.targetRevision ? 85 : 55,
      message: progressMessage,
    });
    const server = await startServer({
      applicationRoot,
      repositoryRoot,
      revision,
      expectedVersion,
      transaction,
    });
    const healthy = await waitForHealthy({
      applicationRoot,
      revision,
      expectedVersion,
      expectedRevision: revision,
      server,
      transaction,
    });
    if (!healthy) {
      const error = new Error(`Il server ${expectedVersion} non ha superato il controllo di salute.`);
      error.server = server;
      throw error;
    }
    return server;
  };

  await stopLegacyLauncher({
    launcherPid: transaction.launcherPid,
    applicationRoot,
    repositoryRoot,
    transaction,
  });
  await waitForParentExit({
    parentPid: transaction.parentPid,
    applicationRoot,
    repositoryRoot,
    transaction,
  });

  try {
    updateTransaction('applying');
    writeUpdateProgress(dataDir, { stage: 'installing', percent: 40, message: 'Applico la nuova versione...' });
    await materializeRevision({
      repositoryRoot,
      applicationRoot,
      fromRevision: transaction.fromRevision,
      toRevision: transaction.targetRevision,
    });

    await verifyRevision(transaction.targetRevision, 'Verifico dipendenze e build della nuova versione...');
    targetServer = await startAndCheck(transaction.targetRevision, 'Avvio la nuova versione e ne verifico la stabilità...');

    updateTransaction('completed');
    fs.rmSync(transactionPath, { force: true });
    fs.rmSync(marker, { force: true });
    await startWatchdog({
      applicationRoot,
      repositoryRoot,
      revision: transaction.targetRevision,
      server: targetServer,
      transaction,
    });
    writeUpdateProgress(dataDir, {
      stage: 'ready',
      percent: 100,
      message: 'Aggiornamento completato. CRM pronto per l’uso.',
    });
    return { updated: true, rolledBack: false, revision: transaction.targetRevision };
  } catch (targetError) {
    const failedServer = targetError.server || targetServer;
    if (failedServer) await stopServer(failedServer);

    try {
      updateTransaction('rolling_back', { failure: String(targetError.message || targetError) });
      writeUpdateProgress(dataDir, {
        stage: 'rolling_back',
        percent: 20,
        message: 'Nuova versione non valida. Ripristino automaticamente la versione precedente...',
      });

      await materializeRevision({
        repositoryRoot,
        applicationRoot,
        fromRevision: transaction.targetRevision,
        toRevision: transaction.fromRevision,
      });
      await verifyRevision(transaction.fromRevision, 'Verifico la versione precedente ripristinata...');
      const rollbackServer = await startAndCheck(transaction.fromRevision, 'Riavvio la versione precedente...');

      fs.rmSync(transactionPath, { force: true });
      fs.rmSync(marker, { force: true });
      await startWatchdog({
        applicationRoot,
        repositoryRoot,
        revision: transaction.fromRevision,
        server: rollbackServer,
        transaction,
      });
      writeUpdateProgress(dataDir, {
        stage: 'rolled_back',
        percent: 100,
        message: `Aggiornamento annullato: ripristinata automaticamente la versione precedente. Motivo: ${targetError.message || targetError}`,
        error: true,
      });
      return {
        updated: false,
        rolledBack: true,
        revision: transaction.fromRevision,
        error: String(targetError.message || targetError),
      };
    } catch (rollbackError) {
      updateTransaction('rollback_failed', {
        failure: String(targetError.message || targetError),
        rollbackFailure: String(rollbackError.message || rollbackError),
      });
      writeUpdateProgress(dataDir, {
        stage: 'rollback_failed',
        percent: 0,
        message: `Rollback automatico non riuscito: ${rollbackError.message || rollbackError}`,
        error: true,
      });
      throw rollbackError;
    }
  }
};

module.exports = {
  runUpdateTransaction,
  materializeRevision,
  defaultWaitForHealthy,
  healthIsValid,
  defaultStopLegacyLauncher,
  defaultStartWatchdog,
};

if (require.main === module) {
  const transactionPath = process.argv[2];
  if (!transactionPath) {
    console.error('Percorso transazione aggiornamento mancante.');
    process.exitCode = 2;
  } else {
    runUpdateTransaction(transactionPath)
      .then((result) => {
        console.log(JSON.stringify(result));
      })
      .catch((error) => {
        console.error('Aggiornamento transazionale fallito:', error);
        process.exitCode = 1;
      });
  }
}
