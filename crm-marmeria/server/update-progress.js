const fs = require('fs');
const path = require('path');

const statusPath = (dataDir) => path.join(dataDir, '.update-progress.json');
const transactionPath = (dataDir) => path.join(dataDir, '.update-transaction.json');

const readUpdateProgress = (dataDir) => {
  try {
    const value = JSON.parse(fs.readFileSync(statusPath(dataDir), 'utf8'));
    if (!value || typeof value !== 'object') return null;
    return value;
  } catch {
    return null;
  }
};

const writeUpdateProgress = (dataDir, { stage, percent, message, error = false, updateId } = {}) => {
  const current = readUpdateProgress(dataDir);
  const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const value = {
    stage: String(stage || 'unknown'),
    percent: safePercent,
    message: String(message || ''),
    error: Boolean(error),
    updatedAt: new Date().toISOString(),
    ...(updateId !== undefined
      ? { updateId: String(updateId || '') }
      : current?.updateId
        ? { updateId: current.updateId }
        : {}),
  };
  fs.mkdirSync(dataDir, { recursive: true });
  const target = statusPath(dataDir);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, 'utf8');
  fs.renameSync(temporary, target);
  return value;
};

const markUpdateReady = (dataDir) => {
  const current = readUpdateProgress(dataDir);
  if (fs.existsSync(transactionPath(dataDir))) {
    if (current?.stage === 'healthcheck' && current.percent === 95 && !current.error) return current;
    return writeUpdateProgress(dataDir, {
      stage: 'healthcheck',
      percent: 95,
      message: 'Server aggiornato avviato. Verifico che resti operativo...',
    });
  }
  if (!current || current.stage === 'ready' || current.error) return current;
  if (current.stage !== 'restarting') return current;
  return writeUpdateProgress(dataDir, {
    stage: 'ready',
    percent: 100,
    message: 'Aggiornamento completato. CRM pronto per l’uso.',
  });
};

module.exports = { readUpdateProgress, writeUpdateProgress, markUpdateReady };
