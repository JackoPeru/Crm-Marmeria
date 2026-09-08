const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { recoverPendingUpdate } = require('./update-recovery');

const main = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-update-recovery-'));
  try {
    const dataDir = path.join(root, 'data');
    const runtimeDir = path.join(dataDir, '.update-runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    const transactionPath = path.join(dataDir, '.update-transaction.json');
    fs.writeFileSync(transactionPath, '{"state":"applying"}\n', 'utf8');
    fs.writeFileSync(
      path.join(runtimeDir, 'update-runner.cjs'),
      "module.exports={runUpdateTransaction:async p=>{require('fs').writeFileSync(p+'.recovered','ok')}};\n",
      'utf8',
    );

    const recovered = await recoverPendingUpdate({ dataDir, env: {} });
    assert.equal(recovered, true);
    assert.equal(fs.readFileSync(`${transactionPath}.recovered`, 'utf8'), 'ok');

    fs.rmSync(`${transactionPath}.recovered`);
    const bypassed = await recoverPendingUpdate({
      dataDir,
      env: { CRM_UPDATE_CHILD: '1' },
    });
    assert.equal(bypassed, false, 'Il server avviato dal supervisore non deve rilanciare il recovery');
    assert.equal(fs.existsSync(`${transactionPath}.recovered`), false);

    fs.rmSync(transactionPath);
    assert.equal(await recoverPendingUpdate({ dataDir, env: {} }), false);

    console.log('UPDATE_RECOVERY_CHECK_OK');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
