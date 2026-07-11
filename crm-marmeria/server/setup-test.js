const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const { createCrmServer } = require('./app');

const compromisedAdmin = {
  id: 'admin_001',
  username: 'admin',
  email: 'admin@marmeria.com',
  password: bcrypt.hashSync('admin123', 10),
  role: 'admin',
  firstName: 'Amministratore',
  lastName: 'Sistema',
  isActive: true,
  permissions: ['dashboard.view'],
};

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

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-setup-'));
  const dataDir = path.join(root, 'data');
  const backupDir = path.join(root, 'backups');
  const attachmentsDir = path.join(root, 'attachments');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'users.json'),
    JSON.stringify([compromisedAdmin], null, 2),
  );

  let instance;
  try {
    instance = await createCrmServer({
      port: 0,
      host: '127.0.0.1',
      dataDir,
      backupDir,
      attachmentsDir,
      serverName: 'Setup CI',
      setupSecret: 'segreto-setup-ci',
    });
    const baseUrl = `http://127.0.0.1:${instance.port}/api`;

    const initialHealth = await requestJson(baseUrl, '/health');
    assert.equal(initialHealth.response.status, 200);
    assert.equal(
      initialHealth.body.setupRequired,
      true,
      'Qualunque hash bcrypt delle password pubbliche deve essere rimosso',
    );

    const missingSecret = await requestJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'proprietario',
        password: 'Password-forte-123',
        email: 'proprietario@example.test',
        firstName: 'Mario',
        lastName: 'Bianchi',
      }),
    });
    assert.equal(missingSecret.response.status, 403, 'Il setup HTTP senza segreto desktop deve essere rifiutato');

    const shortPassword = await requestJson(baseUrl, '/auth/login', {
      method: 'POST',
      headers: { 'X-CRM-Setup-Secret': 'segreto-setup-ci' },
      body: JSON.stringify({ username: 'proprietario', password: 'corta' }),
    });
    assert.equal(shortPassword.response.status, 400);

    const publicSetupPassword = await requestJson(baseUrl, '/auth/login', {
      method: 'POST',
      headers: { 'X-CRM-Setup-Secret': 'segreto-setup-ci' },
      body: JSON.stringify({
        username: 'proprietario',
        password: 'operaio123',
        email: 'proprietario@example.test',
        firstName: 'Mario',
        lastName: 'Bianchi',
      }),
    });
    assert.equal(
      publicSetupPassword.response.status,
      400,
      'La configurazione iniziale non deve accettare una password legacy pubblica',
    );

    const setup = await requestJson(baseUrl, '/auth/login', {
      method: 'POST',
      headers: { 'X-CRM-Setup-Secret': 'segreto-setup-ci' },
      body: JSON.stringify({
        username: 'proprietario',
        password: 'Password-forte-123',
        email: 'proprietario@example.test',
        firstName: 'Mario',
        lastName: 'Bianchi',
      }),
    });
    assert.equal(setup.response.status, 201, 'La configurazione locale deve creare il primo admin');
    assert.equal(setup.body.user.role, 'admin');
    assert.ok(setup.body.user.permissions.includes('users.create'));
    assert.ok(setup.body.token);

    const authHeaders = { Authorization: `Bearer ${setup.body.token}` };
    const finalHealth = await requestJson(baseUrl, '/health');
    assert.equal(finalHealth.body.setupRequired, false);

    const users = await requestJson(baseUrl, '/users', { headers: authHeaders });
    assert.equal(users.response.status, 200);
    assert.equal(users.body.length, 1);
    assert.equal(users.body[0].username, 'proprietario');

    const publicUserPassword = await requestJson(baseUrl, '/users', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        username: 'vecchio-operaio',
        email: 'vecchio-operaio@example.test',
        password: 'admin123',
        firstName: 'Vecchio',
        lastName: 'Operaio',
        role: 'worker',
        permissions: ['dashboard.view'],
      }),
    });
    assert.equal(
      publicUserPassword.response.status,
      400,
      'La gestione utenti non deve ricreare account con password pubbliche',
    );

    const demoteLastAdmin = await requestJson(baseUrl, `/users/${setup.body.user.id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ role: 'worker' }),
    });
    assert.equal(
      demoteLastAdmin.response.status,
      400,
      'Non deve essere possibile rimuovere l’ultimo amministratore attivo',
    );

    const disableLastAdmin = await requestJson(baseUrl, `/users/${setup.body.user.id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(
      disableLastAdmin.response.status,
      400,
      'Non deve essere possibile disattivare l’ultimo amministratore attivo',
    );

    const stillAdmin = await requestJson(baseUrl, '/users', { headers: authHeaders });
    assert.equal(stillAdmin.response.status, 200);
    assert.equal(stillAdmin.body[0].role, 'admin');
    assert.equal(stillAdmin.body[0].isActive, true);

    const reusedSetup = await requestJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'secondo-admin',
        password: 'Password-forte-456',
      }),
    });
    assert.equal(reusedSetup.response.status, 401, 'Dopo il setup il login non deve creare altri admin');
  } finally {
    if (instance) await instance.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
