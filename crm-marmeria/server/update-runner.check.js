const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const {
  runUpdateTransaction,
  healthIsValid,
  serverProcessIsAlive,
  watchdogRestartAllowed,
  watchdogEnvironment,
  defaultStopServer,
  signalRunnerReady,
  defaultWaitForParentExit,
} = require('./update-runner');

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, 'utf8');
};
const commit = (cwd, message) => {
  git(['add', '.'], cwd);
  git(['commit', '-m', message], cwd);
};

assert.equal(healthIsValid({
  health: { statusCode: 200, body: { mode: 'central-server', status: 'ok', version: '2.0.0', revision: 'target-sha' } },
  expectedVersion: '2.0.0',
  expectedRevision: 'target-sha',
}), true);
assert.equal(healthIsValid({
  health: { statusCode: 200, body: { mode: 'central-server', status: 'ok', version: '2.0.0', revision: 'other-sha' } },
  expectedVersion: '2.0.0',
  expectedRevision: 'target-sha',
}), false, 'Un altro processo con stessa versione ma SHA diverso non deve superare il health check');

assert.equal(watchdogRestartAllowed({
  applicationRoot: 'C:\\crm',
  existsSync: (candidate) => candidate.endsWith('.update-transaction.json'),
  readFileSync: () => JSON.stringify({ state: 'applying' }),
}), false, 'Il watchdog precedente non deve rilanciare il server durante un nuovo update');
assert.equal(watchdogRestartAllowed({
  applicationRoot: 'C:\\crm',
  existsSync: (candidate) => candidate.endsWith('.update-transaction.json'),
  readFileSync: () => JSON.stringify({ state: 'completed' }),
}), true, 'Un server già verificato deve poter essere riavviato durante la finalizzazione');
assert.equal(watchdogRestartAllowed({
  applicationRoot: 'C:\\crm',
  existsSync: () => false,
}), true, 'Il watchdog deve rilanciare il server dopo un crash normale');

assert.equal(
  watchdogEnvironment({ baseEnv: { CRM_RUNTIME_REVISION: 'old-sha', KEEP: '1' }, revision: 'new-sha' }).CRM_RUNTIME_REVISION,
  'new-sha',
);
const watchdogEnv = watchdogEnvironment({
  baseEnv: { CRM_RUNTIME_REVISION: 'old-sha', CRM_UPDATE_CHILD: '1', KEEP: '1' },
  revision: 'new-sha',
});
assert.equal(watchdogEnv.KEEP, '1');
assert.equal(watchdogEnv.CRM_UPDATE_CHILD, undefined, 'Il launcher riavviato non deve ereditare il bypass del recovery');

assert.equal(serverProcessIsAlive({ pid: 123, exitCode: null, signalCode: null }), true);
assert.equal(serverProcessIsAlive({ pid: 123, exitCode: 1, signalCode: null }), false);
assert.equal(serverProcessIsAlive({ pid: undefined, exitCode: null, signalCode: null }), false);

{
  const readyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-runner-ready-'));
  try {
    const transactionPath = path.join(readyRoot, '.update-transaction.json');
    const readyPath = path.join(readyRoot, '.runner-ready.json');
    write(transactionPath, JSON.stringify({ state: 'prepared', fromRevision: 'a', targetRevision: 'b' }));
    signalRunnerReady({ readyPath, transactionPath });
    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf8'));
    assert.equal(ready.transactionPath, transactionPath);
    assert.equal(ready.pid, process.pid);
  } finally {
    fs.rmSync(readyRoot, { recursive: true, force: true });
  }
}

