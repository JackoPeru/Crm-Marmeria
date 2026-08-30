const { CrmDatabase } = require('./database');

const INSTALLED = Symbol.for('crm-marmeria.business-rules-installed');
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const text = (value) => String(value ?? '').trim();
const money = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const numeric = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const compact = String(value ?? '').trim().replace(/[\s€£$']/g, '');
  if (!compact) return 0;
  const comma = compact.lastIndexOf(',');
  const dot = compact.lastIndexOf('.');
  let normalized = compact;
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? compact.replace(/\./g, '').replace(',', '.')
      : compact.replace(/,/g, '');
  } else if (comma >= 0) normalized = compact.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const conflict = (message) => {
  const error = new Error(message);
  error.status = 409;
  throw error;
};

const localDateKey = (value = new Date()) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return String(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
};

const relationClientId = (record) => text(record?.clientId || record?.customerId);
const getRequired = (db, type, id, label) => {
  const normalized = text(id);
  if (!normalized) return null;
  const item = db.get(type, normalized);
  if (!item) conflict(`${label} non trovato`);
  return item;
};
const assertSameClient = (record, clientId, label) => {
  const relatedClient = relationClientId(record);
  if (relatedClient && relatedClient !== String(clientId)) {
    conflict(`${label} appartiene a un altro cliente`);
  }
};
const sameOptionalId = (left, right) => {
  const normalizedLeft = text(left);
  const normalizedRight = text(right);
  return !normalizedLeft || !normalizedRight || normalizedLeft === normalizedRight;
};

const prepareWorkLines = (lines) => Array.isArray(lines) ? lines.map((line) => ({
  ...line,
  edges: line?.edges && typeof line.edges === 'object'
    ? Object.fromEntries(Object.entries(line.edges).map(([key, edge]) => {
      if (!edge || typeof edge !== 'object' || edge.lengthCm == null) return [key, edge];
      const next = { ...edge };
      delete next.lengthMeters;
      return [key, next];
    }))
    : line?.edges,
})) : lines;

const invoiceLineTax = (item, line) => {
  const itemNature = text(item?.taxNature).toUpperCase();
  const lineNature = text(line?.taxNature).toUpperCase();
  const itemRate = hasOwn(item, 'taxRate') ? numeric(item.taxRate) : null;
  const lineRate = hasOwn(line, 'taxRate') ? numeric(line.taxRate) : null;
  if (itemNature) return { taxRate: itemRate ?? 0, taxNature: itemNature };
  if (lineNature) return { taxRate: lineRate ?? 0, taxNature: lineNature };
  if (itemRate != null && itemRate > 0) return { taxRate: itemRate, taxNature: '' };
  if (lineRate != null && lineRate > 0) return { taxRate: lineRate, taxNature: '' };
  return { taxRate: 22, taxNature: '' };
};

const prepareMutationInput = (type, input = {}) => {
  const prepared = { ...input };
  if (Array.isArray(prepared.workLines)) prepared.workLines = prepareWorkLines(prepared.workLines);
  if (type !== 'invoice') return prepared;

  const sourceItems = Array.isArray(prepared.items) ? prepared.items : [];
  const sourceLines = Array.isArray(prepared.workLines) ? prepared.workLines : [];
  const length = Math.max(sourceItems.length, sourceLines.length);
  if (!length) return prepared;

  const items = Array.from({ length }, (_, index) => {
    const item = sourceItems[index] || {};
    const line = sourceLines[index] || item.workLine || {};
    return { ...item, ...invoiceLineTax(item, line) };
  });
  const lines = sourceLines.length ? sourceLines.map((line, index) => ({
    ...line,
    ...invoiceLineTax(items[index], line),
  })) : sourceLines;
  prepared.items = items;
  if (sourceLines.length) prepared.workLines = lines;
  return prepared;
};

const validateInboundRelations = (db, type, payload) => {
  const id = text(payload?.id);
  if (!id) return;
  const clientId = relationClientId(payload);

  if (type === 'project') {
    for (const [entityType, label] of [['quote', 'Un preventivo collegato'], ['invoice', 'Una fattura collegata'], ['payment', 'Un incasso collegato']]) {
      const linked = db.list(entityType).filter((item) => String(item.projectId || '') === id);
      if (linked.some((item) => relationClientId(item) && relationClientId(item) !== clientId)) {
        conflict(`${label} appartiene a un cliente diverso: modifica prima i documenti collegati`);
      }
    }
    return;
  }

  if (type === 'quote') {
    const linkedInvoices = db.list('invoice').filter((item) => String(item.quoteId || '') === id);
    for (const invoice of linkedInvoices) {
      if (relationClientId(invoice) && relationClientId(invoice) !== clientId) {
        conflict('Una fattura collegata appartiene a un cliente diverso');
      }
      if (!sameOptionalId(invoice.projectId, payload.projectId)) {
        conflict('Una fattura collegata usa un progetto diverso');
      }
    }
    return;
  }

  if (type === 'invoice') {
    const linkedPayments = db.list('payment').filter((item) => String(item.invoiceId || '') === id);
    for (const payment of linkedPayments) {
      if (relationClientId(payment) && relationClientId(payment) !== clientId) {
        conflict('Un incasso collegato appartiene a un cliente diverso');
      }
      if (!sameOptionalId(payment.projectId, payload.projectId)) {
        conflict('Un incasso collegato usa un progetto diverso');
      }
    }
    const paid = linkedPayments.reduce((sum, payment) => sum + numeric(payment.amount), 0);
    const total = numeric(payload.total ?? payload.amount);
    if (money(paid) > money(total) + 0.005) {
      conflict(`Il totale fattura non può scendere sotto gli incassi registrati (€ ${money(paid).toFixed(2)})`);
    }
  }
};

const validateRelations = (db, type, payload, { paymentId = null } = {}) => {
  if (type === 'project') {
    const clientId = relationClientId(payload);
    if (clientId) getRequired(db, 'client', clientId, 'Cliente del progetto');
    validateInboundRelations(db, type, payload);
    return;
  }

  if (type === 'quote') {
    const clientId = relationClientId(payload);
    const client = getRequired(db, 'client', clientId, 'Cliente del preventivo');
    if (!client) conflict('Cliente del preventivo mancante');
    if (payload.projectId) {
      const project = getRequired(db, 'project', payload.projectId, 'Progetto del preventivo');
      assertSameClient(project, clientId, 'Il progetto selezionato');
    }
    validateInboundRelations(db, type, payload);
    return;
  }

  if (type === 'invoice') {
    const clientId = relationClientId(payload);
    const client = getRequired(db, 'client', clientId, 'Cliente della fattura');
    if (!client) conflict('Cliente della fattura mancante');
    const project = payload.projectId
      ? getRequired(db, 'project', payload.projectId, 'Progetto della fattura')
      : null;
    const quote = payload.quoteId
      ? getRequired(db, 'quote', payload.quoteId, 'Preventivo della fattura')
      : null;
    if (project) assertSameClient(project, clientId, 'Il progetto selezionato');
    if (quote) assertSameClient(quote, clientId, 'Il preventivo selezionato');
    if (project && quote?.projectId && String(quote.projectId) !== String(project.id)) {
      conflict('Preventivo e progetto della fattura non sono coerenti');
    }
    validateInboundRelations(db, type, payload);
    return;
  }

  if (type === 'payment') {
    const clientId = relationClientId(payload);
    const client = getRequired(db, 'client', clientId, 'Cliente dell’incasso');
    if (!client) conflict('Cliente dell’incasso mancante');
    const project = payload.projectId
      ? getRequired(db, 'project', payload.projectId, 'Progetto dell’incasso')
      : null;
    const invoice = payload.invoiceId
      ? getRequired(db, 'invoice', payload.invoiceId, 'Fattura dell’incasso')
      : null;
    if (project) assertSameClient(project, clientId, 'Il progetto selezionato');
    if (invoice) {
      assertSameClient(invoice, clientId, 'La fattura selezionata');
      if (project && invoice.projectId && String(invoice.projectId) !== String(project.id)) {
        conflict('Fattura e progetto dell’incasso non sono coerenti');
      }
      const alreadyPaid = db.list('payment')
        .filter((entry) => String(entry.invoiceId || '') === String(invoice.id)
          && String(entry.id) !== String(paymentId || ''))
        .reduce((sum, entry) => sum + numeric(entry.amount), 0);
      const proposed = numeric(payload.amount);
      const total = numeric(invoice.total ?? invoice.amount);
      if (money(alreadyPaid + proposed) > money(total) + 0.005) {
        conflict(`L’incasso supera il residuo della fattura (€ ${money(Math.max(0, total - alreadyPaid)).toFixed(2)})`);
      }
    }
    return;
  }

  if (['service_case', 'message_draft'].includes(type) && payload.clientId) {
    getRequired(db, 'client', payload.clientId, 'Cliente collegato');
  }
};

const invoicePaymentStatus = (db, invoice) => {
  const total = numeric(invoice?.total ?? invoice?.amount);
  const paid = db.list('payment')
    .filter((payment) => String(payment.invoiceId || '') === String(invoice?.id || ''))
    .reduce((sum, payment) => sum + numeric(payment.amount), 0);
  if (total > 0 && money(paid) >= money(total) - 0.005) return 'Pagata';
  if (paid > 0) return 'Pagata Parzialmente';
  const dueDate = localDateKey(invoice?.dueDate || invoice?.date);
  return dueDate && dueDate < localDateKey() ? 'Scaduta' : 'Non Pagata';
};

const assertDeletable = (db, type, id) => {
  const target = String(id);
  const references = [];
  const add = (entityType, field, label) => {
    if (db.list(entityType).some((item) => String(item[field] || '') === target)) references.push(label);
  };
  const addClientRelation = (entityType, label) => {
    if (db.list(entityType).some((item) => relationClientId(item) === target)) references.push(label);
  };

  if (type === 'client') {
    addClientRelation('project', 'progetti');
    addClientRelation('quote', 'preventivi');
    addClientRelation('invoice', 'fatture');
    addClientRelation('payment', 'incassi');
    add('service_case', 'clientId', 'assistenze');
    add('message_draft', 'clientId', 'comunicazioni');
  } else if (type === 'project') {
    add('quote', 'projectId', 'preventivi');
    add('invoice', 'projectId', 'fatture');
    add('payment', 'projectId', 'incassi');
  } else if (type === 'quote') {
    add('invoice', 'quoteId', 'fatture');
  } else if (type === 'invoice') {
    add('payment', 'invoiceId', 'incassi');
  }

  if (references.length) {
    conflict(`Elemento ancora utilizzato da: ${[...new Set(references)].join(', ')}`);
  }
};

const installDatabaseRules = (DatabaseClass = CrmDatabase) => {
  const prototype = DatabaseClass.prototype;
  if (prototype[INSTALLED]) return DatabaseClass;
  Object.defineProperty(prototype, INSTALLED, { value: true });

  const originalCreate = prototype.create;
  const originalUpdate = prototype.update;
  const originalDelete = prototype.delete;
  const originalNormalize = prototype.normalizeData;

  const normalizedCandidate = (db, type, input) => originalNormalize.call(db, type, prepareMutationInput(type, input));
  const replayExists = (db, operationId) => Boolean(operationId && db.getOperation(operationId));

  const syncInvoiceStatus = (db, invoiceId, user) => {
    if (!invoiceId) return null;
    const invoice = db.get('invoice', invoiceId);
    if (!invoice) return null;
    const status = invoicePaymentStatus(db, invoice);
    if (String(invoice.status || '') === status) return invoice;
    return originalUpdate.call(db, 'invoice', invoice.id, { status }, invoice.version, user, null).item;
  };

  prototype.create = function createWithBusinessRules(type, input, user, operationId) {
    if (replayExists(this, operationId)) return originalCreate.call(this, type, input, user, operationId);
    const prepared = prepareMutationInput(type, input);
    const normalized = normalizedCandidate(this, type, prepared);
    validateRelations(this, type, normalized);
    if (type === 'invoice') prepared.status = invoicePaymentStatus(this, { ...normalized, id: normalized.id || prepared.id || '' });
    const result = originalCreate.call(this, type, prepared, user, operationId);
    if (type === 'payment' && !result.replayed) syncInvoiceStatus(this, result.item.invoiceId, user);
    return result;
  };

  prototype.update = function updateWithBusinessRules(type, id, input, expectedVersion, user, operationId) {
    if (replayExists(this, operationId)) return originalUpdate.call(this, type, id, input, expectedVersion, user, operationId);
    const current = this.get(type, id);
    if (!current) return originalUpdate.call(this, type, id, input, expectedVersion, user, operationId);
    const prepared = prepareMutationInput(type, input);
    const candidate = normalizedCandidate(this, type, { ...current, ...prepared, id: current.id });
    validateRelations(this, type, candidate, { paymentId: type === 'payment' ? current.id : null });
    if (type === 'invoice') prepared.status = invoicePaymentStatus(this, candidate);
    const result = originalUpdate.call(this, type, id, prepared, expectedVersion, user, operationId);
    if (type === 'payment' && !result.replayed) {
      if (current.invoiceId && String(current.invoiceId) !== String(result.item.invoiceId || '')) {
        syncInvoiceStatus(this, current.invoiceId, user);
      }
      syncInvoiceStatus(this, result.item.invoiceId, user);
    }
    return result;
  };

  prototype.delete = function deleteWithBusinessRules(type, id, expectedVersion, user, operationId) {
    if (replayExists(this, operationId)) return originalDelete.call(this, type, id, expectedVersion, user, operationId);
    const current = this.get(type, id);
    if (current) assertDeletable(this, type, id);
    const result = originalDelete.call(this, type, id, expectedVersion, user, operationId);
    if (type === 'payment' && current && !result.replayed) syncInvoiceStatus(this, current.invoiceId, user);
    return result;
  };

  return DatabaseClass;
};

module.exports = {
  assertDeletable,
  installDatabaseRules,
  invoiceLineTax,
  invoicePaymentStatus,
  prepareMutationInput,
  validateInboundRelations,
  validateRelations,
};
