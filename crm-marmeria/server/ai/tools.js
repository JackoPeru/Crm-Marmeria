const crypto = require('crypto');
const { canViewFinancials, hasEntityPermission } = require('../access-policy');

const MAX_SEARCH_RESULTS = 20;
const MONEY_EPSILON = 0.005;
const FINANCIAL_FIELDS = new Set([
  'amount', 'bankAccount', 'budget', 'cost', 'discount', 'fiscalCode',
  'iban', 'margin', 'minPrice', 'paymentDetails', 'price', 'profit', 'costItems',
  'purchasePrice', 'salePrice', 'subtotal', 'taxRate', 'taxTotal', 'total',
  'totalPrice', 'unitPrice', 'vatNumber', 'materialCost', 'margins', 'taxes',
  'vat', 'vatRate',
].map((key) => key.toLowerCase().replace(/[_-]/g, '')));

const money = (value) => Number(Number(value || 0).toFixed(2));
const text = (value) => String(value ?? '').trim();
const dateOnly = (value) => text(value).slice(0, 10);
const customerIdOf = (item) => text(item?.customerId || item?.clientId);
const customerNameOf = (item) => text(item?.name || [item?.firstName, item?.lastName].filter(Boolean).join(' '));
const normalizeSearch = (value) => text(value).toLocaleLowerCase('it-IT');
const today = () => {
  const value = new Date();
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-');
};
const localDay = (value) => {
  const source = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(source.getTime())) return '';
  return [source.getFullYear(), String(source.getMonth() + 1).padStart(2, '0'), String(source.getDate()).padStart(2, '0')].join('-');
};
const addDays = (value, amount) => {
  const source = new Date(value);
  source.setDate(source.getDate() + amount);
  return source;
};
const roundMoney = (value) => money(value);

const toolError = (code, message, status = 400, details = undefined) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
};

const safeCustomer = (item) => item && ({
  id: String(item.id),
  name: customerNameOf(item),
  type: item.clientType || item.type || null,
  email: text(item.email) || null,
  phone: text(item.phone) || null,
  city: text(item.city) || null,
});

const safeInvoice = (item, summary = null, includeFinancials = Boolean(summary)) => item && ({
  id: String(item.id),
  invoiceNumber: text(item.invoiceNumber) || null,
  customerId: customerIdOf(item) || null,
  date: dateOnly(item.date || item.createdAt) || null,
  dueDate: dateOnly(item.dueDate || item.date) || null,
  status: text(item.status) || 'Non Pagata',
  total: includeFinancials ? money(item.total ?? item.amount) : null,
  paymentSummary: includeFinancials ? summary : null,
});

const safePayment = (item) => item && ({
  id: String(item.id),
  invoiceId: text(item.invoiceId) || null,
  clientId: text(item.clientId) || null,
  date: dateOnly(item.date || item.createdAt) || null,
  amount: money(item.amount),
  method: text(item.method) || null,
  reference: text(item.reference) || null,
});

const safeProject = (item) => item && ({
  id: String(item.id),
  title: text(item.title || item.name) || null,
  customerId: customerIdOf(item) || null,
  status: text(item.status) || null,
  startDate: dateOnly(item.startDate) || null,
  deadline: dateOnly(item.deadline || item.endDate) || null,
  progress: item.progress == null ? null : Number(item.progress),
});

const redactFinancials = (value) => {
  if (Array.isArray(value)) return value.map(redactFinancials);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !FINANCIAL_FIELDS.has(String(key).toLowerCase().replace(/[_-]/g, '')))
    .map(([key, nested]) => [key, redactFinancials(nested)]));
};

const safeQuote = (item, includeFinancials = false) => item && ({
  id: String(item.id),
  quoteNumber: text(item.quoteNumber) || null,
  customerId: customerIdOf(item) || null,
  date: dateOnly(item.date || item.createdAt) || null,
  status: text(item.status) || null,
  total: includeFinancials ? money(item.total ?? item.amount) : null,
});

