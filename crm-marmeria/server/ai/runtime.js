const crypto = require('crypto');
const { canViewFinancials } = require('../access-policy');
const { assertToolPermission, executeTool, getTool, getToolCatalog, toolError, validateSchema } = require('./tools');

const SYSTEM_PROMPT = 'Sei l’assistente locale del CRM Marmeria. Rispondi in italiano semplice. Usa solo strumenti CRM autorizzati e dati restituiti dagli strumenti. Non inventare dati. Per ogni modifica attendi conferma strutturata del server. Non mostrare dettagli tecnici degli strumenti.';
const MAX_CONTEXT_CHARS = Math.min(Math.max(Number(process.env.CRM_AI_CONTEXT_MAX_CHARS) || 60000, 1000), 64000);
const MAX_TURNS = 12;
const MAX_TOOL_RESULTS = 8;
const MAX_RESULT_CHARS = 8000;
const MAX_DISAMBIGUATION_CANDIDATES = 8;
const MAX_CANDIDATE_FIELD_CHARS = 160;
const DEFAULT_QWEN_ENDPOINT = 'http://127.0.0.1:8000/v1';
const DEFAULT_QWEN_MODEL = 'Qwen3.8-27B';

const nowMs = () => Date.now();
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || min, min), max);
const text = (value) => String(value ?? '').trim();
const selectReasoningMode = (message) => /(?:^|[\s?!.,;:'’])(perch[eé]|analizz\w*|analy[sz]\w*|analisi|analysis|confront\w*|compar\w*|pianific\w*|plan\w*|piano\s+(?:di|per|d['’])|andament\w*|trend|tendenz\w*|ritard\w*|prevision\w*|previs\w*|forecast|root[\s-]?cause|causa[\s-]+radice|caus\w*\s+del|scostament\w*)(?=$|[\s?!.,;:'’])/i.test(text(message))
  ? 'reasoning'
  : 'fast';
const scopedOperationId = ({ user, session, tool, operationId }) => `ai:v1:${crypto.createHash('sha256')
  .update(JSON.stringify([String(user?.id || ''), String(session?.id || ''), String(tool || ''), String(operationId || '')]))
  .digest('hex')}`;
const money = (value) => `€ ${Number(value || 0).toFixed(2).replace('.', ',')}`;
const safeJson = (value, max = MAX_RESULT_CHARS) => {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { serialized = '{}'; }
  return serialized.length > max ? `${serialized.slice(0, max)}…` : serialized;
};
const boundedCandidate = (candidate) => {
  if (!candidate || typeof candidate !== 'object') return null;
  const value = (field) => text(candidate[field]).slice(0, MAX_CANDIDATE_FIELD_CHARS) || null;
  const id = value('id');
  if (!id) return null;
  return { id, name: value('name'), email: value('email'), phone: value('phone'), city: value('city') };
};
const boundedCandidates = (candidates) => (Array.isArray(candidates) ? candidates : [])
  .slice(0, MAX_DISAMBIGUATION_CANDIDATES).map(boundedCandidate).filter(Boolean);
const boundedToolResult = (result) => {
  const ordered = canonical(result);
  const serialized = safeJson(ordered, MAX_RESULT_CHARS);
  if (serialized.length <= MAX_RESULT_CHARS) return ordered;
  return { truncated: true, preview: serialized.slice(0, MAX_RESULT_CHARS - 40) };
};
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const stableCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

class AiSessionStore {
  constructor({ maxSessions = 200, ttlMs = 8 * 60 * 60 * 1000 } = {}) {
    this.maxSessions = maxSessions;
    this.ttlMs = ttlMs;
    this.sessions = new Map();
  }

  prune() {
    const cutoff = nowMs() - this.ttlMs;
    for (const [id, session] of this.sessions) {
      if (session.touchedAt < cutoff) this.sessions.delete(id);
    }
    while (this.sessions.size > this.maxSessions) {
      const oldest = [...this.sessions.values()].sort((left, right) => left.touchedAt - right.touchedAt)[0];
      if (!oldest) break;
      this.sessions.delete(oldest.id);
    }
  }

  create(userId) {
    this.prune();
    const session = {
      id: crypto.randomUUID(), userId: String(userId), createdAt: new Date().toISOString(), touchedAt: nowMs(),
      state: { currentEntityIds: {}, pendingConfirmation: null, disambiguationCandidates: [], recentTurns: [], toolResults: [] },
      completed: new Map(),
      lastMetrics: null,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id, userId) {
    const session = this.sessions.get(String(id));
    if (!session) throw toolError('session_not_found', 'Sessione assistente non trovata.', 404);
    if (String(session.userId) !== String(userId)) throw toolError('session_forbidden', 'Sessione assistente non disponibile.', 403);
    session.touchedAt = nowMs();
    return session;
  }

  addTurn(session, role, content) {
    session.state.recentTurns.push({ role, content: text(content).slice(0, 4000) });
    session.state.recentTurns = session.state.recentTurns.slice(-MAX_TURNS);
    session.touchedAt = nowMs();
  }

  addToolResult(session, name, result) {
    session.state.toolResults.push({ name, result: safeJson(result) });
    session.state.toolResults = session.state.toolResults.slice(-MAX_TOOL_RESULTS);
    for (const key of ['customer', 'invoice', 'quote', 'project', 'appointment']) {
      if (result?.[key]?.id) session.state.currentEntityIds[key] = String(result[key].id);
    }
    if (result?.customer?.id) session.state.currentEntityIds.customer = String(result.customer.id);
    session.touchedAt = nowMs();
  }

  setPending(session, action) {
    session.state.pendingConfirmation = action;
    session.touchedAt = nowMs();
  }

  clearPending(session) {
    const pending = session.state.pendingConfirmation;
    session.state.pendingConfirmation = null;
    session.touchedAt = nowMs();
    return pending;
  }

  setCompleted(session, operationId, result) {
    session.completed.set(String(operationId), result);
    while (session.completed.size > 50) session.completed.delete(session.completed.keys().next().value);
  }

  publicState(session) {
    const pending = session.state.pendingConfirmation;
    return {
      sessionId: session.id,
      currentEntityIds: { ...session.state.currentEntityIds },
      disambiguationCandidates: session.state.disambiguationCandidates,
      pendingConfirmation: pending ? {
        actionId: pending.actionId,
        operationId: pending.operationId,
        summary: pending.summary,
        expiresAt: pending.expiresAt,
      } : null,
      recentTurns: session.state.recentTurns.slice(-MAX_TURNS),
      lastMetrics: session.lastMetrics,
    };
  }
}

const staticToolSchema = (definition) => ({
  name: definition.name,
  description: definition.description,
  parameters: canonical(definition.schema),
});

const buildStaticPrefix = (definitions) => JSON.stringify({
  system: SYSTEM_PROMPT,
  tools: definitions.map(staticToolSchema).sort((left, right) => stableCompare(left.name, right.name)),
});

const buildContext = (session, definitions) => {
  const prefix = buildStaticPrefix(definitions);
  const dynamic = {
    state: session.state.currentEntityIds,
    pending: session.state.pendingConfirmation ? { actionId: session.state.pendingConfirmation.actionId, summary: session.state.pendingConfirmation.summary } : null,
    disambiguationCandidates: boundedCandidates(session.state.disambiguationCandidates),
    turns: session.state.recentTurns,
    toolResults: session.state.toolResults,
  };
  let dynamicJson = JSON.stringify(dynamic);
  if ((prefix.length + dynamicJson.length) > MAX_CONTEXT_CHARS) {
    const turns = [...dynamic.turns];
    while (turns.length && (prefix.length + dynamicJson.length) > MAX_CONTEXT_CHARS) {
      turns.shift();
      dynamic.turns = turns;
      dynamicJson = JSON.stringify(dynamic);
    }
  }
  if ((prefix.length + dynamicJson.length) > MAX_CONTEXT_CHARS) {
    dynamic.toolResults = dynamic.toolResults.slice(-2);
    dynamicJson = JSON.stringify(dynamic);
  }
  if ((prefix.length + dynamicJson.length) > MAX_CONTEXT_CHARS) {
    dynamic.toolResults = [];
    dynamicJson = JSON.stringify(dynamic);
  }
  if ((prefix.length + dynamicJson.length) > MAX_CONTEXT_CHARS) {
    dynamic.turns = [];
    dynamicJson = JSON.stringify(dynamic);
  }
  return `${prefix}\n${dynamicJson}`.slice(0, MAX_CONTEXT_CHARS);
};

const normalize = (value) => text(value).toLocaleLowerCase('it-IT');
const isCancelIntent = (message) => /^(annulla|cancella|lascia perdere|non procedere)\b/i.test(text(message));
const isConfirmIntent = (message) => /^(confermo|conferma|s[iì]|ok|procedi|vai|esegui)(?:\s|$)/i.test(text(message));
const rememberToolError = (session, error) => {
  if (Array.isArray(error?.details?.candidates)) session.state.disambiguationCandidates = boundedCandidates(error.details.candidates);
};

const domainTools = {
  customers: ['search_customers', 'get_customer', 'get_customer_balance', 'get_customer_history', 'get_customer_invoices', 'search_invoices', 'get_payments'],
  invoices: ['search_invoices', 'get_invoice', 'list_unpaid_invoices', 'get_customer_invoices', 'get_payments', 'get_customer_balance', 'register_payment', 'mark_invoice_paid'],
  projects: ['search_projects', 'get_active_projects', 'get_project_measurements', 'get_customer', 'search_customers'],
  quotes: ['search_quotes', 'get_quote', 'create_quote_draft', 'get_customer', 'search_customers'],
  calendar: ['get_today_schedule', 'get_tomorrow_schedule', 'create_appointment', 'search_customers', 'get_customer'],
  analytics: ['get_revenue_period', 'get_outstanding_total', 'get_monthly_revenue', 'get_customer_statistics', 'get_payment_statistics', 'list_unpaid_invoices', 'get_payments'],
};

const detectDomain = (message) => {
  const value = normalize(message);
  if (/appunt|calendario|domani|oggi|venerd|lunedi|martedi|mercoledi|giovedi|sabato|domenica/.test(value)) return 'calendar';
  if (/qual[e]? cliente.*deve|cliente.*pi[uù].*soldi|pi[uù].*soldi|fatturat|ricav|statistic|mese|anno/.test(value)) return 'analytics';
  if (/fattur|pagat|incass|deve|soldi|residu|cliente.*deb|deb.*cliente/.test(value)) return value.includes('fatturat') ? 'analytics' : value.includes('appuntament') ? 'calendar' : value.includes('preventiv') ? 'quotes' : 'invoices';
  if (/progett|misur|lavorazion/.test(value)) return 'projects';
  if (/preventiv|quot/.test(value)) return 'quotes';
  if (/client|rossi|bianchi/.test(value)) return 'customers';
  return 'customers';
};

const selectTools = (message, user) => {
  const catalog = getToolCatalog();
  const allowed = new Set(Array.isArray(user?.permissions) ? user.permissions : []);
  const domain = detectDomain(message);
  const preferred = domainTools[domain] || domainTools.customers;
  const selected = catalog.filter((definition) => preferred.includes(definition.name)
    && (definition.permissions || []).every((permission) => allowed.has(permission))
    && (!definition.financial || canViewFinancials(user)));
  const fallback = catalog.filter((definition) => (definition.permissions || []).every((permission) => allowed.has(permission)) && (!definition.financial || canViewFinancials(user)));
  return selected.slice(0, 10).length >= 5 ? selected.slice(0, 10) : fallback.slice(0, 10);
};

const dateForWeekday = (targetDay) => {
  const current = new Date();
  const delta = (targetDay - current.getDay() + 7) % 7 || 7;
  current.setDate(current.getDate() + delta);
  current.setHours(9, 0, 0, 0);
  return current;
};
const monthRange = () => {
  const current = new Date();
  return {
    startDate: `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-01`,
    endDate: `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate()).padStart(2, '0')}`,
  };
};
const extractPerson = (message, pattern) => {
  const match = text(message).match(pattern);
  return text(match?.[1]?.replace(/[?.!,;:]+$/, ''));
};

class MockLlmProvider {
  constructor() { this.name = 'mock'; }

  async generate({ message }) {
    const value = normalize(message);
    if (/quanto deve/.test(value)) return { toolCalls: [{ name: 'get_customer_balance', args: { customerQuery: extractPerson(message, /quanto deve\s+(.+)/i) } }] };
    if (/ultima fattura/.test(value)) return { toolCalls: [{ name: 'get_customer_invoices', args: { customerQuery: extractPerson(message, /fattura\s+di\s+(.+)/i), limit: 1 } }] };
    if (/segna la fattura/.test(value) && /pagat/.test(value)) return { toolCalls: [{ name: 'mark_invoice_paid', args: { invoiceNumber: extractPerson(message, /fattura\s+([^\s]+)\s+come/i), date: new Date().toISOString().slice(0, 10), method: 'Non specificato' } }] };
    if (/fatturat.*mese|fatturato questo mese/.test(value)) return { toolCalls: [{ name: 'get_revenue_period', args: monthRange() }] };
    if (/appuntament.*domani|domani.*appuntament/.test(value)) return { toolCalls: [{ name: 'get_tomorrow_schedule', args: {} }] };
    if (/crea un appuntamento/.test(value) && /venerd/.test(value)) {
      const start = dateForWeekday(5);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const customerQuery = extractPerson(message, /con\s+(.+?)\s+venerd/i);
      return { toolCalls: [{ name: 'create_appointment', args: { title: `Appuntamento con ${customerQuery}`, customerQuery, startAt: start.toISOString(), endAt: end.toISOString() } }] };
    }
    if (/quale cliente.*deve|cliente.*pi[uù].*soldi|pi[uù].*soldi/.test(value)) return { toolCalls: [{ name: 'get_customer_statistics', args: { limit: 10 } }] };
    if (/domani/.test(value)) return { toolCalls: [{ name: 'get_tomorrow_schedule', args: {} }] };
    if (/oggi/.test(value) && /appuntament/.test(value)) return { toolCalls: [{ name: 'get_today_schedule', args: {} }] };
    if (/fattur|fattura/.test(value)) return { toolCalls: [{ name: 'search_invoices', args: { query: text(message).replace(/fattur[ae]?/ig, '').trim() || ' ' } }] };
    if (/cliente/.test(value)) return { toolCalls: [{ name: 'search_customers', args: { query: text(message).replace(/cliente/ig, '').trim() || ' ' } }] };
    return { text: 'Posso cercare clienti, progetti, preventivi, fatture, incassi, appuntamenti o statistiche. Specifica la richiesta.' };
  }

  async *stream(input) { yield await this.generate(input); }

  async *streamFinal({ message, plan, toolResults = [] }) {
    const primary = toolResults[0];
    const output = primary
      ? formatResult(primary.name, primary.result)
      : text(plan?.text) || (await this.generate({ message })).text;
    if (output) yield { delta: output };
  }
}

const qwenToolDefinitions = (definitions) => definitions.map((definition) => ({
  type: 'function',
  function: { name: definition.name, description: definition.description, parameters: definition.schema },
}));

const qwenContent = (value) => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((part) => typeof part === 'string' ? part : text(part?.text)).join('');
  return '';
};

const parseQwenToolArguments = (call) => {
  const raw = call?.function?.arguments;
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { throw toolError('invalid_tool_args', 'Il server locale ha restituito argomenti non validi.'); }
};

const parseSseBlock = (block) => {
  const data = String(block || '').split(/\r\n|\n|\r/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n').trim();
  if (!data) return null;
  if (data === '[DONE]') return { done: true };
  try { return JSON.parse(data); } catch { throw toolError('local_provider_invalid_response', 'Il server Qwen locale ha inviato un evento SSE non valido.', 502); }
};

const drainSseBuffer = (buffer, flush = false) => {
  const events = [];
  let remaining = buffer;
  while (true) {
    const separatorIndex = remaining.search(/\r\n\r\n|\n\n|\r\r/);
    if (separatorIndex < 0) break;
    const separator = remaining.slice(separatorIndex).match(/^\r\n\r\n|^\n\n|^\r\r/)[0];
    const event = parseSseBlock(remaining.slice(0, separatorIndex));
    remaining = remaining.slice(separatorIndex + separator.length);
    if (event) events.push(event);
  }
  if (flush && remaining.trim()) {
    const event = parseSseBlock(remaining);
    if (event) events.push(event);
    remaining = '';
  }
  return { remaining, events };
};

const readSseResponse = async function* (response) {
  if (!response?.body) throw toolError('local_provider_invalid_response', 'Il server Qwen locale non ha restituito uno stream valido.', 502);
  const decoder = new TextDecoder();
  let buffer = '';
  const consume = (chunk, flush = false) => {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: !flush });
    const drained = drainSseBuffer(buffer, flush);
    buffer = drained.remaining;
    return drained.events;
  };
  if (typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    try {
      while (true) {
        const next = await reader.read();
        for (const event of consume(next.value || new Uint8Array(), next.done)) {
          yield event;
          if (event.done) return;
        }
        if (next.done) return;
      }
    } finally { reader.releaseLock?.(); }
  }
  if (response.body[Symbol.asyncIterator]) {
    for await (const chunk of response.body) {
      for (const event of consume(chunk)) {
        yield event;
        if (event.done) return;
      }
    }
    for (const event of consume('', true)) yield event;
    return;
  }
  throw toolError('local_provider_invalid_response', 'Il server Qwen locale non ha restituito uno stream leggibile.', 502);
};

class QwenLocalProvider {
  constructor({ endpoint = process.env.CRM_AI_QWEN_URL || DEFAULT_QWEN_ENDPOINT, model = process.env.CRM_AI_QWEN_MODEL || DEFAULT_QWEN_MODEL, timeoutMs = 30000, chatTemplateKwargs } = {}) {
    this.name = 'qwen-local';
    this.endpoint = String(endpoint).replace(/\/$/, '');
    this.model = model;
    this.timeoutMs = timeoutMs;
    const configured = chatTemplateKwargs ?? process.env.CRM_AI_QWEN_CHAT_TEMPLATE_KWARGS;
    if (typeof configured === 'string' && configured.trim()) {
      try { this.chatTemplateKwargs = JSON.parse(configured); } catch { this.chatTemplateKwargs = {}; }
    } else {
      this.chatTemplateKwargs = configured && typeof configured === 'object' && !Array.isArray(configured) ? { ...configured } : {};
    }
  }

  chatTemplateKwargsFor(reasoningMode = 'fast') {
    return { ...this.chatTemplateKwargs, enable_thinking: reasoningMode === 'reasoning' };
  }

  async generate({ message, context, definitions, reasoningMode = 'fast' }) {
    if (typeof fetch !== 'function') throw toolError('local_provider_unavailable', 'Runtime Node senza fetch: server Qwen locale non disponibile.', 503);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.endpoint}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ model: this.model, temperature: 0, stream: false, chat_template_kwargs: this.chatTemplateKwargsFor(reasoningMode), messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `${context}\nRichiesta: ${message}` }], tools: qwenToolDefinitions(definitions), tool_choice: 'auto' }),
      });
      if (!response.ok) throw toolError('local_provider_unavailable', 'Server Qwen locale non raggiungibile o ha rifiutato la richiesta.', 503);
      const payload = await response.json();
      const assistant = payload?.choices?.[0]?.message;
      if (!assistant) throw toolError('local_provider_invalid_response', 'Risposta non valida dal server Qwen locale.', 502);
      const toolCalls = (assistant.tool_calls || []).map((call, index) => ({ id: call.id || `call_${index + 1}`, name: call.function?.name, args: parseQwenToolArguments(call) }));
      return { text: text(assistant.content), toolCalls, usage: payload.usage || null };
    } catch (error) {
      if (error.code) throw error;
      throw toolError('local_provider_unavailable', 'Server Qwen locale non disponibile.', 503);
    } finally { clearTimeout(timer); }
  }

  async *stream(input) { yield await this.generate(input); }

  async *streamFinal({ message, context, definitions, toolResults = [], plan = null, reasoningMode = 'fast' }) {
    if (typeof fetch !== 'function') throw toolError('local_provider_unavailable', 'Runtime Node senza fetch: server Qwen locale non disponibile.', 503);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const calls = Array.isArray(plan?.toolCalls) ? plan.toolCalls.slice(0, 3) : [];
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${context}\nRichiesta: ${message}` },
      ];
      if (toolResults.length) {
        messages.push({
          role: 'assistant',
          content: text(plan?.text) || null,
          tool_calls: calls.map((call, index) => ({
            id: call.id || `call_${index + 1}`,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.args || {}) },
          })),
        });
        toolResults.slice(0, 3).forEach((entry, index) => {
          messages.push({
            role: 'tool',
            tool_call_id: entry.toolCallId || calls[index]?.id || `call_${index + 1}`,
            name: entry.name,
            content: safeJson(boundedToolResult(entry.result), MAX_RESULT_CHARS),
          });
        });
      }
      const response = await fetch(`${this.endpoint}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, signal: controller.signal,
        body: JSON.stringify({ model: this.model, temperature: 0, stream: true, stream_options: { include_usage: true }, chat_template_kwargs: this.chatTemplateKwargsFor(reasoningMode), messages, tools: qwenToolDefinitions(definitions), tool_choice: 'none' }),
      });
      if (!response.ok) throw toolError('local_provider_unavailable', 'Server Qwen locale non raggiungibile o ha rifiutato la risposta finale.', 503);
      for await (const payload of readSseResponse(response)) {
        if (payload.done) return;
        const choice = payload?.choices?.[0];
        if (choice?.delta?.tool_calls?.length || choice?.message?.tool_calls?.length) throw toolError('local_provider_invalid_response', 'Il server Qwen locale ha richiesto uno strumento durante la risposta finale.', 502);
        const delta = qwenContent(choice?.delta?.content ?? choice?.message?.content);
        if (delta) yield { delta, usage: payload.usage || null };
        else if (payload.usage) yield { usage: payload.usage };
      }
    } catch (error) {
      if (error.code) throw error;
      throw toolError('local_provider_unavailable', 'Server Qwen locale non disponibile.', 503);
    } finally { clearTimeout(timer); }
  }
}

