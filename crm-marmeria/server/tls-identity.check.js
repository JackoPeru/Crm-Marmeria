const assert = require('assert');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const forge = require('node-forge');
const { createCrmServer } = require('./app');
const { readOrCreateTlsIdentity } = require('./tls-identity');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-tls-identity-'));
  let server;
  try {
    const identity = await readOrCreateTlsIdentity(root, 'crm-marmeria-test', { sans: ['192.168.1.10'] });
    assert.ok(identity.key.length > 0);
    assert.ok(identity.cert.length > 0);
    assert.ok(identity.fingerprint);
    assert.ok(identity.caCert.length > 0);
    assert.ok(identity.caFingerprint);
    assert.ok(fs.existsSync(path.join(root, 'ca-key.pem')));
    assert.ok(fs.existsSync(path.join(root, 'ca-cert.pem')));
    assert.ok(fs.existsSync(path.join(root, 'server-key.pem')));
    assert.ok(fs.existsSync(path.join(root, 'server-cert.pem')));
    // Stabilità: seconda chiamata riusa CA e foglia.
    const again = await readOrCreateTlsIdentity(root, 'ignored', { sans: ['192.168.1.10'] });
    assert.equal(again.fingerprint, identity.fingerprint);
    assert.equal(again.caFingerprint, identity.caFingerprint);
    // La foglia è firmata dalla CA e copre loopback + SAN richieste.
    const leaf = forge.pki.certificateFromPem(identity.cert.toString());
    const ca = forge.pki.certificateFromPem(identity.caCert.toString());
    forge.pki.verifyCertificateChain(forge.pki.createCaStore([ca]), [leaf]);
    assert.equal(ca.getExtension('basicConstraints').cA, true);
    const san = leaf.getExtension('subjectAltName');
    const covered = new Set((san.altNames || []).map((alt) => alt.ip || alt.value));
    for (const expected of ['localhost', '127.0.0.1', '::1', '192.168.1.10']) {
      assert.ok(covered.has(expected), `SAN mancante: ${expected}`);
    }
    // Nuovi SAN richiesti rigenerano solo la foglia, non la CA.
    const rotated = await readOrCreateTlsIdentity(root, 'crm-marmeria-test', { sans: ['192.168.1.11'] });
    assert.equal(rotated.caFingerprint, identity.caFingerprint);
    assert.notEqual(rotated.fingerprint, identity.fingerprint);

    const webRoot = path.join(root, 'web');
    fs.mkdirSync(webRoot);
    fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>CRM LAN</title>');

    const instance = await createCrmServer({
      port: 0,
      host: '127.0.0.1',
      dataDir: path.join(root, 'data'),
      backupDir: path.join(root, 'backups'),
      serverId: '11111111-1111-4111-8111-111111111111',
      tls: rotated,
      webRoot,
      webOrigins: ['https://127.0.0.1'],
    });
    server = instance;
    const get = (urlPath) => new Promise((resolve, reject) => {
      https.get(`https://127.0.0.1:${instance.port}${urlPath}`, { rejectUnauthorized: false }, (response) => {
        const peerFingerprint = response.socket.getPeerCertificate().fingerprint256;
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.resume();
        response.on('end', () => resolve({
          status: response.statusCode,
          headers: response.headers,
          body,
          peerFingerprint,
        }));
      }).on('error', reject);
    });

    const health = await get('/api/health');
    const healthBody = JSON.parse(health.body);
    assert.equal(healthBody.mode, 'central-server');
    assert.equal(healthBody.tlsFingerprint, rotated.fingerprint);
    assert.equal(healthBody.caFingerprint, rotated.caFingerprint);
    assert.equal(health.peerFingerprint.toLowerCase(), rotated.fingerprint.toLowerCase());

    const caDownload = await get('/api/tls/ca');
    assert.equal(caDownload.status, 200);
    assert.match(caDownload.headers['content-type'], /x509-ca-cert/);
    assert.match(caDownload.headers['content-disposition'], /crm-marmeria-ca\.crt/);
    assert.ok(caDownload.body.includes('BEGIN CERTIFICATE'));

    const guide = await new Promise((resolve, reject) => {
      https.get(`https://127.0.0.1:${instance.port}/sicurezza`, { rejectUnauthorized: false }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body }));
      }).on('error', reject);
    });
    assert.equal(guide.status, 200);
    assert.match(guide.body, /Connessione sicura/);
    assert.ok(guide.body.includes(rotated.caFingerprint));

    const page = await get('/');
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
