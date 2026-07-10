const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const WebSocket = require('ws');
const { CrmDatabase } = require('./database');

const makeDatabase = (prefix) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dataDir = path.join(root, 'data');
  const backupDir = path.join(root, 'backups');
  const attachmentsDir = path.join(root, 'attachments');
  return {
    root,
    dataDir,
    backupDir,
    attachmentsDir,
    db: new CrmDatabase({ dataDir, backupDir, attachmentsDir }),
  };
};

const user = { id: 'ci', username: 'ci' };
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const requestJson = async (baseUrl, route, options = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
};

async function runServerTest() {
  const { createCrmServer } = require('./app');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-server-'));
  const dataDir = path.join(root, 'data');
  const backupDir = path.join(root, 'backups');
  const attachmentsDir = path.join(root, 'attachments');
  fs.mkdirSync(dataDir, { recursive: true });

  const password = 'Test-password-123';
  const passwordHash = await bcrypt.hash(password, 4);
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([
    {
      id: 'admin-ci',
      username: 'admin-ci',
      email: 'admin-ci@example.test',
      password: passwordHash,
      firstName: 'Admin',
      lastName: 'CI',
      role: 'admin',
      isActive: true,
      permissions: [
        'dashboard.view',
        'clients.view', 'clients.create', 'clients.edit', 'clients.delete',
        'projects.view', 'projects.create', 'projects.edit', 'projects.delete',
        'materials.view', 'materials.create', 'materials.edit', 'materials.delete',
        'quotes.view', 'quotes.create', 'quotes.edit', 'quotes.delete',
        'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete',
        'orders.view', 'orders.create', 'orders.edit', 'orders.delete',
        'settings.view', 'settings.edit',
      ],
    },
    {
      id: 'worker-ci',
      username: 'worker-ci',
      email: 'worker-ci@example.test',
      password: passwordHash,
      firstName: 'Worker',
      lastName: 'CI',
      role: 'worker',
      isActive: true,
      permissions: [
        'dashboard.view',
        'projects.view', 'projects.edit',
        'materials.view', 'materials.edit',
        'orders.view', 'orders.edit',
      ],
    },
  ], null, 2));

  let instance;
  let workerSocket;
  try {
    instance = await createCrmServer({
      port: 0,
      host: '127.0.0.1',
      dataDir,
      backupDir,
      attachmentsDir,
      serverName: 'CI',
    });
    const baseUrl = `http://127.0.0.1:${instance.port}/api`;

    const health = await requestJson(baseUrl, '/health');
    assert.equal(health.response.ok, true, 'L’endpoint health deve rispondere');
    assert.equal(health.body.mode, 'central-server');

    const login = async (username) => {
      const result = await requestJson(baseUrl, '/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      assert.equal(result.response.status, 200, `Login ${username} fallito`);
      return result.body.token;
    };

    const adminToken = await login('admin-ci');
    const workerToken = await login('worker-ci');
    const authHeaders = (token) => ({ Authorization: `Bearer ${token}` });

    const invalidToken = await requestJson(baseUrl, '/auth/me', {
      headers: authHeaders('token-non-valido'),
    });
    assert.equal(invalidToken.response.status, 401, 'Un token non valido deve restituire 401');

    const deniedInvoices = await requestJson(baseUrl, '/invoices', {
      headers: authHeaders(workerToken),
    });
    assert.equal(deniedInvoices.response.status, 403, 'L’operaio non deve leggere le fatture');

    const createdProject = await requestJson(baseUrl, '/projects', {
      method: 'POST',
      headers: {
        ...authHeaders(adminToken),
        'X-Operation-Id': 'project-create-ci',
      },
      body: JSON.stringify({
        name: 'Progetto da non cancellare',
        customerId: 'cliente-uuid',
        deadline: '2030-01-01',
        budget: '€ 1.000,00',
        status: 'In Attesa',
      }),
    });
    assert.equal(createdProject.response.status, 201);

    const workerUpdate = await requestJson(
      baseUrl,
      `/projects/${createdProject.body.id}`,
      {
        method: 'PUT',
        headers: {
          ...authHeaders(workerToken),
          'If-Match': String(createdProject.body.version),
          'X-Operation-Id': 'worker-update-ci',
        },
        body: JSON.stringify({
          status: 'In Lavorazione',
          phase: 'Taglio',
        }),
      },
    );
    assert.equal(workerUpdate.response.status, 200, 'L’operaio deve aggiornare la produzione');
    assert.equal(workerUpdate.body.name, 'Progetto da non cancellare', 'L’aggiornamento operaio non deve cancellare il nome');
    assert.equal(workerUpdate.body.deadline, '2030-01-01', 'L’aggiornamento operaio non deve cancellare la scadenza');
    assert.equal(workerUpdate.body.budget, '€ 1.000,00', 'L’aggiornamento operaio non deve cancellare il budget');

    workerSocket = new WebSocket(
      `ws://127.0.0.1:${instance.port}/ws?token=${encodeURIComponent(workerToken)}`,
    );
    const workerEvents = [];
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout connessione WebSocket')), 2000);
      workerSocket.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      workerSocket.once('error', reject);
    });
    workerSocket.on('message', (message) => {
      try {
        const event = JSON.parse(message.toString());
        if (event.event !== 'connected') workerEvents.push(event);
      } catch {
        // Ignora ping/pong testuali.
      }
    });

    const invoice = await requestJson(baseUrl, '/invoices', {
      method: 'POST',
      headers: {
        ...authHeaders(adminToken),
        'X-Operation-Id': 'invoice-create-ci',
      },
      body: JSON.stringify({
        date: '2030-01-01',
        customerId: 'cliente-uuid',
        items: [{ description: 'Test', quantity: 1, unitPrice: 100, taxRate: 22 }],
        total: 122,
        status: 'Non Pagata',
      }),
    });
    assert.equal(invoice.response.status, 201);
    assert.match(invoice.body.invoiceNumber, /^FATT-2030-\d{3}$/);
    await wait(250);
    assert.equal(
      workerEvents.some((event) => event.entityType === 'invoice'),
      false,
      'Il realtime non deve inviare fatture agli operai',
    );

    const createUsers = await Promise.all(['utente-a', 'utente-b'].map((username) => (
      requestJson(baseUrl, '/users', {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({
          username,
          email: `${username}@example.test`,
          password,
          firstName: username,
          lastName: 'CI',
          role: 'worker',
          permissions: ['dashboard.view'],
        }),
      })
    )));
    assert.ok(createUsers.every((result) => result.response.status === 201));
    const users = await requestJson(baseUrl, '/users', {
      headers: authHeaders(adminToken),
    });
    assert.ok(users.body.some((entry) => entry.username === 'utente-a'));
    assert.ok(users.body.some((entry) => entry.username === 'utente-b'));
  } finally {
    workerSocket?.terminate();
    if (instance) await instance.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function run(mode) {
  if (mode === 'server') {
    await runServerTest();
    return;
  }

  const {
    root,
    dataDir,
    backupDir,
    attachmentsDir,
    db,
  } = makeDatabase(`crm-${mode}-`);

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

    if (mode === 'integrity') {
      const client = db.create(
        'client',
        { name: 'Cliente CI', type: 'Azienda' },
        user,
        'client-create-ci',
      ).item;
      assert.equal(client.type, 'Azienda');
      assert.equal(db.get('client', client.id).clientType, 'Azienda');

      const firstQuote = db.create(
        'quote',
        { date: '2031-01-02', quoteNumber: 'PREV-2031-001' },
        user,
        'quote-one-ci',
      ).item;
      const secondQuote = db.create(
        'quote',
        { date: '2031-01-02', quoteNumber: 'PREV-2031-001' },
        user,
        'quote-two-ci',
      ).item;
      assert.notEqual(firstQuote.quoteNumber, secondQuote.quoteNumber, 'I numeri preventivo devono essere univoci');

      const attachmentDirectory = db.attachmentDirectory('project', created.item.id);
      assert.equal(
        path.relative(attachmentsDir, attachmentDirectory).startsWith('..'),
        false,
        'La cartella allegati deve restare nella directory prevista',
      );
      fs.mkdirSync(attachmentDirectory, { recursive: true });
      const storedName = 'test.txt';
      fs.writeFileSync(path.join(attachmentDirectory, storedName), 'allegato');
      db.addAttachments([{
        entityType: 'project',
        entityId: created.item.id,
        originalName: 'test.txt',
        storedName,
        mimeType: 'text/plain',
        sizeBytes: 8,
      }], user);
      db.delete('project', created.item.id, 1, user, 'project-delete-ci');
      assert.equal(db.listAttachments('project', created.item.id).length, 0);
      assert.equal(fs.existsSync(attachmentDirectory), false, 'Gli allegati devono essere eliminati con il record');
    }

    if (mode === 'snapshot') {
      fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([
        { id: 'utente-backup', username: 'backup', isActive: true },
      ], null, 2));
      fs.mkdirSync(path.join(attachmentsDir, 'manuale'), { recursive: true });
      fs.writeFileSync(path.join(attachmentsDir, 'manuale', 'file.txt'), 'backup');

      const snapshot = await db.createSnapshot('ci');
      const snapshotPath = path.join(backupDir, snapshot.name);
      assert.ok(fs.existsSync(path.join(snapshotPath, 'crm-marmeria.db')));
      assert.ok(fs.existsSync(path.join(snapshotPath, 'users.json')), 'Il backup deve includere gli account');
      assert.ok(fs.existsSync(path.join(snapshotPath, 'attachments', 'manuale', 'file.txt')));

      db.update('project', created.item.id, { status: 'Modificato' }, 1, user, 'snapshot-update-ci');
      fs.writeFileSync(path.join(dataDir, 'users.json'), '[]');
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
      fs.mkdirSync(attachmentsDir, { recursive: true });

      db.restoreSnapshot(snapshot.name, user);
      assert.equal(db.get('project', created.item.id).status, 'In Attesa');
      assert.ok(JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8')).length === 1);
      assert.ok(fs.existsSync(path.join(attachmentsDir, 'manuale', 'file.txt')));
      assert.ok(db.listSnapshots().some((item) => item.name === snapshot.name));
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
