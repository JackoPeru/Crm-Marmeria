'use strict';

const fs = require('fs');
const path = require('path');
const { writeUpdateProgress } = require('./update-progress');

const recoverPendingUpdate = async ({
  dataDir,
  env = process.env,
  loadRunner = (runnerPath) => require(runnerPath),
  currentParentPid = process.ppid,
} = {}) => {
  if (String(env.CRM_UPDATE_CHILD || '') === '1') return false;
  if (!dataDir) throw new Error('Cartella dati mancante per recovery aggiornamento.');

  const transactionPath = path.join(dataDir, '.update-transaction.json');
  if (!fs.existsSync(transactionPath)) return false;

  const runnerPath = path.join(dataDir, '.update-runtime', 'update-runner.cjs');
  if (!fs.existsSync(runnerPath)) {
    throw new Error('Transazione aggiornamento presente ma supervisore di recovery mancante.');
  }

  const transaction = JSON.parse(fs.readFileSync(transactionPath, 'utf8'));
  if (['completed', 'rolled_back'].includes(String(transaction.state || ''))) {
    fs.rmSync(path.join(dataDir, '.update-data-backup'), { recursive: true, force: true });
    if (transaction.applicationRoot) {
      fs.rmSync(path.join(path.resolve(transaction.applicationRoot), '.crm-update-pending'), { force: true });
    }
    fs.rmSync(transactionPath, { force: true });
    if (transaction.state === 'rolled_back') {
      writeUpdateProgress(dataDir, {
        stage: 'rolled_back',
        percent: 100,
        message: `Aggiornamento annullato: versione precedente già ripristinata. Motivo: ${transaction.failure || 'target non valido'}`,
        error: true,
      });
    } else {
      writeUpdateProgress(dataDir, {
        stage: 'ready',
        percent: 100,
        message: 'Aggiornamento completato. CRM pronto per l’uso.',
      });
    }
    return false;
  }

  transaction.parentPid = 0;
  transaction.launcherPid = Number(currentParentPid) || 0;
  const temporary = `${transactionPath}.${process.pid}.recovery.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(transaction, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, transactionPath);

  const runner = loadRunner(runnerPath);
  if (!runner || typeof runner.runUpdateTransaction !== 'function') {
    throw new Error('Supervisore di recovery aggiornamento non valido.');
  }

  await runner.runUpdateTransaction(transactionPath);
  return true;
};

module.exports = { recoverPendingUpdate };
