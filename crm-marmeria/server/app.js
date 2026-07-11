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
  drainUserMutations,
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

const ADMIN_PERMISSIONS = [
  'dashboard.view',
  ...Object.values(ROUTES).flatMap(({ permission }) => [
    `${permission}.view`,
    `${permission}.create`,
    `${permission}.edit`,
    `${permission}.delete`,
  ]),
  'settings.view', 'settings.edit',
  'users.view', 'users.create', 'users.edit', 'users.delete',
];

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

const FINANCIAL_FIELDS = new Set([
  'amount', 'budget', 'cost', 'fiscalCode', 'minPrice', 'paymentDetails',
  'price', 'purchasePrice', 'salePrice', 'subtotal', 'taxTotal', 'total',
  'totalPrice', 'unitPrice', 'vatNumber',
]);

const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const loginAttempts = new Map();

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

const publicActor = (user) => ({ id: String(user.id), username: user.username });
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const hasAny = (object, keys) => keys.some((key) => hasOwn(object, key));
const isLoopback = (req) => [
  '127.0.0.1', '::1', '::ffff:127.0.0.1',
].includes(req.socket.remoteAddress);

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
  } else if (comma >= 0) {
    normalized = compact.replace(',', '.');
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const dateKey = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};
const betweenDates = (value, start, end) => {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp >= start.getTime() && timestamp <= end.getTime();
};
const addDays = (date, days) => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};
const canViewFinancials = (user) => ['admin', 'manager'].includes(user?.role);

const redactFinancials = (value) => {
  if (Array.isArray(value)) return value.map(redactFinancials);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !FINANCIAL_FIELDS.has(key))
      .map(([key, nested]) => [key, redactFinancials(nested)]),
  );
};
const presentEntity = (user, type, item) => {
  if (item == null || canViewFinancials(user)) return item;
  return ['project', 'order', 'material', 'quote', 'invoice', 'client'].includes(type)
    ? redactFinancials(item)
    : item;
};
const presentAudit = (user, item) => ({
  ...item,
  previous: presentEntity(user, item.entityType, item.previous),
  next: presentEntity(user, item.entityType, item.next),
});

