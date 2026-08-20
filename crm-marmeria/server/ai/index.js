const crypto = require('crypto');
const express = require('express');
const { AiRuntime, createProvider, selectTools } = require('./runtime');
const { getToolCatalog } = require('./tools');

const operationIdFrom = (req, fallback = null) => {
  const value = req.get('X-Operation-Id') || req.body?.operationId || fallback;
  return text(value) || crypto.randomUUID();
};
const text = (value) => String(value ?? '').trim();

const publicError = (error) => {
  const status = Number(error?.status) || 500;
  const code = text(error?.code) || (status === 403 ? 'permission_denied' : status === 404 ? 'not_found' : 'ai_error');
  const message = status >= 500 && !error?.code
    ? 'Errore interno dell’assistente locale.'
    : text(error?.message) || 'Richiesta non eseguita.';
  const result = { ok: false, error: code, message };
  if (error?.details && typeof error.details === 'object') result.details = error.details;
  return { status, body: result };
};

const createAiRouter = ({ db, authenticateToken, provider, providerMode, qwen, realtime, domain } = {}) => {
  const router = express.Router();
  const runtime = new AiRuntime({
    db,
    provider: provider || createProvider({ providerMode, qwen }),
    domain,
    onMutation: ({ tool, result, user }) => {
      if (!realtime || !result) return;
      const events = {
        register_payment: [{ event: 'payments.created', permission: 'payments.view', item: result.payment }, { event: 'invoices.updated', permission: 'invoices.view', item: result.invoice }],
        mark_invoice_paid: [{ event: 'payments.created', permission: 'payments.view', item: result.payment }, { event: 'invoices.updated', permission: 'invoices.view', item: result.invoice }],
        create_appointment: [{ event: 'appointments.created', permission: 'calendar.view', item: result.appointment }],
        create_quote_draft: [{ event: 'quotes.created', permission: 'quotes.view', item: result.quote }],
      }[tool] || [];
      events.forEach((entry) => realtime.broadcast({ event: entry.event, entityType: entry.item?.entityType || entry.event.split('.')[0].replace(/s$/, ''), item: entry.item, actor: { id: String(user.id), username: user.username } }, entry.permission));
    },
  });

  router.post('/sessions', authenticateToken, (req, res) => {
    const session = runtime.createSession(req.user);
    return res.status(201).json({ ok: true, sessionId: session.id, state: runtime.sessions.publicState(session) });
  });

  router.get('/sessions/:id', authenticateToken, (req, res) => {
    try {
      const session = runtime.getSession(req.params.id, req.user);
      return res.json({ ok: true, state: runtime.sessions.publicState(session) });
    } catch (error) {
      const result = publicError(error);
      return res.status(result.status).json(result.body);
    }
  });

  router.get('/tools/metadata', authenticateToken, (req, res) => {
    const definitions = selectTools(String(req.query.q || ''), req.user);
    return res.json({ ok: true, tools: definitions.map((definition) => ({ name: definition.name, domain: definition.domain, description: definition.description, risk: definition.risk, schema: definition.schema })) });
  });

  router.get('/benchmark/session', authenticateToken, (req, res) => {
    try {
      const session = runtime.getSession(req.query.sessionId, req.user);
      return res.json({ ok: true, metrics: session.lastMetrics });
    } catch (error) {
      const result = publicError(error);
      return res.status(result.status).json(result.body);
    }
  });

  router.post('/chat', authenticateToken, async (req, res) => {
    const write = (event) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    res.status(200);
    res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    write({ type: 'status', status: 'received' });
    try {
      const session = runtime.getSession(req.body?.sessionId, req.user);
      const operationId = operationIdFrom(req);
      const result = await runtime.chat({ session, user: req.user, message: req.body?.message, operationId, onEvent: write });
      write({ type: 'done', ok: true, operationId, result: { text: result.text, confirmation: result.confirmation || null }, metrics: result.metrics || session.lastMetrics || null, replayed: Boolean(result.replayed) });
    } catch (error) {
      const result = publicError(error);
      write({ type: 'error', ...result.body });
      write({ type: 'done', ok: false });
    }
    return res.end();
  });

  router.post('/confirm', authenticateToken, async (req, res) => {
    try {
      const session = runtime.getSession(req.body?.sessionId, req.user);
      const operationId = text(req.body?.operationId) || session.state.pendingConfirmation?.operationId || crypto.randomUUID();
      const result = await runtime.confirm({ session, user: req.user, actionId: req.body?.actionId, operationId, originalInput: 'Conferma esplicita', onEvent: async () => {} });
      return res.json({ ok: true, operationId, text: result.text, result: result.result || null, metrics: result.metrics || null, replayed: Boolean(result.replayed) });
    } catch (error) {
      const result = publicError(error);
      return res.status(result.status).json(result.body);
    }
  });

  router.post('/cancel', authenticateToken, async (req, res) => {
    try {
      const session = runtime.getSession(req.body?.sessionId, req.user);
      const result = await runtime.cancel({ session, user: req.user, actionId: req.body?.actionId || null, originalInput: 'Annulla', onEvent: async () => {} });
      return res.json({ ok: true, text: result.text, cancelled: true });
    } catch (error) {
      const result = publicError(error);
      return res.status(result.status).json(result.body);
    }
  });

  return router;
};

module.exports = { createAiRouter, publicError };
