const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const WebSocket = require('ws');
const { renderQuoteDocument } = require('./quote-document');
const { createGmailDraftService } = require('./gmail-drafts');
const { createGoogleDriveBackupService } = require('./google-drive-backups');
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
  rotateAuthEpoch,
  getAuthEpoch,
} = require('./middleware/auth');
const { MutationBarrier } = require('./mutation-barrier');
const { checkForServerUpdate, applyServerUpdate } = require('./self-update');
const { gracefulShutdown } = require('./shutdown-runtime');
const {
  canViewFinancials,
  ensureRolePermissions,
  hasEntityPermission,
  permissionForType,
} = require('./access-policy');

const ROUTES = {
  clients: { type: 'client', permission: 'clients' },
  orders: { type: 'order', permission: 'orders' },
  projects: { type: 'project', permission: 'projects' },
  materials: { type: 'material', permission: 'materials' },
  quotes: { type: 'quote', permission: 'quotes' },
  'quote-templates': { type: 'quote_template', permission: 'quotes' },
  invoices: { type: 'invoice', permission: 'invoices' },
  appointments: { type: 'appointment', permission: 'calendar' },
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
  'amount', 'bankAccount', 'budget', 'cost', 'discount', 'fiscalCode',
  'iban', 'margin', 'minPrice', 'paymentDetails', 'price', 'profit',
  'purchasePrice', 'salePrice', 'subtotal', 'taxRate', 'taxTotal', 'total',
  'totalPrice', 'unitPrice', 'vatNumber',
]);

const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_ATTEMPT_MAX_ENTRIES = 1000;
const LOGIN_IDENTITY_MAX_LENGTH = 128;
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
const hasActiveAdmin = () => readUsers().some((user) => user.role === 'admin' && user.isActive);
const createBootstrapAdmin = async (credentials) => {
  if (!credentials || hasActiveAdmin()) return false;
  const username = String(credentials.username || '').trim();
  const password = String(credentials.password || '');
  const email = String(credentials.email || '').trim();
  const firstName = String(credentials.firstName || '').trim();
  const lastName = String(credentials.lastName || '').trim();
  if (!username || password.length < 10 || !validEmail(email) || !firstName || !lastName) {
    throw new Error('Credenziali amministratore iniziale non valide');
  }
  const passwordHash = await hashPassword(password);
  await mutateUsers(async (users) => {
    if (users.some((user) => user.role === 'admin' && user.isActive)) return { write: false };
    users.push({
      id: crypto.randomUUID(),
      username,
      email,
      password: passwordHash,
      firstName,
      lastName,
      role: 'admin',
      permissions: ADMIN_PERMISSIONS,
      isActive: true,
      sessionVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return { value: true };
  });
  return true;
};
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const hasAny = (object, keys) => keys.some((key) => hasOwn(object, key));
const isLoopback = (req) => [
  '127.0.0.1', '::1', '::ffff:127.0.0.1',
].includes(req.socket.remoteAddress);
const secureEqual = (left, right) => {
  const first = Buffer.from(String(left || ''));
  const second = Buffer.from(String(right || ''));
  return first.length > 0
    && first.length === second.length
    && crypto.timingSafeEqual(first, second);
};
const canonicalIdentity = (value) => String(value || '').trim().toLowerCase();
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const normalizePermissions = (value) => {
  if (!Array.isArray(value)) {
    const error = new Error('L’elenco permessi non è valido');
    error.status = 400;
    throw error;
  }
  const permissions = [...new Set(value.map((entry) => String(entry).trim()).filter(Boolean))];
  const unknown = permissions.filter((permission) => !ADMIN_PERMISSIONS.includes(permission));
  if (unknown.length) {
    const error = new Error(`Permessi non riconosciuti: ${unknown.join(', ')}`);
    error.status = 400;
    throw error;
  }
  return permissions;
};

const numeric = (value, { strict = false, field = 'valore' } = {}) => {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    if (!strict) return 0;
  }
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
  const parsed = Number(normalized);
  if (Number.isFinite(parsed)) return parsed;
  if (!strict) return 0;
  const error = new Error(`${field} non è un numero valido`);
  error.status = 400;
  throw error;
};

const localDateKey = (value) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return String(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
};
const parseLocalDay = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
  return localDateKey(date) === String(value) ? date : null;
};
const localToday = () => localDateKey(new Date());
const dateKey = localDateKey;
const betweenDates = (value, start, end) => {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp >= start.getTime() && timestamp <= end.getTime();
};
const addDays = (date, days) => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};

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
      quantity: numeric(item.quantity, { strict: true, field: 'quantità' }),
      unitPrice: numeric(item.unitPrice, { strict: true, field: 'prezzo unitario' }),
      taxRate: numeric(item.taxRate, { strict: true, field: 'aliquota IVA' }),
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
      const unitPrice = numeric(data.unitPrice ?? data.price, { strict: true, field: 'prezzo unitario' });
      data.unitPrice = unitPrice;
      data.price = unitPrice;
    }
    if (defaults || hasAny(data, ['stockQuantity', 'quantity', 'stock'])) {
      const stockQuantity = numeric(data.stockQuantity ?? data.quantity ?? data.stock, { strict: true, field: 'quantità disponibile' });
      data.stockQuantity = stockQuantity;
      data.quantity = stockQuantity;
      data.stock = stockQuantity;
    }
    if (defaults || hasAny(data, ['minStockLevel', 'minQuantity'])) {
      const minStockLevel = numeric(data.minStockLevel ?? data.minQuantity ?? 10, { strict: true, field: 'scorta minima' });
      data.minStockLevel = minStockLevel;
      data.minQuantity = minStockLevel;
    }
  }
  if (type === 'appointment') {
    data.type = 'appointment';
    data.entityType = 'appointment';
    if (hasOwn(data, 'title')) data.title = String(data.title || '').trim();
  }
  if (type === 'quote_template') {
    data.type = 'quote_template';
    data.entityType = 'quote_template';
    if (hasOwn(data, 'name')) data.name = String(data.name || '').trim();
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
    if (type === 'project' && hasOwn(data, 'budget')) data.budget = numeric(data.budget, { strict: true, field: 'budget' });
    if (hasAny(data, ['amount', 'total'])) data.amount = numeric(data.amount ?? data.total, { strict: true, field: 'importo' });
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
    appointment: ['title', 'startAt', 'endAt'],
    quote_template: ['name'],
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
  if (['quote', 'invoice'].includes(type)) {
    payload.items.forEach((item, index) => {
      if (!String(item.description || '').trim()) {
        const error = new Error(`Descrizione mancante nella voce ${index + 1}`);
        error.status = 400;
        throw error;
      }
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        const error = new Error(`Quantità non valida nella voce ${index + 1}`);
        error.status = 400;
        throw error;
      }
      if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
        const error = new Error(`Prezzo non valido nella voce ${index + 1}`);
        error.status = 400;
        throw error;
      }
      if (type === 'invoice' && (!Number.isFinite(item.taxRate) || item.taxRate < 0 || item.taxRate > 100)) {
        const error = new Error(`Aliquota IVA non valida nella voce ${index + 1}`);
        error.status = 400;
        throw error;
      }
    });
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
  if (type === 'appointment') {
    const start = new Date(payload.startAt);
    const end = new Date(payload.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      const error = new Error('Intervallo appuntamento non valido');
      error.status = 400;
      throw error;
    }
  }
};

