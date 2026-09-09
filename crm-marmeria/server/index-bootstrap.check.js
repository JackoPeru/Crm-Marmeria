const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-index-bootstrap-'));
  const previousDataDir = process.env.CRM_DATA_DIR;
  const previousSetupSecret = process.env.CRM_SETUP_SECRET;
  const previousRuntimeRevision = process.env.CRM_RUNTIME_REVISION;
  const previousUpdateChild = process.env.CRM_UPDATE_CHILD;
  const originalLoad = Module._load;
  const originalWarn = console.warn;
  const warnings = [];
  let receivedOptions = null;
  let readyDuringCreate = null;

  try {
    process.env.CRM_DATA_DIR = root;
    delete process.env.CRM_SETUP_SECRET;
    process.env.CRM_RUNTIME_REVISION = 'target-sha-test';
    process.env.CRM_UPDATE_CHILD = '1';
    fs.writeFileSync(
      path.join(root, '.update-transaction.json'),
      JSON.stringify({ state: 'applying' }),
      'utf8',
    );
    console.warn = (...args) => warnings.push(args.join(' '));

    Module._load = function loadWithIndexMocks(request, parent, isMain) {
      if (
        parent?.filename?.endsWith(`${path.sep}server${path.sep}index.js`)
        || parent?.filename?.endsWith(`${path.sep}server${path.sep}index-server.js`)
      ) {
        if (request === './app') {
          return {
            createCrmServer: async (options) => {
              receivedOptions = options;
              readyDuringCreate = typeof options.isStartupReady === 'function'
                ? options.isStartupReady()
                : null;
              return {
                host: options.host,
                port: 3001,
                close: async () => undefined,
              };
            },
          };
        }
        if (request === './middleware/auth') {
          return {
            readUsers: () => [{
              id: 'worker-only',
              username: 'worker-only',
              role: 'worker',
              isActive: true,
            }],
          };
        }
        if (request === './snapshot-compat') {
          return { upgradeLegacySnapshots: () => 0 };
        }
        if (request === './tls-identity') {
          return {
            readOrCreateTlsIdentity: async () => ({ key: 'test-key', cert: 'test-cert', fingerprint: 'test-fingerprint' }),
          };
        }
      }
      return originalLoad.call(this, request, parent, isMain);
    };

    require('./index');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(receivedOptions, 'Il server standalone deve avviare createCrmServer');
    assert.match(receivedOptions.serverId, /^[0-9a-f-]{36}$/i);
    assert.match(receivedOptions.setupSecret, /^[0-9a-f]{96}$/i);
    assert.equal(receivedOptions.revision, 'target-sha-test');
    assert.equal(readyDuringCreate, false, 'Il health deve restare starting durante il bootstrap');
    assert.equal(receivedOptions.isStartupReady(), true, 'Il health diventa ready solo a bootstrap completato');
    assert.equal(receivedOptions.isUpdateProbationActive(), true);
    fs.writeFileSync(
      path.join(root, '.update-transaction.json'),
      JSON.stringify({ state: 'completed' }),
      'utf8',
    );
    assert.equal(
      receivedOptions.isUpdateProbationActive(),
      false,
      'Una transazione terminale non deve lasciare il CRM read-only',
    );
    assert.deepEqual(
      receivedOptions.tls,
      { key: 'test-key', cert: 'test-cert', fingerprint: 'test-fingerprint' },
      'Il server browser LAN deve usare TLS per default',
    );
    assert.equal(
      fs.readFileSync(path.join(root, '.setup-secret'), 'utf8').trim(),
      receivedOptions.setupSecret,
      'Il segreto di setup deve essere persistente',
    );
    assert.ok(
      warnings.some((line) => line.includes('Segreto setup locale')),
      'Senza amministratore il bootstrap deve comunicare il segreto locale',
    );
  } finally {
    Module._load = originalLoad;
    console.warn = originalWarn;
    if (previousDataDir === undefined) delete process.env.CRM_DATA_DIR;
    else process.env.CRM_DATA_DIR = previousDataDir;
    if (previousSetupSecret === undefined) delete process.env.CRM_SETUP_SECRET;
    else process.env.CRM_SETUP_SECRET = previousSetupSecret;
    if (previousRuntimeRevision === undefined) delete process.env.CRM_RUNTIME_REVISION;
    else process.env.CRM_RUNTIME_REVISION = previousRuntimeRevision;
    if (previousUpdateChild === undefined) delete process.env.CRM_UPDATE_CHILD;
    else process.env.CRM_UPDATE_CHILD = previousUpdateChild;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