const fixture = ({ externalData = false } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-runner-'));
  const repo = path.join(root, 'repo');
  const app = path.join(repo, 'crm-marmeria');
  fs.mkdirSync(app, { recursive: true });
  git(['init', '-b', 'main'], repo);
  git(['config', 'user.email', 'test@crm.local'], repo);
  git(['config', 'user.name', 'CRM update test'], repo);
  write(path.join(app, 'package.json'), '{"version":"1.0.0"}\n');
  write(path.join(app, 'server', 'package.json'), '{"version":"1.0.0"}\n');
  write(path.join(app, 'server', 'data', 'users.json'), 'REAL-DATA\n');
  write(path.join(app, 'README.md'), 'OLD\n');
  commit(repo, 'old');
  const from = git(['rev-parse', 'HEAD'], repo);

  fs.rmSync(path.join(app, 'server', 'data', 'users.json'));
  write(path.join(app, '.gitignore'), 'server/data/*\n!server/data/.gitkeep\n');
  write(path.join(app, 'server', 'data', '.gitkeep'), '');
  write(path.join(app, 'package.json'), '{"version":"2.0.0"}\n');
  write(path.join(app, 'server', 'package.json'), '{"version":"2.0.0"}\n');
  write(path.join(app, 'README.md'), 'NEW\n');
  commit(repo, 'new');
  const target = git(['rev-parse', 'HEAD'], repo);

  git(['reset', '--hard', from], repo);
  const data = externalData ? path.join(root, 'external-data') : path.join(app, 'server', 'data');
  write(path.join(data, 'users.json'), 'REAL-DATA\n');
  write(path.join(data, 'crm-marmeria.db'), 'REAL-DB\n');
  write(path.join(data, 'attachments', 'keep.txt'), 'REAL-ATTACHMENT\n');
  const transaction = path.join(data, '.update-transaction.json');
  write(transaction, JSON.stringify({
    schemaVersion: 1,
    state: 'prepared',
    branch: 'main',
    fromRevision: from,
    targetRevision: target,
    applicationRoot: app,
    repositoryRoot: repo,
    parentPid: 999999,
    launcherPid: 555555,
  }));
  return { root, repo, app, data, transaction, from, target };
};

const assertData = (fx) => {
  assert.equal(fs.readFileSync(path.join(fx.data, 'users.json'), 'utf8'), 'REAL-DATA\n');
  assert.equal(fs.readFileSync(path.join(fx.data, 'crm-marmeria.db'), 'utf8'), 'REAL-DB\n');
  assert.equal(
    fs.readFileSync(path.join(fx.data, 'attachments', 'keep.txt'), 'utf8'),
    'REAL-ATTACHMENT\n',
  );
};

