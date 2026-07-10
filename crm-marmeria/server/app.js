const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const WebSocket = require('ws');
const { CrmDatabase, ENTITY_TYPES } = require('./database');
const {
  authenticateToken,
  requirePermission,
  requireRole,
  generateToken,
  hashPassword,
  verifyPassword,
  findUserByCredentials,
  readUsers,
  writeUsers,
  configureAuth,
  verifyToken,
} = require('./middleware/auth');

const ROUTES = {
  clients: { type: 'client', permission: 'clients' },
  orders: { type: 'order', permission: 'orders' },
  projects: { type: 'project', permission: 'projects' },
  materials: { type: 'material', permission: 'materials' },
  quotes: { type: 'quote', permission: 'quotes' },
  invoices: { type: 'invoice', permission: 'invoices' },
};

const WORKER_FIELDS = {
  project: ['status', 'phase', 'productionNotes', 'notes', 'measurements', 'completedAt', 'startedAt', 'assignedTo', 'progress'],
  order: ['status', 'phase', 'productionNotes', 'notes', 'measurements', 'completedAt', 'startedAt', 'assignedTo', 'progress'],
  material: ['stockQuantity', 'quantity', 'stock', 'notes'],
};

const publicUser = (user) => ({
  id: String(user.id), username: user.username, email: user.email,
  firstName: user.firstName, lastName: user.lastName, role: user.role,
  permissions: user.permissions || [], isActive: user.isActive,
});

const normalize = (type, raw = {}) => {
  const data = { ...raw };
  for (const key of ['id', 'clientId', 'customerId', 'projectId', 'quoteId', 'materialId']) {
    if (data[key] != null && data[key] !== '') data[key] = String(data[key]);
  }
  if (Array.isArray(data.items)) {
    data.items = data.items.map((item) => ({
      ...item,
      materialId: item.materialId == null || item.materialId === '' ? item.materialId : String(item.materialId),
      quantity: Number(item.quantity || 0), unitPrice: Number(item.unitPrice || 0), taxRate: Number(item.taxRate || 0),
    }));
  }
  if (type === 'material') {
    const unitPrice = Number(data.unitPrice ?? data.price ?? 0) || 0;
    const stockQuantity = Number(data.stockQuantity ?? data.quantity ?? data.stock ?? 0) || 0;
    const minStockLevel = Number(data.minStockLevel ?? data.minQuantity ?? 10) || 0;
    Object.assign(data, { unitPrice, price: unitPrice, stockQuantity, quantity: stockQuantity, stock: stockQuantity, minStockLevel, minQuantity: minStockLevel });
  }
  if (['order', 'project', 'quote', 'invoice'].includes(type)) {
    data.type = type;
    data.title = data.title || data.name || '';
    data.name = data.name || data.title || '';
    data.deadline = data.deadline || data.endDate || data.estimatedDelivery || '';
    data.endDate = data.endDate || data.deadline || '';
    const amount = data.amount ?? data.total;
    if (amount != null && amount !== '') data.amount = Number(amount) || 0;
  }
  return data;
};

const sanitizePatch = (user, type, input = {}) => {
  const patch = { ...input };
  for (const key of ['id', 'type', 'createdAt', 'updatedAt', 'version', 'operationId', 'expectedVersion']) delete patch[key];
  if (user.role === 'admin' || user.role === 'manager') return normalize(type, patch);
  const allowed = WORKER_FIELDS[type] || [];
  return normalize(type, Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key))));
};

const operationIdFrom = (req) => req.get('X-Operation-Id') || req.body?.operationId || null;
const expectedVersionFrom = (req) => {
  const raw = req.get('If-Match') || req.body?.expectedVersion || req.body?.version;
  return raw == null || raw === '' ? null : Number(String(raw).replace(/"/g, ''));
};

const createRealtime = (server) => {
  const wss = new WebSocket.Server({ server, path: '/ws' });
  wss.on('connection', (socket, request) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const user = verifyToken(url.searchParams.get('token'));
      if (!user) return socket.close(4001, 'Token non valido');
      socket.user = user;
      socket.send(JSON.stringify({ event: 'connected', timestamp: new Date().toISOString() }));
      socket.on('message', (message) => { if (message.toString() === 'ping') socket.send('pong'); });
    } catch { socket.close(4001, 'Autenticazione richiesta'); }
  });
  const broadcast = (payload) => {
    const message = JSON.stringify({ ...payload, timestamp: new Date().toISOString() });
    for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(message);
  };
  return { wss, broadcast };
};

