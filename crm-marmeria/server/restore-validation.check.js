const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const { CrmDatabase } = require('./database');
const { validateDatabase, validateUsers } = require('./restore-safety');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-restore-validation-'));
const dataDir = path.join(root, 'data');
const backupDir = path.join(root, 'backups');
const attachmentsDir = path.join(root, 'attachments');
const usersPath = path.join(dataDir, 'users.json');
let db;

try {
  db = new CrmDatabase({ dataDir, backupDir, attachmentsDir });
  const client = db.create('client', { id: 'cliente-1', name: 'Cliente' }, { id: 'admin', username: 'admin' }).item;
  db.close();

  validateDatabase(path.join(dataDir, 'crm-marmeria.db'), attachmentsDir);

  const sqlite = require('better-sqlite3')(path.join(dataDir, 'crm-marmeria.db'));
  sqlite.prepare('UPDATE entities SET data_json = ? WHERE entity_type = ? AND id = ?')
    .run('{json corrotto', 'client', client.id);
  sqlite.close();
  assert.throws(
    () => validateDatabase(path.join(dataDir, 'crm-marmeria.db'), attachmentsDir),
    /JSON interno non valido/,
    'SQLite integro con data_json corrotto deve essere rifiutato',
  );

  fs.rmSync(path.join(dataDir, 'crm-marmeria.db'), { force: true });
  db = new CrmDatabase({ dataDir, backupDir, attachmentsDir });
  const project = db.create('project', { id: 'progetto-1', name: 'Progetto' }, { id: 'admin', username: 'admin' }).item;
  db.addAttachments([{
    entityType: 'project',
    entityId: project.id,
    originalName: 'misure.pdf',
    storedName: 'file-mancante.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 123,
  }], { id: 'admin', username: 'admin' });
  db.close();
  assert.throws(
    () => validateDatabase(path.join(dataDir, 'crm-marmeria.db'), attachmentsDir),
    /Allegato mancante/,
    'Un record allegato senza file deve rendere lo snapshot non valido',
  );

  const baseUser = {
    id: 'admin-1', username: 'admin', email: 'admin@example.test',
    password: bcrypt.hashSync('Password-forte-123', 10),
    firstName: 'Admin', lastName: 'Sistema', role: 'admin',
    permissions: ['settings.view'], isActive: true, sessionVersion: 1,
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(usersPath, JSON.stringify([baseUser]));
  assert.equal(validateUsers(usersPath).length, 1);

  fs.writeFileSync(usersPath, JSON.stringify([{ ...baseUser, password: 'non-bcrypt' }]));
  assert.throws(() => validateUsers(usersPath), /hash password non valido/);

  fs.writeFileSync(usersPath, JSON.stringify([{ ...baseUser, isActive: 'true' }]));
  assert.throws(() => validateUsers(usersPath), /stato account non valido/);
} finally {
  try { db?.close(); } catch {}
  fs.rmSync(root, { recursive: true, force: true });
}
