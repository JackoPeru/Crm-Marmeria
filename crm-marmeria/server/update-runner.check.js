const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runUpdateTransaction } = require('./update-runner');

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, 'utf8');
};
const commit = (cwd, message) => {
  git(['add', '.'], cwd);
  git(['commit', '-m', message], cwd);
};

const fixture = () => {
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
  write(path.join(app, 'server', 'data', 'users.json'), 'REAL-DATA\n');
  const data = path.join(app, 'server', 'data');
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

const assertData = (fx) => assert.equal(
  fs.readFileSync(path.join(fx.data, 'users.json'), 'utf8'),
  'REAL-DATA\n',
);

const runSuccess = async () => {
  const fx = fixture();
  try {
    const legacyStops = [];
    const watchdogs = [];
    const result = await runUpdateTransaction(fx.transaction, {
      waitForParentExit: async () => {},
      stopLegacyLauncher: async ({ launcherPid }) => legacyStops.push(launcherPid),
      startWatchdog: async ({ revision }) => watchdogs.push(revision),
      verifyApplication: async () => {},
      startServer: async ({ expectedVersion }) => ({ pid: 100, expectedVersion }),
      waitForHealthy: async ({ expectedVersion }) => expectedVersion === '2.0.0',
      stopServer: async () => {},
    });
    assert.equal(result.updated, true);
    assert.deepEqual(legacyStops, [555555]);
    assert.deepEqual(watchdogs, [fx.target]);
    assert.equal(git(['rev-parse', 'HEAD'], fx.repo), fx.target);
    assert.equal(fs.readFileSync(path.join(fx.app, 'README.md'), 'utf8'), 'NEW\n');
    assertData(fx);
    assert.equal(fs.existsSync(fx.transaction), false);
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
    const result = await runUpdateTransaction(fx.transaction, {
      waitForParentExit: async () => {},
      stopLegacyLauncher: async () => {},
      startWatchdog: async () => { throw new Error('watchdog non deve partire dopo rollback'); },
      verifyApplication: async ({ revision }) => {
        if (failureMode === 'verify' && revision === fx.target) throw new Error('target invalid');
      },
      startServer: async ({ expectedVersion }) => {
        starts.push(expectedVersion);
        return { pid: expectedVersion === '2.0.0' ? 200 : 201 };
      },
      waitForHealthy: async ({ expectedVersion }) => failureMode !== 'health' || expectedVersion === '1.0.0',
      stopServer: async ({ pid }) => stopped.push(pid),
    });
    assert.equal(result.rolledBack, true);
    assert.equal(git(['rev-parse', 'HEAD'], fx.repo), fx.from);
    assert.equal(fs.readFileSync(path.join(fx.app, 'README.md'), 'utf8'), 'OLD\n');
    assertData(fx);
    assert.equal(fs.existsSync(fx.transaction), false);
    const progress = JSON.parse(fs.readFileSync(path.join(fx.data, '.update-progress.json'), 'utf8'));
    assert.equal(progress.stage, 'rolled_back');
    assert.equal(progress.error, true);
    if (failureMode === 'verify') assert.deepEqual(starts, ['1.0.0']);
    if (failureMode === 'health') {
      assert.deepEqual(starts, ['2.0.0', '1.0.0']);
      assert.deepEqual(stopped, [200]);
    }
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
};

(async () => {
  await runSuccess();
  await runRollback('verify');
  await runRollback('health');
  console.log('UPDATE_RUNNER_CHECK_OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