const safeAppointment = (item) => item && ({
  id: String(item.id),
  title: text(item.title),
  customerId: customerIdOf(item) || null,
  startAt: item.startAt || null,
  endAt: item.endAt || null,
  notes: text(item.notes) || null,
});

const customerMatches = (db, query) => {
  const needle = normalizeSearch(query);
  if (!needle) return [];
  return db.list('client').filter((item) => [item.id, customerNameOf(item), item.email, item.phone, item.city]
    .some((value) => normalizeSearch(value).includes(needle)));
};

const resolveCustomer = (db, args = {}) => {
  const query = text(args.customerId || args.customerQuery || args.customer || args.clientId);
  if (!query) throw toolError('customer_required', 'Indica il cliente da cercare.');
  const matches = customerMatches(db, query);
  if (!matches.length) throw toolError('customer_not_found', `Non trovo il cliente "${query}".`, 404);
  const exact = matches.filter((item) => [item.id, customerNameOf(item), item.email, item.phone]
    .some((value) => normalizeSearch(value) === normalizeSearch(query)));
  const selected = exact.length === 1 ? exact : matches.length === 1 ? matches : [];
  if (selected.length === 1) return selected[0];
  throw toolError('ambiguous_customer', `Ho trovato più clienti per "${query}".`, 409, {
    candidates: matches.slice(0, 8).map(safeCustomer),
  });
};

const invoiceMatches = (db, query) => {
  const needle = normalizeSearch(query);
  return db.list('invoice').filter((item) => [item.id, item.invoiceNumber]
    .some((value) => normalizeSearch(value) === needle));
};

const resolveInvoice = (db, args = {}) => {
  const query = text(args.invoiceId || args.invoiceNumber || args.invoice || args.number);
  if (!query) throw toolError('invoice_required', 'Indica la fattura da usare.');
  const matches = invoiceMatches(db, query);
  if (!matches.length) throw toolError('invoice_not_found', `Non trovo la fattura "${query}".`, 404);
  if (matches.length > 1) {
    throw toolError('ambiguous_invoice', `Ho trovato più fatture per "${query}".`, 409, {
      candidates: matches.slice(0, 8).map((item) => safeInvoice(item)),
    });
  }
  return matches[0];
};

const paymentTotals = (db) => db.list('payment').reduce((result, item) => {
  const invoiceId = text(item.invoiceId);
  if (invoiceId) result[invoiceId] = money((result[invoiceId] || 0) + Number(item.amount || 0));
  return result;
}, {});

const invoiceSummary = (db, invoice, totals = paymentTotals(db)) => {
  const total = money(invoice.total ?? invoice.amount);
  const paid = money(totals[String(invoice.id)] || 0);
  const historicalPaid = text(invoice.status).toLocaleLowerCase('it-IT') === 'pagata' && paid === 0;
  const remaining = money(Math.max(0, historicalPaid ? 0 : total - paid));
  return {
    paid,
    remaining,
    computedStatus: remaining <= MONEY_EPSILON ? 'Pagata' : paid > 0 ? 'Pagata Parzialmente' : 'Non Pagata',
  };
};

const byRecent = (left, right) => String(right.date || right.updatedAt || right.createdAt || '').localeCompare(String(left.date || left.updatedAt || left.createdAt || ''));

