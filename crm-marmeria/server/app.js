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
  mutateUsers,
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
  project: [
    'status', 'phase', 'productionNotes', 'notes', 'measurements',
    'completedAt', 'startedAt', 'assignedTo', 'progress',
  ],
  order: [
    'status', 'phase', 'productionNotes', 'notes', 'measurements',
    'completedAt', 'startedAt', 'assignedTo', 'progress',
  ],
  material: ['stockQuantity', 'quantity', 'stock', 'notes'],
};

const publicUser = (user) => ({
  id: String(user.id),
  username: user.username,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  role: user.role,
  permissions: user.permissions || [],
  isActive: user.isActive,
});

const publicActor = (user) => ({
  id: String(user.id),
  username: user.username,
});

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const hasAny = (object, keys) => keys.some((key) => hasOwn(object, key));

const normalize = (type, raw = {}, { defaults = false } = {}) => {
  const data = { ...raw };

  for (const key of ['id', 'clientId', 'customerId', 'projectId', 'quoteId', 'materialId']) {
    if (data[key] != null && data[key] !== '') data[key] = String(data[key]);
  }

  if (Array.isArray(data.items)) {
    data.items = data.items.map((item) => ({
      ...item,
      materialId: item.materialId == null || item.materialId === ''
        ? item.materialId
        : String(item.materialId),
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.unitPrice || 0),
      taxRate: Number(item.taxRate || 0),
    }));
  }

  if (type === 'client') {
    if (defaults || hasAny(data, ['type', 'clientType'])) {
      const clientType = data.clientType
        || (['Azienda', 'Privato'].includes(data.type) ? data.type : 'Privato');
      data.type = clientType;
      data.clientType = clientType;
    }
    data.entityType = 'client';
  }

  if (type === 'material') {
    data.type = 'material';
    data.entityType = 'material';

    if (defaults || hasAny(data, ['unitPrice', 'price'])) {
      const unitPrice = Number(data.unitPrice ?? data.price ?? 0) || 0;
      data.unitPrice = unitPrice;
      data.price = unitPrice;
    }
    if (defaults || hasAny(data, ['stockQuantity', 'quantity', 'stock'])) {
      const stockQuantity = Number(
        data.stockQuantity ?? data.quantity ?? data.stock ?? 0,
      ) || 0;
      data.stockQuantity = stockQuantity;
      data.quantity = stockQuantity;
      data.stock = stockQuantity;
    }
    if (defaults || hasAny(data, ['minStockLevel', 'minQuantity'])) {
      const minStockLevel = Number(
        data.minStockLevel ?? data.minQuantity ?? 10,
      ) || 0;
      data.minStockLevel = minStockLevel;
      data.minQuantity = minStockLevel;
    }
  }

  if (['order', 'project', 'quote', 'invoice'].includes(type)) {
    data.type = type;
    data.entityType = type;

    if (defaults || hasAny(data, ['title', 'name'])) {
      const title = data.title ?? data.name ?? '';
      const name = data.name ?? data.title ?? '';
      data.title = title;
      data.name = name;
    }
    if (defaults || hasAny(data, ['deadline', 'endDate', 'estimatedDelivery'])) {
      const deadline = data.deadline ?? data.endDate ?? data.estimatedDelivery ?? '';
      data.deadline = deadline;
      data.endDate = data.endDate ?? deadline;
    }
    if (hasAny(data, ['amount', 'total'])) {
      data.amount = Number(data.amount ?? data.total) || 0;
    }
  }

  return data;
};

const sanitizePatch = (user, type, input = {}) => {
  const patch = { ...input };
  for (const key of [
    'id', 'type', 'entityType', 'createdAt', 'updatedAt',
    'version', 'operationId', 'expectedVersion',
  ]) {
    delete patch[key];
  }

  const entries = user.role === 'admin' || user.role === 'manager'
    ? Object.entries(patch)
    : Object.entries(patch).filter(([key]) => (WORKER_FIELDS[type] || []).includes(key));

  if (!entries.length) return null;
  return normalize(type, Object.fromEntries(entries));
};

