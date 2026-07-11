const path = require('path');
const { createCrmServer } = require('./app');
const { upgradeLegacySnapshots } = require('./snapshot-compat');

let instance = null;

const start = async () => {
  const dataDir = process.env.CRM_DATA_DIR || path.join(__dirname, 'data');
  const backupDir = process.env.CRM_BACKUP_DIR || path.join(dataDir, 'backups');

  instance = await createCrmServer({
    port: Number(process.env.PORT || 3001),
    host: process.env.HOST || '0.0.0.0',
    dataDir,
    backupDir,
    serverName: process.env.CRM_SERVER_NAME || 'crm-marmeria',
    setupSecret: process.env.CRM_SETUP_SECRET || null,
  });

  const upgradedSnapshots = upgradeLegacySnapshots({ dataDir, backupDir });
  if (upgradedSnapshots > 0) {
    console.log(`Aggiornati ${upgradedSnapshots} snapshot legacy con gli account correnti`);
  }
  console.log(`CRM Marmeria centrale attivo su ${instance.host}:${instance.port}`);
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
