const core = require('./database-core');

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const asId = (value) => value == null || value === '' ? '' : String(value);
const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const IMPORTED_INVOICE_SOURCES = new Set(['quote', 'project']);

const conflict = (message) => {
  const error = new Error(message);
  error.status = 409;
  return error;
};

const sourceLines = (raw, legacyItems) => Array.isArray(raw)
  ? raw
  : Array.isArray(legacyItems) ? legacyItems : [];

const normalizeServerWorkLines = (raw, legacyItems) => {
  const source = sourceLines(raw, legacyItems);
  const normalized = core.normalizeServerWorkLines(raw, legacyItems);
  return normalized.map((line, index) => {
    const original = source[index];
    if (original && original.taxRate != null && original.taxRate !== '') return line;
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

  syncInvoicePaymentStatus(invoiceId) {
    const id = asId(invoiceId);
    if (!id) return;
    const row = this.db.prepare("SELECT data_json FROM entities WHERE entity_type = 'invoice' AND id = ?").get(id);
    if (!row) return;
    const data = JSON.parse(row.data_json);
    const status = this.paymentStatus(id);
    if (data.status === status) return;
    data.status = status;
    this.db.prepare("UPDATE entities SET data_json = ? WHERE entity_type = 'invoice' AND id = ?")
      .run(JSON.stringify(data), id);
  }

  migrateLegacyPaidInvoices() {
    const payments = super.list('payment');
    const paidInvoiceIds = new Set(payments.map((payment) => asId(payment.invoiceId)).filter(Boolean));
    for (const invoice of super.list('invoice')) {
      if (String(invoice.status || '').toLocaleLowerCase('it-IT') !== 'pagata') continue;
      if (paidInvoiceIds.has(asId(invoice.id))) continue;
      const total = roundMoney(invoice.total ?? invoice.amount);
      if (total <= 0 || !this.clientIdOf(invoice)) continue;
      try {
        this.create('payment', {
          id: `legacy-payment-${invoice.id}`,
          clientId: this.clientIdOf(invoice),
          invoiceId: asId(invoice.id),
          projectId: asId(invoice.projectId) || null,
          date: String(invoice.date || new Date().toISOString()).slice(0, 10),
          amount: total,
          method: 'Storico',
          reference: 'Migrazione stato fattura pagata',
          source: 'legacy-status-migration',
        }, { id: 'system', username: 'Migrazione CRM' }, `legacy-paid-invoice:${invoice.id}`);
      } catch (error) {
        if (error?.status !== 409) throw error;
      }
    }
  }

  validateReferences(type, payload, { currentPaymentId = '' } = {}) {
    const clientId = this.clientIdOf(payload);
    if (['project', 'quote', 'invoice', 'payment', 'service_case', 'message_draft'].includes(type) && clientId) {
      if (!super.get('client', clientId)) throw conflict('Cliente collegato non trovato');
    }

    const projectId = asId(payload?.projectId);
    if (projectId) {
      const project = super.get('project', projectId);
      if (!project) throw conflict('Progetto collegato non trovato');
      const projectClientId = this.clientIdOf(project);
      if (clientId && projectClientId && clientId !== projectClientId) {
        throw conflict('Il progetto selezionato appartiene a un altro cliente');
      }
    }

    const quoteId = asId(payload?.quoteId);
    if (quoteId) {
      const quote = super.get('quote', quoteId);
      if (!quote) throw conflict('Preventivo collegato non trovato');
      const quoteClientId = this.clientIdOf(quote);
      if (clientId && quoteClientId && clientId !== quoteClientId) {
        throw conflict('Il preventivo selezionato appartiene a un altro cliente');
      }
      if (projectId && asId(quote.projectId) && projectId !== asId(quote.projectId)) {
        throw conflict('Preventivo e fattura non appartengono allo stesso progetto');
      }
    }

    if (type === 'payment') {
      const invoiceId = asId(payload.invoiceId);
      if (!invoiceId) return;
      const invoice = super.get('invoice', invoiceId);
      if (!invoice) throw conflict('Fattura dell’incasso non trovata');
      if (clientId && this.clientIdOf(invoice) !== clientId) {
        throw conflict('La fattura selezionata non appartiene al cliente');
      }
      if (projectId && asId(invoice.projectId) && projectId !== asId(invoice.projectId)) {
        throw conflict('L’incasso non appartiene al progetto della fattura');
      }
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
    const references = {
      client: [
        ['project', (item) => this.clientIdOf(item) === target],
        ['quote', (item) => this.clientIdOf(item) === target],
        ['invoice', (item) => this.clientIdOf(item) === target],
        ['payment', (item) => asId(item.clientId) === target],
        ['service_case', (item) => asId(item.clientId) === target],
        ['message_draft', (item) => asId(item.clientId) === target],
      ],
      project: [
        ['quote', (item) => asId(item.projectId) === target],
        ['invoice', (item) => asId(item.projectId) === target],
        ['payment', (item) => asId(item.projectId) === target],
      ],
      quote: [['invoice', (item) => asId(item.quoteId) === target]],
      invoice: [['payment', (item) => asId(item.invoiceId) === target]],
    }[type] || [];

    for (const [relatedType, predicate] of references) {
      if (super.list(relatedType).some(predicate)) return relatedType;
    }
    return '';
  }

  create(type, input, user, operationId) {
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
    if (type === 'payment') this.syncInvoicePaymentStatus(result.item.invoiceId);
    return result;
  }

  update(type, id, patch, expectedVersion, user, operationId) {
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
      this.syncInvoicePaymentStatus(previousInvoiceId);
      this.syncInvoicePaymentStatus(result.item.invoiceId);
    }
    return result;
  }

  delete(type, id, expectedVersion, user, operationId) {
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
    if (type === 'payment') this.syncInvoicePaymentStatus(invoiceId);
    return result;
  }
}

module.exports = {
  ...core,
  CrmDatabase,
  normalizeServerWorkLines,
  workLinesToItems,
};
