const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const rootRequire = Module.createRequire(path.join(__dirname, '../package.json'));
const originalLoad = Module._load;

try {
  Module._load = function loadElectronNativeModule(request, parent, isMain) {
    if (request === 'better-sqlite3' || request === 'bcrypt') {
      return rootRequire(request);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const { CrmDatabase } = require('../server/database');
  const { hashPassword, verifyPassword } = require('../server/middleware/auth');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-electron-native-'));
  const database = new CrmDatabase({
    dataDir: path.join(root, 'data'),
    backupDir: path.join(root, 'backups'),
    attachmentsDir: path.join(root, 'attachments'),
  });

  Promise.resolve()
    .then(async () => {
      const created = database.create(
        'project',
        { name: 'Electron ABI', status: 'In Attesa' },
        { id: 'electron-ci', username: 'electron-ci' },
        'electron-native-create',
      );
      if (created.item.version !== 1) throw new Error('Creazione SQLite Electron fallita');

      const passwordHash = await hashPassword('Electron-password-123');
      if (!(await verifyPassword('Electron-password-123', passwordHash))) {
        throw new Error('Verifica bcrypt Electron fallita');
      }
    })
    .then(() => {
      database.close();
      fs.rmSync(root, { recursive: true, force: true });
      process.exit(0);
    })
    .catch((error) => {
      database.close();
      fs.rmSync(root, { recursive: true, force: true });
      console.error(error);
      process.exit(1);
    });
} finally {
  Module._load = originalLoad;
}