const createProvider = (options = {}) => {
  if (options.provider && (typeof options.provider.generate === 'function' || typeof options.provider.plan === 'function' || typeof options.provider.stream === 'function')) return options.provider;
  const mode = String(options.providerMode || process.env.CRM_AI_PROVIDER || 'mock').toLowerCase();
  if (mode === 'qwen' || mode === 'qwen-local') return new QwenLocalProvider(options.qwen || {});
  return new MockLlmProvider();
};

const pendingSummary = (name, args) => {
  if (name === 'mark_invoice_paid') return `Saldi la fattura ${args.invoiceNumber || args.invoiceId || ''}.`;
  if (name === 'register_payment') return `Registi un incasso di ${money(args.amount)} sulla fattura ${args.invoiceNumber || args.invoiceId || ''}.`;
  if (name === 'create_appointment') return `Crei l’appuntamento "${args.title}".`;
  if (name === 'create_quote_draft') return 'Crei una bozza di preventivo.';
  return 'Esegui una modifica sui dati CRM.';
};

const formatResult = (name, result) => {
  if (name === 'get_customer_balance') return `${result.customer?.name || 'Il cliente'} deve ${money(result.balance)}.`;
  if (name === 'get_customer_invoices') {
    const invoice = result.invoices?.[0];
    return invoice ? `L’ultima fattura di ${result.customer?.name || 'questo cliente'} è ${invoice.invoiceNumber || invoice.id}, del ${invoice.date || 'data non indicata'}, per ${money(invoice.total)}.` : `Non risultano fatture per ${result.customer?.name || 'questo cliente'}.`;
  }
  if (name === 'get_revenue_period') return `Nel periodo indicato abbiamo fatturato ${money(result.revenue)} su ${result.invoiceCount} fatture.`;
  if (name === 'get_tomorrow_schedule' || name === 'get_today_schedule') return result.appointments?.length ? `Ci sono ${result.appointments.length} appuntamenti il ${result.date}.` : `Non risultano appuntamenti il ${result.date}.`;
  if (name === 'get_customer_statistics') { const first = result.customers?.[0]; return first ? `${first.customer.name} è il cliente con maggior residuo: ${money(first.outstanding)}.` : 'Non risultano clienti con fatture.'; }
  if (name === 'search_customers') return result.customers?.length ? `Ho trovato ${result.customers.length} clienti.` : 'Non trovo clienti corrispondenti.';
  if (name === 'search_invoices') return result.invoices?.length ? `Ho trovato ${result.invoices.length} fatture.` : 'Non trovo fatture corrispondenti.';
  if (name === 'mark_invoice_paid') return `Fattura ${result.invoice?.invoiceNumber || result.invoice?.id || ''} saldata.`;
  if (name === 'register_payment') return `Incasso di ${money(result.payment?.amount)} registrato.`;
  if (name === 'create_appointment') return 'Appuntamento creato.';
  if (name === 'create_quote_draft') return 'Bozza di preventivo creata.';
  if (result?.outstanding != null) return `Il residuo complessivo è ${money(result.outstanding)}.`;
  return 'Richiesta completata.';
};