const runSuccess = async () => {
  const fx = fixture();
  try {
    const legacyStops = [];
    const watchdogs = [];
    const handoffOrder = [];
    const result = await runUpdateTransaction(fx.transaction, {
      waitForParentExit: async () => handoffOrder.push('server-exit'),
      stopLegacyLauncher: async ({ launcherPid }) => {
        legacyStops.push(launcherPid);
        handoffOrder.push('launcher-stop');
      },
      startWatchdog: async ({ revision }) => watchdogs.push(revision),
      verifyApplication: async () => {},
      startServer: async ({ expectedVersion }) => ({ pid: 100, expectedVersion }),
      waitForHealthy: async ({ expectedVersion, expectedRevision }) => expectedVersion === '2.0.0' && expectedRevision === fx.target,
      stopServer: async () => {},
    });
    assert.equal(result.updated, true);
    assert.deepEqual(legacyStops, [555555]);
    assert.deepEqual(handoffOrder, ['launcher-stop', 'server-exit']);
    assert.deepEqual(watchdogs, [fx.target]);
    assert.equal(git(['rev-parse', 'HEAD'], fx.repo), fx.target);
    assert.equal(fs.readFileSync(path.join(fx.app, 'README.md'), 'utf8'), 'NEW\n');
    assertData(fx);
    assert.equal(fs.existsSync(fx.transaction), false);
    assert.equal(fs.existsSync(path.join(fx.data, '.update-data-backup')), false);
    const progress = JSON.parse(fs.readFileSync(path.join(fx.data, '.update-progress.json'), 'utf8'));
    assert.equal(progress.stage, 'ready');
    assert.equal(progress.percent, 100);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
};

const runRollback = async (failureMode) => {
  const fx = fixture();
  try {
    const starts = [];
    const stopped = [];
    const watchdogs = [];
    const result = await runUpdateTransaction(fx.transaction, {
      waitForParentExit: async () => {},
      stopLegacyLauncher: async () => {},
      startWatchdog: async ({ revision }) => watchdogs.push(revision),
      verifyApplication: async ({ revision }) => {
        if (failureMode === 'verify' && revision === fx.target) throw new Error('target invalid');
      },
      startServer: async ({ expectedVersion, dataDir }) => {
        starts.push(expectedVersion);
        if (failureMode === 'health' && expectedVersion === '2.0.0') {
          write(path.join(dataDir, 'users.json'), 'MIGRATED-USERS\n');
          write(path.join(dataDir, 'crm-marmeria.db'), 'MIGRATED-DB\n');
          write(path.join(dataDir, 'attachments', 'keep.txt'), 'MIGRATED-ATTACHMENT\n');
          write(path.join(dataDir, 'attachments', 'new.txt'), 'TARGET-ONLY\n');
        }
        return { pid: expectedVersion === '2.0.0' ? 200 : 201 };
      },
      waitForHealthy: async ({ expectedVersion, expectedRevision }) => {
        assert.ok([fx.target, fx.from].includes(expectedRevision));
        return failureMode !== 'health' || expectedVersion === '1.0.0';
      },
      stopServer: async ({ pid }) => stopped.push(pid),
    });
    assert.equal(result.rolledBack, true);
    assert.equal(git(['rev-parse', 'HEAD'], fx.repo), fx.from);
    assert.equal(fs.readFileSync(path.join(fx.app, 'README.md'), 'utf8'), 'OLD\n');
    assertData(fx);
    assert.equal(fs.existsSync(fx.transaction), false);
    assert.equal(fs.existsSync(path.join(fx.data, '.update-data-backup')), false);
    const progress = JSON.parse(fs.readFileSync(path.join(fx.data, '.update-progress.json'), 'utf8'));
    assert.equal(progress.stage, 'rolled_back');
    assert.equal(progress.error, true);
    assert.deepEqual(watchdogs, [fx.from]);
    if (failureMode === 'verify') assert.deepEqual(starts, ['1.0.0']);
    if (failureMode === 'health') {
      assert.deepEqual(starts, ['2.0.0', '1.0.0']);
      assert.deepEqual(stopped, [200]);
    }
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
};

const runExternalDataSuccess = async () => {
  const fx = fixture({ externalData: true });
  try {
    const starts = [];
    const result = await runUpdateTransaction(fx.transaction, {
      waitForParentExit: async () => {},
      stopLegacyLauncher: async () => {},
      startWatchdog: async ({ dataDir }) => {
        assert.equal(dataDir, fx.data);
      },
      verifyApplication: async ({ dataDir }) => {
        assert.equal(dataDir, fx.data);
      },
      startServer: async ({ expectedVersion, dataDir }) => {
        starts.push({ expectedVersion, dataDir });
        return { pid: 301, exitCode: null, signalCode: null };
      },
      waitForHealthy: async ({ expectedVersion, expectedRevision }) => (
        expectedVersion === '2.0.0' && expectedRevision === fx.target
      ),
      stopServer: async () => {},
    });
    assert.equal(result.updated, true);
    assert.equal(starts[0].dataDir, fx.data);
    assert.equal(git(['rev-parse', 'HEAD'], fx.repo), fx.target);
    assertData(fx);
    assert.equal(fs.existsSync(fx.transaction), false);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
};

(async () => {
  {
    let alive = true;
    const signals = [];
    const fakeKill = (pid, signal) => {
      if (!alive) throw Object.assign(new Error('not found'), { code: 'ESRCH' });
      if (signal === 'SIGKILL') {
        signals.push(signal);
        alive = false;
      }
    };
    await defaultWaitForParentExit({
      parentPid: 777,
      timeoutMs: 5,
      forceTimeoutMs: 50,
      pollMs: 1,
      killProcess: fakeKill,
    });
    assert.deepEqual(signals, ['SIGKILL']);
  }
  {
    const child = new EventEmitter();
    const signals = [];
    child.pid = 901;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = (signal) => {
      signals.push(signal);
      setTimeout(() => {
        child.exitCode = 0;
        child.emit('exit', 0, null);
      }, 5);
      return true;
    };
    await defaultStopServer(child, { graceMs: 100, forceMs: 100 });
    assert.deepEqual(signals, ['SIGTERM']);
  }
  {
    const child = new EventEmitter();
    const signals = [];
    child.pid = 902;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = (signal) => {
      signals.push(signal);
      if (signal === 'SIGKILL') {
        setTimeout(() => {
          child.signalCode = 'SIGKILL';
          child.emit('exit', null, 'SIGKILL');
        }, 5);
      }
      return true;
    };
    await defaultStopServer(child, { graceMs: 10, forceMs: 100 });
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  }

  await runExternalDataSuccess();
  await runSuccess();
  await runRollback('verify');
  await runRollback('health');
  console.log('UPDATE_RUNNER_CHECK_OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
