const assert = require('assert');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  assertTrustedSender,
  createRendererTrustChecker,
  createSerializedExecutor,
  probeApi,
} = require('./main-helpers.cjs');
const { normalizeApiUrl } = require('./network-config.cjs');
const { readOrCreateTlsIdentity } = require('../server/tls-identity');

async function run() {
  const productionFile = path.join(__dirname, '../dist/index.html');
  const productionUrl = pathToFileURL(productionFile).toString();
  const productionTrust = createRendererTrustChecker({ isDev: false, productionFile });
  assert.equal(productionTrust(productionUrl), true);
  assert.equal(productionTrust(`${productionUrl}?route=settings#backup`), true);
  assert.equal(productionTrust(pathToFileURL(path.join(__dirname, '../dist/other.html')).toString()), false);
  assert.equal(productionTrust('https://evil.example'), false);

  const devTrust = createRendererTrustChecker({ isDev: true, productionFile });
  assert.equal(devTrust('http://localhost:5173/settings'), true);
  assert.equal(devTrust('http://localhost:5173.evil.example/settings'), false);

  assert.doesNotThrow(() => assertTrustedSender({ senderFrame: { url: productionUrl } }, productionTrust));
  assert.throws(
    () => assertTrustedSender({ senderFrame: { url: 'https://evil.example' } }, productionTrust),
    /origine non autorizzata/,
  );

  const health = {
    mode: 'central-server',
    serverId: 'server-ci',
    dataEpoch: 'epoch-ci',
  };
  const verified = await probeApi('http://127.0.0.1:3001', 'server-ci', {
    normalizeApiUrl,
    fetchImpl: async (url) => {
      assert.equal(url, 'http://127.0.0.1:3001/api/health');
      return { ok: true, status: 200, json: async () => health };
    },
  });
  assert.equal(verified.apiUrl, 'http://127.0.0.1:3001/api');
  await assert.rejects(
    probeApi('http://127.0.0.1:3001/api', 'server-diverso', {
      normalizeApiUrl,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => health }),
    }),
    (error) => error.code === 'SERVER_ID_MISMATCH',
  );
  await assert.rejects(
    probeApi('http://127.0.0.1:3001/api', null, {
      normalizeApiUrl,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ mode: 'central-server', serverId: 'x' }) }),
    }),
    (error) => error.code === 'INVALID_CRM_SERVER',
  );

  const tlsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-main-helper-tls-'));
  let tlsServer;
  try {
    const identity = await readOrCreateTlsIdentity(tlsRoot, 'crm-main-helper-test');
    tlsServer = https.createServer({ key: identity.key, cert: identity.cert }, (_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ mode: 'central-server', serverId: 'server-tls', dataEpoch: 'epoch-tls' }));
    });
    await new Promise((resolve) => tlsServer.listen(0, '127.0.0.1', resolve));
    const tlsVerified = await probeApi(`https://127.0.0.1:${tlsServer.address().port}/api`, 'server-tls', {
      normalizeApiUrl,
      expectedTlsFingerprint: identity.fingerprint,
    });
    assert.equal(tlsVerified.tlsFingerprint.toLowerCase(), identity.fingerprint.toLowerCase());
    await assert.rejects(
      probeApi(`https://127.0.0.1:${tlsServer.address().port}/api`, 'server-tls', {
        normalizeApiUrl,
        expectedTlsFingerprint: '00:11:22',
      }),
      /Certificato server non corrispondente/,
    );
  } finally {
    if (tlsServer) await new Promise((resolve) => tlsServer.close(resolve));
    fs.rmSync(tlsRoot, { recursive: true, force: true });
  }

  const serialize = createSerializedExecutor();
  const order = [];
  const first = serialize(async () => {
    order.push('first-start');
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push('first-end');
  });
  const failing = serialize(async () => {
    order.push('failing');
    throw new Error('errore previsto');
  });
  const third = serialize(async () => order.push('third'));
  await first;
  await assert.rejects(failing, /errore previsto/);
  await third;
  assert.deepEqual(order, ['first-start', 'first-end', 'failing', 'third']);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
