const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CrmDatabase } = require('./database');

const user = { id: 'test-admin', username: 'test-admin' };

const createDb = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-database-rules-'));
  const db = new CrmDatabase({
    dataDir: path.join(root, 'data'),
    backupDir: path.join(root, 'backups'),
    attachmentsDir: path.join(root, 'attachments'),
  });
  return { db, root };
};

const expectStatus = (fn, status, messagePart) => {
  let thrown = null;
  try { fn(); } catch (error) { thrown = error; }
  assert(thrown, `Atteso errore HTTP ${status}`);
  assert.strictEqual(thrown.status, status);
  if (messagePart) assert(String(thrown.message).includes(messagePart), thrown.message);
};

const line = (taxRate) => ({
  id: 'line-1',
  type: 'manual',
  description: 'Lavorazione',
  quantity: 1,
  unitPrice: 100,
  ...(taxRate === undefined ? {} : { taxRate }),
});

const run = () => {
  const { db, root } = createDb();
  try {
    const client = db.create('client', { id: 'client-1', name: 'Cliente Uno' }, user, 'client-1').item;
    const project = db.create('project', {
      id: 'project-1', name: 'Cucina', clientId: client.id, workLines: [line(0)],
    }, user, 'project-1').item;
    const quote = db.create('quote', {
      id: 'quote-1', date: '2026-08-30', customerId: client.id, projectId: project.id,
      workLines: [line(0)],
    }, user, 'quote-1').item;

    const importedInvoice = db.create('invoice', {
      id: 'invoice-imported', date: '2026-08-30', dueDate: '2026-09-30', customerId: client.id,
      projectId: project.id, quoteId: quote.id,
      importSource: { sourceType: 'quote', sourceId: quote.id, sourceVersion: quote.version },
      workLines: [{ ...line(0), importSource: { sourceType: 'quote', sourceId: quote.id, sourceVersion: quote.version } }],
      items: [{ description: 'Lavorazione', quantity: 1, unitPrice: 100, taxRate: 0, taxNature: '' }],
      status: 'Pagata',
    }, user, 'invoice-imported').item;
    assert.strictEqual(importedInvoice.items[0].taxRate, 22, 'L’import da preventivo deve usare IVA 22% di default');
    assert.strictEqual(db.get('invoice', importedInvoice.id).status, 'Non Pagata', 'Lo stato non deve essere impostabile manualmente senza incassi');

    const zeroVatInvoice = db.create('invoice', {
      id: 'invoice-zero-vat', date: '2026-08-30', dueDate: '2026-09-30', customerId: client.id,
      workLines: [{ ...line(0), taxNature: 'N4' }],
      items: [{ description: 'Operazione esente', quantity: 1, unitPrice: 100, taxRate: 0, taxNature: 'N4' }],
    }, user, 'invoice-zero-vat').item;
    assert.strictEqual(zeroVatInvoice.items[0].taxRate, 0, 'IVA 0% esplicita deve essere preservata');
    assert.strictEqual(zeroVatInvoice.items[0].taxNature, 'N4');

    expectStatus(() => db.create('quote', {
      id: 'quote-orphan', date: '2026-08-30', customerId: 'missing-client', workLines: [line()],
    }, user, 'quote-orphan'), 409, 'Cliente');

    expectStatus(() => db.create('invoice', {
      id: 'invoice-mismatch', date: '2026-08-30', dueDate: '2026-09-30', customerId: client.id,
      projectId: 'missing-project', workLines: [line(22)],
    }, user, 'invoice-mismatch'), 409, 'Progetto');

    const payable = db.create('invoice', {
      id: 'invoice-payable', date: '2026-08-30', dueDate: '2026-09-30', customerId: client.id,
      workLines: [line(22)],
    }, user, 'invoice-payable').item;
    assert.strictEqual(payable.total, 122);

    const firstPayment = db.create('payment', {
      id: 'payment-1', clientId: client.id, invoiceId: payable.id, date: '2026-08-30', amount: 50,
    }, user, 'payment-1').item;
    assert.strictEqual(firstPayment.amount, 50);
    assert.strictEqual(db.get('invoice', payable.id).status, 'Pagata Parzialmente');

    expectStatus(() => db.create('payment', {
      id: 'payment-over', clientId: client.id, invoiceId: payable.id, date: '2026-08-30', amount: 80,
    }, user, 'payment-over'), 409, 'residuo');

    const finalPayment = db.create('payment', {
      id: 'payment-2', clientId: client.id, invoiceId: payable.id, date: '2026-08-30', amount: 72,
    }, user, 'payment-2').item;
    assert.strictEqual(finalPayment.amount, 72);
    assert.strictEqual(db.get('invoice', payable.id).status, 'Pagata');

    expectStatus(() => db.update('invoice', payable.id, {
      workLines: [{ ...line(22), unitPrice: 10 }],
      items: [{ description: 'Ridotta', quantity: 1, unitPrice: 10, taxRate: 22 }],
    }, db.get('invoice', payable.id).version, user, 'invoice-reduce'), 409, 'incassato');

    expectStatus(() => db.delete('client', client.id, client.version, user, 'delete-client'), 409, 'utilizzato');
    expectStatus(() => db.delete('invoice', payable.id, db.get('invoice', payable.id).version, user, 'delete-invoice'), 409, 'incass');

    db.delete('payment', finalPayment.id, finalPayment.version, user, 'delete-payment-2');
    assert.strictEqual(db.get('invoice', payable.id).status, 'Pagata Parzialmente');
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('DATABASE_RULES_CHECK_OK');
};

run();
