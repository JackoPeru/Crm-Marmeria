const path = require('path');
const { createCrmServer } = require('./app');
const { readUsers } = require('./middleware/auth');
const { readOrCreateServerId, readOrCreateSetupSecret } = require('./runtime-files');
const { upgradeLegacySnapshots } = require('./snapshot-compat');

let instance = null;

const persistentServerId = (dataDir) => {
  const configured = String(process.env.CRM_SERVER_ID || '').trim();
  return configured || readOrCreateServerId(path.join(dataDir, '.server-id'));
};

const persistentSetupSecret = (dataDir) => {
  const configured = String(process.env.CRM_SETUP_SECRET || '').trim();
  return configured || readOrCreateSetupSecret(path.join(dataDir, '.setup-secret'));
};

const start = async () => {
  const dataDir = process.env.CRM_DATA_DIR || path.join(__dirname, 'data');
  const backupDir = process.env.CRM_BACKUP_DIR || path.join(dataDir, 'backups');
  const serverId = persistentServerId(dataDir);
  const setupSecret = persistentSetupSecret(dataDir);

  instance = await createCrmServer({
    port: Number(process.env.PORT || 3001),
    host: process.env.HOST || '0.0.0.0',
    dataDir,
    backupDir,
    serverName: process.env.CRM_SERVER_NAME || 'crm-marmeria',
    serverId,
    setupSecret,
  });

  const upgradedSnapshots = upgradeLegacySnapshots({ dataDir, backupDir });
  if (upgradedSnapshots > 0) {
    console.log(`Aggiornati ${upgradedSnapshots} snapshot legacy con gli account correnti`);
  }
  console.log(`CRM Marmeria centrale attivo su ${instance.host}:${instance.port}`);
  console.log(`ID server: ${serverId}`);

  if (!readUsers().some((user) => user.role === 'admin' && user.isActive)) {
    console.warn('Configurazione iniziale richiesta: crea il primo amministratore dal computer server.');
    console.warn(`Segreto setup locale: ${setupSecret}`);
    console.warn('L’endpoint di setup accetta richieste soltanto da 127.0.0.1/::1. Conserva il segreto fuori dai log condivisi.');
  }
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
