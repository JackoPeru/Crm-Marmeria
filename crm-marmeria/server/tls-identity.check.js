const assert = require('assert');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { createCrmServer } = require('./app');
const { readOrCreateTlsIdentity } = require('./tls-identity');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-tls-identity-'));
  let server;
  try {
    const identity = await readOrCreateTlsIdentity(root, 'crm-marmeria-test');
    assert.ok(identity.key.length > 0);
    assert.ok(identity.cert.length > 0);
    assert.ok(identity.fingerprint);
    assert.equal((await readOrCreateTlsIdentity(root, 'ignored')).fingerprint, identity.fingerprint);
    const webRoot = path.join(root, 'web');
    fs.mkdirSync(webRoot);
    fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>CRM LAN</title>');

    const instance = await createCrmServer({
      port: 0,
      host: '127.0.0.1',
      dataDir: path.join(root, 'data'),
      backupDir: path.join(root, 'backups'),
      serverId: '11111111-1111-4111-8111-111111111111',
      tls: identity,
      webRoot,
      webOrigins: ['https://127.0.0.1'],
    });
    server = instance;
    const fingerprint = await new Promise((resolve, reject) => {
      https.get(`https://127.0.0.1:${instance.port}/api/health`, { rejectUnauthorized: false }, (response) => {
        const peerFingerprint = response.socket.getPeerCertificate().fingerprint;
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.resume();
        response.on('end', () => {
          const health = JSON.parse(body);
          assert.equal(health.mode, 'central-server');
          assert.equal(health.tlsFingerprint, identity.fingerprint);
          resolve(peerFingerprint);
        });
      }).on('error', reject);
    });
    assert.equal(fingerprint.toLowerCase(), identity.fingerprint.toLowerCase());
    const page = await new Promise((resolve, reject) => {
      https.get(`https://127.0.0.1:${instance.port}/`, { rejectUnauthorized: false }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body }));
      }).on('error', reject);
    });
    assert.equal(page.status, 200);
    assert.match(page.body, /CRM LAN/);
  } finally {
    if (server) await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