const normalize = (type, raw = {}, { defaults = false } = {}) => {
  const data = { ...raw };
  for (const key of ['id', 'clientId', 'customerId', 'projectId', 'quoteId', 'materialId']) {
    if (data[key] != null && data[key] !== '') data[key] = String(data[key]);
  }
  if (Array.isArray(data.items)) {
    data.items = data.items.map((item) => ({
      ...item,
      materialId: item.materialId == null || item.materialId === '' ? null : String(item.materialId),
      quantity: numeric(item.quantity),
      unitPrice: numeric(item.unitPrice),
      taxRate: numeric(item.taxRate),
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
      const unitPrice = numeric(data.unitPrice ?? data.price);
      data.unitPrice = unitPrice;
      data.price = unitPrice;
    }
    if (defaults || hasAny(data, ['stockQuantity', 'quantity', 'stock'])) {
      const stockQuantity = numeric(data.stockQuantity ?? data.quantity ?? data.stock);
      data.stockQuantity = stockQuantity;
      data.quantity = stockQuantity;
      data.stock = stockQuantity;
    }
    if (defaults || hasAny(data, ['minStockLevel', 'minQuantity'])) {
      const minStockLevel = numeric(data.minStockLevel ?? data.minQuantity ?? 10);
      data.minStockLevel = minStockLevel;
      data.minQuantity = minStockLevel;
    }
  }
  if (['order', 'project', 'quote', 'invoice'].includes(type)) {
    data.type = type;
    data.entityType = type;
    if (defaults || hasAny(data, ['title', 'name'])) {
      data.title = data.title ?? data.name ?? '';
      data.name = data.name ?? data.title ?? '';
    }
    if (defaults || hasAny(data, ['deadline', 'endDate', 'estimatedDelivery'])) {
      data.deadline = data.deadline ?? data.endDate ?? data.estimatedDelivery ?? '';
      data.endDate = data.endDate ?? data.deadline;
    }
    if (type === 'project' && hasOwn(data, 'budget')) data.budget = numeric(data.budget);
    if (hasAny(data, ['amount', 'total'])) data.amount = numeric(data.amount ?? data.total);
  }
  return data;
};

const sanitizePatch = (user, type, input = {}) => {
  const patch = { ...input };
  for (const key of [
    'id', 'type', 'entityType', 'createdAt', 'updatedAt',
    'version', 'operationId', 'expectedVersion',
  ]) delete patch[key];
  const entries = ['admin', 'manager'].includes(user.role)
    ? Object.entries(patch)
    : Object.entries(patch).filter(([key]) => (WORKER_FIELDS[type] || []).includes(key));
  return entries.length ? normalize(type, Object.fromEntries(entries)) : null;
};

const validateEntity = (type, payload) => {
  const required = {
    client: ['name'],
    material: ['name'],
    project: ['name'],
    quote: ['date', 'customerId'],
    invoice: ['date', 'customerId'],
    order: ['title'],
  }[type] || [];
  const missing = required.filter((key) => payload[key] == null || String(payload[key]).trim() === '');
  if (missing.length) {
    const error = new Error(`Campi richiesti mancanti: ${missing.join(', ')}`);
    error.status = 400;
    throw error;
  }
  if (['quote', 'invoice'].includes(type) && (!Array.isArray(payload.items) || !payload.items.length)) {
    const error = new Error('Inserire almeno una voce nel documento');
    error.status = 400;
    throw error;
  }
  if (type === 'material') {
    for (const key of ['unitPrice', 'stockQuantity', 'minStockLevel']) {
      if (payload[key] != null && numeric(payload[key]) < 0) {
        const error = new Error(`${key} non può essere negativo`);
        error.status = 400;
        throw error;
      }
    }
  }
  if (type === 'project' && payload.budget != null && numeric(payload.budget) < 0) {
    const error = new Error('Il budget non può essere negativo');
    error.status = 400;
    throw error;
  }
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
const routeForType = (type) => Object.entries(ROUTES).find(([, config]) => config.type === type);
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
      socket.send(JSON.stringify({ event: 'connected', timestamp: new Date().toISOString() }));
      socket.on('message', (message) => {
        if (message.toString() === 'ping') socket.send('pong');
      });
    } catch {
      socket.close(4001, 'Autenticazione richiesta');
    }
    return undefined;
  });
  const broadcast = (payload, requiredPermission = null) => {
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      const user = verifyToken(client.authToken);
      if (!user) {
        client.close(4001, 'Sessione scaduta');
        continue;
      }
      if (requiredPermission && !user.permissions?.includes(requiredPermission)) continue;
      const projected = payload.item
        ? { ...payload, item: presentEntity(user, payload.entityType, payload.item) }
        : payload;
      client.send(JSON.stringify({ ...projected, timestamp: new Date().toISOString() }));
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

  let maintenanceMode = false;
  app.use('/api', (req, res, next) => {
    if (maintenanceMode && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return res.status(503).json({ error: 'Server in manutenzione: riprovare tra pochi secondi' });
    }
    return next();
  });

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
    return res.status(error.status || 500).json({
      error: error.message || 'Errore interno del server',
      current: error.current || undefined,
    });
  };
  const runMaintenance = async (snapshotLabel, action) => {
    if (maintenanceMode) {
      const error = new Error('È già in corso un’operazione di manutenzione');
      error.status = 503;
      throw error;
    }
    maintenanceMode = true;
    try {
      await drainUserMutations();
      if (snapshotLabel) await db.createSnapshot(snapshotLabel);
      return await action();
    } finally {
      maintenanceMode = false;
    }
  };

  app.get('/api/health', (req, res) => res.json({
    status: maintenanceMode ? 'maintenance' : 'ok',
    version: '2.3.0',
    mode: 'central-server',
    hostname: options.serverName || 'crm-marmeria',
    serverId: options.serverId || null,
    port: server.address()?.port || requestedPort,
    timestamp: new Date().toISOString(),
    websocket: true,
    maintenance: maintenanceMode,
    setupRequired: readUsers().length === 0,
  }));
  app.head('/api/health', (req, res) => res.sendStatus(200));

  app.post('/api/auth/login', async (req, res) => {
    try {
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '');
      if (!username || !password) {
        return res.status(400).json({ error: 'Username e password richiesti' });
      }

      if (readUsers().length === 0) {
        if (!isLoopback(req)) {
          return res.status(403).json({
            error: 'La configurazione iniziale deve essere completata sul PC principale',
          });
        }
        if (password.length < 10) {
          return res.status(400).json({ error: 'La password iniziale deve contenere almeno 10 caratteri' });
        }
        const passwordHash = await hashPassword(password);
        const firstUser = await mutateUsers(async (users) => {
          if (users.length) {
            const error = new Error('Configurazione iniziale già completata');
            error.status = 409;
            throw error;
          }
          const user = {
            id: crypto.randomUUID(),
            username,
            email: String(req.body?.email || `${username}@crm.local`).trim(),
            password: passwordHash,
            firstName: String(req.body?.firstName || 'Amministratore').trim(),
            lastName: String(req.body?.lastName || 'Sistema').trim(),
            role: 'admin',
            permissions: ADMIN_PERMISSIONS,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          users.push(user);
          return { value: user };
        });
        return res.status(201).json({ token: generateToken(firstUser), user: publicUser(firstUser) });
      }

      const key = `${req.ip}|${username.toLowerCase()}`;
      const previous = loginAttempts.get(key);
      if (previous && Date.now() - previous.startedAt < LOGIN_WINDOW_MS && previous.count >= LOGIN_LIMIT) {
        return res.status(429).json({ error: 'Troppi tentativi di accesso. Riprovare più tardi.' });
      }
      if (previous && Date.now() - previous.startedAt >= LOGIN_WINDOW_MS) loginAttempts.delete(key);
      if (loginAttempts.size > 1000) {
        const cutoff = Date.now() - LOGIN_WINDOW_MS;
        for (const [attemptKey, value] of loginAttempts) {
          if (value.startedAt < cutoff) loginAttempts.delete(attemptKey);
        }
      }

      const user = findUserByCredentials(username);
      if (!user || !(await verifyPassword(password, user.password))) {
        const current = loginAttempts.get(key);
        loginAttempts.set(key, {
          count: (current?.count || 0) + 1,
          startedAt: current?.startedAt || Date.now(),
        });
        return res.status(401).json({ error: 'Credenziali non valide' });
      }
      loginAttempts.delete(key);
      return res.json({ token: generateToken(user), user: publicUser(user) });
    } catch (error) {
      return respondError(res, error);
    }
  });

  app.post('/api/auth/logout', authenticateToken, (req, res) => res.json({ message: 'Logout effettuato' }));
  app.get('/api/auth/me', authenticateToken, (req, res) => res.json({ user: publicUser(req.user) }));

  app.put('/api/auth/profile', authenticateToken, async (req, res) => {
    try {
      const allowed = ['username', 'email', 'firstName', 'lastName'];
      const updates = Object.fromEntries(
        allowed.filter((key) => req.body[key] !== undefined)
          .map((key) => [key, String(req.body[key]).trim()]),
      );
      if ((updates.username !== undefined && !updates.username)
        || (updates.email !== undefined && !updates.email)) {
        return res.status(400).json({ error: 'Username ed email non possono essere vuoti' });
      }
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
        users[index] = { ...users[index], ...updates, updatedAt: new Date().toISOString() };
        return { value: users[index] };
      });
      return res.json({ user: publicUser(updatedUser) });
    } catch (error) {
      return respondError(res, error);
    }
  });

  app.get('/api/users', authenticateToken, requireRole('admin'), (req, res) => {
    res.json(readUsers().map(publicUser));
  });

  app.post('/api/users', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
      const { username, email, password, firstName, lastName, role, permissions } = req.body;
      if (!username || !email || !password || !firstName || !lastName || !role) {
        return res.status(400).json({ error: 'Tutti i campi sono richiesti' });
      }
      if (String(password).length < 8) {
        return res.status(400).json({ error: 'La password deve contenere almeno 8 caratteri' });
      }
      if (!['admin', 'manager', 'worker'].includes(String(role))) {
        return res.status(400).json({ error: 'Ruolo non valido' });
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
          permissions: Array.isArray(permissions) ? [...new Set(permissions.map(String))] : [],
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
      if (req.body.password && String(req.body.password).length < 8) {
        return res.status(400).json({ error: 'La password deve contenere almeno 8 caratteri' });
      }
      if (req.body.role && !['admin', 'manager', 'worker'].includes(String(req.body.role))) {
        return res.status(400).json({ error: 'Ruolo non valido' });
      }
      const passwordHash = req.body.password ? await hashPassword(String(req.body.password)) : null;
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
          allowed.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]),
        );
        if (Array.isArray(updates.permissions)) {
          updates.permissions = [...new Set(updates.permissions.map(String))];
        }
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
      return res.json(publicUser(updatedUser));
    } catch (error) {
      return respondError(res, error);
    }
  });

  app.get('/api/clients/search', authenticateToken, requirePermission('clients.view'), (req, res) => {
    const query = String(req.query.q || '').toLowerCase();
    res.json(db.list('client')
      .filter((item) => [item.name, item.email, item.phone]
        .some((value) => String(value || '').toLowerCase().includes(query)))
      .map((item) => presentEntity(req.user, 'client', item)));
  });
  app.get('/api/clients/stats', authenticateToken, requirePermission('clients.view'), (req, res) => {
    const items = db.list('client');
    const byType = items.reduce((result, item) => {
      const type = item.clientType || item.type || 'Privato';
      result[type] = (result[type] || 0) + 1;
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
    res.json(db.list('material')
      .filter((item) => [item.name, item.category, item.supplier]
        .some((value) => String(value || '').toLowerCase().includes(query)))
      .map((item) => presentEntity(req.user, 'material', item)));
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
      totalValue: canViewFinancials(req.user)
        ? items.reduce(
          (sum, item) => sum + Number(item.stockQuantity || 0) * Number(item.unitPrice || 0),
          0,
        )
        : null,
    });
  });
  app.get('/api/materials/categories', authenticateToken, requirePermission('materials.view'), (req, res) => {
    res.json([...new Set(db.list('material').map((item) => item.category || 'Altro'))]);
  });
  app.get('/api/materials/suppliers', authenticateToken, requirePermission('materials.view'), (req, res) => {
    res.json([...new Set(db.list('material').map((item) => item.supplier || 'Non specificato'))]);
  });

  app.get('/api/orders/search', authenticateToken, requirePermission('orders.view'), (req, res) => {
    const query = String(req.query.q || '').toLowerCase();
    res.json(db.list('order')
      .filter((item) => [item.title, item.name, item.clientName, item.status]
        .some((value) => String(value || '').toLowerCase().includes(query)))
      .map((item) => presentEntity(req.user, 'order', item)));
  });
  app.get('/api/orders/by-status/:status', authenticateToken, requirePermission('orders.view'), (req, res) => {
    res.json(db.list('order')
      .filter((item) => item.status === req.params.status)
      .map((item) => presentEntity(req.user, 'order', item)));
  });
  app.get('/api/orders/:id/status', authenticateToken, requirePermission('orders.view'), (req, res) => {
    const item = db.get('order', req.params.id);
    if (!item) return res.status(404).json({ error: 'Ordine non trovato' });
    const endDate = new Date(item.estimatedDelivery || item.endDate || item.deadline || '');
    const delayed = Number.isFinite(endDate.getTime()) && endDate < new Date() && item.status !== 'Completato';
    const completion = item.progress != null
      ? Math.max(0, Math.min(100, Number(item.progress) || 0))
      : ({ Preventivo: 0, 'In Attesa': 10, 'In Lavorazione': 50, Completato: 100, Annullato: 0 }[item.status] || 0);
    return res.json({
      id: String(item.id),
      status: item.status,
      eta: item.estimatedDelivery || item.endDate || item.deadline || null,
      clientName: item.clientName || item.client || '',
      title: item.title || item.name || '',
      priority: item.priority || 'Media',
      completionPercentage: completion,
      delaysCount: delayed ? 1 : 0,
      lastUpdate: item.updatedAt,
    });
  });
  const updateOrderStatus = (req, res) => {
    try {
      const patch = sanitizePatch(req.user, 'order', { status: req.body.status });
      if (!patch) return res.status(400).json({ error: 'Stato richiesto' });
      const result = db.update(
        'order', req.params.id, patch, expectedVersionFrom(req), req.user,
        operationIdFrom(req, `order:status:${req.params.id}`),
      );
      realtime.broadcast({
        event: 'orders.updated', entityType: 'order', item: result.item, actor: publicActor(req.user),
      }, 'orders.view');
      return res.json(presentEntity(req.user, 'order', result.item));
    } catch (error) {
      return respondError(res, error);
    }
  };
  app.patch('/api/orders/:id/status', authenticateToken, requirePermission('orders.edit'), updateOrderStatus);
  app.put('/api/orders/:id/status', authenticateToken, requirePermission('orders.edit'), updateOrderStatus);

  for (const [route, config] of Object.entries(ROUTES)) {
    const base = `/api/${route}`;
    app.get(base, authenticateToken, requirePermission(`${config.permission}.view`), (req, res) => {
      res.json(db.list(config.type).map((item) => presentEntity(req.user, config.type, item)));
    });
    app.get(`${base}/:id`, authenticateToken, requirePermission(`${config.permission}.view`), (req, res) => {
      const item = db.get(config.type, req.params.id);
      if (!item) return res.status(404).json({ error: 'Elemento non trovato' });
      return res.json(presentEntity(req.user, config.type, item));
    });
    app.post(base, authenticateToken, requirePermission(`${config.permission}.create`), (req, res) => {
      try {
        const payload = req.user.role === 'worker'
          ? sanitizePatch(req.user, config.type, req.body)
          : normalize(config.type, req.body, { defaults: true });
        if (!payload) return res.status(403).json({ error: 'Nessun campo modificabile per questo ruolo' });
        validateEntity(config.type, payload);
        const result = db.create(
          config.type, payload, req.user, operationIdFrom(req, `${config.type}:create`),
        );
        realtime.broadcast({
          event: `${route}.created`, entityType: config.type, item: result.item, actor: publicActor(req.user),
        }, `${config.permission}.view`);
        return res.status(result.replayed ? 200 : 201)
          .json(presentEntity(req.user, config.type, result.item));
      } catch (error) {
        return respondError(res, error);
      }
    });
    const update = (req, res) => {
      try {
        const patch = sanitizePatch(req.user, config.type, req.body);
        if (!patch) return res.status(400).json({ error: 'Nessun campo valido da modificare' });
        const current = db.get(config.type, req.params.id);
        if (!current) return res.status(404).json({ error: 'Elemento non trovato' });
        validateEntity(config.type, { ...current, ...patch });
        const result = db.update(
          config.type, req.params.id, patch, expectedVersionFrom(req), req.user,
          operationIdFrom(req, `${config.type}:update:${req.params.id}`),
        );
        realtime.broadcast({
          event: `${route}.updated`, entityType: config.type, item: result.item, actor: publicActor(req.user),
        }, `${config.permission}.view`);
        return res.json(presentEntity(req.user, config.type, result.item));
      } catch (error) {
        return respondError(res, error);
      }
    };
    app.put(`${base}/:id`, authenticateToken, requirePermission(`${config.permission}.edit`), update);
    app.patch(`${base}/:id`, authenticateToken, requirePermission(`${config.permission}.edit`), update);
    app.delete(`${base}/:id`, authenticateToken, requirePermission(`${config.permission}.delete`), (req, res) => {
      try {
        const result = db.delete(
          config.type, req.params.id, expectedVersionFrom(req), req.user,
          operationIdFrom(req, `${config.type}:delete:${req.params.id}`),
        );
        realtime.broadcast({
          event: `${route}.deleted`, entityType: config.type, id: result.id, actor: publicActor(req.user),
        }, `${config.permission}.view`);
        return res.json(result);
      } catch (error) {
        return respondError(res, error);
      }
    });
  }

  const allWork = () => [...db.list('project'), ...db.list('order')];
  const invoiceRevenue = (start, end) => db.list('invoice')
    .filter((item) => betweenDates(item.date || item.createdAt, start, end))
    .reduce((sum, item) => sum + numeric(item.total ?? item.amount), 0);

  app.get('/api/analytics/dashboard', authenticateToken, requirePermission('dashboard.view'), (req, res) => {
    const projects = db.list('project');
    const materials = db.list('material');
    const clients = db.list('client');
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const current = new Date();
    res.json({
      totalProjects: projects.length,
      totalClients: clients.length,
      totalMaterials: materials.length,
      totalRevenue: canViewFinancials(req.user) ? invoiceRevenue(monthStart, current) : null,
      financialsVisible: canViewFinancials(req.user),
      pendingOrders: projects.filter((item) => item.status === 'In Attesa').length,
      inProgressOrders: projects.filter((item) => ['In Corso', 'In Lavorazione'].includes(item.status)).length,
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
    const work = allWork();
    const materials = db.list('material');
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);
    if (Number.isNaN(dayStart.getTime())) return res.status(400).json({ error: 'Data non valida' });
    res.json({
      date,
      ordersCompleted: work.filter(
        (item) => item.status === 'Completato' && betweenDates(item.updatedAt, dayStart, dayEnd),
      ).length,
      deliveriesDue: work.filter(
        (item) => dateKey(item.deadline || item.endDate || item.estimatedDelivery) === date,
      ).length,
      delays: work.filter((item) => {
        const due = new Date(item.deadline || item.endDate || item.estimatedDelivery || '');
        return Number.isFinite(due.getTime()) && due < dayEnd && item.status !== 'Completato';
      }).length,
      newOrders: work.filter((item) => betweenDates(item.createdAt, dayStart, dayEnd)).length,
      revenue: canViewFinancials(req.user) ? invoiceRevenue(dayStart, dayEnd) : 0,
      activeProjects: work.filter((item) => ['In Corso', 'In Lavorazione'].includes(item.status)).length,
      urgentTasks: work.filter((item) => item.priority === 'Urgente').length,
      clientsContacted: 0,
      materials: {
        lowStock: materials.filter(
          (item) => Number(item.stockQuantity || 0) < Number(item.minStockLevel || 0),
        ).length,
        outOfStock: materials.filter((item) => Number(item.stockQuantity || 0) <= 0).length,
      },
    });
  });

  app.get('/api/analytics/weekly/:weekStart?', authenticateToken, requirePermission('dashboard.view'), (req, res) => {
    const start = new Date(`${req.params.weekStart || new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) return res.status(400).json({ error: 'Data non valida' });
    const end = addDays(start, 6);
    end.setUTCHours(23, 59, 59, 999);
    const work = allWork().filter((item) => betweenDates(item.createdAt, start, end));
    const completed = work.filter((item) => item.status === 'Completato');
    const revenue = canViewFinancials(req.user) ? invoiceRevenue(start, end) : 0;
    res.json({
      weekStart: start.toISOString().slice(0, 10),
      weekEnd: end.toISOString().slice(0, 10),
      totalOrders: work.length,
      completedOrders: completed.length,
      totalRevenue: revenue,
      averageOrderValue: work.length ? revenue / work.length : 0,
      clientSatisfaction: 0,
      deliveryPerformance: work.length ? (completed.length / work.length) * 100 : 0,
      topMaterials: [],
    });
  });

  app.get('/api/analytics/monthly/:year/:month', authenticateToken, requirePermission('dashboard.view'), (req, res) => {
    const year = Number(req.params.year);
    const month = Number(req.params.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Mese o anno non validi' });
    }
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    const work = allWork().filter((item) => betweenDates(item.createdAt, start, end));
    const completed = work.filter((item) => item.status === 'Completato');
    const revenue = canViewFinancials(req.user) ? invoiceRevenue(start, end) : 0;
    res.json({
      month: String(month).padStart(2, '0'),
      year,
      totalOrders: work.length,
      totalRevenue: revenue,
      newClients: db.list('client').filter((item) => betweenDates(item.createdAt, start, end)).length,
      completionRate: work.length ? (completed.length / work.length) * 100 : 0,
      averageDeliveryTime: 0,
      topClients: [],
      growthRate: 0,
    });
  });

  app.get('/api/analytics/performance/:period', authenticateToken, requirePermission('dashboard.view'), (req, res) => {
    const days = { week: 7, month: 30, quarter: 90 }[req.params.period];
    if (!days) return res.status(400).json({ error: 'Periodo non valido' });
    const end = new Date();
    const start = addDays(end, -days);
    const work = allWork().filter((item) => betweenDates(item.updatedAt, start, end));
    const completed = work.filter((item) => item.status === 'Completato');
    const onTime = completed.filter((item) => {
      const completedAt = new Date(item.completedAt || item.updatedAt);
      const due = new Date(item.deadline || item.endDate || item.estimatedDelivery || '');
      return Number.isFinite(due.getTime()) && completedAt <= due;
    });
    res.json({
      onTimeDelivery: completed.length ? (onTime.length / completed.length) * 100 : 0,
      customerSatisfaction: 0,
      orderAccuracy: 0,
      responseTime: 0,
      qualityScore: 0,
    });
  });

  app.get('/api/analytics/trends', authenticateToken, requirePermission('dashboard.view'), (req, res) => {
    const metric = String(req.query.metric || 'orders');
    if (!['orders', 'revenue', 'clients', 'satisfaction'].includes(metric)) {
      return res.status(400).json({ error: 'Metrica non valida' });
    }
    if (metric === 'revenue' && !canViewFinancials(req.user)) {
      return res.status(403).json({ error: 'Permessi insufficienti per i dati finanziari' });
    }
    const start = new Date(String(
      req.query.startDate || new Date(Date.now() - 30 * 86400000).toISOString(),
    ));
    const end = new Date(String(req.query.endDate || new Date().toISOString()));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return res.status(400).json({ error: 'Intervallo date non valido' });
    }
    if ((end.getTime() - start.getTime()) / 86400000 > 366) {
      return res.status(400).json({ error: 'Intervallo massimo: 366 giorni' });
    }
    const work = allWork();
    const clients = db.list('client');
    const invoices = db.list('invoice');
    const data = [];
    for (const current = new Date(start); current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
      const date = current.toISOString().slice(0, 10);
      const orders = work.filter((item) => dateKey(item.createdAt) === date).length;
      const clientCount = clients.filter((item) => dateKey(item.createdAt) === date).length;
      const revenue = canViewFinancials(req.user)
        ? invoices.filter((item) => dateKey(item.date || item.createdAt) === date)
          .reduce((sum, item) => sum + numeric(item.total ?? item.amount), 0)
        : 0;
      const row = {
        period: date,
        date,
        label: date,
        orders,
        revenue,
        clients: clientCount,
        satisfaction: 0,
      };
      row.value = metric === 'clients'
        ? clientCount
        : metric === 'revenue'
          ? revenue
          : metric === 'satisfaction'
            ? 0
            : orders;
      data.push(row);
    }
    return res.json(data);
  });

  app.get('/api/audit', authenticateToken, requirePermission('settings.view'), (req, res) => {
    res.json(db.listAudit({ type: req.query.type, id: req.query.id, limit: req.query.limit })
      .map((item) => presentAudit(req.user, item)));
  });
  app.get('/api/audit/:type/:id', authenticateToken, (req, res) => {
    if (!hasEntityPermission(req.user, req.params.type, 'view')) {
      return res.status(403).json({ error: 'Permessi insufficienti' });
    }
    return res.json(db.listAudit({
      type: req.params.type,
      id: req.params.id,
      limit: req.query.limit,
    }).map((item) => presentAudit(req.user, item)));
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
  app.get('/api/entity-attachments/:type/:id', authenticateToken, ensureAttachmentEntity('view'), (req, res) => {
    res.json(db.listAttachments(req.params.type, req.params.id));
  });
  app.post('/api/entity-attachments/:type/:id', authenticateToken, ensureAttachmentEntity('edit'), upload.array('files', 10), (req, res) => {
    try {
      if (!req.files?.length) return res.status(400).json({ error: 'Nessun file ricevuto' });
      const items = db.addAttachments(req.files.map((file) => ({
        entityType: req.params.type,
        entityId: req.params.id,
        originalName: file.originalname,
        storedName: file.filename,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      })), req.user);
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
  });
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

  app.get('/api/backup/export', authenticateToken, requirePermission('settings.view'), (req, res) => res.json(db.exportJson()));
  app.post('/api/backup/import', authenticateToken, requirePermission('settings.edit'), async (req, res) => {
    try {
      await runMaintenance('pre-importazione', () => db.restoreJson(req.body, req.user));
      realtime.broadcast({ event: 'database.restored' });
      return res.json({ message: 'Backup importato' });
    } catch (error) {
      return respondError(res, error);
    }
  });
  app.get('/api/backup', authenticateToken, requirePermission('settings.view'), (req, res) => res.json(db.exportJson()));
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
      await runMaintenance('pre-ripristino', () => db.restoreJson(backup, req.user));
      realtime.broadcast({ event: 'database.restored' });
      return res.json({ message: 'Backup ripristinato' });
    } catch (error) {
      return respondError(res, error);
    }
  });
  app.post('/api/backup/clear', authenticateToken, requirePermission('settings.edit'), async (req, res) => {
    try {
      await runMaintenance('pre-cancellazione', () => db.restoreJson({
        data: Object.fromEntries(ENTITY_TYPES.map((type) => [type, []])),
      }, req.user));
      realtime.broadcast({ event: 'database.restored' });
      return res.json({ message: 'Dati cancellati' });
    } catch (error) {
      return respondError(res, error);
    }
  });
  app.get('/api/backups', authenticateToken, requirePermission('settings.view'), (req, res) => res.json(db.listSnapshots()));
  app.post('/api/backups', authenticateToken, requirePermission('settings.edit'), async (req, res) => {
    try {
      await drainUserMutations();
      return res.status(201).json(await db.createSnapshot(req.body?.label || 'manuale'));
    } catch (error) {
      return respondError(res, error);
    }
  });
  app.post('/api/backups/:name/restore', authenticateToken, requirePermission('settings.edit'), async (req, res) => {
    try {
      const snapshot = await runMaintenance(
        'pre-ripristino',
        () => db.restoreSnapshot(req.params.name, req.user),
      );
      realtime.broadcast({ event: 'database.restored', snapshot });
      return res.json(snapshot);
    } catch (error) {
      return respondError(res, error);
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

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(requestedPort, host, resolve);
    });
  } catch (error) {
    for (const client of realtime.wss.clients) client.terminate();
    db.close();
    throw error;
  }
  const actualPort = server.address().port;

  const ensureDailyBackup = async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const alreadyCreated = db.listSnapshots().some(
        (item) => item.createdAt.startsWith(today) && item.label === 'automatico',
      );
      if (!alreadyCreated) {
        await drainUserMutations();
        await db.createSnapshot('automatico');
      }
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
