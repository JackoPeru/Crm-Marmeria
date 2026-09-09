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
      isUpdateProbationActive: () => probation,
    });
    const baseUrl = `http://127.0.0.1:${instance.port}/api`;

    const health = await requestJson(baseUrl, '/health');
    assert.equal(health.response.status, 200);
    assert.equal(health.body.status, 'ok');

    const blocked = await requestJson(baseUrl, '/auth/login', {
      method: 'POST',
      headers: { 'X-CRM-Setup-Secret': 'probation-secret' },
      body: JSON.stringify({
        username: 'owner',
        password: 'Password-forte-123',
        email: 'owner@example.test',
        firstName: 'Mario',
        lastName: 'Rossi',
      }),
    });
    assert.equal(blocked.response.status, 503);
    assert.match(blocked.body.error, /aggiornamento in verifica/i);

    probation = false;
    const allowed = await requestJson(baseUrl, '/auth/login', {
      method: 'POST',
      headers: { 'X-CRM-Setup-Secret': 'probation-secret' },
      body: JSON.stringify({
        username: 'owner',
        password: 'Password-forte-123',
        email: 'owner@example.test',
        firstName: 'Mario',
        lastName: 'Rossi',
      }),
    });
    assert.equal(allowed.response.status, 201);
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
