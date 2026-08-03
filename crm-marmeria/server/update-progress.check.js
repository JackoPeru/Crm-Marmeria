const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readUpdateProgress, writeUpdateProgress, markUpdateReady } = require('./update-progress');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-update-progress-'));
try {
  assert.equal(readUpdateProgress(dataDir), null);
  const prepared = writeUpdateProgress(dataDir, { stage: 'build', percent: 82.8, message: 'Compilo interfaccia' });
  assert.equal(prepared.percent, 83);
  assert.equal(readUpdateProgress(dataDir).stage, 'build');
  const ready = markUpdateReady(dataDir);
  assert.equal(ready.percent, 100);
  assert.equal(ready.stage, 'ready');
  console.log('UPDATE_PROGRESS_CHECK_OK');
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
