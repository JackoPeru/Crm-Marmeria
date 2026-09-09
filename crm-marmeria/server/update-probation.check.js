'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCrmServer } = require('./app');

const requestJson = async (baseUrl, route, options = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return { response, body };
};

const main = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-update-probation-'));
  const dataDir = path.join(root, 'data');
  let probation = true;
  let instance;
  try {
    instance = await createCrmServer({
      port: 0,
      host: '127.0.0.1',
      dataDir,
      backupDir: path.join(root, 'backups'),
      attachmentsDir: path.join(root, 'attachments'),
      setupSecret: 'probation-secret',
      serverName: 'Probation CI',
      bootstrapAdmin: {
        username: 'admin-probation',
        password: 'Admin-password-123',
        email: 'admin-probation@example.test',
        firstName: 'Admin',
        lastName: 'Probation',
      },
      isUpdateProbationActive: () => probation,
    });
    const baseUrl = `http://127.0.0.1:${instance.port}/api`;

    const health = await requestJson(baseUrl, '/health');
    assert.equal(health.response.status, 200);
    assert.equal(health.body.status, 'ok');
    assert.equal(health.body.setupRequired, false);
    assert.deepEqual(
      fs.readdirSync(path.join(root, 'backups')).filter((name) => !name.startsWith('.')),
      [],
      'La versione in probation non deve creare snapshot automatici',
    );

    const blocked = await requestJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'admin-probation',
        password: 'Admin-password-123',
      }),
    });
    assert.equal(blocked.response.status, 503);
    assert.match(blocked.body.error, /aggiornamento in verifica/i);

    probation = false;
    const allowed = await requestJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'admin-probation',
        password: 'Admin-password-123',
      }),
    });
    assert.equal(allowed.response.status, 200);
    assert.equal(allowed.body.user.role, 'admin');

    console.log('UPDATE_PROBATION_CHECK_OK');
  } finally {
    if (instance) await instance.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
