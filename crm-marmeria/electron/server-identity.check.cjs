const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isValidServerId, readOrCreateServerId } = require('./server-identity.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-server-id-'));
const filePath = path.join(root, 'crm-server-id.txt');
try {
  const generated = readOrCreateServerId(filePath);
  assert.equal(isValidServerId(generated), true);
  assert.equal(readOrCreateServerId(filePath), generated, 'L’identità valida deve restare stabile');

  fs.writeFileSync(filePath, 'identita-corrotta');
  const repaired = readOrCreateServerId(filePath);
  assert.equal(isValidServerId(repaired), true);
  assert.notEqual(repaired, 'identita-corrotta');
  assert.equal(fs.readFileSync(filePath, 'utf8').trim(), repaired);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
