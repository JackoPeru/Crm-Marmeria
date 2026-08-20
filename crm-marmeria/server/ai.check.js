const assert = require('assert');
const bcrypt = require('bcrypt');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCrmServer } = require('./app');
const { publicError } = require('./ai');
const {
  AiRuntime, AiSessionStore, MockLlmProvider, QwenLocalProvider, buildContext, buildStaticPrefix, selectReasoningMode, selectTools,
} = require('./ai/runtime');
const { executeTool, getToolCatalog } = require('./ai/tools');

const requestJson = async (baseUrl, route, options = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return { response, body };
};

const requestSse = async (baseUrl, route, options = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(options.headers || {}) },
  });
  const raw = await response.text();
  const events = raw.split('\n\n').filter(Boolean).map((chunk) => JSON.parse(chunk.replace(/^data:\s*/, '')));
  return { response, events, raw };
};

const permissions = [
  'dashboard.view',
  ...['clients', 'projects', 'quotes', 'invoices', 'payments', 'calendar'].flatMap((section) => [
    `${section}.view`, `${section}.create`, `${section}.edit`, `${section}.delete`,
  ]),
];

const worker = { id: 'worker-ai', username: 'worker-ai', role: 'worker', permissions: ['clients.view', 'projects.view', 'calendar.view'] };

const tomorrowAt = () => {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(11, 0, 0, 0);
  const end = new Date(start.getTime() + 45 * 60 * 1000);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
};

