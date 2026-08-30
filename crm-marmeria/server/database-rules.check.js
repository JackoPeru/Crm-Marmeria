const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CrmDatabase } = require('./database');

const user = { id: 'test-admin', username: 'test-admin' };

const dbOptions = (root) => ({
  dataDir: path.join(root, 'data'),
  backupDir: path.join(root, 'backups'),
  attachmentsDir: path.join(root, 'attachments'),
});

const createDb = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-database-rules-'));
  const db = new CrmDatabase(dbOptions(root));
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

const runLegacyPaidMigrationCheck = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-legacy-paid-'));
  let db = new CrmDatabase(dbOptions(root));
  try {
    db.importEntity('client', { id: 'legacy-client', name: 'Cliente storico' });
    db.importEntity('invoice', {
      id: 'legacy-paid-invoice', date: '2025-01-01', dueDate: '2025-01-15',
      customerId: 'legacy-client', status: 'Pagata',
      items: [{ description: 'Fattura storica', quantity: 1, unitPrice: 100, taxRate: 22 }],
    });
    db.importEntity('invoice', {
      id: 'legacy-paid-partial', date: '2025-02-01', dueDate: '2025-02-15',
      customerId: 'legacy-client', status: 'Pagata',
      items: [{ description: 'Fattura storica parziale', quantity: 1, unitPrice: 100, taxRate: 22 }],
    });
    db.importEntity('payment', {
      id: 'legacy-partial-payment', clientId: 'legacy-client', invoiceId: 'legacy-paid-partial',
      date: '2025-02-02', amount: 22, source: 'legacy',
    });
    db.importEntity('invoice', {
      id: 'legacy-imported-partial', date: '2025-03-01', dueDate: '2025-03-15',
      customerId: 'legacy-client', status: 'Importata',
      items: [{ description: 'Fattura importata parziale', quantity: 1, unitPrice: 100, taxRate: 22 }],
    });
    db.importEntity('payment', {
      id: 'legacy-imported-payment', clientId: 'legacy-client', invoiceId: 'legacy-imported-partial',
      date: '2025-03-02', amount: 22, source: 'legacy',
    });
    db.close();
    db = new CrmDatabase(dbOptions(root));

    const migratedInvoice = db.get('invoice', 'legacy-paid-invoice');
    const migratedPayments = db.list('payment').filter((payment) => payment.invoiceId === migratedInvoice.id);
    assert.strictEqual(migratedInvoice.status, 'Pagata');
    assert.strictEqual(migratedPayments.length, 1, 'Una vecchia fattura Pagata deve ottenere un incasso storico');
    assert.strictEqual(migratedPayments[0].amount, migratedInvoice.total);
    assert.strictEqual(migratedPayments[0].source, 'legacy-status-migration');

    const toppedUpInvoice = db.get('invoice', 'legacy-paid-partial');
    const toppedUpPaid = db.list('payment')
      .filter((payment) => payment.invoiceId === toppedUpInvoice.id)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    assert.strictEqual(toppedUpInvoice.status, 'Pagata');
    assert.strictEqual(toppedUpPaid, toppedUpInvoice.total, 'Una fattura legacy Pagata con incasso parziale deve essere completata fino al totale');

    const reconciledPartial = db.get('invoice', 'legacy-imported-partial');
    assert.strictEqual(reconciledPartial.status, 'Pagata Parzialmente', 'Le fatture legacy con incassi devono essere riconciliate allo stato reale');
  } finally {
    if (db?.db?.open) db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const runBulkHistorySyncCheck = () => {
  const { db, root } = createDb();
  try {
    const result = db.importHistory([
      { type: 'client', input: { id: 'bulk-client', name: 'Cliente bulk' } },
      {
        type: 'invoice',
        input: {
          id: 'bulk-invoice', customerId: 'bulk-client', date: '2026-08-30', status: 'Importata',
          items: [{ description: 'Storico', quantity: 1, unitPrice: 100, taxRate: 22 }],
        },
      },
      {
        type: 'payment',
        input: { id: 'bulk-payment', clientId: 'bulk-client', invoiceId: 'bulk-invoice', date: '2026-08-30', amount: 22 },
      },
    ], user, 'bulk-history');
    assert.strictEqual(result.imported.length, 3);
    const invoice = db.get('invoice', 'bulk-invoice');
    assert.strictEqual(invoice.status, 'Pagata Parzialmente');
    assert(invoice.version > 1, 'La riconciliazione bulk deve versionare la fattura');

    expectStatus(() => db.importHistory([
      {
        type: 'payment',
        input: { id: 'orphan-bulk-payment', clientId: 'missing-client', invoiceId: 'missing-invoice', date: '2026-08-30', amount: 10 },
      },
    ], user, 'bulk-history-orphan'), 409, 'Cliente');
    assert.strictEqual(db.get('payment', 'orphan-bulk-payment'), null, 'Un import bulk non valido deve essere annullato interamente');
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
};

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

    expectStatus(() => db.create('project', {
      id: 'project-orphan', name: 'Progetto orfano', clientId: 'missing-client', workLines: [line()],
    }, user, 'project-orphan'), 409, 'Cliente');
    expectStatus(() => db.create('quote', {
      id: 'quote-orphan', date: '2026-08-30', customerId: 'missing-client', workLines: [line()],
    }, user, 'quote-orphan'), 409, 'Cliente');
    expectStatus(() => db.create('invoice', {
      id: 'invoice-mismatch', date: '2026-08-30', dueDate: '2026-09-30', customerId: client.id,
      projectId: 'missing-project', workLines: [line(22)],
    }, user, 'invoice-mismatch'), 409, 'Progetto');
    expectStatus(() => db.create('appointment', {
      id: 'appointment-orphan', title: 'Sopralluogo orfano', customerId: 'missing-client',
      startAt: '2026-08-31T09:00', endAt: '2026-08-31T10:00',
    }, user, 'appointment-orphan'), 409, 'Cliente');
    expectStatus(() => db.create('purchase_order', {
      id: 'purchase-order-orphan', title: 'Ordine orfano', supplierId: 'missing-supplier',
      projectId: project.id, date: '2026-08-30', amount: 100,
    }, user, 'purchase-order-orphan'), 409, 'Fornitore');

    const calendarClient = db.create('client', { id: 'calendar-client', name: 'Cliente Calendario' }, user, 'calendar-client').item;
    db.create('appointment', {
      id: 'calendar-appointment', title: 'Sopralluogo', customerId: calendarClient.id,
      startAt: '2026-08-31T09:00', endAt: '2026-08-31T10:00',
    }, user, 'calendar-appointment');
    expectStatus(() => db.delete('client', calendarClient.id, calendarClient.version, user, 'delete-calendar-client'), 409, 'utilizzato');

    const supplier = db.create('supplier', { id: 'supplier-1', name: 'Fornitore Uno' }, user, 'supplier-1').item;
    db.create('purchase_order', {
      id: 'purchase-order-1', title: 'Lastre', supplierId: supplier.id, date: '2026-08-30', amount: 100,
    }, user, 'purchase-order-1');
    expectStatus(() => db.delete('supplier', supplier.id, supplier.version, user, 'delete-supplier'), 409, 'utilizzato');

    const appointmentClient = db.create('client', { id: 'appointment-client', name: 'Cliente Progetto Calendario' }, user, 'appointment-client').item;
    const appointmentProject = db.create('project', {
      id: 'appointment-project', name: 'Progetto Calendario', clientId: appointmentClient.id,
    }, user, 'appointment-project').item;
    db.create('appointment', {
      id: 'project-appointment', title: 'Rilievo', customerId: appointmentClient.id,
      projectId: appointmentProject.id, startAt: '2026-09-01T09:00', endAt: '2026-09-01T10:00',
    }, user, 'project-appointment');
    expectStatus(() => db.delete('project', appointmentProject.id, appointmentProject.version, user, 'delete-appointment-project'), 409, 'utilizzato');

    const payable = db.create('invoice', {
      id: 'invoice-payable', date: '2026-08-30', dueDate: '2026-09-30', customerId: client.id,
      workLines: [line(22)],
    }, user, 'invoice-payable').item;
    assert.strictEqual(payable.total, 122);

    const firstPayment = db.create('payment', {
      id: 'payment-1', clientId: client.id, invoiceId: payable.id, date: '2026-08-30', amount: 50,
    }, user, 'payment-1').item;
    const invoiceAfterFirstPayment = db.get('invoice', payable.id);
    assert.strictEqual(firstPayment.amount, 50);
    assert.strictEqual(invoiceAfterFirstPayment.status, 'Pagata Parzialmente');
    assert(invoiceAfterFirstPayment.version > payable.version, 'Lo stato pagamento deve incrementare la versione fattura');
    assert(db.listAudit({ type: 'invoice', id: payable.id }).some((entry) => entry.action === 'update'), 'La sincronizzazione dello stato fattura deve essere auditata');

    expectStatus(() => db.create('payment', {
      id: 'payment-over', clientId: client.id, invoiceId: payable.id, date: '2026-08-30', amount: 80,
    }, user, 'payment-over'), 409, 'residuo');

    const finalPayment = db.create('payment', {
      id: 'payment-2', clientId: client.id, invoiceId: payable.id, date: '2026-08-30', amount: 72,
    }, user, 'payment-2').item;
    const invoiceAfterFinalPayment = db.get('invoice', payable.id);
    assert.strictEqual(finalPayment.amount, 72);
    assert.strictEqual(invoiceAfterFinalPayment.status, 'Pagata');
    assert(invoiceAfterFinalPayment.version > invoiceAfterFirstPayment.version, 'Il saldo deve produrre una nuova versione fattura');

    expectStatus(() => db.update('invoice', payable.id, {
      workLines: [{ ...line(22), unitPrice: 10 }],
      items: [{ description: 'Ridotta', quantity: 1, unitPrice: 10, taxRate: 22 }],
    }, db.get('invoice', payable.id).version, user, 'invoice-reduce'), 409, 'incassato');
    expectStatus(() => db.delete('client', client.id, client.version, user, 'delete-client'), 409, 'utilizzato');
    expectStatus(() => db.delete('invoice', payable.id, db.get('invoice', payable.id).version, user, 'delete-invoice'), 409, 'incass');

    const invoiceVersionBeforeDeletePayment = db.get('invoice', payable.id).version;
    db.delete('payment', finalPayment.id, finalPayment.version, user, 'delete-payment-2');
    const invoiceAfterDeletePayment = db.get('invoice', payable.id);
    assert.strictEqual(invoiceAfterDeletePayment.status, 'Pagata Parzialmente');
    assert(invoiceAfterDeletePayment.version > invoiceVersionBeforeDeletePayment, 'La rimozione di un incasso deve versionare la fattura');
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }

  runLegacyPaidMigrationCheck();
  runBulkHistorySyncCheck();
  console.log('DATABASE_RULES_CHECK_OK');
};

run();