const tokenMetrics = (usage) => {
  const promptTokens = Number(usage?.prompt_tokens ?? usage?.promptTokens);
  const cached = Number(usage?.prompt_tokens_details?.cached_tokens ?? usage?.cached_prompt_tokens);
  const completionTokens = Number(usage?.completion_tokens ?? usage?.completionTokens);
  return {
    prefillTokens: Number.isFinite(promptTokens) ? promptTokens : null,
    cachedPrefillTokens: Number.isFinite(cached) ? cached : null,
    newPrefillTokens: Number.isFinite(promptTokens) && Number.isFinite(cached) ? Math.max(0, promptTokens - cached) : null,
    decodeTokens: Number.isFinite(completionTokens) ? completionTokens : null,
    prefillRateTokensPerSecond: Number.isFinite(Number(usage?.prefill_rate)) ? Number(usage.prefill_rate) : null,
    decodeRateTokensPerSecond: Number.isFinite(Number(usage?.decode_rate)) ? Number(usage.decode_rate) : null,
  };
};

const emitText = async (onEvent, value) => {
  const output = text(value);
  if (!output) return;
  const chunks = output.match(/.{1,48}(?:\s|$)/g) || [output];
  for (const chunk of chunks) await onEvent({ type: 'text', stage: 'delta', delta: chunk });
  await onEvent({ type: 'text', stage: 'final', text: output });
};

