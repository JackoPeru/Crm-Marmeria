const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createCrmServer } = require('./app');

const reservePort = () => new Promise((resolve, reject) => {
  const socket = http.createServer();
  socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => {
    const { port } = socket.address();
    socket.close((error) => error ? reject(error) : resolve(port));
  });
});

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-simple-lan-'));
  let instance;
  try {
    const port = await reservePort();
    const origin = `http://127.0.0.1:${port}`;
    const webRoot = path.join(root, 'web');
    fs.mkdirSync(webRoot);
    fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>CRM LAN semplice</title>');
    instance = await createCrmServer({
      port,
      host: '127.0.0.1',
      dataDir: path.join(root, 'data'),
      backupDir: path.join(root, 'backups'),
      webRoot,
      webOrigins: [origin],
      bootstrapAdmin: {
        username: 'admin',
        password: 'marmo2026!',
        email: 'admin@crm.local',
        firstName: 'Amministratore',
        lastName: 'CRM',
      },
    });
    const page = await fetch(`${origin}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /CRM LAN semplice/);
    const health = await fetch(`${origin}/api/health`);
    const healthData = await health.json();
    assert.equal(healthData.setupRequired, false);
    assert.deepEqual(healthData.defaultAdmin, { username: 'admin', password: 'marmo2026!' });
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'marmo2026!' }),
    });
    assert.equal(login.status, 200);
    assert.ok((await login.json()).token);
  } finally {
    if (instance) await instance.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