const expectedVersionFrom = (req) => {
  const raw = req.get('If-Match') || req.body?.expectedVersion || req.body?.version;
  if (raw == null || raw === '') return null;
  const parsed = Number(String(raw).replace(/"/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const operationIdFrom = (req, scope) => {
  const operationId = req.get('X-Operation-Id') || req.body?.operationId || null;
  return operationId ? `${scope}:${operationId}` : null;
};

const routeForType = (type) => Object.entries(ROUTES)
  .find(([, config]) => config.type === type);

const permissionForType = (type, action = 'view') => {
  const entry = routeForType(type);
  return entry ? `${entry[1].permission}.${action}` : null;
};

const hasEntityPermission = (user, type, action) => {
  const permission = permissionForType(type, action);
  return Boolean(permission && user?.permissions?.includes(permission));
};

const createRealtime = (server) => {
  const wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (socket, request) => {
    try {
      const token = new URL(request.url, 'http://localhost').searchParams.get('token');
      const user = verifyToken(token);
      if (!user) return socket.close(4001, 'Token non valido');
      socket.authToken = token;
      socket.send(JSON.stringify({
        event: 'connected',
        timestamp: new Date().toISOString(),
      }));
      socket.on('message', (message) => {
        if (message.toString() === 'ping') socket.send('pong');
      });
    } catch {
      socket.close(4001, 'Autenticazione richiesta');
    }
    return undefined;
  });

  const broadcast = (payload, requiredPermission = null) => {
    const message = JSON.stringify({
      ...payload,
      timestamp: new Date().toISOString(),
    });

    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      const user = verifyToken(client.authToken);
      if (!user) {
        client.close(4001, 'Sessione scaduta');
        continue;
      }
      if (requiredPermission && !user.permissions?.includes(requiredPermission)) continue;
      client.send(message);
    }
  };

  return { wss, broadcast };
};