const collectProviderPlan = async (provider, input) => {
  if (typeof provider.plan === 'function') return provider.plan(input);
  if (typeof provider.generate === 'function') return provider.generate(input);
  if (typeof provider.stream === 'function') {
    for await (const item of provider.stream(input)) return item;
  }
  throw toolError('local_provider_unavailable', 'Provider locale non disponibile.', 503);
};

const providerFinalStream = async function* (provider, input) {
  let source;
  if (typeof provider.streamFinal === 'function') source = provider.streamFinal(input);
  else if (typeof provider.synthesizeStream === 'function') source = provider.synthesizeStream(input);
  else if (typeof provider.synthesize === 'function') {
    const result = await provider.synthesize(input);
    if (result) yield { delta: result.text, usage: result.usage || null };
    return;
  } else {
    throw toolError('provider_synthesis_unavailable', 'Il provider locale non supporta la risposta finale.', 503);
  }
  if (source && typeof source.then === 'function') source = await source;
  if (source && typeof source[Symbol.asyncIterator] === 'function') {
    for await (const item of source) yield item;
    return;
  }
  if (source) yield source;
};

const emitProviderText = async ({ provider, input, onEvent, started }) => {
  let output = '';
  let usage = null;
  let firstDeltaAt = null;
  let emittedDelta = false;
  for await (const item of providerFinalStream(provider, input)) {
    if (item?.error) throw item.error;
    if (item?.usage) usage = item.usage;
    const rawDelta = item?.delta != null
      ? String(item.delta)
      : (!emittedDelta && item?.text != null ? String(item.text) : '');
    if (!rawDelta) continue;
    if (firstDeltaAt == null) firstDeltaAt = nowMs();
    emittedDelta = true;
    output += rawDelta;
    await onEvent({ type: 'text', stage: 'delta', delta: rawDelta });
  }
  const finalText = text(output);
  if (!finalText) throw toolError('provider_synthesis_failed', 'Il modello locale non ha prodotto una risposta finale.', 502);
  await onEvent({ type: 'text', stage: 'final', text: finalText });
  return { text: finalText, usage, ttftMs: firstDeltaAt == null ? null : firstDeltaAt - started };
};

