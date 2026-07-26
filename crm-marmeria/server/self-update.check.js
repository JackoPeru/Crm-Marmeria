const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServerUpdateService } = require('./self-update');

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const write = (file, content = '') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
};
const commit = (cwd, message) => {
  git(['add', '.'], cwd);
  git(['commit', '-m', message], cwd);
};

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
    write(path.join(applicationRoot, 'server', 'data', 'seed.json'), '[]\n');
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
    write(path.join(local, 'crm-marmeria', 'server', 'data', 'runtime.json'), '{}\n');

    git(['clone', '--branch', 'main', remote, publisher], temp);
    git(['config', 'user.email', 'test@crm.local'], publisher);
    git(['config', 'user.name', 'CRM update test'], publisher);
    write(path.join(publisher, 'crm-marmeria', 'README.md'), 'versione aggiornata\n');
    commit(publisher, 'update');
    git(['push'], publisher);

    const updater = createServerUpdateService({
      applicationRoot: path.join(local, 'crm-marmeria'),
      repositoryRoot: local,
      repository: remote,
    });
    const available = await updater.checkForServerUpdate({ refresh: true });
    assert.equal(available.updateAvailable, true);
    assert.equal(available.pendingCommits, 1);

    const applied = await updater.applyServerUpdate();
    assert.equal(applied.updated, true);
    assert.equal(applied.restartRequired, true);
    assert.equal(applied.updateAvailable, false);
    assert.equal(fs.existsSync(path.join(local, 'crm-marmeria', '.crm-update-pending')), true);
    assert.equal(git(['rev-list', '--count', 'HEAD..origin/main'], local), '0');

    fs.rmSync(path.join(local, 'crm-marmeria', '.crm-update-pending'));
    write(path.join(local, 'uncommitted.txt'), 'unsafe\n');
    await assert.rejects(updater.applyServerUpdate(), (error) => error.status === 409);

    console.log('SELF_UPDATE_CHECK_OK');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