async function createCrmServer(options = {}) {
  const requestedPort = Number(options.port ?? process.env.PORT ?? 3001);
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    throw new Error('Porta server non valida');
  }

  const host = options.host || '0.0.0.0';
  const dataDir = options.dataDir || path.join(__dirname, 'data');
  const backupDir = options.backupDir || path.join(dataDir, 'backups');
  const attachmentsDir = options.attachmentsDir || path.join(dataDir, 'attachments');

  configureAuth({ dataDir });
  const db = new CrmDatabase({ dataDir, backupDir, attachmentsDir });
  db.migrateLegacy(dataDir);

  const app = express();
  app.disable('x-powered-by');
  app.use(cors({
    origin: '*',
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'If-Match', 'X-Operation-Id'],
  }));
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
        } catch (error) {
          callback(error);
        }
      },
      filename: (req, file, callback) => callback(
        null,
        `${crypto.randomUUID()}${path.extname(file.originalname).slice(0, 20)}`,
      ),
    }),
    limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  });

  const removeUploadedFiles = (files = []) => {
    for (const file of files) {
      if (file.path && fs.existsSync(file.path)) fs.rmSync(file.path, { force: true });
    }
  };

  const respondError = (res, error) => {
    console.error(error);
    res.status(error.status || 500).json({
      error: error.message || 'Errore interno del server',
      current: error.current || undefined,
    });
  };

  app.get('/api/health', (req, res) => res.json({
    status: 'ok',
    version: '2.1.0',
    mode: 'central-server',
    hostname: options.serverName || 'crm-marmeria',
    serverId: options.serverId || null,
    port: server.address()?.port || requestedPort,
    timestamp: new Date().toISOString(),
    websocket: true,
  }));
  app.head('/api/health', (req, res) => res.sendStatus(200));

  app.post('/api/auth/login', async (req, res) => {
    try {
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '');
      if (!username || !password) {
        return res.status(400).json({ error: 'Username e password richiesti' });
      }
      const user = findUserByCredentials(username);
      if (!user || !(await verifyPassword(password, user.password))) {
        return res.status(401).json({ error: 'Credenziali non valide' });
      }
      return res.json({ token: generateToken(user), user: publicUser(user) });
    } catch (error) {
      return respondError(res, error);
    }
  });

  app.post('/api/auth/logout', authenticateToken, (req, res) => {
    res.json({ message: 'Logout effettuato' });
  });

  app.get('/api/auth/me', authenticateToken, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  app.put('/api/auth/profile', authenticateToken, async (req, res) => {
    try {
      const allowed = ['username', 'email', 'firstName', 'lastName'];
      const updates = Object.fromEntries(
        allowed
          .filter((key) => req.body[key] !== undefined)
          .map((key) => [key, String(req.body[key]).trim()]),
      );
      const updatedUser = await mutateUsers(async (users) => {
        const index = users.findIndex((user) => String(user.id) === String(req.user.id));
        if (index < 0) {
          const error = new Error('Utente non trovato');
          error.status = 404;
          throw error;
        }
        if (users.some((user, userIndex) => (
          userIndex !== index
          && ((updates.username && user.username === updates.username)
            || (updates.email && user.email === updates.email))
        ))) {
          const error = new Error('Username o email già utilizzati');
          error.status = 400;
          throw error;
        }
        users[index] = {
          ...users[index],
          ...updates,
          updatedAt: new Date().toISOString(),
        };
        return { value: users[index] };
      });
      res.json({ user: publicUser(updatedUser) });
    } catch (error) {
      respondError(res, error);
    }
  });

  app.get('/api/users', authenticateToken, requireRole('admin'), (req, res) => {
    res.json(readUsers().map(publicUser));
  });

  app.post('/api/users', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
      const {
        username,
        email,
        password,
        firstName,
        lastName,
        role,
        permissions,
      } = req.body;
      if (!username || !email || !password || !firstName || !lastName || !role) {
        return res.status(400).json({ error: 'Tutti i campi sono richiesti' });
      }
      const passwordHash = await hashPassword(String(password));
      const createdUser = await mutateUsers(async (users) => {
        if (users.some((user) => user.username === username || user.email === email)) {
          const error = new Error('Username o email già esistenti');
          error.status = 400;
          throw error;
        }
        const user = {
          id: crypto.randomUUID(),
          username: String(username).trim(),
          email: String(email).trim(),
          password: passwordHash,
          firstName: String(firstName).trim(),
          lastName: String(lastName).trim(),
          role: String(role),
          permissions: Array.isArray(permissions) ? permissions.map(String) : [],
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        users.push(user);
        return { value: user };
      });
      return res.status(201).json(publicUser(createdUser));
    } catch (error) {
      return respondError(res, error);
    }
  });

  app.put('/api/users/:id', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
      const passwordHash = req.body.password
        ? await hashPassword(String(req.body.password))
        : null;
      const allowed = [
        'username', 'email', 'firstName', 'lastName',
        'role', 'permissions', 'isActive',
      ];
      const updatedUser = await mutateUsers(async (users) => {
        const index = users.findIndex((user) => String(user.id) === String(req.params.id));
        if (index < 0) {
          const error = new Error('Utente non trovato');
          error.status = 404;
          throw error;
        }
        const updates = Object.fromEntries(
          allowed
            .filter((key) => req.body[key] !== undefined)
            .map((key) => [key, req.body[key]]),
        );
        if (users.some((user, userIndex) => (
          userIndex !== index
          && ((updates.username && user.username === updates.username)
            || (updates.email && user.email === updates.email))
        ))) {
          const error = new Error('Username o email già esistenti');
          error.status = 400;
          throw error;
        }
        users[index] = {
          ...users[index],
          ...updates,
          id: users[index].id,
          password: passwordHash || users[index].password,
          updatedAt: new Date().toISOString(),
        };
        return { value: users[index] };
      });
      res.json(publicUser(updatedUser));
    } catch (error) {
      respondError(res, error);
    }
  });

  app.get('/api/clients/search', authenticateToken, requirePermission('clients.view'), (req, res) => {
    const query = String(req.query.q || '').toLowerCase();
    res.json(db.list('client').filter((item) => (
      [item.name, item.email, item.phone]
        .some((value) => String(value || '').toLowerCase().includes(query))
    )));
  });

  app.get('/api/clients/stats', authenticateToken, requirePermission('clients.view'), (req, res) => {
    const items = db.list('client');
    const byType = items.reduce((result, item) => {
      const clientType = item.clientType || item.type || 'Privato';
      result[clientType] = (result[clientType] || 0) + 1;
      return result;
    }, {});
    res.json({
      total: items.length,
      byType,
      recentlyAdded: items.filter(
        (item) => new Date(item.createdAt).getTime() > Date.now() - 604800000,
      ).length,
    });
  });

  app.get('/api/materials/search', authenticateToken, requirePermission('materials.view'), (req, res) => {
    const query = String(req.query.q || '').toLowerCase();
    res.json(db.list('material').filter((item) => (
      [item.name, item.category, item.supplier]
        .some((value) => String(value || '').toLowerCase().includes(query))
    )));
  });

  app.get('/api/materials/stats', authenticateToken, requirePermission('materials.view'), (req, res) => {
    const items = db.list('material');
    const byCategory = items.reduce((result, item) => {
      const category = item.category || 'Altro';
      result[category] = (result[category] || 0) + 1;
      return result;
    }, {});
    const low = items.filter(
      (item) => Number(item.stockQuantity || 0) < Number(item.minStockLevel || 0),
    );
    res.json({
      total: items.length,
      byCategory,
      lowStock: low.length,
      lowStockItems: low.length,
      totalValue: items.reduce(
        (sum, item) => sum + Number(item.stockQuantity || 0) * Number(item.unitPrice || 0),
        0,
      ),
    });
  });

  app.get('/api/materials/categories', authenticateToken, requirePermission('materials.view'), (req, res) => {
    res.json([...new Set(db.list('material').map((item) => item.category || 'Altro'))]);
  });

  app.get('/api/materials/suppliers', authenticateToken, requirePermission('materials.view'), (req, res) => {
    res.json([
      ...new Set(db.list('material').map((item) => item.supplier || 'Non specificato')),
    ]);
  });

  app.get('/api/orders/search', authenticateToken, requirePermission('orders.view'), (req, res) => {
    const query = String(req.query.q || '').toLowerCase();
    res.json(db.list('order').filter((item) => (
      [item.title, item.name, item.clientName]
        .some((value) => String(value || '').toLowerCase().includes(query))
    )));
  });

  app.get('/api/orders/by-status/:status', authenticateToken, requirePermission('orders.view'), (req, res) => {
    res.json(db.list('order').filter((item) => item.status === req.params.status));
  });

  const updateOrderStatus = (req, res) => {
    try {
      const patch = sanitizePatch(req.user, 'order', { status: req.body.status });
      if (!patch) return res.status(400).json({ error: 'Stato richiesto' });
      const result = db.update(
        'order',
        req.params.id,
        patch,
        expectedVersionFrom(req),
        req.user,
        operationIdFrom(req, `order:status:${req.params.id}`),
      );
      realtime.broadcast({
        event: 'orders.updated',
        entityType: 'order',
        item: result.item,
        actor: publicActor(req.user),
      }, 'orders.view');
      return res.json(result.item);
    } catch (error) {
      return respondError(res, error);
    }
  };

  app.patch('/api/orders/:id/status', authenticateToken, requirePermission('orders.edit'), updateOrderStatus);
  app.put('/api/orders/:id/status', authenticateToken, requirePermission('orders.edit'), updateOrderStatus);

  for (const [route, config] of Object.entries(ROUTES)) {
    const base = `/api/${route}`;

    app.get(base, authenticateToken, requirePermission(`${config.permission}.view`), (req, res) => {
      res.json(db.list(config.type));
    });

    app.get(`${base}/:id`, authenticateToken, requirePermission(`${config.permission}.view`), (req, res) => {
      const item = db.get(config.type, req.params.id);
      if (!item) return res.status(404).json({ error: 'Elemento non trovato' });
      return res.json(item);
    });

    app.post(base, authenticateToken, requirePermission(`${config.permission}.create`), (req, res) => {
      try {
        const payload = req.user.role === 'worker'
          ? sanitizePatch(req.user, config.type, req.body)
          : normalize(config.type, req.body, { defaults: true });
        if (!payload) {
          return res.status(403).json({ error: 'Nessun campo modificabile per questo ruolo' });
        }
        const result = db.create(
          config.type,
          payload,
          req.user,
          operationIdFrom(req, `${config.type}:create`),
        );
        realtime.broadcast({
          event: `${route}.created`,
          entityType: config.type,
          item: result.item,
          actor: publicActor(req.user),
        }, `${config.permission}.view`);
        return res.status(result.replayed ? 200 : 201).json(result.item);
      } catch (error) {
        return respondError(res, error);
      }
    });

    const update = (req, res) => {
      try {
        const patch = sanitizePatch(req.user, config.type, req.body);
        if (!patch) {
          return res.status(400).json({ error: 'Nessun campo valido da modificare' });
        }
        const result = db.update(
          config.type,
          req.params.id,
          patch,
          expectedVersionFrom(req),
          req.user,
          operationIdFrom(req, `${config.type}:update:${req.params.id}`),
        );
        realtime.broadcast({
          event: `${route}.updated`,
          entityType: config.type,
          item: result.item,
          actor: publicActor(req.user),
        }, `${config.permission}.view`);
        return res.json(result.item);
      } catch (error) {
        return respondError(res, error);
      }
    };

    app.put(`${base}/:id`, authenticateToken, requirePermission(`${config.permission}.edit`), update);
    app.patch(`${base}/:id`, authenticateToken, requirePermission(`${config.permission}.edit`), update);

    app.delete(`${base}/:id`, authenticateToken, requirePermission(`${config.permission}.delete`), (req, res) => {
      try {
        const result = db.delete(
          config.type,
          req.params.id,
          expectedVersionFrom(req),
          req.user,
          operationIdFrom(req, `${config.type}:delete:${req.params.id}`),
        );
        realtime.broadcast({
          event: `${route}.deleted`,
          entityType: config.type,
          id: result.id,
          actor: publicActor(req.user),
        }, `${config.permission}.view`);
        return res.json(result);
      } catch (error) {
        return respondError(res, error);
      }
    });
  }

  app.get('/api/analytics/dashboard', authenticateToken, requirePermission('dashboard.view'), (req, res) => {
    const projects = db.list('project');
    const invoices = db.list('invoice');
    const materials = db.list('material');
    const clients = db.list('client');
    res.json({
      totalProjects: projects.length,
      totalClients: clients.length,
      totalRevenue: invoices.reduce(
        (sum, item) => sum + Number(item.total || item.amount || 0),
        0,
      ),
      pendingOrders: projects.filter((item) => item.status === 'In Attesa').length,
      inProgressOrders: projects.filter(
        (item) => ['In Corso', 'In Lavorazione'].includes(item.status),
      ).length,
      completedOrders: projects.filter((item) => item.status === 'Completato').length,
      lowStockMaterials: materials.filter(
        (item) => Number(item.stockQuantity || 0) < Number(item.minStockLevel || 0),
      ).length,
      recentClients: clients.filter(
        (item) => new Date(item.createdAt).getTime() > Date.now() - 604800000,
      ).length,
    });
  });

  app.get('/api/analytics/daily/:date?', authenticateToken, requirePermission('dashboard.view'), (req, res) => {
    const date = req.params.date || new Date().toISOString().slice(0, 10);
    const items = [...db.list('project'), ...db.list('order')]
      .filter((item) => String(item.createdAt || '').slice(0, 10) === date);
    res.json({
      date,
      totalOrders: items.length,
      totalRevenue: items.reduce(
        (sum, item) => sum + Number(item.amount || item.total || 0),
        0,
      ),
      newClients: db.list('client')
        .filter((item) => String(item.createdAt || '').slice(0, 10) === date).length,
      pendingOrders: items.filter(
        (item) => ['pending', 'In Attesa'].includes(item.status),
      ).length,
      completedOrders: items.filter(
        (item) => ['completed', 'Completato'].includes(item.status),
      ).length,
    });
  });

  app.get('/api/analytics/trends', authenticateToken, requirePermission('dashboard.view'), (req, res) => {
    const metric = String(req.query.metric || 'orders');
    const start = new Date(String(
      req.query.startDate || new Date(Date.now() - 30 * 86400000).toISOString(),
    ));
    const end = new Date(String(req.query.endDate || new Date().toISOString()));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return res.status(400).json({ error: 'Intervallo date non valido' });
    }
    const orders = [...db.list('order'), ...db.list('project')];
    const clients = db.list('client');
    const invoices = db.list('invoice');
    const data = [];
    for (const current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
      const date = current.toISOString().slice(0, 10);
      const value = metric === 'clients'
        ? clients.filter((item) => String(item.createdAt || '').slice(0, 10) === date).length
        : metric === 'revenue'
          ? invoices
            .filter((item) => String(item.createdAt || '').slice(0, 10) === date)
            .reduce((sum, item) => sum + Number(item.total || item.amount || 0), 0)
          : orders.filter((item) => String(item.createdAt || '').slice(0, 10) === date).length;
      data.push({ date, value, label: date });
    }
    return res.json(data);
  });

  app.get('/api/audit', authenticateToken, requirePermission('settings.view'), (req, res) => {
    res.json(db.listAudit({
      type: req.query.type,
      id: req.query.id,
      limit: req.query.limit,
    }));
  });

  app.get('/api/audit/:type/:id', authenticateToken, (req, res) => {
    if (!hasEntityPermission(req.user, req.params.type, 'view')) {
      return res.status(403).json({ error: 'Permessi insufficienti' });
    }
    return res.json(db.listAudit({
      type: req.params.type,
      id: req.params.id,
      limit: req.query.limit,
    }));
  });

  const ensureAttachmentEntity = (action) => (req, res, next) => {
    try {
      if (!hasEntityPermission(req.user, req.params.type, action)) {
        return res.status(403).json({ error: 'Permessi insufficienti' });
      }
      if (!db.get(req.params.type, req.params.id)) {
        return res.status(404).json({ error: 'Elemento non trovato' });
      }
      return next();
    } catch (error) {
      return respondError(res, error);
    }
  };

  app.get(
    '/api/entity-attachments/:type/:id',
    authenticateToken,
    ensureAttachmentEntity('view'),
    (req, res) => res.json(db.listAttachments(req.params.type, req.params.id)),
  );

  app.post(
    '/api/entity-attachments/:type/:id',
    authenticateToken,
    ensureAttachmentEntity('edit'),
    upload.array('files', 10),
    (req, res) => {
      try {
        if (!req.files?.length) {
          return res.status(400).json({ error: 'Nessun file ricevuto' });
        }
        const records = req.files.map((file) => ({
          entityType: req.params.type,
          entityId: req.params.id,
          originalName: file.originalname,
          storedName: file.filename,
          mimeType: file.mimetype,
          sizeBytes: file.size,
        }));
        const items = db.addAttachments(records, req.user);
        realtime.broadcast({
          event: 'attachments.changed',
          entityType: req.params.type,
          id: String(req.params.id),
          actor: publicActor(req.user),
        }, permissionForType(req.params.type, 'view'));
        return res.status(201).json(items);
      } catch (error) {
        removeUploadedFiles(req.files);
        return respondError(res, error);
      }
    },
  );

  app.get('/api/attachments/file/:id', authenticateToken, (req, res) => {
    const attachment = db.getAttachment(req.params.id);
    if (!attachment || !fs.existsSync(attachment.absolutePath)) {
      return res.status(404).json({ error: 'Allegato non trovato' });
    }
    if (!hasEntityPermission(req.user, attachment.entityType, 'view')) {
      return res.status(403).json({ error: 'Permessi insufficienti' });
    }
    return res.download(attachment.absolutePath, attachment.originalName);
  });

  app.delete('/api/attachments/file/:id', authenticateToken, (req, res) => {
    try {
      const attachment = db.getAttachment(req.params.id);
      if (!attachment) return res.status(404).json({ error: 'Allegato non trovato' });
      if (!hasEntityPermission(req.user, attachment.entityType, 'edit')) {
        return res.status(403).json({ error: 'Permessi insufficienti' });
      }
      const deleted = db.deleteAttachment(req.params.id, req.user);
      realtime.broadcast({
        event: 'attachments.changed',
        entityType: deleted.entityType,
        id: deleted.entityId,
        actor: publicActor(req.user),
      }, permissionForType(deleted.entityType, 'view'));
      return res.json({ deleted: true });
    } catch (error) {
      return respondError(res, error);
    }
  });

  app.get('/api/backup/export', authenticateToken, requirePermission('settings.view'), (req, res) => {
    res.json(db.exportJson());
  });

  app.post('/api/backup/import', authenticateToken, requirePermission('settings.edit'), async (req, res) => {
    try {
      await db.createSnapshot('pre-importazione');
      db.restoreJson(req.body, req.user);
      realtime.broadcast({ event: 'database.restored' });
      res.json({ message: 'Backup importato' });
    } catch (error) {
      respondError(res, error);
    }
  });

  app.get('/api/backup', authenticateToken, requirePermission('settings.view'), (req, res) => {
    res.json(db.exportJson());
  });

  app.post('/api/backup/restore', authenticateToken, requirePermission('settings.edit'), async (req, res) => {
    try {
      const backup = req.body?.data && !req.body.data.client && req.body.data.clients
        ? {
          ...req.body,
          data: {
            client: req.body.data.clients,
            order: req.body.data.orders?.filter((item) => item.type === 'order') || [],
            project: req.body.data.orders?.filter((item) => item.type === 'project') || [],
            quote: req.body.data.orders?.filter((item) => item.type === 'quote') || [],
            invoice: req.body.data.orders?.filter((item) => item.type === 'invoice') || [],
            material: req.body.data.materials || [],
          },
        }
        : req.body;
      await db.createSnapshot('pre-ripristino');
      db.restoreJson(backup, req.user);
      realtime.broadcast({ event: 'database.restored' });
      res.json({ message: 'Backup ripristinato' });
    } catch (error) {
      respondError(res, error);
    }
  });

  app.post('/api/backup/clear', authenticateToken, requirePermission('settings.edit'), async (req, res) => {
    try {
      await db.createSnapshot('pre-cancellazione');
      db.restoreJson({
        data: Object.fromEntries(ENTITY_TYPES.map((type) => [type, []])),
      }, req.user);
      realtime.broadcast({ event: 'database.restored' });
      res.json({ message: 'Dati cancellati' });
    } catch (error) {
      respondError(res, error);
    }
  });

  app.get('/api/backups', authenticateToken, requirePermission('settings.view'), (req, res) => {
    res.json(db.listSnapshots());
  });

  app.post('/api/backups', authenticateToken, requirePermission('settings.edit'), async (req, res) => {
    try {
      res.status(201).json(await db.createSnapshot(req.body?.label || 'manuale'));
    } catch (error) {
      respondError(res, error);
    }
  });

  app.post('/api/backups/:name/restore', authenticateToken, requirePermission('settings.edit'), async (req, res) => {
    try {
      await db.createSnapshot('pre-ripristino');
      const snapshot = db.restoreSnapshot(req.params.name, req.user);
      realtime.broadcast({ event: 'database.restored', snapshot });
      res.json(snapshot);
    } catch (error) {
      respondError(res, error);
    }
  });

  app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      removeUploadedFiles(req.files);
      return res.status(400).json({ error: error.message });
    }
    if (error instanceof SyntaxError && error.status === 400) {
      return res.status(400).json({ error: 'JSON non valido' });
    }
    return respondError(res, error);
  });

  app.use('*', (req, res) => res.status(404).json({ error: 'Endpoint non trovato' }));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, resolve);
  });
  const actualPort = server.address().port;

  const ensureDailyBackup = async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const alreadyCreated = db.listSnapshots().some(
        (item) => item.createdAt.startsWith(today) && item.label === 'automatico',
      );
      if (!alreadyCreated) await db.createSnapshot('automatico');
    } catch (error) {
      console.error('Backup automatico fallito:', error);
    }
  };

  await ensureDailyBackup();
  const backupTimer = setInterval(ensureDailyBackup, 60 * 60 * 1000);

  return {
    app,
    server,
    db,
    port: actualPort,
    host,
    close: async () => {
      clearInterval(backupTimer);
      for (const client of realtime.wss.clients) client.terminate();
      await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}

module.exports = { createCrmServer };
