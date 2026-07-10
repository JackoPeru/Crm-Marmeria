const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const rootRequire = Module.createRequire(path.join(__dirname, '../package.json'));
const originalLoad = Module._load;
let database = null;
let root = null;

const cleanup = () => {
  try {
    database?.close();
  } catch {
    // Il database potrebbe non essere stato aperto.
  }
  if (root) fs.rmSync(root, { recursive: true, force: true });
};

try {
  Module._load = function loadElectronNativeModule(request, parent, isMain) {
    if (request === 'better-sqlite3' || request === 'bcrypt') {
      return rootRequire(request);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const { CrmDatabase } = require('../server/database');
  const bcrypt = rootRequire('bcrypt');
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-electron-native-'));
  database = new CrmDatabase({
    dataDir: path.join(root, 'data'),
    backupDir: path.join(root, 'backups'),
    attachmentsDir: path.join(root, 'attachments'),
  });

  const created = database.create(
    'project',
    { name: 'Electron ABI', status: 'In Attesa' },
    { id: 'electron-ci', username: 'electron-ci' },
    'electron-native-create',
  );
  if (created.item.version !== 1) {
    throw new Error('Creazione SQLite Electron fallita');
  }

  const passwordHash = bcrypt.hashSync('Electron-password-123', 4);
  if (!bcrypt.compareSync('Electron-password-123', passwordHash)) {
    throw new Error('Verifica bcrypt Electron fallita');
  }

  cleanup();
  process.exit(0);
} catch (error) {
  cleanup();
  console.error(error);
  process.exit(1);
} finally {
  Module._load = originalLoad;
}
