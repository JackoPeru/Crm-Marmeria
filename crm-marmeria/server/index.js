const path = require('path');
const { createCrmServer } = require('./app');

let instance = null;

const start = async () => {
  instance = await createCrmServer({
    port: Number(process.env.PORT || 3001),
    host: process.env.HOST || '0.0.0.0',
    dataDir: process.env.CRM_DATA_DIR || path.join(__dirname, 'data'),
    backupDir: process.env.CRM_BACKUP_DIR || undefined,
    serverName: process.env.CRM_SERVER_NAME || 'crm-marmeria',
  });
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
