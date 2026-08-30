const core = require('./database-core');

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const asId = (value) => value == null || value === '' ? '' : String(value);
const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const entityTypeOf = (item) => asId(item?.entityType || item?.type);
const IMPORTED_INVOICE_SOURCES = new Set(['quote', 'project']);
const STRONG_REFERENCE_FIELDS = {
  client: ['clientId', 'customerId'],
  supplier: ['supplierId'],
  project: ['projectId'],
  quote: ['quoteId'],
  invoice: ['invoiceId'],
  material: ['materialId'],
};
const REFERENCE_LABELS = {
  client: 'Cliente',
  supplier: 'Fornitore',
  project: 'Progetto',
  quote: 'Preventivo',
  invoice: 'Fattura',
  material: 'Materiale',
};

const conflict = (message) => {
  const error = new Error(message);
  error.status = 409;
  return error;
};

const sourceLines = (raw, legacyItems) => Array.isArray(raw)
  ? raw
  : Array.isArray(legacyItems) ? legacyItems : [];

const sanitizeWorkLineEdges = (lines) => Array.isArray(lines) ? lines.map((line) => ({
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

const normalizeServerWorkLines = (raw, legacyItems) => {
  const source = sourceLines(raw, legacyItems);
  const sanitizedRaw = Array.isArray(raw) ? sanitizeWorkLineEdges(raw) : raw;
  const sanitizedLegacy = Array.isArray(legacyItems) ? sanitizeWorkLineEdges(legacyItems) : legacyItems;
  const normalized = core.normalizeServerWorkLines(sanitizedRaw, sanitizedLegacy);
  const taxById = new Map(source.map((line, index) => [
    asId(line?.id || `work-line-${index + 1}`),
    line?.taxRate,
  ]));
  return normalized.map((line) => {
    const originalTax = taxById.get(asId(line.id));
    if (originalTax != null && originalTax !== '') return line;
    const next = { ...line };
    delete next.taxRate;
    return next;
  });
};

const workLinesToItems = (lines, existingItems, invoice) => {
  if (!invoice) return core.workLinesToItems(lines, existingItems, false);
  const preparedLines = (lines || []).map((line) => (
    line?.taxRate == null || line.taxRate === '' ? { ...line, taxRate: 22 } : line
  ));
  const preparedItems = Array.isArray(existingItems)
    ? existingItems.map((item, index) => (
      item?.taxRate == null || item.taxRate === ''
        ? { ...item, taxRate: preparedLines[index]?.taxRate ?? 22 }
        : item
    ))
    : existingItems;
  return core.workLinesToItems(preparedLines, preparedItems, true);
};

const invoiceTaxDefaults = (input, { forceStandard = false } = {}) => {
  const data = clone(input) || {};
  if (Array.isArray(data.workLines)) {
    data.workLines = data.workLines.map((line) => ({
      ...line,
      taxRate: forceStandard || line?.taxRate == null || line.taxRate === '' ? 22 : line.taxRate,
      taxNature: forceStandard ? '' : line?.taxNature,
    }));
  }
  if (Array.isArray(data.items)) {
    data.items = data.items.map((item) => ({
      ...item,
      taxRate: forceStandard || item?.taxRate == null || item.taxRate === '' ? 22 : item.taxRate,
      taxNature: forceStandard ? '' : item?.taxNature,
    }));
  }
  return data;
};

class CrmDatabase extends core.CrmDatabase {
  constructor(options) {
    super(options);
    this.migrateLegacyPaidInvoices();
  }

  normalizeData(type, input) {
    const prepared = clone(input) || {};
    if (Array.isArray(prepared.workLines)) prepared.workLines = sanitizeWorkLineEdges(prepared.workLines);
    if (Array.isArray(prepared.items)) {
      prepared.items = prepared.items.map((item) => ({
        ...item,
        workLine: item?.workLine && typeof item.workLine === 'object'
          ? sanitizeWorkLineEdges([item.workLine])[0]
          : item?.workLine,
      }));
    }
    return super.normalizeData(type, prepared);
  }

  clientIdOf(entity) {
    return asId(entity?.clientId || entity?.customerId);
  }

  paymentSummary(invoiceId, excludedPaymentId = '') {
    const invoice = super.get('invoice', invoiceId);
    if (!invoice) return null;
    const total = roundMoney(invoice.total ?? invoice.amount);
    const paid = roundMoney(super.list('payment')
      .filter((payment) => asId(payment.invoiceId) === asId(invoiceId)
        && asId(payment.id) !== asId(excludedPaymentId))
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
    return {
      total,
      paid,
      remaining: roundMoney(Math.max(0, total - paid)),
    };
  }

  paymentStatus(invoiceId) {
    const summary = this.paymentSummary(invoiceId);
    if (!summary) return 'Non Pagata';
    if (summary.total > 0 && summary.paid >= summary.total - 0.005) return 'Pagata';
    if (summary.paid > 0) return 'Pagata Parzialmente';
    return 'Non Pagata';
  }

  syncInvoicePaymentStatus(invoiceId, user) {
    const id = asId(invoiceId);
    if (!id) return null;
    const current = super.get('invoice', id);
    if (!current) return null;
    const status = this.paymentStatus(id);
    if (current.status === status) return current;
    return super.update('invoice', id, { status }, current.version, user).item;
  }

  migrateLegacyPaidInvoices() {
    const systemUser = { id: 'system', username: 'Migrazione CRM' };
    for (const invoice of super.list('invoice')) {
      const total = roundMoney(invoice.total ?? invoice.amount);
      const clientId = this.clientIdOf(invoice);
      const payments = super.list('payment').filter((payment) => asId(payment.invoiceId) === asId(invoice.id));
      const paid = roundMoney(payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
      const historicallyPaid = String(invoice.status || '').toLocaleLowerCase('it-IT') === 'pagata';

      if (historicallyPaid && total > paid + 0.005 && clientId && super.get('client', clientId)) {
        const projectId = asId(invoice.projectId);
        try {
          this.create('payment', {
            id: `legacy-payment-${invoice.id}`,
            clientId,
            invoiceId: asId(invoice.id),
            projectId: projectId && super.get('project', projectId) ? projectId : null,
            date: String(invoice.date || new Date().toISOString()).slice(0, 10),
            amount: roundMoney(total - paid),
            method: 'Storico',
            reference: 'Migrazione stato fattura pagata',
            source: 'legacy-status-migration',
          }, systemUser, `legacy-paid-invoice:${invoice.id}`);
        } catch (error) {
          if (error?.status !== 409) throw error;
        }
      }

      this.syncInvoicePaymentStatus(invoice.id, systemUser);
    }
  }

  validateReferences(type, payload, { currentPaymentId = '' } = {}) {
    const clientIds = [...new Set(
      STRONG_REFERENCE_FIELDS.client.map((field) => asId(payload?.[field])).filter(Boolean),
    )];
    if (clientIds.length > 1) throw conflict('I riferimenti cliente non sono coerenti');

    for (const [targetType, fields] of Object.entries(STRONG_REFERENCE_FIELDS)) {
      for (const field of fields) {
        const referenceId = asId(payload?.[field]);
        if (!referenceId) continue;
        if (!super.get(targetType, referenceId)) {
          throw conflict(`${REFERENCE_LABELS[targetType]} collegato non trovato`);
        }
      }
    }

    const clientId = this.clientIdOf(payload);
    const projectId = asId(payload?.projectId);
    if (projectId) {
      const project = super.get('project', projectId);
      const projectClientId = this.clientIdOf(project);
      if (clientId && projectClientId && clientId !== projectClientId) {
        throw conflict('Il progetto selezionato appartiene a un altro cliente');
      }
    }

    const quoteId = asId(payload?.quoteId);
    if (quoteId) {
      const quote = super.get('quote', quoteId);
      const quoteClientId = this.clientIdOf(quote);
      if (clientId && quoteClientId && clientId !== quoteClientId) {
        throw conflict('Il preventivo selezionato appartiene a un altro cliente');
      }
      if (projectId && asId(quote.projectId) && projectId !== asId(quote.projectId)) {
        throw conflict('Preventivo e fattura non appartengono allo stesso progetto');
      }
    }

    const invoiceId = asId(payload?.invoiceId);
    if (invoiceId) {
      const invoice = super.get('invoice', invoiceId);
      if (clientId && this.clientIdOf(invoice) && this.clientIdOf(invoice) !== clientId) {
        throw conflict('La fattura selezionata non appartiene al cliente');
      }
      if (projectId && asId(invoice.projectId) && projectId !== asId(invoice.projectId)) {
        throw conflict('Il record non appartiene al progetto della fattura');
      }
    }

    if (type === 'payment' && invoiceId) {
      const summary = this.paymentSummary(invoiceId, currentPaymentId);
      const amount = roundMoney(payload.amount);
      if (summary && amount > summary.remaining + 0.005) {
        throw conflict(`L’importo supera il residuo della fattura (€ ${summary.remaining.toFixed(2)})`);
      }
    }
  }

  validateInvoiceAgainstPayments(invoiceId, payload) {
    const id = asId(invoiceId);
    if (!id) return;
    const paid = roundMoney(super.list('payment')
      .filter((payment) => asId(payment.invoiceId) === id)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
    const total = roundMoney(payload.total ?? payload.amount);
    if (paid > total + 0.005) {
      throw conflict(`Il totale fattura non può scendere sotto quanto già incassato (€ ${paid.toFixed(2)})`);
    }
  }

  deletionBlocker(type, id) {
    const target = asId(id);
    const fields = STRONG_REFERENCE_FIELDS[type] || [];
    if (!target || !fields.length) return '';
    for (const relatedType of core.ENTITY_TYPES) {
      const referenced = super.list(relatedType).some((item) => (
        fields.some((field) => asId(item?.[field]) === target)
      ));
      if (referenced) return relatedType;
    }
    return '';
  }

  create(type, input, user, operationId) {
    const replay = this.getOperation(operationId);
    if (replay) return { ...replay, replayed: true };

    const execute = () => {
      let prepared = clone(input) || {};
      if (type === 'invoice') {
        const imported = IMPORTED_INVOICE_SOURCES.has(String(prepared.importSource?.sourceType || ''));
        prepared = invoiceTaxDefaults(prepared, { forceStandard: imported });
        prepared.status = 'Non Pagata';
      }
      const normalized = this.normalizeData(type, prepared);
      this.validateReferences(type, normalized);
      if (type === 'invoice') this.validateInvoiceAgainstPayments(prepared.id, normalized);
      const result = super.create(type, prepared, user, operationId);
      if (type === 'payment') this.syncInvoicePaymentStatus(result.item.invoiceId, user);
      return result;
    };

    return type === 'payment' ? this.withTransaction(execute) : execute();
  }

  importHistory(operations, user, operationId) {
    const replay = this.getOperation(operationId);
    if (replay) return { ...replay, replayed: true };

    return this.withTransaction(() => {
      const result = super.importHistory(operations, user, operationId);
      for (const item of result.imported || []) this.validateReferences(entityTypeOf(item), item);

      const invoiceIds = new Set();
      for (const item of result.imported || []) {
        const type = entityTypeOf(item);
        if (type === 'invoice') invoiceIds.add(asId(item.id));
        if (type === 'payment' && item.invoiceId) invoiceIds.add(asId(item.invoiceId));
      }
      for (const invoiceId of invoiceIds) this.syncInvoicePaymentStatus(invoiceId, user);

      const finalResult = {
        ...result,
        imported: (result.imported || []).map((item) => {
          const type = entityTypeOf(item);
          return super.get(type, item.id) || item;
        }),
      };
      this.storeOperation(operationId, finalResult);
      return finalResult;
    });
  }

  update(type, id, patch, expectedVersion, user, operationId) {
    const replay = this.getOperation(operationId);
    if (replay) return { ...replay, replayed: true };

    const execute = () => {
      const current = super.get(type, id);
      if (!current) return super.update(type, id, patch, expectedVersion, user, operationId);
      let preparedPatch = clone(patch) || {};
      if (type === 'invoice') preparedPatch = invoiceTaxDefaults(preparedPatch);
      const merged = this.normalizeData(type, { ...current, ...preparedPatch });
      this.validateReferences(type, merged, { currentPaymentId: type === 'payment' ? asId(id) : '' });
      if (type === 'invoice') {
        this.validateInvoiceAgainstPayments(id, merged);
        preparedPatch.status = this.paymentStatus(id);
      }
      const previousInvoiceId = type === 'payment' ? asId(current.invoiceId) : '';
      const result = super.update(type, id, preparedPatch, expectedVersion, user, operationId);
      if (type === 'payment') {
        this.syncInvoicePaymentStatus(previousInvoiceId, user);
        this.syncInvoicePaymentStatus(result.item.invoiceId, user);
      }
      return result;
    };

    return type === 'payment' ? this.withTransaction(execute) : execute();
  }

  delete(type, id, expectedVersion, user, operationId) {
    const replay = this.getOperation(operationId);
    if (replay) return { ...replay, replayed: true };

    const execute = () => {
      const current = super.get(type, id);
      if (current && type !== 'payment') {
        const blocker = this.deletionBlocker(type, id);
        if (blocker) {
          const detail = type === 'invoice' && blocker === 'payment'
            ? 'La fattura ha incassi registrati'
            : `L’elemento è utilizzato da record di tipo ${blocker}`;
          throw conflict(`${detail}: elimina o scollega prima i record collegati`);
        }
      }
      const invoiceId = type === 'payment' ? asId(current?.invoiceId) : '';
      const result = super.delete(type, id, expectedVersion, user, operationId);
      if (type === 'payment') this.syncInvoicePaymentStatus(invoiceId, user);
      return result;
    };

    return type === 'payment' ? this.withTransaction(execute) : execute();
  }
}

module.exports = {
  ...core,
  CrmDatabase,
  normalizeServerWorkLines,
  workLinesToItems,
};