class AiRuntime {
  constructor({ db, provider, sessionStore, maxConfirmationMs = 10 * 60 * 1000, onMutation = null, domain = null } = {}) {
    this.db = db;
    this.provider = provider || createProvider();
    this.sessions = sessionStore || new AiSessionStore();
    this.maxConfirmationMs = maxConfirmationMs;
    this.onMutation = onMutation;
    this.domain = domain;
  }

  getSession(id, user) { return this.sessions.get(id, user.id); }
  createSession(user) { return this.sessions.create(user.id); }

  async chat({ session, user, message, operationId, onEvent }) {
    const started = nowMs();
    const input = text(message);
    if (typeof message !== 'string' || !input || input.length > 4000) throw toolError('invalid_message', 'Scrivi una richiesta tra 1 e 4000 caratteri.');
    const clientOperationId = text(operationId) || crypto.randomUUID();
    const reasoningMode = selectReasoningMode(input);
    const existing = session.completed.get(clientOperationId);
    if (existing) {
      await emitText(onEvent, existing.text);
      return { ...existing, replayed: true, metrics: session.lastMetrics };
    }
    if (isCancelIntent(input)) return this.cancel({ session, user, actionId: null, onEvent, originalInput: input });
    if (isConfirmIntent(input) && session.state.pendingConfirmation) {
      const pending = session.state.pendingConfirmation;
      return this.confirm({ session, user, actionId: pending.actionId, operationId: pending.operationId, onEvent, originalInput: input });
    }
    if (session.state.pendingConfirmation) {
      const response = { text: 'C’è una modifica in attesa. Confermala o annullala prima di continuare.' };
      await emitText(onEvent, response.text);
      return response;
    }
    this.sessions.addTurn(session, 'user', input);
    await onEvent({ type: 'status', status: 'routing' });
    const definitions = selectTools(input, user);
    const context = buildContext(session, definitions);
    const response = await collectProviderPlan(this.provider, { message: input, context, definitions, reasoningMode });
    if (!response) throw toolError('local_provider_invalid_response', 'Il provider locale non ha restituito una decisione.', 502);
    const routingMs = nowMs() - started;
    if (response.toolCalls?.length) {
      let finalResult = null;
      const toolResults = [];
      const toolStarted = nowMs();
      for (const [index, call] of response.toolCalls.slice(0, 3).entries()) {
        await onEvent({ type: 'tool', stage: 'start', name: call.name });
        const definition = getTool(call.name);
        if (!definition) throw toolError('unknown_tool', 'Operazione non riconosciuta.', 400);
        if (definition.risk === 'write') {
          assertToolPermission(definition, user);
          validateSchema(definition.schema, call.args || {});
          const pending = {
            actionId: crypto.randomUUID(),
            operationId: clientOperationId,
            dbOperationId: scopedOperationId({ user, session, tool: call.name, operationId: clientOperationId }),
            tool: call.name,
            args: call.args || {},
            originalInput: input.slice(0, 4000),
            reasoningMode,
            summary: pendingSummary(call.name, call.args || {}),
            createdAt: new Date().toISOString(),
            expiresAt: new Date(nowMs() + this.maxConfirmationMs).toISOString(),
          };
          this.sessions.setPending(session, pending);
          await onEvent({ type: 'tool', stage: 'pending', name: call.name });
          await onEvent({ type: 'confirmation', actionId: pending.actionId, operationId: pending.operationId, summary: pending.summary, expiresAt: pending.expiresAt });
          const textResponse = `Per procedere: ${pending.summary} Confermi o annulli?`;
          await emitText(onEvent, textResponse);
          const result = { text: textResponse, confirmation: { actionId: pending.actionId, summary: pending.summary }, metrics: { routingMs, ttftMs: routingMs, toolMs: null, sttLatencyMs: null, ttsFirstAudioMs: null, totalMs: nowMs() - started, provider: this.provider.name, promptChars: context.length, reasoningMode, ...tokenMetrics(response.usage) } };
          session.lastMetrics = result.metrics;
          session.completed.delete(clientOperationId);
          return { ...result, operationId: clientOperationId };
        }
        let executed;
        try {
          executed = executeTool({ db: this.db, name: call.name, args: call.args || {}, user, operationId: null, domain: this.domain });
        } catch (error) {
          rememberToolError(session, error);
          throw error;
        }
        finalResult = { name: executed.definition.name, result: executed.result };
        this.sessions.addToolResult(session, executed.definition.name, executed.result);
        session.state.disambiguationCandidates = [];
        toolResults.push({ toolCallId: call.id || `call_${index + 1}`, name: executed.definition.name, result: boundedToolResult(executed.result) });
        await onEvent({ type: 'tool', stage: 'done', name: executed.definition.name, result: executed.result });
      }
      const finalContext = buildContext(session, definitions);
      const synthesis = await emitProviderText({
        provider: this.provider,
        input: { message: input, context: finalContext, definitions, plan: response, toolResults, reasoningMode },
        onEvent,
        started,
      });
      const textResponse = synthesis.text;
      this.sessions.addTurn(session, 'assistant', textResponse);
      const metrics = { routingMs, ttftMs: synthesis.ttftMs, toolMs: nowMs() - toolStarted, sttLatencyMs: null, ttsFirstAudioMs: null, totalMs: nowMs() - started, provider: this.provider.name, promptChars: finalContext.length, reasoningMode, ...tokenMetrics(synthesis.usage || response.usage) };
      session.lastMetrics = metrics;
      const result = { text: textResponse, result: finalResult.result, metrics };
      this.sessions.setCompleted(session, clientOperationId, result);
      return result;
    }
    const finalContext = buildContext(session, definitions);
    const synthesis = await emitProviderText({
      provider: this.provider,
      input: { message: input, context: finalContext, definitions, plan: response, toolResults: [], reasoningMode },
      onEvent,
      started,
    });
    const textResponse = synthesis.text;
    this.sessions.addTurn(session, 'assistant', textResponse);
    const metrics = { routingMs, ttftMs: synthesis.ttftMs, toolMs: null, sttLatencyMs: null, ttsFirstAudioMs: null, totalMs: nowMs() - started, provider: this.provider.name, promptChars: finalContext.length, reasoningMode, ...tokenMetrics(synthesis.usage || response.usage), ...(synthesis.usage ? { usage: synthesis.usage } : {}) };
    session.lastMetrics = metrics;
    const result = { text: textResponse, metrics };
    this.sessions.setCompleted(session, clientOperationId, result);
    return result;
  }

