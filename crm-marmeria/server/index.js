const path = require('path');
const { createCrmServer } = require('./app');
const { readUsers } = require('./middleware/auth');
const { readOrCreateServerId, readOrCreateSetupSecret } = require('./runtime-files');
const { upgradeLegacySnapshots } = require('./snapshot-compat');
const { readOrCreateTlsIdentity } = require('./tls-identity');

let instance = null;

const persistentServerId = (dataDir) => {
  const configured = String(process.env.CRM_SERVER_ID || '').trim();
  return configured || readOrCreateServerId(path.join(dataDir, '.server-id'));
};

const persistentSetupSecret = (dataDir) => {
  const configured = String(process.env.CRM_SETUP_SECRET || '').trim();
  return configured || readOrCreateSetupSecret(path.join(dataDir, '.setup-secret'));
};

const configuredWebRoot = () => {
  const candidate = process.env.CRM_WEB_ROOT || path.resolve(__dirname, '../dist');
  return require('fs').existsSync(path.join(candidate, 'index.html')) ? path.resolve(candidate) : null;
};

const configuredWebOrigins = () => String(process.env.CRM_WEB_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

const defaultAdmin = () => process.env.CRM_SIMPLE_DEFAULT_ADMIN === '1'
  ? {
    username: 'admin',
    password: 'marmo2026!',
    email: 'admin@crm.local',
    firstName: 'Amministratore',
    lastName: 'CRM',
  }
  : null;

const start = async () => {
  const dataDir = process.env.CRM_DATA_DIR || path.join(__dirname, 'data');
  const backupDir = process.env.CRM_BACKUP_DIR || path.join(dataDir, 'backups');
  const serverId = persistentServerId(dataDir);
  const setupSecret = persistentSetupSecret(dataDir);
  const tlsIdentity = process.env.CRM_ENABLE_TLS === '1'
    ? await readOrCreateTlsIdentity(
      path.join(dataDir, '.tls'),
      process.env.CRM_TLS_COMMON_NAME || `crm-marmeria-${serverId}`,
    )
    : null;
  const webRoot = configuredWebRoot();
  const webOrigins = configuredWebOrigins();

  instance = await createCrmServer({
    port: Number(process.env.PORT || 3001),
    host: process.env.HOST || '0.0.0.0',
    dataDir,
    backupDir,
    serverName: process.env.CRM_SERVER_NAME || 'crm-marmeria',
    serverId,
    setupSecret,
    tls: tlsIdentity,
    webRoot,
    webOrigins,
    bootstrapAdmin: defaultAdmin(),
    onUpdateApplied: () => void shutdown(),
  });

  const upgradedSnapshots = upgradeLegacySnapshots({ dataDir, backupDir });
  if (upgradedSnapshots > 0) {
    console.log(`Aggiornati ${upgradedSnapshots} snapshot legacy con gli account correnti`);
  }
  console.log(`CRM Marmeria centrale ${tlsIdentity ? 'HTTPS' : 'HTTP'} attivo su ${instance.host}:${instance.port}`);
  console.log(`ID server: ${serverId}`);
  if (tlsIdentity) console.log(`Impronta certificato TLS: ${tlsIdentity.fingerprint}`);
  if (defaultAdmin()) console.log('Accesso base: admin / marmo2026!');
  if (webRoot) {
    console.log(`Interfaccia web disponibile per: ${webOrigins.join(', ') || 'localhost'}`);
  } else {
    console.warn('Interfaccia web non trovata: eseguire npm run build nella cartella principale.');
  }

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