const run = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-ai-'));
  const dataDir = path.join(root, 'data');
  const isolatedUsersPath = path.join(dataDir, 'users.json');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(isolatedUsersPath, '[]\n', 'utf8');
  assert.deepEqual(JSON.parse(fs.readFileSync(isolatedUsersPath, 'utf8')), []);
  const adminPassword = 'Ai-check-password-123!';
  let instance;
  try {
    instance = await createCrmServer({
      port: 0,
      host: '127.0.0.1',
      dataDir,
      backupDir: path.join(root, 'backups'),
      attachmentsDir: path.join(root, 'attachments'),
      aiProvider: new MockLlmProvider(),
      bootstrapAdmin: {
        username: 'admin-ai', password: adminPassword, email: 'admin-ai@example.test', firstName: 'Admin', lastName: 'AI',
      },
      googleDriveBackups: { status: () => ({ enabled: false, connected: false }), isDue: () => false, uploadSnapshot: async () => null },
      sdiPec: { status: () => ({ email: null, hasPassword: false }), pollReceipts: async () => ({ changed: 0 }) },
    });
    const baseUrl = `http://127.0.0.1:${instance.port}/api`;
    const login = await requestJson(baseUrl, '/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin-ai', password: adminPassword }) });
    assert.equal(login.response.status, 200);
    const token = login.body.token;
    const headers = { Authorization: `Bearer ${token}` };
    const admin = instance.db.listAudit ? { id: 'admin-ai', username: 'admin-ai', role: 'admin', permissions } : null;
    const rossi = instance.db.create('client', { id: 'client-rossi', name: 'Rossi', city: 'Milano' }, admin, 'seed-client-rossi').item;
    const rossiMarmi = instance.db.create('client', { id: 'client-rossi-marmi', name: 'Rossi Marmi', city: 'Roma' }, admin, 'seed-client-rossi-marmi').item;
    const bianchi = instance.db.create('client', { id: 'client-bianchi', name: 'Bianchi', city: 'Torino' }, admin, 'seed-client-bianchi').item;
    const currentDate = new Date().toISOString().slice(0, 10);
    const project = instance.db.create('project', { id: 'project-rossi', name: 'Cucina Rossi', clientId: rossi.id, measurements: '240 x 65 cm', status: 'In Lavorazione' }, admin, 'seed-project-rossi').item;
    const quote = instance.db.create('quote', { id: 'quote-rossi', quoteNumber: 'PREV-1', date: currentDate, customerId: rossi.id, items: [{ description: 'Piano cucina', quantity: 1, unitPrice: 900 }] }, admin, 'seed-quote-rossi').item;
    const invoiceRossi = instance.db.create('invoice', { id: 'invoice-284', invoiceNumber: '284', date: currentDate, dueDate: currentDate, customerId: rossi.id, items: [{ description: 'Piano cucina', quantity: 1, unitPrice: 1000, taxRate: 0 }] }, admin, 'seed-invoice-284').item;
    const invoiceBianchi = instance.db.create('invoice', { id: 'invoice-bianchi', invoiceNumber: 'B-1', date: currentDate, dueDate: currentDate, customerId: bianchi.id, items: [{ description: 'Scala', quantity: 1, unitPrice: 1500, taxRate: 0 }] }, admin, 'seed-invoice-bianchi').item;
    const catalogInvoice = instance.db.create('invoice', { id: 'invoice-catalog', invoiceNumber: 'CAT-1', date: currentDate, dueDate: currentDate, customerId: rossi.id, items: [{ description: 'Test catalogo', quantity: 1, unitPrice: 100, taxRate: 0 }] }, admin, 'seed-invoice-catalog').item;
    instance.db.create('payment', { id: 'payment-rossi', clientId: rossi.id, invoiceId: invoiceRossi.id, date: currentDate, amount: 200, method: 'Bonifico' }, admin, 'seed-payment-rossi').item;
    const tomorrow = tomorrowAt();
    instance.db.create('appointment', { id: 'appointment-tomorrow', title: 'Sopralluogo Rossi', customerId: rossi.id, ...tomorrow }, admin, 'seed-appointment').item;

    assert.ok(selectTools('Quanto deve Rossi?', { permissions }).length >= 5);
    assert.ok(selectTools('Quanto deve Rossi?', { permissions }).length <= 10);
    const routedTools = selectTools('Quanto deve Rossi?', { permissions });
    assert.equal(buildStaticPrefix(routedTools), buildStaticPrefix([...routedTools].reverse()));
    assert.equal(executeTool({ db: instance.db, name: 'search_projects', args: { query: 'Cucina' }, user: admin }).result.projects[0].id, project.id);
    assert.equal(executeTool({ db: instance.db, name: 'get_project_measurements', args: { projectId: project.id }, user: admin }).result.measurements, '240 x 65 cm');
    assert.equal(executeTool({ db: instance.db, name: 'search_quotes', args: { query: 'PREV-1' }, user: admin }).result.quotes[0].id, quote.id);
    assert.equal(executeTool({ db: instance.db, name: 'get_quote', args: { quoteNumber: 'PREV-1' }, user: admin }).result.quote.id, quote.id);

    const clientsOnly = { id: 'clients-only', role: 'worker', permissions: ['clients.view'] };
    const clientsOnlyHistory = executeTool({ db: instance.db, name: 'get_customer_history', args: { customerId: rossi.id }, user: clientsOnly }).result;
    assert.equal(Object.hasOwn(clientsOnlyHistory, 'projects'), false);
    assert.equal(Object.hasOwn(clientsOnlyHistory, 'quotes'), false);
    assert.equal(Object.hasOwn(clientsOnlyHistory, 'invoices'), false);
    assert.equal(Object.hasOwn(clientsOnlyHistory, 'payments'), false);
    assert.equal(Object.hasOwn(clientsOnlyHistory, 'counts'), false);
    const partialHistory = executeTool({ db: instance.db, name: 'get_customer_history', args: { customerId: rossi.id }, user: { ...clientsOnly, permissions: ['clients.view', 'projects.view', 'invoices.view'] } }).result;
    assert.equal(partialHistory.projects.length, 1);
    assert.equal(Object.hasOwn(partialHistory, 'quotes'), false);
    assert.equal(partialHistory.invoices.length, 2);
    assert.deepEqual(partialHistory.counts, { projects: 1, invoices: 2 });
    assert.equal(partialHistory.invoices[0].total, null);

    const financialProject = {
      id: 'project-financial-fixture',
      measurements: { width: 240, unitPrice: 900, nested: { materialCost: 500, total: 1400, label: 'visibile' } },
      technicalSheet: { price: '900', taxes: { taxRate: 22, taxTotal: 198 }, note: 'scheda' },
      workLines: [{ description: 'Piano', unitPrice: 900, materialCost: 500, cost: 400, total: 1400, nested: { amount: 3, safe: true } }],
    };
    const measurementDb = { get: () => financialProject };
    const hiddenMeasurements = executeTool({ db: measurementDb, name: 'get_project_measurements', args: { projectId: financialProject.id }, user: { ...clientsOnly, permissions: ['projects.view'] } }).result;
    const hiddenMeasurementJson = JSON.stringify(hiddenMeasurements);
    for (const secretField of ['unitPrice', 'materialCost', 'cost', 'total', 'price', 'taxes', 'taxRate', 'taxTotal', 'amount']) assert.equal(hiddenMeasurementJson.includes(`"${secretField}"`), false, secretField);
    assert.equal(hiddenMeasurements.measurements.width, 240);
    assert.equal(hiddenMeasurements.measurements.nested.label, 'visibile');
    const visibleMeasurements = executeTool({ db: measurementDb, name: 'get_project_measurements', args: { projectId: financialProject.id }, user: admin }).result;
    assert.equal(visibleMeasurements.workLines[0].unitPrice, 900);

    const limitClients = Array.from({ length: 50 }, (_, index) => ({ id: `limit-client-${index}`, name: index === 0 ? 'Limit Client' : `Limit Client ${index}`, city: 'Milano' }));
    const limitProjects = Array.from({ length: 50 }, (_, index) => ({ id: `limit-project-${index}`, name: `Limit Project ${index}`, status: 'In Lavorazione' }));
    const limitQuotes = Array.from({ length: 50 }, (_, index) => ({ id: `limit-quote-${index}`, quoteNumber: `PREV-LIMIT-${index}`, status: 'Bozza' }));
    const limitInvoices = Array.from({ length: 50 }, (_, index) => ({ id: `limit-invoice-${index}`, invoiceNumber: `FATT-LIMIT-${index}`, customerId: limitClients[0].id, total: 100, status: 'Non Pagata', date: currentDate }));
    const limitPayments = Array.from({ length: 50 }, (_, index) => ({ id: `limit-payment-${index}`, invoiceId: limitInvoices[index].id, amount: 0, date: currentDate, method: 'Test' }));
    const limitDb = {
      list: (type) => ({ client: limitClients, project: limitProjects, quote: limitQuotes, invoice: limitInvoices, payment: limitPayments }[type] || []),
      get: (type, id) => ({ project: limitProjects, invoice: limitInvoices }[type] || []).find((item) => String(item.id) === String(id)) || null,
    };
    const limitedCases = [
      ['search_customers', { query: 'Limit Client', limit: 'limit' }, (result) => result.customers.length],
      ['search_projects', { query: 'Limit Project', limit: 'limit' }, (result) => result.projects.length],
      ['get_active_projects', { limit: 'limit' }, (result) => result.projects.length],
      ['search_quotes', { query: 'PREV-LIMIT', limit: 'limit' }, (result) => result.quotes.length],
      ['search_invoices', { query: 'FATT-LIMIT', limit: 'limit' }, (result) => result.invoices.length],
      ['list_unpaid_invoices', { limit: 'limit' }, (result) => result.invoices.length],
      ['get_customer_invoices', { customerId: limitClients[0].id, limit: 'limit' }, (result) => result.invoices.length],
      ['get_payments', { limit: 'limit' }, (result) => result.payments.length],
      ['get_customer_statistics', { limit: 'limit' }, (result) => result.customers.length],
    ];
    for (const rawLimit of [-1, 0, 9999, 3.7]) {
      const expectedLimit = rawLimit === 9999 ? 20 : rawLimit === 3.7 ? 3 : 1;
      for (const [name, template, count] of limitedCases) {
        const args = { ...template, limit: rawLimit };
        assert.equal(count(executeTool({ db: limitDb, name, args, user: admin }).result), expectedLimit, `${name}:${rawLimit}`);
      }
    }

    const catalogArgs = {
      search_customers: { query: 'Rossi', limit: 1 },
      get_customer: { customerId: rossi.id },
      get_customer_balance: { customerId: rossi.id },
      get_customer_history: { customerId: rossi.id },
      search_projects: { query: 'Cucina', limit: 1 },
      get_active_projects: { limit: 1 },
      get_project_measurements: { projectId: project.id },
      search_quotes: { query: 'PREV-1', limit: 1 },
      get_quote: { quoteNumber: 'PREV-1' },
      search_invoices: { query: 'B-1', limit: 1 },
      get_invoice: { invoiceNumber: 'B-1' },
      list_unpaid_invoices: { limit: 1 },
      get_customer_invoices: { customerId: rossi.id, limit: 1 },
      get_payments: { limit: 1 },
      get_today_schedule: {},
      get_tomorrow_schedule: {},
      get_revenue_period: { startDate: currentDate, endDate: currentDate },
      get_outstanding_total: {},
      get_monthly_revenue: { year: Number(currentDate.slice(0, 4)) },
      get_customer_statistics: { limit: 1 },
      get_payment_statistics: { startDate: currentDate, endDate: currentDate },
      create_quote_draft: { customerId: rossi.id, date: currentDate, items: [{ description: 'Riga catalogo', quantity: 1, unitPrice: 10 }] },
      create_appointment: { title: 'Appuntamento catalogo', customerId: rossi.id, ...tomorrowAt() },
      register_payment: { invoiceId: catalogInvoice.id, amount: 10, date: currentDate, method: 'Test', reference: 'catalog' },
      mark_invoice_paid: { invoiceId: catalogInvoice.id, date: currentDate, method: 'Test', reference: 'catalog-close' },
    };
    const catalogReads = getToolCatalog().filter((definition) => definition.risk !== 'write');
    for (const definition of catalogReads) {
      const executed = executeTool({ db: instance.db, name: definition.name, args: catalogArgs[definition.name] || {}, user: admin, operationId: `catalog-read-${definition.name}` });
      assert.ok(executed.result, `catalog read ${definition.name}`);
    }
    for (const name of ['create_quote_draft', 'create_appointment', 'register_payment', 'mark_invoice_paid']) {
      const executed = executeTool({ db: instance.db, name, args: catalogArgs[name], user: admin, operationId: `catalog-write-${name}` });
      assert.ok(executed.result, `catalog write ${name}`);
    }

    const auditSecret = 'AI-AUDIT-SECRET-123';
    const redactedAudit = instance.db.writeAiAudit({
      sessionId: 'audit-redaction-session', operationId: 'audit-redaction-operation', user: admin,
      originalInput: `Invia token=${auditSecret}, Authorization: Bearer ${auditSecret}, cookie=${auditSecret}`,
      tool: 'audit_probe',
      args: { password: auditSecret, api_key: auditSecret, nested: { authorization: `Bearer ${auditSecret}`, note: 'keep this' } },
      result: { token: auditSecret, safe: 'preserve', nested: { secret: auditSecret } },
      confirmation: 'none', mutation: { cookie: auditSecret, useful: 'value' }, success: true,
    });
    const rawAuditRow = instance.db.db.prepare('SELECT * FROM ai_audit_log WHERE id = ?').get(redactedAudit.id);
    assert.equal(JSON.stringify(rawAuditRow).includes(auditSecret), false);
    const redactedAuditView = instance.db.listAiAudit({ sessionId: 'audit-redaction-session' })[0];
    assert.equal(JSON.stringify(redactedAuditView).includes(auditSecret), false);
    assert.equal(redactedAuditView.args.nested.note, 'keep this');
    assert.equal(redactedAuditView.result.safe, 'preserve');

    const appointmentCountBeforeHttp = instance.db.list('appointment').length;

    const store = new AiSessionStore();
    const contextSession = store.create('admin-ai');
    for (let index = 0; index < 50; index += 1) store.addTurn(contextSession, 'user', 'x'.repeat(4000));
    assert.ok(buildContext(contextSession, selectTools('Quanto deve Rossi?', { permissions })).length <= 60000);

    assert.throws(() => executeTool({ db: instance.db, name: 'search_customers', args: { query: 'Rossi', extra: true }, user: { permissions } }), (error) => error.code === 'invalid_tool_args');
    assert.throws(() => executeTool({ db: instance.db, name: 'tool_does_not_exist', args: {}, user: { permissions } }), (error) => error.code === 'unknown_tool');
    assert.throws(() => executeTool({ db: instance.db, name: 'get_customer', args: { customerQuery: 'Ross' }, user: { permissions } }), (error) => error.code === 'ambiguous_customer');
    assert.throws(() => executeTool({ db: instance.db, name: 'get_invoice', args: { invoiceNumber: 'missing' }, user: admin }), (error) => error.code === 'invoice_not_found');
    assert.throws(() => executeTool({ db: instance.db, name: 'get_customer_balance', args: { customerQuery: 'Rossi' }, user: worker }), (error) => error.code === 'permission_denied');
    const hidden = publicError(new Error('secret stack details'));
    assert.equal(hidden.body.message, 'Errore interno dell’assistente locale.');
    assert.equal(Object.hasOwn(hidden.body, 'stack'), false);

    const createdSession = await requestJson(baseUrl, '/ai/sessions', { method: 'POST', headers, body: '{}' });
    assert.equal(createdSession.response.status, 201);
    const sessionId = createdSession.body.sessionId;
    const read = await requestSse(baseUrl, '/ai/chat', { method: 'POST', headers, body: JSON.stringify({ sessionId, operationId: 'op-balance', message: 'Quanto deve Rossi?' }) });
    assert.equal(read.response.status, 200);
    assert.equal(read.events[0].type, 'status');
    assert.equal(read.events[0].status, 'received');
    assert.equal(read.events[1].status, 'routing');
    assert.ok(read.events.some((event) => event.type === 'tool' && event.stage === 'start'));
    assert.ok(read.events.some((event) => event.type === 'tool' && event.stage === 'done'));
    assert.ok(read.events.some((event) => event.type === 'text' && event.stage === 'delta'));
    assert.equal(read.events.at(-1).type, 'done');
    assert.match(read.events.find((event) => event.type === 'text' && event.stage === 'final').text, /800,00/);
    assert.ok(read.events.at(-1).metrics.totalMs >= 0);
    assert.ok(Object.hasOwn(read.events.at(-1).metrics, 'ttftMs'));
    assert.ok(Object.hasOwn(read.events.at(-1).metrics, 'sttLatencyMs'));
    assert.ok(Object.hasOwn(read.events.at(-1).metrics, 'ttsFirstAudioMs'));
    assert.equal(read.events.at(-1).metrics.reasoningMode, 'fast');

    const benchmark = await requestJson(baseUrl, `/ai/benchmark/session?sessionId=${encodeURIComponent(sessionId)}`, { headers });
    assert.equal(benchmark.response.status, 200);
    for (const metricKey of ['routingMs', 'promptChars', 'prefillTokens', 'cachedPrefillTokens', 'newPrefillTokens', 'ttftMs', 'toolMs', 'totalMs', 'prefillRateTokensPerSecond', 'decodeRateTokensPerSecond', 'sttLatencyMs', 'ttsFirstAudioMs', 'reasoningMode']) assert.ok(Object.hasOwn(benchmark.body.metrics, metricKey), metricKey);

    const invoiceRead = await requestSse(baseUrl, '/ai/chat', { method: 'POST', headers, body: JSON.stringify({ sessionId, operationId: 'op-invoice', message: "Qual è l'ultima fattura di Bianchi?" }) });
    assert.equal(invoiceRead.response.status, 200);
    assert.match(invoiceRead.events.find((event) => event.type === 'text' && event.stage === 'final').text, /B-1/);
    const revenue = await requestSse(baseUrl, '/ai/chat', { method: 'POST', headers, body: JSON.stringify({ sessionId, operationId: 'op-revenue', message: 'Quanto abbiamo fatturato questo mese?' }) });
    assert.match(revenue.events.find((event) => event.type === 'text' && event.stage === 'final').text, /2600,00/);
    const schedule = await requestSse(baseUrl, '/ai/chat', { method: 'POST', headers, body: JSON.stringify({ sessionId, operationId: 'op-schedule', message: 'Che appuntamenti abbiamo domani?' }) });
    assert.match(schedule.events.find((event) => event.type === 'text' && event.stage === 'final').text, /2 appuntamenti/);
    const stats = await requestSse(baseUrl, '/ai/chat', { method: 'POST', headers, body: JSON.stringify({ sessionId, operationId: 'op-stats', message: 'Quale cliente ci deve più soldi?' }) });
    assert.match(stats.events.find((event) => event.type === 'text' && event.stage === 'final').text, /Bianchi/);

    const appointmentSessionResponse = await requestJson(baseUrl, '/ai/sessions', { method: 'POST', headers, body: '{}' });
    const appointmentSessionId = appointmentSessionResponse.body.sessionId;
    const pendingAppointment = await requestSse(baseUrl, '/ai/chat', { method: 'POST', headers, body: JSON.stringify({ sessionId: appointmentSessionId, operationId: 'op-appointment', message: 'Crea un appuntamento con Rossi venerdì mattina.' }) });
    const appointmentConfirmation = pendingAppointment.events.find((event) => event.type === 'confirmation');
    assert.ok(appointmentConfirmation?.actionId);
    const appointmentDone = pendingAppointment.events.at(-1);
    const confirmedAppointment = await requestJson(baseUrl, '/ai/confirm', { method: 'POST', headers, body: JSON.stringify({ sessionId: appointmentSessionId, actionId: appointmentConfirmation.actionId, operationId: appointmentDone.operationId }) });
    assert.equal(confirmedAppointment.response.status, 200);
    assert.equal(instance.db.list('appointment').length, appointmentCountBeforeHttp + 1);

    const naturalConfirmSessionResponse = await requestJson(baseUrl, '/ai/sessions', { method: 'POST', headers, body: '{}' });
    const naturalConfirmSessionId = naturalConfirmSessionResponse.body.sessionId;
    const naturalPending = await requestSse(baseUrl, '/ai/chat', { method: 'POST', headers, body: JSON.stringify({ sessionId: naturalConfirmSessionId, operationId: 'op-natural-pending', message: 'Crea un appuntamento con Rossi venerdì mattina.' }) });
    const naturalAction = naturalPending.events.find((event) => event.type === 'confirmation');
    const naturalConfirmation = await requestSse(baseUrl, '/ai/chat', { method: 'POST', headers, body: JSON.stringify({ sessionId: naturalConfirmSessionId, operationId: 'op-natural-confirm-message', message: 'Sì' }) });
    assert.equal(naturalConfirmation.response.status, 200);
    assert.equal(naturalConfirmation.events.some((event) => event.type === 'error'), false);
    assert.match(naturalConfirmation.events.find((event) => event.type === 'text' && event.stage === 'final').text, /Appuntamento creato/);
    assert.equal(instance.db.list('appointment').length, appointmentCountBeforeHttp + 2);
    assert.ok(naturalAction?.actionId);

    const beforePayments = instance.db.list('payment').length;
    const pending = await requestSse(baseUrl, '/ai/chat', { method: 'POST', headers, body: JSON.stringify({ sessionId, operationId: 'op-pay-284', message: 'Segna la fattura 284 come pagata.' }) });
    assert.equal(instance.db.list('payment').length, beforePayments);
    const confirmation = pending.events.find((event) => event.type === 'confirmation');
    assert.ok(confirmation?.actionId);
    const donePending = pending.events.at(-1);
    assert.equal(donePending.result.confirmation.actionId, confirmation.actionId);
    const confirmed = await requestJson(baseUrl, '/ai/confirm', { method: 'POST', headers, body: JSON.stringify({ sessionId, actionId: confirmation.actionId, operationId: donePending.operationId }) });
    assert.equal(confirmed.response.status, 200);
    assert.equal(instance.db.list('payment').length, beforePayments + 1);
    assert.equal(instance.db.get('invoice', invoiceRossi.id).status, 'Pagata');
    const replay = await requestJson(baseUrl, '/ai/confirm', { method: 'POST', headers, body: JSON.stringify({ sessionId, actionId: confirmation.actionId, operationId: donePending.operationId }) });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(instance.db.list('payment').length, beforePayments + 1);
    const cancelledSession = await requestJson(baseUrl, '/ai/sessions', { method: 'POST', headers, body: '{}' });
    const cancelledId = cancelledSession.body.sessionId;
    const pendingCancel = await requestSse(baseUrl, '/ai/chat', { method: 'POST', headers, body: JSON.stringify({ sessionId: cancelledId, operationId: 'op-cancel', message: 'Segna la fattura B-1 come pagata.' }) });
    const cancelAction = pendingCancel.events.find((event) => event.type === 'confirmation').actionId;
    const cancelled = await requestJson(baseUrl, '/ai/cancel', { method: 'POST', headers, body: JSON.stringify({ sessionId: cancelledId, actionId: cancelAction }) });
    assert.equal(cancelled.body.cancelled, true);
    assert.equal(instance.db.list('payment').length, beforePayments + 1);
    const audit = instance.db.listAiAudit({ sessionId }).find((entry) => entry.operationId === donePending.operationId && entry.confirmation === 'confirmed');
    assert.ok(audit);
    assert.equal(audit.success, true);
    assert.equal(audit.tool, 'mark_invoice_paid');
    assert.match(audit.originalInput, /Segna la fattura/);

    const faultSessionResponse = await requestJson(baseUrl, '/ai/sessions', { method: 'POST', headers, body: '{}' });
    const faultSessionId = faultSessionResponse.body.sessionId;
    const faultPending = await requestSse(baseUrl, '/ai/chat', { method: 'POST', headers, body: JSON.stringify({ sessionId: faultSessionId, operationId: 'op-audit-fault', message: 'Segna la fattura B-1 come pagata.' }) });
    const faultConfirmation = faultPending.events.find((event) => event.type === 'confirmation');
    const faultInvoiceBefore = instance.db.get('invoice', invoiceBianchi.id);
    const faultPaymentsBefore = instance.db.list('payment').length;
    const faultOperationsBefore = instance.db.db.prepare('SELECT COUNT(*) AS count FROM operations').get().count;
    const originalWriteAiAudit = instance.db.writeAiAudit.bind(instance.db);
    instance.db.writeAiAudit = (input) => input.success ? (() => { throw new Error('forced successful audit failure'); })() : originalWriteAiAudit(input);
    const faultResult = await requestJson(baseUrl, '/ai/confirm', { method: 'POST', headers, body: JSON.stringify({ sessionId: faultSessionId, actionId: faultConfirmation.actionId, operationId: faultPending.events.at(-1).operationId }) });
    instance.db.writeAiAudit = originalWriteAiAudit;
    assert.equal(faultResult.response.status, 400);
    assert.equal(faultResult.body.error, 'mutation_failed');
    assert.deepEqual(instance.db.get('invoice', invoiceBianchi.id), faultInvoiceBefore);
    assert.equal(instance.db.list('payment').length, faultPaymentsBefore);
    assert.equal(instance.db.db.prepare('SELECT COUNT(*) AS count FROM operations').get().count, faultOperationsBefore);
    const faultAudit = instance.db.listAiAudit({ sessionId: faultSessionId })[0];
    assert.equal(faultAudit.success, false);
    assert.equal(faultAudit.args.invoiceNumber, 'B-1');
    assert.equal(JSON.stringify(faultAudit).includes('AI-AUDIT-SECRET-123'), false);
    await requestJson(baseUrl, '/ai/cancel', { method: 'POST', headers, body: JSON.stringify({ sessionId: faultSessionId, actionId: faultConfirmation.actionId }) });

    const isolatedRuntime = new AiRuntime({ db: instance.db, provider: new MockLlmProvider() });
    const isolatedUser = admin;
    const secondUser = { id: 'second-ai-user', username: 'second-ai-user', role: 'admin', permissions };
    const isolatedSessionA = isolatedRuntime.createSession(isolatedUser);
    const isolatedSessionB = isolatedRuntime.createSession(secondUser);
    const sharedOperationId = 'same-client-operation-id';
    await isolatedRuntime.chat({ session: isolatedSessionA, user: isolatedUser, message: 'Crea un appuntamento con Rossi venerdì mattina.', operationId: sharedOperationId, onEvent: async () => {} });
    await isolatedRuntime.chat({ session: isolatedSessionB, user: secondUser, message: 'Crea un appuntamento con Rossi venerdì mattina.', operationId: sharedOperationId, onEvent: async () => {} });
    const isolatedCountBefore = instance.db.list('appointment').length;
    const isolatedDoneA = await isolatedRuntime.confirm({ session: isolatedSessionA, user: isolatedUser, actionId: isolatedSessionA.state.pendingConfirmation.actionId, operationId: sharedOperationId, onEvent: async () => {} });
    const isolatedDoneB = await isolatedRuntime.confirm({ session: isolatedSessionB, user: secondUser, actionId: isolatedSessionB.state.pendingConfirmation.actionId, operationId: sharedOperationId, onEvent: async () => {} });
    assert.equal(isolatedDoneA.replayed, false);
    assert.equal(isolatedDoneB.replayed, false);
    assert.equal(instance.db.list('appointment').length, isolatedCountBefore + 2);
    const isolatedRetry = await isolatedRuntime.confirm({ session: isolatedSessionA, user: isolatedUser, actionId: 'already-cleared', operationId: sharedOperationId, onEvent: async () => {} });
    assert.equal(isolatedRetry.replayed, true);
    assert.equal(instance.db.list('appointment').length, isolatedCountBefore + 2);

    assert.equal(selectReasoningMode('Elenca i clienti di Milano'), 'fast');
    assert.equal(selectReasoningMode('Mostrami il piano cucina Rossi'), 'fast');
    for (const reasoningMessage of [
      'Perché questo mese abbiamo incassato meno?',
      'Analizza l’andamento dei ricavi.',
      'Quali ritardi stanno accumulando?',
      'Dammi una previsione per il prossimo mese.',
      'Fai il forecast dei ricavi.',
      'Individua la root-cause del calo.',
    ]) assert.equal(selectReasoningMode(reasoningMessage), 'reasoning', reasoningMessage);

    const ambiguousRuntime = new AiRuntime({ db: instance.db, provider: { name: 'ambiguous', async *stream() { yield { toolCalls: [{ name: 'get_customer', args: { customerQuery: 'Ross' } }] }; } } });
    const ambiguousSession = ambiguousRuntime.createSession({ id: 'admin-ai' });
    await assert.rejects(() => ambiguousRuntime.chat({ session: ambiguousSession, user: admin, message: 'Cliente Ross', operationId: 'ambiguous', onEvent: async () => {} }), (error) => error.code === 'ambiguous_customer');
    assert.equal(ambiguousSession.state.disambiguationCandidates.length, 2);

    const selectionContexts = [];
    let requestedCandidateId = null;
    const selectionRuntime = new AiRuntime({ db: instance.db, provider: {
      name: 'selection-spy',
      async *stream(input) {
        selectionContexts.push(input.context);
        if (selectionContexts.length === 1) {
          yield { toolCalls: [{ name: 'get_customer', args: { customerQuery: 'Ross' } }] };
          return;
        }
        const dynamic = JSON.parse(input.context.slice(input.context.lastIndexOf('\n') + 1));
        assert.equal(dynamic.disambiguationCandidates.length, 2);
        const selected = dynamic.disambiguationCandidates[1];
        requestedCandidateId = selected.id;
        yield { toolCalls: [{ name: 'get_customer', args: { customerId: selected.id } }] };
      },
      async *streamFinal() { yield { delta: 'Cliente selezionato.' }; },
    } });
    const selectionSession = selectionRuntime.createSession({ id: 'admin-ai' });
    await assert.rejects(() => selectionRuntime.chat({ session: selectionSession, user: admin, message: 'Cliente Ross', operationId: 'selection-ambiguous', onEvent: async () => {} }), (error) => error.code === 'ambiguous_customer');
    const selectedResult = await selectionRuntime.chat({ session: selectionSession, user: admin, message: 'Il secondo.', operationId: 'selection-resolved', onEvent: async () => {} });
    assert.equal(selectionContexts.length, 2);
    assert.match(selectionContexts[1], /disambiguationCandidates/);
    assert.equal(selectedResult.result.customer.id, selectionSession.state.currentEntityIds.customer);
    assert.equal(selectedResult.result.customer.id, requestedCandidateId);
    assert.equal(selectionSession.state.disambiguationCandidates.length, 0);

    const providerSpyCalls = [];
    const providerSpy = {
      name: 'provider-spy',
      async generate(input) {
        providerSpyCalls.push({ phase: 'plan', input });
        return { text: 'Questo testo non deve essere mostrato.', toolCalls: [{ id: 'spy-call-1', name: 'get_customer_balance', args: { customerQuery: 'Bianchi' } }] };
      },
      async *streamFinal(input) {
        providerSpyCalls.push({ phase: 'synthesis', input });
        yield { delta: 'Risposta prodotta dal secondo pass.' };
      },
    };
    const providerSpyRuntime = new AiRuntime({ db: instance.db, provider: providerSpy });
    const providerSpySession = providerSpyRuntime.createSession({ id: 'admin-ai' });
    const providerSpyEvents = [];
    const providerSpyResult = await providerSpyRuntime.chat({ session: providerSpySession, user: admin, message: 'Quanto deve Bianchi?', operationId: 'provider-round-trip', onEvent: async (event) => providerSpyEvents.push(event) });
    assert.equal(providerSpyCalls.length, 2);
    assert.equal(providerSpyCalls[1].phase, 'synthesis');
    assert.equal(providerSpyCalls[1].input.toolResults[0].result.balance, 1500);
    assert.equal(providerSpyCalls[1].input.toolResults[0].result.customer.name, 'Bianchi');
    assert.equal(providerSpyCalls[0].input.reasoningMode, 'fast');
    assert.equal(providerSpyCalls[1].input.reasoningMode, 'fast');
    assert.equal(providerSpyResult.text, 'Risposta prodotta dal secondo pass.');
    assert.equal(providerSpyEvents.find((event) => event.type === 'text' && event.stage === 'final').text, providerSpyResult.text);

    const reasoningCalls = [];
    const reasoningRuntime = new AiRuntime({ db: instance.db, provider: {
      name: 'reasoning-spy',
      async generate(input) { reasoningCalls.push({ phase: 'plan', input }); return { text: 'Piano di analisi.' }; },
      async *streamFinal(input) { reasoningCalls.push({ phase: 'synthesis', input }); yield { delta: 'Analisi completata.' }; },
    } });
    const reasoningSession = reasoningRuntime.createSession({ id: 'admin-ai' });
    const reasoningResult = await reasoningRuntime.chat({ session: reasoningSession, user: admin, message: 'Analizza il trend e confronta i ricavi annuali.', operationId: 'reasoning-request', onEvent: async () => {} });
    assert.equal(reasoningResult.metrics.reasoningMode, 'reasoning');
    assert.equal(reasoningCalls[0].input.reasoningMode, 'reasoning');
    assert.equal(reasoningCalls[1].input.reasoningMode, 'reasoning');

    let streamingProviderCompleted = false;
    let sawDeltaBeforeProviderCompleted = false;
    const streamingProvider = {
      name: 'mock-streaming',
      async generate() { return { text: 'Piano non finale.' }; },
      async *streamFinal() {
        streamingProviderCompleted = false;
        yield { delta: 'Prima ' };
        sawDeltaBeforeProviderCompleted = !streamingProviderCompleted;
        await new Promise((resolve) => setTimeout(resolve, 2));
        streamingProviderCompleted = true;
        yield { delta: 'seconda.' };
      },
    };
    const streamingRuntime = new AiRuntime({ db: instance.db, provider: streamingProvider });
    const streamingSession = streamingRuntime.createSession({ id: 'admin-ai' });
    const streamingEvents = [{ type: 'status', status: 'received' }];
    const streamingResult = await streamingRuntime.chat({ session: streamingSession, user: admin, message: 'Scrivi una risposta breve.', operationId: 'streaming-response', onEvent: async (event) => streamingEvents.push(event) });
    streamingEvents.push({ type: 'done' });
    assert.equal(streamingResult.text, 'Prima seconda.');
    assert.equal(sawDeltaBeforeProviderCompleted, true);
    assert.deepEqual(streamingEvents.map((event) => event.type), ['status', 'status', 'text', 'text', 'text', 'done']);
    assert.deepEqual(streamingEvents.slice(2, 5).map((event) => event.stage), ['delta', 'delta', 'final']);

    const originalFetch = global.fetch;
    const qwenRequests = [];
    try {
      global.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        qwenRequests.push({ url, body });
        if (!body.stream) return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ id: 'call-qwen-1', function: { name: 'get_customer_balance', arguments: '{"customerQuery":"Rossi"}' } }] } }] }) };
        const chunks = [
          'data: {"choices":[{"delta":{"content":"Prima ',
          'parte"}}]}\r\n\r\n',
          'data: {"choices":[{"delta":{"content":" seconda"}}]}\n\n',
          'data: {"usage":{"prompt_tokens":42,"completion_tokens":3}}\n\n',
          'data: [DONE]\n\n',
        ];
        const encoder = new TextEncoder();
        return { ok: true, body: new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk))); controller.close(); } }) };
      };
      const qwen = new QwenLocalProvider({ endpoint: 'http://qwen.test/v1', chatTemplateKwargs: { add_generation_prompt: true, enable_thinking: true } });
      const qwenPlan = await qwen.generate({ message: 'Quanto deve Rossi?', context: '{}', definitions: routedTools, reasoningMode: 'fast' });
      const qwenDeltas = [];
      for await (const item of qwen.streamFinal({ message: 'Quanto deve Rossi?', context: '{}', definitions: routedTools, plan: qwenPlan, reasoningMode: 'fast', toolResults: [{ toolCallId: 'call-qwen-1', name: 'get_customer_balance', result: { customer: { name: 'Rossi' }, balance: 800 } }] })) qwenDeltas.push(item.delta || '');
      const qwenReasoningPlan = await qwen.generate({ message: 'Analizza il trend dei ricavi.', context: '{}', definitions: routedTools, reasoningMode: 'reasoning' });
      const qwenReasoningDeltas = [];
      for await (const item of qwen.streamFinal({ message: 'Analizza il trend dei ricavi.', context: '{}', definitions: routedTools, plan: qwenReasoningPlan, reasoningMode: 'reasoning' })) qwenReasoningDeltas.push(item.delta || '');
      assert.equal(qwenRequests[0].body.stream, false);
      assert.equal(qwenRequests[1].body.stream, true);
      assert.equal(qwenRequests[1].body.model, 'Qwen3.8-27B');
      assert.equal(qwenRequests[0].body.chat_template_kwargs.add_generation_prompt, true);
      assert.equal(qwenRequests[0].body.chat_template_kwargs.enable_thinking, false);
      assert.equal(qwenRequests[1].body.chat_template_kwargs.enable_thinking, false);
      assert.equal(qwenRequests[2].body.chat_template_kwargs.enable_thinking, true);
      assert.equal(qwenRequests[3].body.chat_template_kwargs.enable_thinking, true);
      assert.equal(qwenRequests[1].body.messages.at(-1).role, 'tool');
      assert.match(qwenRequests[1].body.messages.at(-1).content, /800/);
      assert.equal(qwenDeltas.join(''), 'Prima parte seconda');
      assert.equal(qwenReasoningDeltas.join(''), 'Prima parte seconda');
    } finally {
      global.fetch = originalFetch;
    }

    const malformedRuntime = new AiRuntime({ db: instance.db, provider: { name: 'malformed', async *stream() { yield { toolCalls: [{ name: 'search_customers', args: { query: 'Rossi', nope: true } }] }; } } });
    const malformedSession = malformedRuntime.createSession({ id: 'admin-ai' });
    await assert.rejects(() => malformedRuntime.chat({ session: malformedSession, user: admin, message: 'test', operationId: 'malformed', onEvent: async () => {} }), (error) => error.code === 'invalid_tool_args');

    const noAuth = await requestJson(baseUrl, '/ai/sessions', { method: 'POST', body: '{}' });
    assert.equal(noAuth.response.status, 401);
    console.log('AI checks passed');
  } finally {
    if (instance) await instance.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