  async confirm({ session, user, actionId, operationId, onEvent, originalInput = 'Conferma esplicita' }) {
    const pending = session.state.pendingConfirmation;
    if (!pending) {
      const completed = session.completed.get(String(operationId || ''));
      if (completed) { await emitText(onEvent, completed.text); return { ...completed, replayed: true }; }
      throw toolError('no_pending_confirmation', 'Non c’è alcuna modifica da confermare.', 409);
    }
    if (pending.actionId !== String(actionId || '')) throw toolError('confirmation_mismatch', 'La conferma non corrisponde alla modifica in attesa.', 409);
    if (new Date(pending.expiresAt).getTime() < nowMs()) { this.sessions.clearPending(session); throw toolError('confirmation_expired', 'La conferma è scaduta. Ripeti la richiesta.', 409); }
    if (operationId && String(operationId) !== String(pending.operationId)) throw toolError('operation_mismatch', 'Operazione non coerente con la conferma.', 409);
    const started = nowMs();
    await onEvent({ type: 'tool', stage: 'start', name: pending.tool });
    const dbOperationId = pending.dbOperationId || scopedOperationId({ user, session, tool: pending.tool, operationId: pending.operationId });
    let committed;
    try {
      committed = this.db.withTransaction(() => {
        const executed = executeTool({ db: this.db, name: pending.tool, args: pending.args, user, operationId: dbOperationId, domain: this.domain });
        const output = executed.result;
        const auditResult = this.db.writeAiAudit({ sessionId: session.id, operationId: pending.operationId, user, originalInput: pending.originalInput, tool: pending.tool, args: pending.args, result: output, confirmation: 'confirmed', mutation: { executed: true, replayed: Boolean(output?.replayed) }, success: true });
        return { output, auditResult };
      });
    } catch (error) {
      const stableError = error?.code ? error : toolError('mutation_failed', 'Modifica non eseguita.');
      rememberToolError(session, stableError);
      try {
        this.db.writeAiAudit({ sessionId: session.id, operationId: pending.operationId, user, originalInput: pending.originalInput, tool: pending.tool, args: pending.args, result: null, confirmation: 'confirmed', mutation: { executed: false }, success: false, errorCode: stableError.code });
      } catch {
        // L’audit del fallimento è best-effort e non deve alterare l’errore stabile della mutazione.
      }
      throw stableError;
    }
    const output = committed.output;
    const auditResult = committed.auditResult;
    this.sessions.addToolResult(session, pending.tool, output);
    this.sessions.clearPending(session);
    const resultText = formatResult(pending.tool, output);
    this.sessions.addTurn(session, 'user', originalInput);
    this.sessions.addTurn(session, 'assistant', resultText);
    const metrics = { routingMs: null, ttftMs: null, toolMs: nowMs() - started, sttLatencyMs: null, ttsFirstAudioMs: null, totalMs: nowMs() - started, provider: this.provider.name, promptChars: null, reasoningMode: pending.reasoningMode || 'fast', confirmed: true, ...tokenMetrics(null) };
    session.lastMetrics = metrics;
    await onEvent({ type: 'tool', stage: 'done', name: pending.tool, result: output, replayed: Boolean(output?.replayed) });
    if (this.onMutation && !output?.replayed) {
      try { this.onMutation({ tool: pending.tool, result: output, user }); } catch { /* il commit DB resta valido */ }
    }
    await emitText(onEvent, resultText);
    const result = { text: resultText, result: output, metrics, auditId: auditResult?.id || null, replayed: Boolean(output?.replayed) };
    this.sessions.setCompleted(session, pending.operationId, result);
    return result;
  }