const expectedVersionFrom = (req, required = false) => {
  const raw = req.get('If-Match') || req.body?.expectedVersion || req.body?.version;
  if (raw == null || raw === '') {
    if (!required) return null;
    const error = new Error('Versione del record richiesta');
    error.status = 428;
    throw error;
  }
  const parsed = Number(String(raw).replace(/"/g, ''));
  if (!Number.isInteger(parsed) || parsed < 1) {
    const error = new Error('Versione del record non valida');
    error.status = 400;
    throw error;
  }
  return parsed;
};
const operationIdFrom = (req, scope) => {
  const operationId = req.get('X-Operation-Id') || req.body?.operationId || null;
  return operationId ? `${scope}:${operationId}` : null;
};
const canViewAuditEntry = (user, item) => item.entityType === 'database'
  ? user?.role === 'admin' || user?.permissions?.includes('settings.edit')
  : hasEntityPermission(user, item.entityType, 'view');

const normalizeBackupPayload = (raw) => {
  if (!raw?.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) return raw;
  const data = raw.data;
  // I backup completi creati prima di calendario e modelli Word restano validi.
  // Un backup parziale continua invece a essere rifiutato da restoreJson.
  const previousEntityTypes = ['client', 'order', 'project', 'material', 'quote', 'invoice'];
  if (previousEntityTypes.every((type) => Array.isArray(data[type]))) {
    return {
      ...raw,
      data: {
        ...data,
        appointment: Array.isArray(data.appointment) ? data.appointment : [],
        quote_template: Array.isArray(data.quote_template) ? data.quote_template : [],
      },
    };
  }
  if (ENTITY_TYPES.some((type) => Object.prototype.hasOwnProperty.call(data, type))) return raw;

  const legacyKeys = ['clients', 'orders', 'projects', 'materials', 'quotes', 'invoices'];
  if (!legacyKeys.some((key) => Object.prototype.hasOwnProperty.call(data, key))) return raw;
  for (const key of legacyKeys) {
    if (Object.prototype.hasOwnProperty.call(data, key) && !Array.isArray(data[key])) {
      const error = new Error(`La sezione legacy ${key} del backup non è valida`);
      error.status = 400;
      throw error;
    }
  }
  const legacyOrders = Array.isArray(data.orders) ? data.orders : [];
  const typedOrders = (type) => legacyOrders.filter((item) => item?.type === type);
  return {
    ...raw,
    data: {
      client: Array.isArray(data.clients) ? data.clients : [],
      order: legacyOrders.filter((item) => !item?.type || item.type === 'order'),
      project: Array.isArray(data.projects) ? data.projects : typedOrders('project'),
      material: Array.isArray(data.materials) ? data.materials : [],
      quote: Array.isArray(data.quotes) ? data.quotes : typedOrders('quote'),
      invoice: Array.isArray(data.invoices) ? data.invoices : typedOrders('invoice'),
    },
  };
};

const createRealtime = (server) => {
  const wss = new WebSocket.Server({ server, path: '/ws', maxPayload: 8192 });
  wss.on('connection', (socket) => {
    if (wss.clients.size > 100) {
      socket.close(1013, 'Troppe connessioni');
      return;
    }

    const authenticationTimeout = setTimeout(() => {
      if (!socket.authToken) socket.close(4001, 'Autenticazione richiesta');
    }, 5000);

    socket.on('message', (message) => {
      const text = message.toString();
      if (!socket.authToken) {
        try {
          const payload = JSON.parse(text);
          if (payload?.type !== 'auth' || !payload?.token) {
            socket.close(4001, 'Autenticazione richiesta');
            return;
          }
          const user = verifyToken(payload.token);
          if (!user) {
            socket.close(4001, 'Token non valido');
            return;
          }
          socket.authToken = payload.token;
          clearTimeout(authenticationTimeout);
          socket.send(JSON.stringify({ event: 'connected', timestamp: new Date().toISOString() }));
        } catch {
          socket.close(4001, 'Autenticazione richiesta');
        }
        return;
      }
      if (text === 'ping') socket.send('pong');
    });
    socket.on('close', () => clearTimeout(authenticationTimeout));
  });

  const broadcast = (payload, requiredPermission = null) => {
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN || !client.authToken) continue;
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
  const gmail = options.gmail || createGmailDraftService({
    dataDir,
    // Google OAuth per app desktop accetta il callback solo sul loopback HTTP.
    // Il codice resta locale, è monouso e vincolato al state/PKCE.
    callbackUrl: options.gmailCallbackUrl || `http://127.0.0.1:${requestedPort}/oauth2/gmail`,
  });
  const googleDriveBackups = options.googleDriveBackups || createGoogleDriveBackupService({ dataDir, google: gmail });
  const setupSecret = options.setupSecret || process.env.CRM_SETUP_SECRET || null;
  const webRoot = options.webRoot && fs.existsSync(path.join(options.webRoot, 'index.html'))
    ? path.resolve(options.webRoot)
    : null;
  const webOrigins = new Set((Array.isArray(options.webOrigins) ? options.webOrigins : [])
    .map((origin) => String(origin || '').replace(/\/$/, ''))
    .filter(Boolean));

  configureAuth({ dataDir });
  await createBootstrapAdmin(options.bootstrapAdmin || null);
  // Aggiorna gli amministratori già esistenti con la nuova sezione, senza
  // alterare ruoli manager/operaio o le loro configurazioni personalizzate.
  if (hasActiveAdmin()) {
    await mutateUsers(async (users) => {
      let changed = false;
      for (const user of users) {
        if (user.role !== 'admin') continue;
        const required = ['calendar.view', 'calendar.create', 'calendar.edit', 'calendar.delete'];
        const permissions = [...new Set([...(user.permissions || []), ...required])];
        if (permissions.length !== (user.permissions || []).length) {
          user.permissions = permissions;
          user.updatedAt = new Date().toISOString();
          changed = true;
        }
      }
      return changed ? { value: true } : { write: false };
    });
  }
  const mutationBarrier = new MutationBarrier({ timeoutMs: 30000 });
  const db = new CrmDatabase({ dataDir, backupDir, attachmentsDir });
  db.migrateLegacy(dataDir);

  const app = express();
  app.disable('x-powered-by');
  const corsOptions = {
    origin(origin, callback) {
      const allowed = !origin
        || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin)
        || webOrigins.has(String(origin).replace(/\/$/, ''));
      if (allowed) return callback(null, true);
      const error = new Error('Origine web non autorizzata');
      error.status = 403;
      return callback(error);
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 'Authorization', 'If-Match',
      'X-Operation-Id', 'X-CRM-Setup-Secret',
    ],
    maxAge: 600,
  };
  app.use(cors(corsOptions));
  // Full database imports can be large, but must never be parsed for an
  // unauthenticated network peer. Every other JSON request is deliberately
  // small so concurrent anonymous bodies cannot exhaust the central server.
  app.use('/api/backup', authenticateToken, requireRole('admin'), express.json({ limit: '25mb' }));
  app.use('/api/backup', authenticateToken, requireRole('admin'), express.urlencoded({ extended: true, limit: '25mb' }));
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: true, limit: '64kb' }));

  const isMaintenanceControlRequest = (req) => {
    if (req.method !== 'POST') return false;
    const route = String(req.originalUrl || '').split('?')[0];
    return route === '/api/backups'
      || route === '/api/backup/import'
      || route === '/api/backup/restore'
      || route === '/api/backup/clear'
      || route === '/api/integrations/google-drive-backups/run'
      || /^\/api\/backups\/[^/]+\/restore$/.test(route);
  };
  app.use('/api', (req, res, next) => {
    const healthRequest = req.path === '/health';
    const controlRequest = isMaintenanceControlRequest(req);
    if (mutationBarrier.isMaintenance && !healthRequest && !controlRequest && req.method !== 'OPTIONS') {
      return res.status(503).json({ error: 'Server in manutenzione: riprovare tra pochi secondi' });
    }
    if (healthRequest || controlRequest || req.method === 'OPTIONS') return next();

    const release = mutationBarrier.enterRequest();
    if (!release) {
      return res.status(503).json({ error: 'Server in manutenzione: riprovare tra pochi secondi' });
    }
    res.once('finish', release);
    res.once('close', release);
    return next();
  });

  const server = options.tls?.key && options.tls?.cert
    ? https.createServer({ key: options.tls.key, cert: options.tls.cert }, app)
    : http.createServer(app);
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
    limits: { fileSize: 25 * 1024 * 1024 },
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
  const runMaintenance = (snapshotLabel, action) => mutationBarrier.runMaintenance(async () => {
    await drainUserMutations();
    if (snapshotLabel) await db.createSnapshot(snapshotLabel);
    return action();
  });
  let googleDriveBackupQueue = Promise.resolve();
  const runGoogleDriveBackup = (force = false) => {
    const task = googleDriveBackupQueue.then(async () => {
      if (!force && !googleDriveBackups.isDue()) return null;
      const status = googleDriveBackups.status();
      if (!status.enabled) throw Object.assign(new Error('Backup Google Drive disattivato'), { status: 409 });
      if (!status.connected) throw Object.assign(new Error('Ricollega account Google dal PC server per autorizzare Google Drive'), { status: 409 });
      const snapshot = await runMaintenance(null, () => db.createSnapshot('google-drive'));
      return googleDriveBackups.uploadSnapshot({
        snapshot,
        snapshotDirectory: path.join(backupDir, snapshot.name),
      });
    });
    googleDriveBackupQueue = task.catch(() => undefined);
    return task;
  };

  app.get('/api/health', (req, res) => res.json({
    status: mutationBarrier.isMaintenance ? 'maintenance' : 'ok',
    version: '2.4.1',
    mode: 'central-server',
    hostname: options.serverName || 'crm-marmeria',
    serverId: options.serverId || null,
    tlsFingerprint: options.tls?.fingerprint || null,
    port: server.address()?.port || requestedPort,
    timestamp: new Date().toISOString(),
    websocket: true,
    maintenance: mutationBarrier.isMaintenance,
    dataEpoch: getAuthEpoch(),
    setupRequired: !hasActiveAdmin(),
  }));
  app.head('/api/health', (req, res) => res.sendStatus(200));

  app.post('/api/auth/login', async (req, res) => {
    try {
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '');
      if (username.length > LOGIN_IDENTITY_MAX_LENGTH || password.length > 1024) {
        return res.status(400).json({ error: 'Credenziali non valide' });
      }
      if (!username || !password) {
        return res.status(400).json({ error: 'Username e password richiesti' });
      }

      if (!hasActiveAdmin()) {
        if (!isLoopback(req)) {
          return res.status(403).json({
            error: 'La configurazione iniziale deve essere completata sul PC principale',
          });
        }
        if (!setupSecret || !secureEqual(req.get('X-CRM-Setup-Secret'), setupSecret)) {
          return res.status(403).json({
            error: 'Configurazione iniziale consentita soltanto dall’app desktop principale',
          });
        }
        if (password.length < 10) {
          return res.status(400).json({ error: 'La password iniziale deve contenere almeno 10 caratteri' });
        }
        const email = String(req.body?.email || `${username}@crm.local`).trim();
        const firstName = String(req.body?.firstName || 'Amministratore').trim();
        const lastName = String(req.body?.lastName || 'Sistema').trim();
        if (!validEmail(email) || !firstName || !lastName) {
          return res.status(400).json({ error: 'Nome, cognome ed email validi sono richiesti' });
        }
        const passwordHash = await hashPassword(password);
        const firstUser = await mutateUsers(async (users) => {
          if (users.some((entry) => entry.role === 'admin' && entry.isActive)) {
            const error = new Error('Configurazione iniziale già completata');
            error.status = 409;
            throw error;
          }
          if (users.some((entry) => (
            canonicalIdentity(entry.username) === canonicalIdentity(username)
            || canonicalIdentity(entry.email) === canonicalIdentity(email)
          ))) {
            const error = new Error('Username o email già utilizzati da un account esistente');
            error.status = 400;
            throw error;
          }
          const user = {
            id: crypto.randomUUID(),
            username,
            email,
            password: passwordHash,
            firstName,
            lastName,
            role: 'admin',
            permissions: ADMIN_PERMISSIONS,
            isActive: true,
            sessionVersion: 1,
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
      if (loginAttempts.size >= LOGIN_ATTEMPT_MAX_ENTRIES) {
        const cutoff = Date.now() - LOGIN_WINDOW_MS;
        for (const [attemptKey, value] of loginAttempts) {
          if (value.startedAt < cutoff) loginAttempts.delete(attemptKey);
        }
        while (loginAttempts.size >= LOGIN_ATTEMPT_MAX_ENTRIES) {
          const oldest = loginAttempts.keys().next().value;
          if (!oldest) break;
          loginAttempts.delete(oldest);
        }
      }

      const user = findUserByCredentials(username);
      if (!user || !(await verifyPassword(password, user.password))) {
        const current = loginAttempts.get(key);
        // Refresh insertion order so eviction removes the least recently used
        // key while retaining normal per-user throttling behavior.
        if (current) loginAttempts.delete(key);
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
      const updates = {};
      for (const key of ['username', 'email', 'firstName', 'lastName']) {
        if (req.body[key] !== undefined) updates[key] = String(req.body[key]).trim();
      }
      if ((updates.username !== undefined && !updates.username)
        || (updates.email !== undefined && !validEmail(updates.email))
        || (updates.firstName !== undefined && !updates.firstName)
        || (updates.lastName !== undefined && !updates.lastName)) {
        return res.status(400).json({ error: 'Dati profilo non validi' });
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
          && ((updates.username && canonicalIdentity(user.username) === canonicalIdentity(updates.username))
            || (updates.email && canonicalIdentity(user.email) === canonicalIdentity(updates.email)))
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
      const username = String(req.body?.username || '').trim();
      const email = String(req.body?.email || '').trim();
      const password = String(req.body?.password || '');
      const firstName = String(req.body?.firstName || '').trim();
      const lastName = String(req.body?.lastName || '').trim();
      const role = String(req.body?.role || '');
      if (!username || !validEmail(email) || !password || !firstName || !lastName || !role) {
        return res.status(400).json({ error: 'Tutti i campi devono essere validi' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'La password deve contenere almeno 8 caratteri' });
      }
      if (!['admin', 'manager', 'worker'].includes(role)) {
        return res.status(400).json({ error: 'Ruolo non valido' });
      }
      const permissions = ensureRolePermissions(role, normalizePermissions(req.body?.permissions || []));
      const passwordHash = await hashPassword(password);
      const createdUser = await mutateUsers(async (users) => {
        if (users.some((user) => (
          canonicalIdentity(user.username) === canonicalIdentity(username)
          || canonicalIdentity(user.email) === canonicalIdentity(email)
        ))) {
          const error = new Error('Username o email già esistenti');
          error.status = 400;
          throw error;
        }
        const createdAt = new Date().toISOString();
        const created = {
          id: crypto.randomUUID(),
          username,
          email,
          password: passwordHash,
          firstName,
          lastName,
          role,
          permissions,
          isActive: true,
          sessionVersion: 1,
          createdAt,
          updatedAt: createdAt,
        };
        users.push(created);
        return { value: created };
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
      if (req.body.role !== undefined && !['admin', 'manager', 'worker'].includes(String(req.body.role))) {
        return res.status(400).json({ error: 'Ruolo non valido' });
      }
      if (req.body.isActive !== undefined && typeof req.body.isActive !== 'boolean') {
        return res.status(400).json({ error: 'Stato account non valido' });
      }
      const passwordHash = req.body.password ? await hashPassword(String(req.body.password)) : null;
      const updatedUser = await mutateUsers(async (users) => {
        const index = users.findIndex((user) => String(user.id) === String(req.params.id));
        if (index < 0) {
          const error = new Error('Utente non trovato');
          error.status = 404;
          throw error;
        }
        const previous = users[index];
        const updates = {};
        for (const key of ['username', 'email', 'firstName', 'lastName']) {
          if (req.body[key] !== undefined) updates[key] = String(req.body[key]).trim();
        }
        if ((updates.username !== undefined && !updates.username)
          || (updates.email !== undefined && !validEmail(updates.email))
          || (updates.firstName !== undefined && !updates.firstName)
          || (updates.lastName !== undefined && !updates.lastName)) {
          const error = new Error('Dati account non validi');
          error.status = 400;
          throw error;
        }
        if (req.body.role !== undefined) updates.role = String(req.body.role);
        if (req.body.permissions !== undefined) {
          updates.permissions = ensureRolePermissions(
            String(req.body.role ?? previous.role),
            normalizePermissions(req.body.permissions),
          );
        } else if (req.body.role !== undefined) {
          updates.permissions = ensureRolePermissions(String(req.body.role), previous.permissions || []);
        }
        if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
        if (users.some((user, userIndex) => (
          userIndex !== index
          && ((updates.username && canonicalIdentity(user.username) === canonicalIdentity(updates.username))
            || (updates.email && canonicalIdentity(user.email) === canonicalIdentity(updates.email)))
        ))) {
          const error = new Error('Username o email già esistenti');
          error.status = 400;
          throw error;
        }
        const securityChanged = Boolean(passwordHash)
          || (updates.role !== undefined && updates.role !== previous.role)
          || (updates.isActive !== undefined && updates.isActive !== previous.isActive)
          || (updates.permissions !== undefined
            && JSON.stringify(updates.permissions) !== JSON.stringify(previous.permissions || []));
        users[index] = {
          ...previous,
          ...updates,
          id: previous.id,
          password: passwordHash || previous.password,
          sessionVersion: securityChanged
            ? Number(previous.sessionVersion || 1) + 1
            : Number(previous.sessionVersion || 1),
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
        'order', req.params.id, patch, expectedVersionFrom(req, true), req.user,
        operationIdFrom(req, `order:status:${req.params.id}`),
      );
      if (!result.replayed) {
        realtime.broadcast({
          event: 'orders.updated', entityType: 'order', item: result.item, actor: publicActor(req.user),
        }, 'orders.view');
      } else {
        res.set('X-Idempotent-Replay', 'true');
      }
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
        if (!result.replayed) {
          realtime.broadcast({
            event: `${route}.created`, entityType: config.type, item: result.item, actor: publicActor(req.user),
          }, `${config.permission}.view`);
        } else {
          res.set('X-Idempotent-Replay', 'true');
        }
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
          config.type, req.params.id, patch, expectedVersionFrom(req, true), req.user,
          operationIdFrom(req, `${config.type}:update:${req.params.id}`),
        );
        if (!result.replayed) {
          realtime.broadcast({
            event: `${route}.updated`, entityType: config.type, item: result.item, actor: publicActor(req.user),
          }, `${config.permission}.view`);
        } else {
          res.set('X-Idempotent-Replay', 'true');
        }
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
          config.type, req.params.id, expectedVersionFrom(req, true), req.user,
          operationIdFrom(req, `${config.type}:delete:${req.params.id}`),
        );
        if (!result.replayed) {
          realtime.broadcast({
            event: `${route}.deleted`, entityType: config.type, id: result.id, actor: publicActor(req.user),
          }, `${config.permission}.view`);
        } else {
          res.set('X-Idempotent-Replay', 'true');
        }
        return res.json(result);
      } catch (error) {
        return respondError(res, error);
      }
    });
  }

  const quoteWordDocument = (quoteId, requestedTemplateId = '', { requireCustomerEmail = false } = {}) => {
    const quote = db.get('quote', quoteId);
    if (!quote) throw Object.assign(new Error('Preventivo non trovato'), { status: 404 });
    const templateId = String(requestedTemplateId || quote.templateId || '').trim();
    if (!templateId) throw Object.assign(new Error('Seleziona un modello Word prima di creare il preventivo'), { status: 400 });
    const template = db.get('quote_template', templateId);
    if (!template) throw Object.assign(new Error('Modello Word non trovato'), { status: 404 });
    const attachment = db.listAttachments('quote_template', templateId)
      .map((item) => db.getAttachment(item.id))
      .find((item) => item && /\.docx$/i.test(item.originalName));
    if (!attachment || !fs.existsSync(attachment.absolutePath)) {
      throw Object.assign(new Error('Il modello non contiene un file .docx valido'), { status: 409 });
    }
    const customer = quote.customerId ? db.get('client', quote.customerId) : null;
    if (requireCustomerEmail && !customer?.email) throw Object.assign(new Error('Il cliente non ha un indirizzo email valido'), { status: 400 });
    const project = quote.projectId ? db.get('project', quote.projectId) : null;
    const document = renderQuoteDocument({ templatePath: attachment.absolutePath, quote, customer, project });
    const number = String(quote.quoteNumber || quote.id).replace(/[^a-zA-Z0-9_-]+/g, '-');
    return { quote, customer, document, fileName: `preventivo-${number}.docx` };
  };

  app.get('/api/quotes/:id/document', authenticateToken, requirePermission('quotes.view'), (req, res) => {
    try {
      const { document, fileName } = quoteWordDocument(req.params.id, req.query.templateId);
      res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.attachment(fileName);
      return res.send(document);
    } catch (error) {
      error.status = error.status || 400;
      return respondError(res, error);
    }
  });

  app.post('/api/quotes/:id/gmail-draft', authenticateToken, requirePermission('quotes.edit'), async (req, res) => {
    try {
      const { quote, customer, document, fileName } = quoteWordDocument(req.params.id, req.body?.templateId, { requireCustomerEmail: true });
      const subject = String(req.body?.subject || `Preventivo ${quote.quoteNumber || ''}`).trim();
      const text = String(req.body?.text || '').trim();
      if (!subject || !text) return res.status(400).json({ error: 'Oggetto e messaggio email sono obbligatori' });
      const draft = await gmail.createDraft({ to: customer.email, subject, text, attachmentName: fileName, attachment: document });
      return res.status(201).json(draft);
    } catch (error) {
      return respondError(res, error);
    }
  });

  const visibleList = (user, type) => (
    hasEntityPermission(user, type, 'view') ? db.list(type) : []
  );
  const allWork = (user) => [
    ...visibleList(user, 'project'),
    ...visibleList(user, 'order'),
  ];
  const invoiceRevenue = (user, start, end) => (
    canViewFinancials(user)
      ? db.list('invoice')
        .filter((item) => betweenDates(item.date || item.createdAt, start, end))
        .reduce((sum, item) => sum + numeric(item.total ?? item.amount), 0)
      : 0
  );

  app.get('/api/analytics/dashboard', authenticateToken, requirePermission('dashboard.view'), (req, res) => {
    const projects = visibleList(req.user, 'project');
    const materials = visibleList(req.user, 'material');
    const clients = visibleList(req.user, 'client');
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const current = new Date();
    res.json({
      totalProjects: projects.length,
      totalClients: clients.length,
      totalMaterials: materials.length,
      totalRevenue: canViewFinancials(req.user) ? invoiceRevenue(req.user, monthStart, current) : null,
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
    const date = req.params.date || localToday();
    const work = allWork(req.user);
    const materials = visibleList(req.user, 'material');
    const dayStart = parseLocalDay(date);
    if (!dayStart) return res.status(400).json({ error: 'Data non valida' });
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);
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
      revenue: canViewFinancials(req.user) ? invoiceRevenue(req.user, dayStart, dayEnd) : 0,
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
    const start = parseLocalDay(req.params.weekStart || localToday());
    if (!start) return res.status(400).json({ error: 'Data non valida' });
    const end = addDays(start, 6);
    end.setHours(23, 59, 59, 999);
    const work = allWork().filter((item) => betweenDates(item.createdAt, start, end));
    const completed = work.filter((item) => item.status === 'Completato');
    const revenue = canViewFinancials(req.user) ? invoiceRevenue(req.user, start, end) : 0;
    res.json({
      weekStart: localDateKey(start),
      weekEnd: localDateKey(end),
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
    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    const work = allWork().filter((item) => betweenDates(item.createdAt, start, end));
    const completed = work.filter((item) => item.status === 'Completato');
    const revenue = canViewFinancials(req.user) ? invoiceRevenue(req.user, start, end) : 0;
    res.json({
      month: String(month).padStart(2, '0'),
      year,
      totalOrders: work.length,
      totalRevenue: revenue,
      newClients: visibleList(req.user, 'client').filter((item) => betweenDates(item.createdAt, start, end)).length,
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
    const metricAllowed = metric === 'revenue'
      ? canViewFinancials(req.user)
      : metric === 'clients'
        ? hasEntityPermission(req.user, 'client', 'view')
        : metric === 'orders'
          ? hasEntityPermission(req.user, 'project', 'view') || hasEntityPermission(req.user, 'order', 'view')
          : true;
    if (!metricAllowed) {
      return res.status(403).json({ error: 'Permessi insufficienti per la metrica richiesta' });
    }
    const start = parseLocalDay(String(
      req.query.startDate || localDateKey(new Date(Date.now() - 30 * 86400000)),
    ));
    const end = parseLocalDay(String(req.query.endDate || localToday()));
    if (!start || !end || start > end) {
      return res.status(400).json({ error: 'Intervallo date non valido' });
    }
    if ((end.getTime() - start.getTime()) / 86400000 > 366) {
      return res.status(400).json({ error: 'Intervallo massimo: 366 giorni' });
    }
    const work = allWork(req.user);
    const clients = visibleList(req.user, 'client');
    const invoices = visibleList(req.user, 'invoice');
    const data = [];
    for (const current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
      const date = localDateKey(current);
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
      .filter((item) => canViewAuditEntry(req.user, item))
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

  app.get('/api/system/update/status', authenticateToken, requirePermission('settings.edit'), async (req, res) => {
    try {
      return res.json(await checkForServerUpdate());
    } catch (error) {
      return respondError(res, error);
    }
  });
  app.post('/api/system/update/check', authenticateToken, requirePermission('settings.edit'), async (req, res) => {
    try {
      return res.json(await checkForServerUpdate({ refresh: true }));
    } catch (error) {
      return respondError(res, error);
    }
  });
  app.post('/api/system/update/apply', authenticateToken, requirePermission('settings.edit'), async (req, res) => {
    try {
      const result = await applyServerUpdate();
      res.json(result);
      if (result.restartRequired && typeof options.onUpdateApplied === 'function') {
        setTimeout(() => options.onUpdateApplied(), 750);
      }
      return undefined;
    } catch (error) {
      return respondError(res, error);
    }
  });

  app.get('/api/integrations/gmail/status', authenticateToken, requirePermission('settings.edit'), (req, res) => res.json(gmail.status()));
  app.put('/api/integrations/gmail/config', authenticateToken, requirePermission('settings.edit'), (req, res) => {
    try {
      return res.json(gmail.configure({ clientId: req.body?.clientId }));
    } catch (error) {
      return respondError(res, error);
    }
  });
  app.post('/api/integrations/gmail/authorize', authenticateToken, requirePermission('settings.edit'), (req, res) => {
    try {
      if (!isLoopback(req)) return res.status(403).json({ error: 'Collega Gmail aprendo il CRM dal browser del PC server: http://localhost:3001' });
      return res.json(gmail.beginAuthorization());
    } catch (error) {
      return respondError(res, error);
    }
  });
  app.delete('/api/integrations/gmail', authenticateToken, requirePermission('settings.edit'), (req, res) => {
    try {
      return res.json(gmail.disconnect());
    } catch (error) {
      return respondError(res, error);
    }
  });
  app.get('/api/integrations/google-drive-backups/status', authenticateToken, requirePermission('settings.edit'), (req, res) => res.json(googleDriveBackups.status()));
  app.put('/api/integrations/google-drive-backups/config', authenticateToken, requirePermission('settings.edit'), (req, res) => {
    try {
      return res.json(googleDriveBackups.configure(req.body || {}));
    } catch (error) {
      return respondError(res, error);
    }
  });
  app.post('/api/integrations/google-drive-backups/run', authenticateToken, requirePermission('settings.edit'), async (req, res) => {
    try {
      return res.status(201).json(await runGoogleDriveBackup(true));
    } catch (error) {
      return respondError(res, error);
    }
  });
  app.get('/oauth2/gmail', async (req, res) => {
    try {
      if (!isLoopback(req)) return res.status(403).type('text').send('Autorizzazione Gmail consentita solo dal PC server.');
      if (req.query.error) return res.status(400).type('html').send('<!doctype html><title>CRM Marmeria</title><p>Autorizzazione Gmail annullata. Puoi chiudere questa finestra.</p>');
      await gmail.completeAuthorization({ code: req.query.code, state: req.query.state });
      return res.type('html').send('<!doctype html><title>CRM Marmeria</title><p>Gmail collegato. Puoi chiudere questa finestra e tornare al CRM.</p><script>window.close()</script>');
    } catch (error) {
      return res.status(error.status || 400).type('html').send('<!doctype html><title>CRM Marmeria</title><p>Collegamento Gmail non riuscito. Torna al CRM e riprova.</p>');
    }
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
  app.post('/api/entity-attachments/:type/:id', authenticateToken, ensureAttachmentEntity('edit'), upload.array('files'), (req, res) => {
    try {
      if (!req.files?.length) return res.status(400).json({ error: 'Nessun file ricevuto' });
      if (!db.get(req.params.type, req.params.id)) {
        removeUploadedFiles(req.files);
        return res.status(409).json({ error: 'L’elemento è stato eliminato durante il caricamento' });
      }
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

  app.get('/api/backup/export', authenticateToken, requireRole('admin'), (req, res) => res.json(db.exportJson()));
  app.post('/api/backup/import', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
      const backup = normalizeBackupPayload(req.body);
      await runMaintenance('pre-importazione', () => db.restoreJson(backup, req.user));
      rotateAuthEpoch();
      realtime.broadcast({ event: 'database.restored' });
      return res.json({ message: 'Backup importato' });
    } catch (error) {
      return respondError(res, error);
    }
  });
  app.get('/api/backup', authenticateToken, requireRole('admin'), (req, res) => res.json(db.exportJson()));
  app.post('/api/backup/restore', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
      const backup = normalizeBackupPayload(req.body);
      await runMaintenance('pre-ripristino', () => db.restoreJson(backup, req.user));
      rotateAuthEpoch();
      realtime.broadcast({ event: 'database.restored' });
      return res.json({ message: 'Backup ripristinato' });
    } catch (error) {
      return respondError(res, error);
    }
  });
  app.post('/api/backup/clear', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
      await runMaintenance('pre-cancellazione', () => db.restoreJson({
        data: Object.fromEntries(ENTITY_TYPES.map((type) => [type, []])),
      }, req.user));
      rotateAuthEpoch();
      realtime.broadcast({ event: 'database.restored' });
      return res.json({ message: 'Dati cancellati' });
    } catch (error) {
      return respondError(res, error);
    }
  });
  app.get('/api/backups', authenticateToken, requireRole('admin'), (req, res) => res.json(db.listSnapshots()));
  app.post('/api/backups', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
      const snapshot = await runMaintenance(null, () => db.createSnapshot(req.body?.label || 'manuale'));
      return res.status(201).json(snapshot);
    } catch (error) {
      return respondError(res, error);
    }
  });
  app.post('/api/backups/:name/restore', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
      const snapshot = await runMaintenance(
        'pre-ripristino',
        () => db.restoreSnapshot(req.params.name, req.user),
      );
      rotateAuthEpoch();
      realtime.broadcast({ event: 'database.restored', snapshot });
      return res.json(snapshot);
    } catch (error) {
      return respondError(res, error);
    }
  });

  if (webRoot) {
    app.use(express.static(webRoot, { index: 'index.html', fallthrough: true }));
    app.get('*', (req, res, next) => {
      if (req.path === '/ws' || req.path.startsWith('/api/')) return next();
      return res.sendFile(path.join(webRoot, 'index.html'));
    });
  }

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
      if (!hasActiveAdmin()) return;
      const today = localToday();
      const alreadyCreated = db.listSnapshots().some(
        (item) => localDateKey(item.createdAt) === today && item.label === 'automatico',
      );
      if (!alreadyCreated) {
        await runMaintenance(null, () => db.createSnapshot('automatico'));
      }
    } catch (error) {
      console.error('Backup automatico fallito:', error);
    }
  };
  await ensureDailyBackup();
  const backupTimer = setInterval(ensureDailyBackup, 60 * 60 * 1000);
  const googleDriveBackupTimer = setInterval(() => {
    void runGoogleDriveBackup(false).catch((error) => console.error('Backup Google Drive automatico fallito:', error.message));
  }, 15 * 60 * 1000);
  void runGoogleDriveBackup(false).catch((error) => console.error('Backup Google Drive automatico fallito:', error.message));

  return {
    app,
    server,
    db,
    googleDriveBackups,
    port: actualPort,
    host,
    close: async () => {
      clearInterval(googleDriveBackupTimer);
      return gracefulShutdown({
        barrier: mutationBarrier,
        server,
        websocketServer: realtime.wss,
        database: db,
        timer: backupTimer,
      });
    },
  };
}

module.exports = { createCrmServer };
