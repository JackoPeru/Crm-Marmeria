const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createCrmServer } = require('./app');
const { upgradeLegacySnapshots } = require('./snapshot-compat');

let instance = null;

const persistentServerId = (dataDir) => {
  if (process.env.CRM_SERVER_ID) return String(process.env.CRM_SERVER_ID).trim();
  const filePath = path.join(dataDir, '.server-id');
  if (!fs.existsSync(filePath)) {
    const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(temporary, crypto.randomUUID());
    fs.renameSync(temporary, filePath);
  }
  return fs.readFileSync(filePath, 'utf8').trim();
};

const start = async () => {
  const dataDir = process.env.CRM_DATA_DIR || path.join(__dirname, 'data');
  const backupDir = process.env.CRM_BACKUP_DIR || path.join(dataDir, 'backups');
  const serverId = persistentServerId(dataDir);

  instance = await createCrmServer({
    port: Number(process.env.PORT || 3001),
    host: process.env.HOST || '0.0.0.0',
    dataDir,
    backupDir,
    serverName: process.env.CRM_SERVER_NAME || 'crm-marmeria',
    serverId,
    setupSecret: process.env.CRM_SETUP_SECRET || null,
  });

  const upgradedSnapshots = upgradeLegacySnapshots({ dataDir, backupDir });
  if (upgradedSnapshots > 0) {
    console.log(`Aggiornati ${upgradedSnapshots} snapshot legacy con gli account correnti`);
  }
  console.log(`CRM Marmeria centrale attivo su ${instance.host}:${instance.port}`);
  console.log(`ID server: ${serverId}`);
};

const shutdown = async () => {
  try {
    if (instance) await instance.close();
  } finally {
    process.exit(0);
  }
};

start().catch((error) => {
  console.error('Avvio server fallito:', error);
  process.exit(1);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
