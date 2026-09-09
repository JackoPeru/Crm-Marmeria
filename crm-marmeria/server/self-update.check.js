const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServerUpdateService, createTargetPreflight, createRuntimeRunnerLauncher, resolveNpmBuildInvocation } = require('./self-update');

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const write = (file, content = '') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
};
const commit = (cwd, message) => {
  git(['add', '.'], cwd);
  git(['commit', '-m', message], cwd);
};

const windowsNpm = resolveNpmBuildInvocation({
  platform: 'win32',
  execPath: 'C:\\Program Files\\nodejs\\node.exe',
  npmExecPath: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
  existsSync: () => true,
});
assert.equal(windowsNpm.command, 'C:\\Program Files\\nodejs\\node.exe');
assert.deepEqual(windowsNpm.args, [
  'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
  'run',
  'build',
]);

const main = async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-self-update-'));
  try {
    const remote = path.join(temp, 'remote.git');
    const seed = path.join(temp, 'seed');
    const local = path.join(temp, 'local');
    const publisher = path.join(temp, 'publisher');
    const applicationRoot = path.join(seed, 'crm-marmeria');

    git(['init', '--bare', remote], temp);
    fs.mkdirSync(applicationRoot, { recursive: true });
    write(path.join(applicationRoot, 'package.json'), '{"version":"1.0.0"}\n');
    write(path.join(applicationRoot, 'server', 'data', 'users.json'), '[{"username":"admin"}]\n');
    write(path.join(applicationRoot, 'server', 'update-runner.js'), "'use strict';\n");
    write(path.join(applicationRoot, 'server', 'update-progress.js'), "'use strict';\n");
    write(path.join(applicationRoot, 'README.md'), 'versione iniziale\n');
    git(['init', '-b', 'main'], seed);
    git(['config', 'user.email', 'test@crm.local'], seed);
    git(['config', 'user.name', 'CRM update test'], seed);
    commit(seed, 'initial');
    git(['remote', 'add', 'origin', remote], seed);
    git(['push', '-u', 'origin', 'main'], seed);
    git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remote);

    git(['clone', remote, local], temp);
    git(['config', 'user.email', 'test@crm.local'], local);
    git(['config', 'user.name', 'CRM update test'], local);
    write(path.join(local, 'crm-marmeria', 'server', 'data', 'users.json'), '[{"username":"cliente-reale"}]\n');

    git(['clone', '--branch', 'main', remote, publisher], temp);
    git(['config', 'user.email', 'test@crm.local'], publisher);
    git(['config', 'user.name', 'CRM update test'], publisher);
    fs.rmSync(path.join(publisher, 'crm-marmeria', 'server', 'data', 'users.json'));
    write(path.join(publisher, 'crm-marmeria', '.gitignore'), 'server/data/*\n!server/data/.gitkeep\n');
    write(path.join(publisher, 'crm-marmeria', 'server', 'data', '.gitkeep'));
    write(path.join(publisher, 'crm-marmeria', 'README.md'), 'versione aggiornata\n');
    write(path.join(publisher, 'crm-marmeria', 'server', 'update-runner.js'), "'use strict';\nmodule.exports = { targetRunner: true };\n");
    write(path.join(publisher, 'crm-marmeria', 'server', 'update-progress.js'), "'use strict';\nmodule.exports = { targetProgress: true };\n");
    commit(publisher, 'update');
    git(['push'], publisher);

    const initialRevision = git(['rev-parse', 'HEAD'], local);
    const targetRevision = git(['rev-parse', 'HEAD'], publisher);
    const launches = [];
    let preflightCalls = 0;
    const customDataDir = path.join(temp, 'external-runtime-data');
    const updater = createServerUpdateService({
      applicationRoot: path.join(local, 'crm-marmeria'),
      repositoryRoot: local,
      repository: remote,
      dataDir: customDataDir,
      preflightUpdate: async ({ targetRevision: target }) => {
        preflightCalls += 1;
        assert.equal(target, targetRevision);
      },
      launchUpdateRunner: (payload) => {
        launches.push(payload);
        return { pid: 4321 };
      },
    });
    const available = await updater.checkForServerUpdate({ refresh: true });
    assert.equal(available.updateAvailable, true);
    assert.equal(available.pendingCommits, 1);

    const applied = await updater.applyServerUpdate();
    assert.equal(applied.updated, true);
    assert.equal(applied.restartRequired, true);
    assert.equal(preflightCalls, 1, 'L’update deve essere validato prima di fermare il server');
    assert.equal(launches.length, 1, 'Deve partire un runner esterno prima dello shutdown');
    assert.equal(
      fs.readFileSync(path.join(local, 'crm-marmeria', 'README.md'), 'utf8'),
      'versione iniziale\n',
      'Il processo server non deve modificare il codice che sta eseguendo',
    );
    assert.equal(git(['rev-parse', 'HEAD'], local), initialRevision, 'HEAD resta sulla versione attiva fino al riavvio');
    assert.equal(git(['rev-list', '--count', 'HEAD..origin/main'], local), '1');

    const transactionPath = path.join(customDataDir, '.update-transaction.json');
    assert.equal(fs.existsSync(transactionPath), true, 'La transazione deve usare CRM_DATA_DIR anche fuori dall’app');
    assert.equal(
      fs.existsSync(path.join(local, 'crm-marmeria', 'server', 'data', '.update-transaction.json')),
      false,
      'La cartella dati predefinita non deve ricevere stato updater quando è configurato un dataDir esterno',
    );
    assert.equal(launches[0].dataDir, customDataDir);
    const transaction = JSON.parse(fs.readFileSync(transactionPath, 'utf8'));
    assert.equal(transaction.fromRevision, initialRevision);
    assert.equal(transaction.targetRevision, targetRevision);
    assert.equal(transaction.branch, 'main');
    assert.equal(transaction.state, 'prepared');
    assert.equal(fs.existsSync(path.join(local, 'crm-marmeria', '.crm-update-pending')), false);

    const preflightSeen = [];
    const preflight = createTargetPreflight({
      verifyTarget: async ({ applicationRoot: candidateRoot, targetRevision: candidateRevision }) => {
        preflightSeen.push(candidateRevision);
        assert.equal(fs.readFileSync(path.join(candidateRoot, 'README.md'), 'utf8'), 'versione aggiornata\n');
        assert.notEqual(path.resolve(candidateRoot), path.resolve(path.join(local, 'crm-marmeria')));
      },
    });
    await preflight({
      applicationRoot: path.join(local, 'crm-marmeria'),
      repositoryRoot: local,
      targetRevision,
    });
    assert.deepEqual(preflightSeen, [targetRevision]);
    assert.equal(
      fs.readFileSync(path.join(local, 'crm-marmeria', 'README.md'), 'utf8'),
      'versione iniziale\n',
      'Il preflight non deve modificare l’installazione live',
    );
    assert.equal(
      git(['worktree', 'list', '--porcelain'], local).includes('crm-update-preflight-'),
      false,
      'La worktree temporanea del preflight deve essere sempre rimossa',
    );

    const spawned = [];
    const runtimeLauncher = createRuntimeRunnerLauncher({
      spawnRunner: (node, args, options) => {
        spawned.push({ node, args, options });
        return { pid: 7654, unref() {} };
      },
    });
    runtimeLauncher({
      applicationRoot: path.join(local, 'crm-marmeria'),
      repositoryRoot: local,
      dataDir: customDataDir,
      transactionPath,
      transaction: { targetRevision },
    });
    const runtimeDir = path.join(customDataDir, '.update-runtime');
    assert.equal(fs.existsSync(path.join(runtimeDir, 'update-runner.cjs')), true);
    assert.equal(fs.existsSync(path.join(runtimeDir, 'update-progress.js')), true);
    assert.match(
      fs.readFileSync(path.join(runtimeDir, 'update-runner.cjs'), 'utf8'),
      /targetRunner: true/,
      'Il supervisore deve essere preso dalla revisione target già verificata',
    );
    assert.match(
      fs.readFileSync(path.join(runtimeDir, 'update-progress.js'), 'utf8'),
      /targetProgress: true/,
    );
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].args[0], path.join(runtimeDir, 'update-runner.cjs'));
    assert.equal(spawned[0].args[1], transactionPath);
    assert.equal(spawned[0].options.detached, true);

    fs.rmSync(transactionPath, { force: true });
    fs.mkdirSync(path.join(customDataDir, '.update-data-backup'), { recursive: true });
    write(path.join(customDataDir, '.update-data-backup', 'stale.txt'), 'stale\n');
    await updater.checkForServerUpdate();
    assert.equal(fs.existsSync(path.join(customDataDir, '.update-data-backup')), true);

    write(transactionPath, '{corrotto');
    await assert.rejects(updater.applyServerUpdate(), (error) => error.status === 409);
    assert.equal(
      fs.existsSync(path.join(customDataDir, '.update-data-backup')),
      true,
      'Un checkpoint non deve essere eliminato se esiste una transazione illeggibile',
    );
    fs.rmSync(transactionPath, { force: true });

    write(path.join(local, 'uncommitted.txt'), 'unsafe\n');
    await assert.rejects(updater.applyServerUpdate(), (error) => error.status === 409);
    assert.equal(
      fs.existsSync(path.join(customDataDir, '.update-data-backup')),
      false,
      'Senza transazione attiva un checkpoint orfano può essere rimosso in sicurezza',
    );

    console.log('SELF_UPDATE_CHECK_OK');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
