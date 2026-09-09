const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readUpdateProgress, writeUpdateProgress, markUpdateReady } = require('./update-progress');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-update-progress-'));
try {
  assert.equal(readUpdateProgress(dataDir), null);
  const prepared = writeUpdateProgress(dataDir, { stage: 'build', percent: 82.8, message: 'Compilo interfaccia', updateId: 'update-test-1' });
  assert.equal(prepared.percent, 83);
  assert.equal(readUpdateProgress(dataDir).stage, 'build');
  assert.equal(readUpdateProgress(dataDir).updateId, 'update-test-1');

  fs.writeFileSync(
    path.join(dataDir, '.update-transaction.json'),
    JSON.stringify({ state: 'applying', targetRevision: 'target-sha' }),
    'utf8',
  );
  writeUpdateProgress(dataDir, { stage: 'restarting', percent: 92, message: 'Avvio nuova versione' });
  const healthcheck = markUpdateReady(dataDir);
  assert.equal(healthcheck.stage, 'healthcheck', 'Il server avviato non deve segnare 100% finché il supervisore non verifica /api/health');
  assert.equal(healthcheck.percent, 95);
  assert.equal(healthcheck.error, false);
  assert.equal(healthcheck.updateId, 'update-test-1');

  fs.rmSync(path.join(dataDir, '.update-transaction.json'));
  writeUpdateProgress(dataDir, { stage: 'restarting', percent: 95, message: 'Legacy update pronto al riavvio' });
  const ready = markUpdateReady(dataDir);
  assert.equal(ready.percent, 100);
  assert.equal(ready.stage, 'ready');
  assert.equal(ready.updateId, 'update-test-1');

  writeUpdateProgress(dataDir, { stage: 'error', percent: 0, message: 'Preflight fallito', error: true, updateId: 'failed-update' });
  const preservedError = markUpdateReady(dataDir);
  assert.equal(preservedError.stage, 'error');
  assert.equal(preservedError.error, true);
  assert.equal(preservedError.updateId, 'failed-update');
  console.log('UPDATE_PROGRESS_CHECK_OK');
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