  async cancel({ session, user, actionId, onEvent, originalInput = 'Annulla' }) {
    const pending = session.state.pendingConfirmation;
    if (!pending) {
      const message = 'Non c’è alcuna modifica in attesa.';
      await emitText(onEvent, message);
      return { text: message };
    }
    if (actionId && pending.actionId !== String(actionId)) throw toolError('confirmation_mismatch', 'La richiesta di annullamento non corrisponde alla modifica in attesa.', 409);
    this.sessions.clearPending(session);
    this.db.writeAiAudit({ sessionId: session.id, operationId: pending.operationId, user, originalInput: pending.originalInput, tool: pending.tool, args: pending.args, result: null, confirmation: 'cancelled', mutation: { executed: false }, success: false, errorCode: 'cancelled' });
    const message = 'Operazione annullata.';
    this.sessions.addTurn(session, 'user', originalInput);
    this.sessions.addTurn(session, 'assistant', message);
    await onEvent({ type: 'confirmation', state: 'cancelled', actionId: pending.actionId });
    await emitText(onEvent, message);
    return { text: message, cancelled: true };
  }
}

module.exports = {
  AiRuntime,
  AiSessionStore,
  DEFAULT_QWEN_ENDPOINT,
  DEFAULT_QWEN_MODEL,
  MAX_CONTEXT_CHARS,
  MockLlmProvider,
  QwenLocalProvider,
  SYSTEM_PROMPT,
  buildContext,
  buildStaticPrefix,
  createProvider,
  selectReasoningMode,
  selectTools,
};