const validateSchema = (schema, value, path = 'args') => {
  if (!schema) return;
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw toolError('invalid_tool_args', `${path} deve essere un oggetto.`);
    const keys = Object.keys(value);
    if (schema.additionalProperties === false) {
      const unknown = keys.filter((key) => !Object.prototype.hasOwnProperty.call(schema.properties || {}, key));
      if (unknown.length) throw toolError('invalid_tool_args', `Argomenti non riconosciuti: ${unknown.join(', ')}.`);
    }
    for (const required of schema.required || []) {
      if (value[required] == null || value[required] === '') throw toolError('invalid_tool_args', `Argomento obbligatorio mancante: ${required}.`);
    }
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (value[key] != null) validateSchema(child, value[key], `${path}.${key}`);
    }
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) throw toolError('invalid_tool_args', `${path} deve essere un elenco.`);
    if (schema.maxItems != null && value.length > schema.maxItems) throw toolError('invalid_tool_args', `${path} contiene troppe voci.`);
    value.forEach((entry, index) => validateSchema(schema.items, entry, `${path}[${index}]`));
    return;
  }
  if (schema.type === 'string' && typeof value !== 'string') throw toolError('invalid_tool_args', `${path} deve essere testo.`);
  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw toolError('invalid_tool_args', `${path} deve essere un numero valido.`);
    if (schema.integer && !Number.isInteger(value)) throw toolError('invalid_tool_args', `${path} deve essere un numero intero.`);
    if (schema.minimum != null && value < schema.minimum) throw toolError('invalid_tool_args', `${path} è inferiore al minimo consentito.`);
    if (schema.maximum != null && value > schema.maximum) throw toolError('invalid_tool_args', `${path} supera il massimo consentito.`);
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') throw toolError('invalid_tool_args', `${path} deve essere booleano.`);
  if (schema.enum && !schema.enum.includes(value)) throw toolError('invalid_tool_args', `${path} contiene un valore non consentito.`);
};

