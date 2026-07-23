const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const rootRequire = Module.createRequire(path.join(__dirname, '../package.json'));
const electronNativeModules = {
  'better-sqlite3': rootRequire.resolve('better-sqlite3'),
  bcrypt: rootRequire.resolve('bcrypt'),
};
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
    const resolvedNativeModule = electronNativeModules[request];
    if (resolvedNativeModule) {
      return originalLoad.call(this, resolvedNativeModule, parent, isMain);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const { CrmDatabase } = require('../server/database');
  const bcrypt = originalLoad.call(
    Module,
    electronNativeModules.bcrypt,
    module,
    false,
  );
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
