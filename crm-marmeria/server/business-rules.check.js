process.env.TZ = 'Europe/Rome';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const { createCrmServer } = require('./app');

const requestJson = async (baseUrl, route, options = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return { response, body };
};

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-business-rules-'));
  const dataDir = path.join(root, 'data');
  const backupDir = path.join(root, 'backups');
  const attachmentsDir = path.join(root, 'attachments');
  fs.mkdirSync(dataDir, { recursive: true });

  const password = 'Business-rules-123';
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([{
    id: 'admin-rules',
    username: 'admin-rules',
    email: 'admin-rules@example.test',
    password: await bcrypt.hash(password, 4),
    firstName: 'Admin',
    lastName: 'Rules',
    role: 'admin',
    isActive: true,
    permissions: [
      'dashboard.view',
      'clients.view', 'clients.create', 'clients.edit', 'clients.delete',
      'projects.view', 'projects.create', 'projects.edit', 'projects.delete',
      'quotes.view', 'quotes.create', 'quotes.edit', 'quotes.delete',
      'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete',
      'payments.view', 'payments.create', 'payments.edit', 'payments.delete',
      'settings.view', 'settings.edit',
    ],
  }], null, 2));

  let instance;
  try {
    instance = await createCrmServer({
      port: 0,
      host: '127.0.0.1',
      dataDir,
      backupDir,
      attachmentsDir,
      serverName: 'business-rules-ci',
    });
    const baseUrl = `http://127.0.0.1:${instance.port}/api`;
    const login = await requestJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin-rules', password }),
    });
    assert.equal(login.response.status, 200);
    const auth = { Authorization: `Bearer ${login.body.token}` };

    const invalidProject = await requestJson(baseUrl, '/projects', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'Orfano', clientId: 'cliente-inesistente' }),
    });
    assert.equal(invalidProject.response.status, 409, 'Un progetto non può riferirsi a un cliente inesistente');

    const client = await requestJson(baseUrl, '/clients', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'Cliente regole', type: 'Azienda' }),
    });
    assert.equal(client.response.status, 201);

    const project = await requestJson(baseUrl, '/projects', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'Cucina', clientId: client.body.id }),
    });
    assert.equal(project.response.status, 201);

    const quote = await requestJson(baseUrl, '/quotes', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        date: '2030-01-01',
        customerId: client.body.id,
        projectId: project.body.id,
        workLines: [{
          id: 'quote-line',
          type: 'manual',
          description: 'Piano cucina',
          quantity: 1,
          unitPrice: 100,
          taxRate: 0,
          taxNature: '',
        }],
      }),
    });
    assert.equal(quote.response.status, 201);

    const invoice = await requestJson(baseUrl, `/quotes/${quote.body.id}/invoice`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ date: '2030-01-01', dueDate: '2030-01-31' }),
    });
    assert.equal(invoice.response.status, 201);
    assert.equal(invoice.body.items[0].taxRate, 22, 'La fattura derivata da un preventivo standard deve usare IVA 22%');
    assert.equal(invoice.body.total, 122);
    assert.equal(invoice.body.status, 'Non Pagata');

    const paymentOne = await requestJson(baseUrl, '/payments', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        clientId: client.body.id,
        invoiceId: invoice.body.id,
        projectId: project.body.id,
        date: '2030-01-10',
        amount: 40,
        method: 'Bonifico',
      }),
    });
    assert.equal(paymentOne.response.status, 201);

    const partialInvoice = await requestJson(baseUrl, `/invoices/${invoice.body.id}`, { headers: auth });
    assert.equal(partialInvoice.body.status, 'Pagata Parzialmente', 'Lo stato fattura deve derivare dagli incassi registrati');

    const overpayment = await requestJson(baseUrl, '/payments', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        clientId: client.body.id,
        invoiceId: invoice.body.id,
        date: '2030-01-11',
        amount: 83,
      }),
    });
    assert.equal(overpayment.response.status, 409, 'Un incasso non può superare il residuo della fattura');

    const paymentTwo = await requestJson(baseUrl, '/payments', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        clientId: client.body.id,
        invoiceId: invoice.body.id,
        date: '2030-01-11',
        amount: 82,
      }),
    });
    assert.equal(paymentTwo.response.status, 201);

    const paidInvoice = await requestJson(baseUrl, `/invoices/${invoice.body.id}`, { headers: auth });
    assert.equal(paidInvoice.body.status, 'Pagata');

    const forcedOpen = await requestJson(baseUrl, `/invoices/${invoice.body.id}`, {
      method: 'PUT',
      headers: { ...auth, 'If-Match': String(paidInvoice.body.version) },
      body: JSON.stringify({ status: 'Non Pagata' }),
    });
    assert.equal(forcedOpen.response.status, 200);
    assert.equal(forcedOpen.body.status, 'Pagata', 'Lo stato manuale non deve contraddire gli incassi');

    for (const [route, version, label] of [
      [`/clients/${client.body.id}`, client.body.version, 'cliente referenziato'],
      [`/projects/${project.body.id}`, project.body.version, 'progetto referenziato'],
      [`/quotes/${quote.body.id}`, quote.body.version, 'preventivo referenziato'],
      [`/invoices/${invoice.body.id}`, forcedOpen.body.version, 'fattura con incassi'],
    ]) {
      const result = await requestJson(baseUrl, route, {
        method: 'DELETE',
        headers: { ...auth, 'If-Match': String(version) },
      });
      assert.equal(result.response.status, 409, `Non deve essere eliminabile un ${label}`);
    }

    const deletedPayment = await requestJson(baseUrl, `/payments/${paymentTwo.body.id}`, {
      method: 'DELETE',
      headers: { ...auth, 'If-Match': String(paymentTwo.body.version) },
    });
    assert.equal(deletedPayment.response.status, 200);
    const reopenedInvoice = await requestJson(baseUrl, `/invoices/${invoice.body.id}`, { headers: auth });
    assert.equal(reopenedInvoice.body.status, 'Pagata Parzialmente', 'Eliminare un incasso deve ricalcolare lo stato fattura');

    console.log('BUSINESS_RULES_CHECK_OK');
  } finally {
    if (instance) await instance.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