const objectSchema = (properties, required = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const stringProperty = { type: 'string' };
const numberProperty = { type: 'number' };

const clampLimit = (value, fallback = MAX_SEARCH_RESULTS) => {
  const fallbackValue = Math.min(Math.max(Math.trunc(Number(fallback) || 1), 1), MAX_SEARCH_RESULTS);
  if (value == null || value === '') return fallbackValue;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(Math.max(Math.trunc(numeric), 1), MAX_SEARCH_RESULTS);
};

const tool = (definition) => Object.freeze({ ...definition });

const CATALOG = [
  tool({
    name: 'search_customers', domain: 'customers', description: 'Cerca clienti per nome, email, telefono o città.', permissions: ['clients.view'], risk: 'read',
    schema: objectSchema({ query: stringProperty, limit: numberProperty }, ['query']),
    execute: ({ db, args }) => ({ customers: customerMatches(db, args.query).slice(0, clampLimit(args.limit, 10)).map(safeCustomer) }),
  }),
  tool({
    name: 'get_customer', domain: 'customers', description: 'Legge i dati essenziali di un cliente identificato senza ambiguità.', permissions: ['clients.view'], risk: 'read',
    schema: objectSchema({ customerId: stringProperty, customerQuery: stringProperty }),
    execute: ({ db, args }) => ({ customer: safeCustomer(resolveCustomer(db, args)) }),
  }),
  tool({
    name: 'get_customer_balance', domain: 'customers', description: 'Calcola il residuo delle fatture di un cliente.', permissions: ['clients.view', 'invoices.view', 'payments.view'], financial: true, risk: 'read',
    schema: objectSchema({ customerId: stringProperty, customerQuery: stringProperty }),
    execute: ({ db, args }) => {
      const customer = resolveCustomer(db, args);
      const totals = paymentTotals(db);
      const invoices = db.list('invoice').filter((item) => customerIdOf(item) === String(customer.id));
      const rows = invoices.map((item) => ({ invoice: safeInvoice(item, invoiceSummary(db, item, totals)), summary: invoiceSummary(db, item, totals) }));
      return { customer: safeCustomer(customer), balance: money(rows.reduce((sum, row) => sum + row.summary.remaining, 0)), invoices: rows };
    },
  }),
  tool({
    name: 'get_customer_history', domain: 'customers', description: 'Riassume progetti, preventivi, fatture e incassi di un cliente.', permissions: ['clients.view'], risk: 'read',
    schema: objectSchema({ customerId: stringProperty, customerQuery: stringProperty }),
    execute: ({ db, args, user }) => {
      const customer = resolveCustomer(db, args);
      const id = String(customer.id);
      const response = { customer: safeCustomer(customer) };
      const counts = {};
      if (hasEntityPermission(user, 'project', 'view')) {
        const projects = db.list('project').filter((item) => customerIdOf(item) === id).sort(byRecent);
        response.projects = projects.slice(0, MAX_SEARCH_RESULTS).map(safeProject);
        counts.projects = projects.length;
      }
      if (hasEntityPermission(user, 'quote', 'view')) {
        const quotes = db.list('quote').filter((item) => customerIdOf(item) === id).sort(byRecent);
        response.quotes = quotes.slice(0, MAX_SEARCH_RESULTS).map(safeQuote);
        counts.quotes = quotes.length;
      }
      const canSeeMoney = canViewFinancials(user)
        && hasEntityPermission(user, 'payment', 'view')
        && hasEntityPermission(user, 'invoice', 'view');
      if (hasEntityPermission(user, 'invoice', 'view')) {
        const invoices = db.list('invoice').filter((item) => customerIdOf(item) === id).sort(byRecent);
        const totals = canSeeMoney ? paymentTotals(db) : {};
        response.invoices = invoices.slice(0, MAX_SEARCH_RESULTS)
          .map((item) => safeInvoice(item, canSeeMoney ? invoiceSummary(db, item, totals) : null));
        counts.invoices = invoices.length;
      }
      if (canSeeMoney) {
        response.payments = db.list('payment')
          .filter((item) => customerIdOf(item) === id)
          .sort(byRecent)
          .slice(0, MAX_SEARCH_RESULTS)
          .map(safePayment);
        counts.payments = response.payments.length;
      }
      if (Object.keys(counts).length) response.counts = counts;
      return response;
    },
  }),
  tool({
    name: 'search_projects', domain: 'projects', description: 'Cerca progetti per titolo, cliente o stato.', permissions: ['projects.view'], risk: 'read',
    schema: objectSchema({ query: stringProperty, limit: numberProperty }, ['query']),
    execute: ({ db, args }) => {
      const needle = normalizeSearch(args.query);
      const projects = db.list('project').filter((item) => [item.id, item.title, item.name, item.status, item.clientName]
        .some((value) => normalizeSearch(value).includes(needle))).slice(0, clampLimit(args.limit, 10));
      return { projects: projects.map(safeProject) };
    },
  }),
  tool({
    name: 'get_active_projects', domain: 'projects', description: 'Elenca progetti non completati e non annullati.', permissions: ['projects.view'], risk: 'read',
    schema: objectSchema({ limit: numberProperty }),
    execute: ({ db, args }) => ({ projects: db.list('project').filter((item) => !['completato', 'annullato'].includes(normalizeSearch(item.status))).sort(byRecent).slice(0, clampLimit(args.limit, 20)).map(safeProject) }),
  }),
  tool({
    name: 'get_project_measurements', domain: 'projects', description: 'Legge misure e scheda tecnica del progetto.', permissions: ['projects.view'], risk: 'read',
    schema: objectSchema({ projectId: stringProperty }),
    execute: ({ db, args, user }) => {
      const project = db.get('project', args.projectId);
      if (!project) throw toolError('project_not_found', 'Progetto non trovato.', 404);
      const visible = canViewFinancials(user);
      return {
        project: safeProject(project),
        measurements: visible ? project.measurements || null : redactFinancials(project.measurements || null),
        technicalSheet: visible ? project.technicalSheet || null : redactFinancials(project.technicalSheet || null),
        workLines: Array.isArray(project.workLines)
          ? project.workLines.slice(0, MAX_SEARCH_RESULTS).map((line) => visible ? line : redactFinancials(line))
          : [],
      };
    },
  }),
  tool({
    name: 'search_quotes', domain: 'quotes', description: 'Cerca preventivi per numero, cliente o stato.', permissions: ['quotes.view'], risk: 'read',
    schema: objectSchema({ query: stringProperty, limit: numberProperty }, ['query']),
    execute: ({ db, args }) => {
      const needle = normalizeSearch(args.query);
      return { quotes: db.list('quote').filter((item) => [item.id, item.quoteNumber, item.customerName, item.status]
        .some((value) => normalizeSearch(value).includes(needle))).slice(0, clampLimit(args.limit, 10)).map(safeQuote) };
    },
  }),
  tool({
    name: 'get_quote', domain: 'quotes', description: 'Legge un preventivo per ID o numero.', permissions: ['quotes.view', 'payments.view'], financial: true, risk: 'read',
    schema: objectSchema({ quoteId: stringProperty, quoteNumber: stringProperty }),
    execute: ({ db, args, user }) => {
      const query = text(args.quoteId || args.quoteNumber);
      const item = db.list('quote').find((entry) => [entry.id, entry.quoteNumber].some((value) => text(value) === query));
      if (!item) throw toolError('quote_not_found', 'Preventivo non trovato.', 404);
      return { quote: safeQuote(item, canViewFinancials(user)), items: canViewFinancials(user) && Array.isArray(item.items) ? item.items.slice(0, MAX_SEARCH_RESULTS) : [] };
    },
  }),
  tool({
    name: 'create_quote_draft', domain: 'quotes', description: 'Prepara una bozza di preventivo con cliente e righe fornite.', permissions: ['quotes.create'], financial: true, risk: 'write',
    schema: objectSchema({ customerId: stringProperty, customerQuery: stringProperty, date: stringProperty, notes: stringProperty, items: { type: 'array', maxItems: 50, items: objectSchema({ description: stringProperty, quantity: numberProperty, unitPrice: numberProperty }) } }, ['date', 'items']),
    execute: ({ db, args, user, operationId, domain }) => {
      const customer = resolveCustomer(db, args);
      if (!args.items.length || args.items.some((item) => !text(item.description) || item.quantity <= 0 || item.unitPrice < 0)) throw toolError('invalid_quote', 'La bozza deve contenere righe valide.');
      const raw = { customerId: String(customer.id), date: dateOnly(args.date), notes: text(args.notes), status: 'Bozza', items: args.items };
      const payload = domain?.normalize ? domain.normalize('quote', raw, { defaults: true }) : raw;
      domain?.validateEntity?.('quote', payload);
      const result = db.create('quote', payload, user, operationId);
      return { quote: safeQuote(result.item), replayed: Boolean(result.replayed) };
    },
  }),
  tool({
    name: 'search_invoices', domain: 'invoices', description: 'Cerca fatture per numero, cliente o stato.', permissions: ['invoices.view'], risk: 'read',
    schema: objectSchema({ query: stringProperty, limit: numberProperty }, ['query']),
    execute: ({ db, args }) => {
      const needle = normalizeSearch(args.query);
      return { invoices: db.list('invoice').filter((item) => [item.id, item.invoiceNumber, item.customerName, item.status]
        .some((value) => normalizeSearch(value).includes(needle))).sort(byRecent).slice(0, clampLimit(args.limit, 10)).map((item) => safeInvoice(item)) };
    },
  }),
  tool({
    name: 'get_invoice', domain: 'invoices', description: 'Legge una fattura e il suo residuo.', permissions: ['invoices.view', 'payments.view'], financial: true, risk: 'read',
    schema: objectSchema({ invoiceId: stringProperty, invoiceNumber: stringProperty, number: stringProperty }),
    execute: ({ db, args }) => {
      const invoice = resolveInvoice(db, args);
      return { invoice: safeInvoice(invoice, invoiceSummary(db, invoice)) };
    },
  }),
  tool({
    name: 'list_unpaid_invoices', domain: 'invoices', description: 'Elenca fatture con residuo aperto.', permissions: ['invoices.view', 'payments.view'], financial: true, risk: 'read',
    schema: objectSchema({ limit: numberProperty }),
    execute: ({ db, args }) => {
      const totals = paymentTotals(db);
      return { invoices: db.list('invoice').map((item) => ({ item, summary: invoiceSummary(db, item, totals) })).filter((row) => row.summary.remaining > MONEY_EPSILON).sort((a, b) => String(a.item.dueDate || a.item.date).localeCompare(String(b.item.dueDate || b.item.date))).slice(0, clampLimit(args.limit, 20)).map((row) => safeInvoice(row.item, row.summary)) };
    },
  }),
  tool({
    name: 'get_customer_invoices', domain: 'invoices', description: 'Elenca fatture di un cliente.', permissions: ['clients.view', 'invoices.view', 'payments.view'], financial: true, risk: 'read',
    schema: objectSchema({ customerId: stringProperty, customerQuery: stringProperty, limit: numberProperty }),
    execute: ({ db, args }) => {
      const customer = resolveCustomer(db, args);
      const totals = paymentTotals(db);
      return { customer: safeCustomer(customer), invoices: db.list('invoice').filter((item) => customerIdOf(item) === String(customer.id)).sort(byRecent).slice(0, clampLimit(args.limit, 20)).map((item) => safeInvoice(item, invoiceSummary(db, item, totals))) };
    },
  }),
  tool({
    name: 'get_payments', domain: 'payments', description: 'Elenca incassi filtrabili per cliente o fattura.', permissions: ['payments.view'], financial: true, risk: 'read',
    schema: objectSchema({ customerId: stringProperty, invoiceId: stringProperty, limit: numberProperty }),
    execute: ({ db, args }) => ({ payments: db.list('payment').filter((item) => (!args.customerId || customerIdOf(item) === String(args.customerId)) && (!args.invoiceId || text(item.invoiceId) === String(args.invoiceId))).sort(byRecent).slice(0, clampLimit(args.limit, 20)).map(safePayment) }),
  }),
  tool({
    name: 'register_payment', domain: 'payments', description: 'Registra un incasso su una fattura dopo conferma esplicita.', permissions: ['payments.create', 'invoices.view'], financial: true, risk: 'write',
    schema: objectSchema({ invoiceId: stringProperty, invoiceNumber: stringProperty, amount: numberProperty, date: stringProperty, method: stringProperty, reference: stringProperty }, ['amount', 'date']),
    execute: ({ db, args, user, operationId, domain }) => {
      const invoice = resolveInvoice(db, args);
      const customerId = customerIdOf(invoice);
      if (!customerId) throw toolError('invoice_customer_missing', 'La fattura non ha un cliente collegato.', 409);
      const summary = invoiceSummary(db, invoice);
      const amount = money(args.amount);
      if (amount <= 0 || amount - summary.remaining > MONEY_EPSILON) throw toolError('payment_exceeds_balance', 'L’incasso supera il residuo della fattura.', 409, { remaining: summary.remaining });
      const raw = { id: crypto.randomUUID(), clientId: customerId, invoiceId: String(invoice.id), date: dateOnly(args.date), amount, method: text(args.method) || 'Non specificato', reference: text(args.reference) };
      const payload = domain?.normalize ? domain.normalize('payment', raw, { defaults: true }) : raw;
      domain?.validateEntity?.('payment', payload);
      domain?.validatePaymentLinks?.(db, payload);
      const result = db.create('payment', payload, user, operationId);
      return { payment: safePayment(result.item), invoice: safeInvoice(invoice, { ...summary, paid: money(summary.paid + amount), remaining: money(summary.remaining - amount) }), replayed: Boolean(result.replayed) };
    },
  }),
  tool({
    name: 'mark_invoice_paid', domain: 'payments', description: 'Salda il residuo di una fattura registrando l’incasso e aggiornando lo stato, dopo conferma.', permissions: ['payments.create', 'invoices.view'], financial: true, risk: 'write',
    schema: objectSchema({ invoiceId: stringProperty, invoiceNumber: stringProperty, date: stringProperty, method: stringProperty, reference: stringProperty }, ['date']),
    execute: ({ db, args, user, operationId, domain }) => {
      const invoice = resolveInvoice(db, args);
      const summary = invoiceSummary(db, invoice);
      if (summary.remaining <= MONEY_EPSILON) throw toolError('invoice_already_paid', 'La fattura risulta già saldata.', 409);
      const rawPayment = { clientId: customerIdOf(invoice), invoiceId: String(invoice.id), date: dateOnly(args.date), amount: summary.remaining, method: text(args.method) || 'Non specificato', reference: text(args.reference) };
      const paymentPayload = domain?.normalize ? domain.normalize('payment', rawPayment, { defaults: true }) : rawPayment;
      domain?.validateEntity?.('payment', paymentPayload);
      domain?.validatePaymentLinks?.(db, paymentPayload);
      const result = db.markInvoicePaid(invoice.id, { date: dateOnly(args.date), method: text(args.method) || 'Non specificato', reference: text(args.reference) }, user, operationId);
      return { payment: safePayment(result.payment), invoice: safeInvoice(result.invoice, { paid: money(result.invoice.total ?? result.invoice.amount), remaining: 0, computedStatus: 'Pagata' }), replayed: Boolean(result.replayed) };
    },
  }),
  tool({
    name: 'get_today_schedule', domain: 'calendar', description: 'Elenca gli appuntamenti di oggi.', permissions: ['calendar.view'], risk: 'read',
    schema: objectSchema({}),
    execute: ({ db }) => ({ date: today(), appointments: db.list('appointment').filter((item) => localDay(item.startAt) === today()).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt))).map(safeAppointment) }),
  }),
  tool({
    name: 'get_tomorrow_schedule', domain: 'calendar', description: 'Elenca gli appuntamenti di domani.', permissions: ['calendar.view'], risk: 'read',
    schema: objectSchema({}),
    execute: ({ db }) => { const date = localDay(addDays(new Date(), 1)); return { date, appointments: db.list('appointment').filter((item) => localDay(item.startAt) === date).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt))).map(safeAppointment) }; },
  }),
  tool({
    name: 'create_appointment', domain: 'calendar', description: 'Crea un appuntamento con cliente e intervallo indicati dopo conferma.', permissions: ['calendar.create'], risk: 'write',
    schema: objectSchema({ title: stringProperty, customerId: stringProperty, customerQuery: stringProperty, startAt: stringProperty, endAt: stringProperty, notes: stringProperty }, ['title', 'startAt', 'endAt']),
    execute: ({ db, args, user, operationId, domain }) => {
      const start = new Date(args.startAt);
      const end = new Date(args.endAt);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw toolError('invalid_appointment', 'Intervallo appuntamento non valido.');
      const customer = args.customerId || args.customerQuery ? resolveCustomer(db, args) : null;
      const raw = { title: text(args.title), customerId: customer ? String(customer.id) : null, startAt: start.toISOString(), endAt: end.toISOString(), notes: text(args.notes) };
      const payload = domain?.normalize ? domain.normalize('appointment', raw, { defaults: true }) : raw;
      domain?.validateEntity?.('appointment', payload);
      const result = db.create('appointment', payload, user, operationId);
      return { appointment: safeAppointment(result.item), replayed: Boolean(result.replayed) };
    },
  }),
  tool({
    name: 'get_revenue_period', domain: 'analytics', description: 'Somma imponibile/totale delle fatture nel periodo indicato.', permissions: ['invoices.view'], financial: true, risk: 'read',
    schema: objectSchema({ startDate: stringProperty, endDate: stringProperty }, ['startDate', 'endDate']),
    execute: ({ db, args }) => { const rows = db.list('invoice').filter((item) => dateOnly(item.date || item.createdAt) >= args.startDate && dateOnly(item.date || item.createdAt) <= args.endDate); return { startDate: args.startDate, endDate: args.endDate, revenue: money(rows.reduce((sum, item) => sum + Number(item.total ?? item.amount ?? 0), 0)), invoiceCount: rows.length }; },
  }),
  tool({
    name: 'get_outstanding_total', domain: 'analytics', description: 'Somma i residui delle fatture aperte.', permissions: ['invoices.view', 'payments.view'], financial: true, risk: 'read',
    schema: objectSchema({}),
    execute: ({ db }) => { const totals = paymentTotals(db); const rows = db.list('invoice').map((item) => ({ item, summary: invoiceSummary(db, item, totals) })); return { outstanding: money(rows.reduce((sum, row) => sum + row.summary.remaining, 0)), invoiceCount: rows.filter((row) => row.summary.remaining > MONEY_EPSILON).length }; },
  }),
  tool({
    name: 'get_monthly_revenue', domain: 'analytics', description: 'Somma fatture per mese nel periodo annuale indicato.', permissions: ['invoices.view'], financial: true, risk: 'read',
    schema: objectSchema({ year: numberProperty }),
    execute: ({ db, args }) => { const year = Number(args.year); const monthly = Array.from({ length: 12 }, (_, month) => ({ month: month + 1, revenue: 0, invoiceCount: 0 })); db.list('invoice').forEach((item) => { const date = dateOnly(item.date || item.createdAt); if (Number(date.slice(0, 4)) !== year) return; const entry = monthly[Number(date.slice(5, 7)) - 1]; if (!entry) return; entry.revenue = money(entry.revenue + Number(item.total ?? item.amount ?? 0)); entry.invoiceCount += 1; }); return { year, monthly }; },
  }),
  tool({
    name: 'get_customer_statistics', domain: 'analytics', description: 'Classifica clienti per fatturato e residuo.', permissions: ['clients.view', 'invoices.view', 'payments.view'], financial: true, risk: 'read',
    schema: objectSchema({ limit: numberProperty }),
    execute: ({ db, args }) => { const totals = paymentTotals(db); const rows = db.list('client').map((customer) => { const invoices = db.list('invoice').filter((item) => customerIdOf(item) === String(customer.id)); return { customer: safeCustomer(customer), invoiced: money(invoices.reduce((sum, item) => sum + Number(item.total ?? item.amount ?? 0), 0)), outstanding: money(invoices.reduce((sum, item) => sum + invoiceSummary(db, item, totals).remaining, 0)), invoiceCount: invoices.length }; }).sort((a, b) => b.outstanding - a.outstanding); return { customers: rows.slice(0, clampLimit(args.limit, 20)) }; },
  }),
  tool({
    name: 'get_payment_statistics', domain: 'analytics', description: 'Riassume incassi per metodo nel periodo.', permissions: ['payments.view'], financial: true, risk: 'read',
    schema: objectSchema({ startDate: stringProperty, endDate: stringProperty }),
    execute: ({ db, args }) => { const rows = db.list('payment').filter((item) => (!args.startDate || dateOnly(item.date) >= args.startDate) && (!args.endDate || dateOnly(item.date) <= args.endDate)); const byMethod = rows.reduce((result, item) => { const method = text(item.method) || 'Non specificato'; result[method] = money((result[method] || 0) + Number(item.amount || 0)); return result; }, {}); return { total: money(rows.reduce((sum, item) => sum + Number(item.amount || 0), 0)), byMethod, paymentCount: rows.length }; },
  }),
].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

const getTool = (name) => CATALOG.find((item) => item.name === String(name));
const getToolCatalog = () => CATALOG;

const assertToolPermission = (definition, user) => {
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const missing = (definition.permissions || []).filter((permission) => !permissions.includes(permission));
  if (missing.length || (definition.financial && !canViewFinancials(user))) {
    throw toolError('permission_denied', 'Non hai i permessi necessari per questa informazione o operazione.', 403, { missing });
  }
};

const executeTool = ({ db, name, args, user, operationId, domain }) => {
  const definition = getTool(name);
  if (!definition) throw toolError('unknown_tool', 'Operazione non riconosciuta.', 400);
  assertToolPermission(definition, user);
  validateSchema(definition.schema, args || {});
  return { definition, result: definition.execute({ db, args: args || {}, user, operationId, domain }) };
};

module.exports = {
  CATALOG,
  MAX_SEARCH_RESULTS,
  assertToolPermission,
  clampLimit,
  executeTool,
  getTool,
  getToolCatalog,
  invoiceSummary,
  money,
  redactFinancials,
  toolError,
  validateSchema,
};
