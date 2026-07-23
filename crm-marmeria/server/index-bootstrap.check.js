const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-index-bootstrap-'));
  const previousDataDir = process.env.CRM_DATA_DIR;
  const previousSetupSecret = process.env.CRM_SETUP_SECRET;
  const originalLoad = Module._load;
  const originalWarn = console.warn;
  const warnings = [];
  let receivedOptions = null;

  try {
    process.env.CRM_DATA_DIR = root;
    delete process.env.CRM_SETUP_SECRET;
    console.warn = (...args) => warnings.push(args.join(' '));

    Module._load = function loadWithIndexMocks(request, parent, isMain) {
      if (parent?.filename?.endsWith(`${path.sep}server${path.sep}index.js`)) {
        if (request === './app') {
          return {
            createCrmServer: async (options) => {
              receivedOptions = options;
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
    assert.equal(receivedOptions.tls.fingerprint, 'test-fingerprint');
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
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
