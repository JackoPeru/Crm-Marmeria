const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  readOrCreateServerId,
  readOrCreateSetupSecret,
} = require('./runtime-files');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-runtime-files-'));
try {
  const idPath = path.join(root, '.server-id');
  const firstId = readOrCreateServerId(idPath);
  assert.match(firstId, /^[0-9a-f-]{36}$/i);
  assert.equal(readOrCreateServerId(idPath), firstId);
  fs.writeFileSync(idPath, 'corrotto');
  assert.notEqual(readOrCreateServerId(idPath), 'corrotto');

  const secretPath = path.join(root, '.setup-secret');
  const firstSecret = readOrCreateSetupSecret(secretPath);
  assert.match(firstSecret, /^[0-9a-f]{96}$/i);
  assert.equal(readOrCreateSetupSecret(secretPath), firstSecret);
  fs.writeFileSync(secretPath, 'debole');
  assert.notEqual(readOrCreateSetupSecret(secretPath), 'debole');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