async function createCrmServer(options = {}) {
  const port = Number(options.port || process.env.PORT || 3001);
  const host = options.host || '0.0.0.0';
  const dataDir = options.dataDir || path.join(__dirname, 'data');
  const backupDir = options.backupDir || path.join(dataDir, 'backups');
  const attachmentsDir = options.attachmentsDir || path.join(dataDir, 'attachments');
  configureAuth({ dataDir });
  const db = new CrmDatabase({ dataDir, backupDir, attachmentsDir });
  db.migrateLegacy(dataDir);

  const app = express();
  app.use(cors({ origin: '*', methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'If-Match', 'X-Operation-Id'] }));
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));
  const server = http.createServer(app);
  const realtime = createRealtime(server);
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, callback) => {
        try {
          const destination = db.attachmentDirectory(req.params.type, req.params.id);
          fs.mkdirSync(destination, { recursive: true });
          callback(null, destination);
        } catch (error) { callback(error); }
      },
      filename: (req, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname)}`),
    }),
    limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  });
  const respondError = (res, error) => {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message || 'Errore interno del server', current: error.current || undefined });
  };

  app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '2.0.0', mode: 'central-server', hostname: options.serverName || 'crm-marmeria', serverId: options.serverId || null, port, timestamp: new Date().toISOString(), websocket: true }));
  app.head('/api/health', (req, res) => res.sendStatus(200));

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'Username e password richiesti' });
      const user = findUserByCredentials(username);
      if (!user || !(await verifyPassword(password, user.password))) return res.status(401).json({ error: 'Credenziali non valide' });
      res.json({ token: generateToken(user), user: publicUser(user) });
    } catch (error) { respondError(res, error); }
  });
  app.post('/api/auth/logout', authenticateToken, (req, res) => res.json({ message: 'Logout effettuato' }));
  app.get('/api/auth/me', authenticateToken, (req, res) => res.json({ user: publicUser(req.user) }));
  app.put('/api/auth/profile', authenticateToken, (req, res) => {
    try {
      const users = readUsers();
      const index = users.findIndex((user) => String(user.id) === String(req.user.id));
      if (index < 0) return res.status(404).json({ error: 'Utente non trovato' });
      const allowed = ['username', 'email', 'firstName', 'lastName'];
      const updates = Object.fromEntries(allowed.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));
      if (users.some((user, i) => i !== index && ((updates.username && user.username === updates.username) || (updates.email && user.email === updates.email)))) return res.status(400).json({ error: 'Username o email già utilizzati' });
      users[index] = { ...users[index], ...updates, updatedAt: new Date().toISOString() };
      if (!writeUsers(users)) throw new Error('Salvataggio profilo fallito');
      res.json({ user: publicUser(users[index]) });
    } catch (error) { respondError(res, error); }
  });

  app.get('/api/users', authenticateToken, requireRole('admin'), (req, res) => res.json(readUsers().map(publicUser)));
  app.post('/api/users', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
      const { username, email, password, firstName, lastName, role, permissions } = req.body;
      if (!username || !email || !password || !firstName || !lastName || !role) return res.status(400).json({ error: 'Tutti i campi sono richiesti' });
      const users = readUsers();
      if (users.some((user) => user.username === username || user.email === email)) return res.status(400).json({ error: 'Username o email già esistenti' });
      const user = { id: crypto.randomUUID(), username, email, password: await hashPassword(password), firstName, lastName, role, permissions: Array.isArray(permissions) ? permissions : [], isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      users.push(user);
      if (!writeUsers(users)) throw new Error('Salvataggio utente fallito');
      res.status(201).json(publicUser(user));
    } catch (error) { respondError(res, error); }
  });
  app.put('/api/users/:id', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
      const users = readUsers();
      const index = users.findIndex((user) => String(user.id) === String(req.params.id));
      if (index < 0) return res.status(404).json({ error: 'Utente non trovato' });
      users[index] = { ...users[index], ...req.body, id: users[index].id, password: req.body.password ? await hashPassword(req.body.password) : users[index].password, updatedAt: new Date().toISOString() };
      if (!writeUsers(users)) throw new Error('Salvataggio utente fallito');
      res.json(publicUser(users[index]));
    } catch (error) { respondError(res, error); }
  });

  app.get('/api/clients/search', authenticateToken, requirePermission('clients.view'), (req, res) => {
    const query = String(req.query.q || '').toLowerCase();
    res.json(db.list('client').filter((item) => [item.name, item.email, item.phone].some((value) => String(value || '').toLowerCase().includes(query))));
  });
  app.get('/api/clients/stats', authenticateToken, requirePermission('clients.view'), (req, res) => {
    const items = db.list('client');
    const byType = items.reduce((result, item) => ({ ...result, [item.type || 'standard']: (result[item.type || 'standard'] || 0) + 1 }), {});
    res.json({ total: items.length, byType, recentlyAdded: items.filter((item) => new Date(item.createdAt).getTime() > Date.now() - 604800000).length });
  });
  app.get('/api/materials/search', authenticateToken, requirePermission('materials.view'), (req, res) => {
    const query = String(req.query.q || '').toLowerCase();
    res.json(db.list('material').filter((item) => [item.name, item.category, item.supplier].some((value) => String(value || '').toLowerCase().includes(query))));
  });
  app.get('/api/materials/stats', authenticateToken, requirePermission('materials.view'), (req, res) => {
    const items = db.list('material');
    const low = items.filter((item) => Number(item.stockQuantity || 0) < Number(item.minStockLevel || 0));
    const byCategory = items.reduce((result, item) => ({ ...result, [item.category || 'Altro']: (result[item.category || 'Altro'] || 0) + 1 }), {});
    res.json({ total: items.length, byCategory, lowStock: low.length, lowStockItems: low.length, totalValue: items.reduce((sum, item) => sum + Number(item.stockQuantity || 0) * Number(item.unitPrice || 0), 0) });
  });
  app.get('/api/materials/categories', authenticateToken, requirePermission('materials.view'), (req, res) => res.json([...new Set(db.list('material').map((item) => item.category || 'Altro'))]));
  app.get('/api/materials/suppliers', authenticateToken, requirePermission('materials.view'), (req, res) => res.json([...new Set(db.list('material').map((item) => item.supplier || 'Non specificato'))]));
  app.get('/api/orders/search', authenticateToken, requirePermission('orders.view'), (req, res) => {
    const query = String(req.query.q || '').toLowerCase();
    res.json(db.list('order').filter((item) => [item.title, item.name, item.clientName].some((value) => String(value || '').toLowerCase().includes(query))));
  });
  app.get('/api/orders/by-status/:status', authenticateToken, requirePermission('orders.view'), (req, res) => res.json(db.list('order').filter((item) => item.status === req.params.status)));
  app.patch('/api/orders/:id/status', authenticateToken, requirePermission('orders.edit'), (req, res) => {
    try {
      const result = db.update('order', req.params.id, sanitizePatch(req.user, 'order', { status: req.body.status }), expectedVersionFrom(req), req.user, operationIdFrom(req));
      realtime.broadcast({ event: 'orders.updated', entityType: 'order', item: result.item, user: publicUser(req.user) });
      res.json(result.item);
    } catch (error) { respondError(res, error); }
  });

  for (const [route, config] of Object.entries(ROUTES)) {
    const base = `/api/${route}`;
    app.get(base, authenticateToken, requirePermission(`${config.permission}.view`), (req, res) => res.json(db.list(config.type)));
    app.get(`${base}/:id`, authenticateToken, requirePermission(`${config.permission}.view`), (req, res) => {
      const item = db.get(config.type, req.params.id);
      item ? res.json(item) : res.status(404).json({ error: 'Elemento non trovato' });
    });
    app.post(base, authenticateToken, requirePermission(`${config.permission}.create`), (req, res) => {
      try {
        const payload = req.user.role === 'worker' ? sanitizePatch(req.user, config.type, req.body) : normalize(config.type, req.body);
        if (req.user.role === 'worker' && Object.keys(payload).length === 0) return res.status(403).json({ error: 'Nessun campo modificabile per questo ruolo' });
        const result = db.create(config.type, payload, req.user, operationIdFrom(req));
        realtime.broadcast({ event: `${route}.created`, entityType: config.type, item: result.item, user: publicUser(req.user) });
        res.status(result.replayed ? 200 : 201).json(result.item);
      } catch (error) { respondError(res, error); }
    });
    const update = (req, res) => {
      try {
        const patch = sanitizePatch(req.user, config.type, req.body);
        if (req.user.role === 'worker' && Object.keys(patch).length === 0) return res.status(403).json({ error: 'Nessun campo modificabile per questo ruolo' });
        const result = db.update(config.type, req.params.id, patch, expectedVersionFrom(req), req.user, operationIdFrom(req));
        realtime.broadcast({ event: `${route}.updated`, entityType: config.type, item: result.item, user: publicUser(req.user) });
        res.json(result.item);
      } catch (error) { respondError(res, error); }
    };
    app.put(`${base}/:id`, authenticateToken, requirePermission(`${config.permission}.edit`), update);
    app.patch(`${base}/:id`, authenticateToken, requirePermission(`${config.permission}.edit`), update);
    app.delete(`${base}/:id`, authenticateToken, requirePermission(`${config.permission}.delete`), (req, res) => {
      try {
        const result = db.delete(config.type, req.params.id, expectedVersionFrom(req), req.user, operationIdFrom(req));
        realtime.broadcast({ event: `${route}.deleted`, entityType: config.type, id: result.id, user: publicUser(req.user) });
        res.json(result);
      } catch (error) { respondError(res, error); }
    });
  }

  app.get('/api/analytics/dashboard', authenticateToken, requirePermission('dashboard.view'), (req, res) => {
    const projects = db.list('project'), invoices = db.list('invoice'), materials = db.list('material'), clients = db.list('client');
    res.json({ totalProjects: projects.length, totalClients: clients.length, totalRevenue: invoices.reduce((sum, item) => sum + Number(item.total || item.amount || 0), 0), pendingOrders: projects.filter((item) => item.status === 'In Attesa').length, inProgressOrders: projects.filter((item) => ['In Corso', 'In Lavorazione'].includes(item.status)).length, completedOrders: projects.filter((item) => item.status === 'Completato').length, lowStockMaterials: materials.filter((item) => Number(item.stockQuantity || 0) < Number(item.minStockLevel || 0)).length, recentClients: clients.filter((item) => new Date(item.createdAt).getTime() > Date.now() - 604800000).length });
  });
  app.get('/api/analytics/daily/:date?', authenticateToken, requirePermission('dashboard.view'), (req, res) => {
    const date = req.params.date || new Date().toISOString().slice(0, 10);
    const items = [...db.list('project'), ...db.list('order')].filter((item) => String(item.createdAt || '').slice(0, 10) === date);
    res.json({ date, totalOrders: items.length, totalRevenue: items.reduce((sum, item) => sum + Number(item.amount || item.total || 0), 0), newClients: db.list('client').filter((item) => String(item.createdAt || '').slice(0, 10) === date).length, pendingOrders: items.filter((item) => ['pending', 'In Attesa'].includes(item.status)).length, completedOrders: items.filter((item) => ['completed', 'Completato'].includes(item.status)).length });
  });
  app.get('/api/analytics/trends', authenticateToken, requirePermission('dashboard.view'), (req, res) => {
    const metric = String(req.query.metric || 'orders');
    const start = new Date(String(req.query.startDate || new Date(Date.now() - 30 * 86400000).toISOString()));
    const end = new Date(String(req.query.endDate || new Date().toISOString()));
    const orders = [...db.list('order'), ...db.list('project')], clients = db.list('client'), invoices = db.list('invoice'), data = [];
    for (const current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
      const date = current.toISOString().slice(0, 10);
      const value = metric === 'clients' ? clients.filter((item) => String(item.createdAt || '').slice(0, 10) === date).length : metric === 'revenue' ? invoices.filter((item) => String(item.createdAt || '').slice(0, 10) === date).reduce((sum, item) => sum + Number(item.total || item.amount || 0), 0) : orders.filter((item) => String(item.createdAt || '').slice(0, 10) === date).length;
      data.push({ date, value, label: date });
    }
    res.json(data);
  });

  app.get('/api/audit', authenticateToken, requirePermission('settings.view'), (req, res) => res.json(db.listAudit({ type: req.query.type, id: req.query.id, limit: req.query.limit })));
  app.get('/api/audit/:type/:id', authenticateToken, (req, res) => res.json(db.listAudit({ type: req.params.type, id: req.params.id, limit: req.query.limit })));

  app.get('/api/attachments/:type/:id', authenticateToken, (req, res) => { try { res.json(db.listAttachments(req.params.type, req.params.id)); } catch (error) { respondError(res, error); } });
  app.post('/api/attachments/:type/:id', authenticateToken, upload.array('files', 10), (req, res) => {
    try {
      if (!db.get(req.params.type, req.params.id)) return res.status(404).json({ error: 'Elemento non trovato' });
      const items = (req.files || []).map((file) => db.addAttachment({ entityType: req.params.type, entityId: req.params.id, originalName: file.originalname, storedName: file.filename, mimeType: file.mimetype, sizeBytes: file.size, user: req.user }));
      realtime.broadcast({ event: 'attachments.changed', entityType: req.params.type, id: String(req.params.id) });
      res.status(201).json(items);
    } catch (error) { respondError(res, error); }
  });
  app.get('/api/attachments/file/:id', authenticateToken, (req, res) => {
    const attachment = db.getAttachment(req.params.id);
    if (!attachment || !fs.existsSync(attachment.absolutePath)) return res.status(404).json({ error: 'Allegato non trovato' });
    res.download(attachment.absolutePath, attachment.originalName);
  });
  app.delete('/api/attachments/file/:id', authenticateToken, (req, res) => {
    const deleted = db.deleteAttachment(req.params.id, req.user);
    if (!deleted) return res.status(404).json({ error: 'Allegato non trovato' });
    realtime.broadcast({ event: 'attachments.changed', entityType: deleted.entityType, id: deleted.entityId });
    res.json({ deleted: true });
  });

  app.get('/api/backup/export', authenticateToken, requirePermission('settings.view'), (req, res) => res.json(db.exportJson()));
  app.post('/api/backup/import', authenticateToken, requirePermission('settings.edit'), (req, res) => {
    try { db.restoreJson(req.body, req.user); realtime.broadcast({ event: 'database.restored' }); res.json({ message: 'Backup importato' }); } catch (error) { respondError(res, error); }
  });
  app.get('/api/backup', authenticateToken, requirePermission('settings.view'), (req, res) => res.json(db.exportJson()));
  app.post('/api/backup/restore', authenticateToken, requirePermission('settings.edit'), (req, res) => {
    try {
      const backup = req.body?.data && !req.body.data.client && req.body.data.clients ? { ...req.body, data: { client: req.body.data.clients, order: req.body.data.orders?.filter((item) => item.type === 'order') || [], project: req.body.data.orders?.filter((item) => item.type === 'project') || [], quote: req.body.data.orders?.filter((item) => item.type === 'quote') || [], invoice: req.body.data.orders?.filter((item) => item.type === 'invoice') || [], material: req.body.data.materials || [] } } : req.body;
      db.restoreJson(backup, req.user); realtime.broadcast({ event: 'database.restored' }); res.json({ message: 'Backup ripristinato' });
    } catch (error) { respondError(res, error); }
  });
  app.post('/api/backup/clear', authenticateToken, requirePermission('settings.edit'), (req, res) => {
    try { db.restoreJson({ data: Object.fromEntries(ENTITY_TYPES.map((type) => [type, []])) }, req.user); realtime.broadcast({ event: 'database.restored' }); res.json({ message: 'Dati cancellati' }); } catch (error) { respondError(res, error); }
  });
  app.get('/api/backups', authenticateToken, requirePermission('settings.view'), (req, res) => res.json(db.listSnapshots()));
  app.post('/api/backups', authenticateToken, requirePermission('settings.edit'), async (req, res) => { try { res.status(201).json(await db.createSnapshot(req.body?.label || 'manuale')); } catch (error) { respondError(res, error); } });
  app.post('/api/backups/:name/restore', authenticateToken, requirePermission('settings.edit'), (req, res) => { try { const snapshot = db.restoreSnapshot(req.params.name); realtime.broadcast({ event: 'database.restored', snapshot }); res.json(snapshot); } catch (error) { respondError(res, error); } });

  app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) return res.status(400).json({ error: error.message });
    if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: 'JSON non valido' });
    respondError(res, error);
  });
  app.use('*', (req, res) => res.status(404).json({ error: 'Endpoint non trovato' }));

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const ensureDailyBackup = async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (!db.listSnapshots().some((item) => item.createdAt.startsWith(today) && item.label === 'automatico')) await db.createSnapshot('automatico');
    } catch (error) { console.error('Backup automatico fallito:', error); }
  };
  await ensureDailyBackup();
  const backupTimer = setInterval(ensureDailyBackup, 60 * 60 * 1000);

  return { app, server, db, port, host, close: async () => { clearInterval(backupTimer); for (const client of realtime.wss.clients) client.close(); await new Promise((resolve) => server.close(resolve)); db.close(); } };
}

module.exports = { createCrmServer };
