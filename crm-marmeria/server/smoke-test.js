const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CrmDatabase } = require('./database');

const makeDatabase = (prefix) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    root,
    db: new CrmDatabase({
      dataDir: path.join(root, 'data'),
      backupDir: path.join(root, 'backups'),
      attachmentsDir: path.join(root, 'attachments'),
    }),
  };
};

const user = { id: 'ci', username: 'ci' };

async function run(mode) {
  if (mode === 'server') {
    const { createCrmServer } = require('./app');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-server-'));
    let instance;
    try {
      instance = await createCrmServer({
        port: 32123,
        host: '127.0.0.1',
        dataDir: path.join(root, 'data'),
        backupDir: path.join(root, 'backups'),
        attachmentsDir: path.join(root, 'attachments'),
        serverName: 'CI',
      });
      const response = await fetch('http://127.0.0.1:32123/api/health');
      assert.equal(response.ok, true, 'L’endpoint health deve rispondere');
      assert.equal((await response.json()).mode, 'central-server');
    } finally {
      if (instance) await instance.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
    return;
  }

  const { root, db } = makeDatabase(`crm-${mode}-`);
  try {
    const created = db.create(
      'project',
      { name: `Test ${mode}`, status: 'In Attesa' },
      user,
      `${mode}-create`,
    );
    assert.equal(created.item.version, 1, 'La creazione deve partire dalla versione 1');

    if (['update', 'conflict'].includes(mode)) {
      const updated = db.update(
        'project',
        created.item.id,
        { status: 'Completato' },
        1,
        user,
        `${mode}-update`,
      );
      assert.equal(updated.item.version, 2, 'L’aggiornamento deve incrementare la versione');
    }

    if (mode === 'conflict') {
      let conflictDetected = false;
      try {
        db.update(
          'project',
          created.item.id,
          { status: 'In Corso' },
          1,
          user,
          'conflict-stale-update',
        );
      } catch (error) {
        conflictDetected = error.status === 409;
      }
      assert.equal(conflictDetected, true, 'Una versione obsoleta deve produrre conflitto 409');
    }

    if (mode === 'snapshot') {
      const snapshot = await db.createSnapshot('ci');
      assert.ok(snapshot.name, 'Il backup deve restituire un nome');
      assert.ok(
        fs.existsSync(path.join(root, 'backups', snapshot.name, 'crm-marmeria.db')),
        'Il file SQLite del backup deve esistere',
      );
      assert.ok(
        db.listSnapshots().some((item) => item.name === snapshot.name),
        'Il backup deve essere elencato',
      );
    }
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run(process.argv[2] || 'create').catch((error) => {
  console.error(error);
  process.exit(1);
});
