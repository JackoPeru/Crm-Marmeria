const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-master-check-'));
  const originalLoad = Module._load;
  try {
    Module._load = function loadWithServerMocks(request, parent, isMain) {
      if (request === 'electron') {
        return { app: { getPath: () => root } };
      }
      if (parent?.filename?.endsWith(`${path.sep}electron${path.sep}server.cjs`)) {
        if (request === './discovery.cjs') {
          return {
            DiscoveryAdvertiser: class { start() {} stop() {} },
            discoverMasters: async () => [{
              serverId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              apiUrl: 'https://192.168.1.20:3001/api',
              name: 'Clone CRM',
            }],
            localAddresses: () => ['192.168.1.10'],
          };
        }
        if (request === '../server/snapshot-compat') {
          return { upgradeLegacySnapshots: () => 0 };
        }
        if (request === '../server/app') {
          return { createCrmServer: async () => ({ port: 3001, close: async () => undefined }) };
        }
      }
      return originalLoad.call(this, request, parent, isMain);
    };

    const CentralCrmServer = require('./server.cjs');
    const server = new CentralCrmServer();
    server.serverId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const masters = await server.findOtherMasters(server.serverId);
    assert.equal(
      masters.length,
      1,
      'Un master remoto con lo stesso ID deve essere considerato un clone concorrente',
    );
  } finally {
    Module._load = originalLoad;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
