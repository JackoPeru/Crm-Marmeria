process.env.TZ = 'Europe/Rome';
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


    const hostileOrigin = await requestJson(baseUrl, '/health', {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(hostileOrigin.response.status, 403, 'Le origini web esterne devono essere bloccate');
    const electronOrigin = await requestJson(baseUrl, '/health', {
      headers: { Origin: 'null' },
    });
    assert.equal(electronOrigin.response.status, 200, 'Le pagine Electron file:// devono poter usare l’API');

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

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await requestJson(baseUrl, '/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'utente-bloccato', password: 'errata' }),
      });
      assert.equal(failed.response.status, 401);
    }
    const rateLimited = await requestJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'utente-bloccato', password: 'errata' }),
    });
    assert.equal(rateLimited.response.status, 429, 'Il login deve limitare i tentativi ripetuti');

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
    assert.equal(createdProject.body.budget, 1000, 'Il budget deve essere normalizzato a numero');

    const workerProject = await requestJson(baseUrl, `/projects/${createdProject.body.id}`, {
      headers: authHeaders(workerToken),
    });
    assert.equal(workerProject.response.status, 200);
    assert.equal('budget' in workerProject.body, false, 'Il budget non deve essere inviato all’operaio');

    const workerUpdate = await requestJson(baseUrl, `/projects/${createdProject.body.id}`, {
      method: 'PUT',
      headers: {
        ...authHeaders(workerToken),
        'If-Match': String(createdProject.body.version),
        'X-Operation-Id': 'worker-update-ci',
      },
      body: JSON.stringify({ status: 'In Lavorazione', phase: 'Taglio' }),
    });
    assert.equal(workerUpdate.response.status, 200, 'L’operaio deve aggiornare la produzione');
    assert.equal(workerUpdate.body.name, 'Progetto da non cancellare');
    assert.equal(workerUpdate.body.deadline, '2030-01-01');
    assert.equal('budget' in workerUpdate.body, false, 'La risposta operaio deve restare redatta');

    const adminProject = await requestJson(baseUrl, `/projects/${createdProject.body.id}`, {
      headers: authHeaders(adminToken),
    });
    assert.equal(adminProject.body.budget, 1000, 'Il budget deve restare nel database');

    const createdMaterial = await requestJson(baseUrl, '/materials', {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        name: 'Granito CI',
        category: 'Granito',
        unit: 'm²',
        unitPrice: 12.34,
        stockQuantity: 5,
        minStockLevel: 2,
      }),
    });
    assert.equal(createdMaterial.response.status, 201);
    assert.equal(createdMaterial.body.unitPrice, 12.34);
    const workerMaterials = await requestJson(baseUrl, '/materials', {
      headers: authHeaders(workerToken),
    });
    assert.equal('unitPrice' in workerMaterials.body[0], false);
    assert.equal('price' in workerMaterials.body[0], false);
    assert.equal(workerMaterials.body[0].stockQuantity, 5);

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

    const adminUpdate = await requestJson(baseUrl, `/projects/${createdProject.body.id}`, {
      method: 'PUT',
      headers: {
        ...authHeaders(adminToken),
        'If-Match': String(adminProject.body.version),
        'X-Operation-Id': 'admin-financial-update-ci',
      },
      body: JSON.stringify({ budget: 2000, status: 'In Corso' }),
    });
    assert.equal(adminUpdate.response.status, 200);
    await wait(150);
    const projectEvent = workerEvents.find((event) => event.entityType === 'project');
    assert.ok(projectEvent, 'L’operaio deve ricevere l’aggiornamento operativo realtime');
    assert.equal('budget' in projectEvent.item, false, 'Il realtime operaio deve rimuovere il budget');

    const workerAudit = await requestJson(
      baseUrl,
      `/audit/project/${createdProject.body.id}`,
      { headers: authHeaders(workerToken) },
    );
    assert.equal(workerAudit.response.status, 200);
    assert.equal(workerAudit.body.some((entry) => (
      entry.previous?.budget != null || entry.next?.budget != null
    )), false, 'Lo storico operaio non deve contenere il budget');

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
        total: 999999,
        status: 'Non Pagata',
      }),
    });
    assert.equal(invoice.response.status, 201);
    assert.match(invoice.body.invoiceNumber, /^FATT-2030-\d{3}$/);
    assert.equal(invoice.body.total, 122, 'Il server deve ignorare un totale client alterato');
    await wait(150);
    assert.equal(
      workerEvents.some((event) => event.entityType === 'invoice'),
      false,
      'Il realtime non deve inviare fatture agli operai',
    );

    const order = await requestJson(baseUrl, '/orders', {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        title: 'Ordine CI',
        clientName: 'Cliente CI',
        status: 'In Lavorazione',
        priority: 'Alta',
        endDate: '2030-01-10',
        amount: 500,
      }),
    });
    assert.equal(order.response.status, 201);
    const orderStatus = await requestJson(baseUrl, `/orders/${order.body.id}/status`, {
      headers: authHeaders(workerToken),
    });
    assert.equal(orderStatus.response.status, 200);
    assert.equal(orderStatus.body.id, order.body.id);
    assert.equal(typeof orderStatus.body.completionPercentage, 'number');

    const workerDashboard = await requestJson(baseUrl, '/analytics/dashboard', {
      headers: authHeaders(workerToken),
    });
    assert.equal(workerDashboard.response.status, 200);
    assert.equal(workerDashboard.body.financialsVisible, false);
    assert.equal(workerDashboard.body.totalRevenue, null);

    instance.db.importEntity('order', {
      id: 'ordine-mezzanotte-roma',
      title: 'Ordine dopo mezzanotte locale',
      status: 'In Attesa',
      createdAt: '2030-01-01T23:30:00.000Z',
      updatedAt: '2030-01-01T23:30:00.000Z',
    });
    const localMidnightDaily = await requestJson(baseUrl, '/analytics/daily/2030-01-02', {
      headers: authHeaders(adminToken),
    });
    assert.ok(
      localMidnightDaily.body.newOrders >= 1,
      'Le 00:30 italiane devono appartenere al giorno locale, non al giorno UTC precedente',
    );

    const daily = await requestJson(baseUrl, '/analytics/daily/2030-01-01', {
      headers: authHeaders(adminToken),
    });
    assert.equal(daily.response.status, 200);
    assert.ok('ordersCompleted' in daily.body);
    assert.ok('materials' in daily.body);

    const weekly = await requestJson(baseUrl, '/analytics/weekly/2030-01-01', {
      headers: authHeaders(adminToken),
    });
    assert.equal(weekly.response.status, 200);
    assert.ok('averageOrderValue' in weekly.body);

    const monthly = await requestJson(baseUrl, '/analytics/monthly/2030/1', {
      headers: authHeaders(adminToken),
    });
    assert.equal(monthly.response.status, 200);
    assert.ok('completionRate' in monthly.body);

    const performance = await requestJson(baseUrl, '/analytics/performance/month', {
      headers: authHeaders(adminToken),
    });
    assert.equal(performance.response.status, 200);
    assert.ok('onTimeDelivery' in performance.body);

    const trends = await requestJson(
      baseUrl,
      '/analytics/trends?metric=orders&startDate=2030-01-01&endDate=2030-01-03',
      { headers: authHeaders(adminToken) },
    );
    assert.equal(trends.response.status, 200);
    assert.equal(trends.body.length, 3);
    assert.ok('period' in trends.body[0] && 'orders' in trends.body[0]);

    const deniedRevenueTrend = await requestJson(
      baseUrl,
      '/analytics/trends?metric=revenue&startDate=2030-01-01&endDate=2030-01-03',
      { headers: authHeaders(workerToken) },
    );
    assert.equal(deniedRevenueTrend.response.status, 403);

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
        {
          date: '2031-01-02',
          quoteNumber: 'PREV-2031-001',
          items: [{ description: 'Voce', quantity: 2, unitPrice: 12.34 }],
        },
        user,
        'quote-one-ci',
      ).item;
      const secondQuote = db.create(
        'quote',
        { date: '2031-01-02', quoteNumber: 'PREV-2031-001' },
        user,
        'quote-two-ci',
      ).item;
      assert.notEqual(firstQuote.quoteNumber, secondQuote.quoteNumber);
      assert.equal(firstQuote.total, 24.68, 'Il preventivo deve conservare i decimali');

      const calculatedInvoice = db.create(
        'invoice',
        {
          date: '2031-01-02',
          total: 999,
          items: [{ description: 'Voce', quantity: 2, unitPrice: 10, taxRate: 22 }],
        },
        user,
        'invoice-total-ci',
      ).item;
      assert.equal(calculatedInvoice.subtotal, 20);
      assert.equal(calculatedInvoice.taxTotal, 4.4);
      assert.equal(calculatedInvoice.total, 24.4);

      const attachmentDirectory = db.attachmentDirectory('project', created.item.id);
      assert.equal(path.relative(attachmentsDir, attachmentDirectory).startsWith('..'), false);
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
      assert.equal(fs.existsSync(attachmentDirectory), false);
    }

    if (mode === 'snapshot') {
      fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([
        {
          id: 'utente-backup',
          username: 'backup',
          email: 'backup@example.test',
          password: '$2b$10$hash-di-test-non-pubblico',
          role: 'admin',
          isActive: true,
          permissions: ['settings.view', 'settings.edit'],
        },
      ], null, 2));
      fs.mkdirSync(path.join(attachmentsDir, 'manuale'), { recursive: true });
      fs.writeFileSync(path.join(attachmentsDir, 'manuale', 'file.txt'), 'backup');

      const snapshot = await db.createSnapshot('ci');
      const snapshotPath = path.join(backupDir, snapshot.name);
      assert.ok(fs.existsSync(path.join(snapshotPath, 'crm-marmeria.db')));
      assert.ok(fs.existsSync(path.join(snapshotPath, 'users.json')));
      assert.ok(fs.existsSync(path.join(snapshotPath, 'attachments', 'manuale', 'file.txt')));

      db.update('project', created.item.id, { status: 'Modificato' }, 1, user, 'snapshot-update-ci');
      fs.writeFileSync(path.join(dataDir, 'users.json'), '[]');
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
      fs.mkdirSync(attachmentsDir, { recursive: true });

      db.restoreSnapshot(snapshot.name, user);
      assert.equal(db.get('project', created.item.id).status, 'In Attesa');
      assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8')).length, 1);
      assert.ok(fs.existsSync(path.join(attachmentsDir, 'manuale', 'file.txt')));

      const legacyName = `${snapshot.name}-legacy`;
      const legacyPath = path.join(backupDir, legacyName);
      fs.cpSync(snapshotPath, legacyPath, { recursive: true });
      fs.rmSync(path.join(legacyPath, 'users.json'), { force: true });
      fs.rmSync(path.join(legacyPath, 'attachments'), { recursive: true, force: true });

      fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([
        {
          id: 'utente-corrente',
          username: 'corrente',
          email: 'corrente@example.test',
          password: '$2b$10$hash-corrente-non-pubblico',
          role: 'admin',
          isActive: true,
          permissions: ['settings.view', 'settings.edit'],
        },
      ]));
      fs.mkdirSync(path.join(attachmentsDir, 'corrente'), { recursive: true });
      fs.writeFileSync(path.join(attachmentsDir, 'corrente', 'file.txt'), 'corrente');

      db.restoreSnapshot(legacyName, user);
      const currentUsers = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'));
      assert.equal(currentUsers[0].id, 'utente-corrente', 'Uno snapshot legacy non deve cancellare gli account');
      assert.ok(
        fs.existsSync(path.join(attachmentsDir, 'corrente', 'file.txt')),
        'Uno snapshot legacy non deve cancellare gli allegati correnti',
      );


      const corruptName = `${snapshot.name}-corrotto`;
      const corruptPath = path.join(backupDir, corruptName);
      fs.cpSync(snapshotPath, corruptPath, { recursive: true });
      fs.writeFileSync(path.join(corruptPath, 'crm-marmeria.db'), 'database non valido');
      const beforeCorruptRestore = db.get('project', created.item.id);
      assert.throws(
        () => db.restoreSnapshot(corruptName, user),
        /Database del backup non valido/,
      );
      assert.equal(
        db.get('project', created.item.id).status,
        beforeCorruptRestore.status,
        'Un database corrotto non deve sostituire quello corrente',
      );

      const noAdminName = `${snapshot.name}-senza-admin`;
      const noAdminPath = path.join(backupDir, noAdminName);
      fs.cpSync(snapshotPath, noAdminPath, { recursive: true });
      fs.writeFileSync(path.join(noAdminPath, 'users.json'), JSON.stringify([{
        id: 'solo-operaio',
        username: 'solo-operaio',
        email: 'operaio@example.test',
        password: '$2b$10$hash-operaio-non-pubblico',
        role: 'worker',
        isActive: true,
      }]));
      assert.throws(
        () => db.restoreSnapshot(noAdminName, user),
        /amministratore attivo/,
      );

      db.close();
      const interruptedDb = `${db.dbPath}.previous`;
      const interruptedUsers = `${db.usersPath}.previous`;
      const interruptedAttachments = `${db.attachmentsDir}.previous`;
      fs.renameSync(db.dbPath, interruptedDb);
      fs.renameSync(db.usersPath, interruptedUsers);
      fs.renameSync(db.attachmentsDir, interruptedAttachments);
      fs.writeFileSync(path.join(dataDir, '.restore-journal.json'), JSON.stringify({
        state: 'swapping',
        previousDb: interruptedDb,
        previousUsers: interruptedUsers,
        previousAttachments: interruptedAttachments,
      }));
      const recovered = new CrmDatabase({ dataDir, backupDir, attachmentsDir });
      assert.ok(recovered.get('project', created.item.id));
      assert.equal(fs.existsSync(path.join(dataDir, '.restore-journal.json')), false);
      recovered.close();
      db.open();
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
