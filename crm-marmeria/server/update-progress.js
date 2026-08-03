const fs = require('fs');
const path = require('path');

const statusPath = (dataDir) => path.join(dataDir, '.update-progress.json');

const readUpdateProgress = (dataDir) => {
  try {
    const value = JSON.parse(fs.readFileSync(statusPath(dataDir), 'utf8'));
    if (!value || typeof value !== 'object') return null;
    return value;
  } catch {
    return null;
  }
};

const writeUpdateProgress = (dataDir, { stage, percent, message, error = false }) => {
  const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const value = {
    stage: String(stage || 'unknown'),
    percent: safePercent,
    message: String(message || ''),
    error: Boolean(error),
    updatedAt: new Date().toISOString(),
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
  if (!current || current.stage === 'ready') return current;
  return writeUpdateProgress(dataDir, {
    stage: 'ready',
    percent: 100,
    message: 'Aggiornamento completato. CRM pronto per l’uso.',
  });
};

module.exports = { readUpdateProgress, writeUpdateProgress, markUpdateReady };
