const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCrmServer } = require('./app');
const { readUsers } = require('./middleware/auth');
const { readOrCreateSetupSecret } = require('./runtime-files');
const { readOrCreateTlsIdentity } = require('./tls-identity');

const runCli = (environment) => new Promise((resolve, reject) => {
  childProcess.execFile(process.execPath, ['first-admin-cli.js'], {
    cwd: __dirname,
    env: environment,
  }, (error, stdout, stderr) => {
    if (error) return reject(new Error(stderr || error.message));
    resolve(stdout);
  });
});

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-first-admin-'));
  let instance;
  try {
    const dataDir = path.join(root, 'data');
    const setupSecret = readOrCreateSetupSecret(path.join(dataDir, '.setup-secret'));
    const tls = await readOrCreateTlsIdentity(path.join(root, 'tls'), 'crm-first-admin-test');
    instance = await createCrmServer({
      port: 0,
      host: '127.0.0.1',
      dataDir,
      backupDir: path.join(root, 'backups'),
      serverId: '22222222-2222-4222-8222-222222222222',
      setupSecret,
      tls,
    });
    const output = await runCli({
      ...process.env,
      PORT: String(instance.port),
      CRM_DATA_DIR: dataDir,
      CRM_FIRST_ADMIN_JSON: JSON.stringify({
        firstName: 'Admin',
        lastName: 'Locale',
        email: 'admin@example.test',
        username: 'admin-lan',
        password: 'Password-locale-123',
      }),
    });
    assert.match(output, /Primo amministratore creato/);
    assert.equal(readUsers().filter((user) => user.role === 'admin' && user.isActive).length, 1);
  } finally {
    if (instance) await instance.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
