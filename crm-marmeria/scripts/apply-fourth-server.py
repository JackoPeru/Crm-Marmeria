from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if old not in text:
        raise RuntimeError(f'Pattern not found in {path}: {old[:160]!r}')
    path.write_text(text.replace(old, new, 1))


def replace_block(path: Path, start_marker: str, end_marker: str, replacement: str) -> None:
    text = path.read_text()
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    path.write_text(text[:start] + replacement + text[end:])


# ---------------------------------------------------------------------------
# server/app.js
# ---------------------------------------------------------------------------
app = ROOT / 'server/app.js'
replace_once(
    app,
    """  configureAuth,
  verifyToken,
} = require('./middleware/auth');
""",
    """  configureAuth,
  verifyToken,
  rotateAuthEpoch,
  getAuthEpoch,
} = require('./middleware/auth');
const { MutationBarrier } = require('./mutation-barrier');
""",
)
replace_once(
    app,
    """  'amount', 'budget', 'cost', 'fiscalCode', 'minPrice', 'paymentDetails',
  'price', 'purchasePrice', 'salePrice', 'subtotal', 'taxTotal', 'total',
  'totalPrice', 'unitPrice', 'vatNumber',
""",
    """  'amount', 'bankAccount', 'budget', 'cost', 'discount', 'fiscalCode',
  'iban', 'margin', 'minPrice', 'paymentDetails', 'price', 'profit',
  'purchasePrice', 'salePrice', 'subtotal', 'taxRate', 'taxTotal', 'total',
  'totalPrice', 'unitPrice', 'vatNumber',
""",
)
replace_once(
    app,
    """const numeric = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const compact = String(value ?? '').trim().replace(/[\\s€£$']/g, '');
  if (!compact) return 0;
  const comma = compact.lastIndexOf(',');
  const dot = compact.lastIndexOf('.');
  let normalized = compact;
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? compact.replace(/\\./g, '').replace(',', '.')
      : compact.replace(/,/g, '');
  } else if (comma >= 0) {
    normalized = compact.replace(',', '.');
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};
""",
    """const numeric = (value, { strict = false, field = 'valore' } = {}) => {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    if (!strict) return 0;
  }
  const compact = String(value ?? '').trim().replace(/[\\s€£$']/g, '');
  if (!compact) return 0;
  const comma = compact.lastIndexOf(',');
  const dot = compact.lastIndexOf('.');
  let normalized = compact;
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? compact.replace(/\\./g, '').replace(',', '.')
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
""",
)
replace_once(
    app,
    """const secureEqual = (left, right) => {
  const first = Buffer.from(String(left || ''));
  const second = Buffer.from(String(right || ''));
  return first.length > 0
    && first.length === second.length
    && crypto.timingSafeEqual(first, second);
};
""",
    """const secureEqual = (left, right) => {
  const first = Buffer.from(String(left || ''));
  const second = Buffer.from(String(right || ''));
  return first.length > 0
    && first.length === second.length
    && crypto.timingSafeEqual(first, second);
};
const canonicalIdentity = (value) => String(value || '').trim().toLowerCase();
const validEmail = (value) => /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(String(value || '').trim());
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
""",
)
# Strict input numbers at the API boundary.
text = app.read_text()
text = text.replace('quantity: numeric(item.quantity),', "quantity: numeric(item.quantity, { strict: true, field: 'quantità' }),")
text = text.replace('unitPrice: numeric(item.unitPrice),', "unitPrice: numeric(item.unitPrice, { strict: true, field: 'prezzo unitario' }),")
text = text.replace('taxRate: numeric(item.taxRate),', "taxRate: numeric(item.taxRate, { strict: true, field: 'aliquota IVA' }),")
text = text.replace('const unitPrice = numeric(data.unitPrice ?? data.price);', "const unitPrice = numeric(data.unitPrice ?? data.price, { strict: true, field: 'prezzo unitario' });")
text = text.replace('const stockQuantity = numeric(data.stockQuantity ?? data.quantity ?? data.stock);', "const stockQuantity = numeric(data.stockQuantity ?? data.quantity ?? data.stock, { strict: true, field: 'quantità disponibile' });")
text = text.replace('const minStockLevel = numeric(data.minStockLevel ?? data.minQuantity ?? 10);', "const minStockLevel = numeric(data.minStockLevel ?? data.minQuantity ?? 10, { strict: true, field: 'scorta minima' });")
text = text.replace("if (type === 'project' && hasOwn(data, 'budget')) data.budget = numeric(data.budget);", "if (type === 'project' && hasOwn(data, 'budget')) data.budget = numeric(data.budget, { strict: true, field: 'budget' });")
text = text.replace("if (hasAny(data, ['amount', 'total'])) data.amount = numeric(data.amount ?? data.total);", "if (hasAny(data, ['amount', 'total'])) data.amount = numeric(data.amount ?? data.total, { strict: true, field: 'importo' });")
app.write_text(text)

replace_once(
    app,
    """  if (['quote', 'invoice'].includes(type) && (!Array.isArray(payload.items) || !payload.items.length)) {
    const error = new Error('Inserire almeno una voce nel documento');
    error.status = 400;
    throw error;
  }
""",
    """  if (['quote', 'invoice'].includes(type) && (!Array.isArray(payload.items) || !payload.items.length)) {
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
""",
)
replace_once(
    app,
    """const expectedVersionFrom = (req) => {
  const raw = req.get('If-Match') || req.body?.expectedVersion || req.body?.version;
  if (raw == null || raw === '') return null;
  const parsed = Number(String(raw).replace(/\"/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};
""",
    """const expectedVersionFrom = (req, required = false) => {
  const raw = req.get('If-Match') || req.body?.expectedVersion || req.body?.version;
  if (raw == null || raw === '') {
    if (!required) return null;
    const error = new Error('Versione del record richiesta');
    error.status = 428;
    throw error;
  }
  const parsed = Number(String(raw).replace(/\"/g, ''));
  if (!Number.isInteger(parsed) || parsed < 1) {
    const error = new Error('Versione del record non valida');
    error.status = 400;
    throw error;
  }
  return parsed;
};
""",
)

realtime = r'''const createRealtime = (server) => {
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

'''
replace_block(app, 'const createRealtime = (server) => {', 'async function createCrmServer(options = {}) {', realtime)

replace_once(
    app,
    """  configureAuth({ dataDir });
  const db = new CrmDatabase({ dataDir, backupDir, attachmentsDir });
""",
    """  configureAuth({ dataDir });
  const mutationBarrier = new MutationBarrier({ timeoutMs: 30000 });
  const db = new CrmDatabase({ dataDir, backupDir, attachmentsDir });
""",
)

old_maintenance = """  let maintenanceMode = false;
  app.use('/api', (req, res, next) => {
    if (maintenanceMode && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return res.status(503).json({ error: 'Server in manutenzione: riprovare tra pochi secondi' });
    }
    return next();
  });
"""
new_maintenance = """  const isMaintenanceControlRequest = (req) => {
    if (req.method !== 'POST') return false;
    const route = String(req.originalUrl || '').split('?')[0];
    return route === '/api/backups'
      || route === '/api/backup/import'
      || route === '/api/backup/restore'
      || route === '/api/backup/clear'
      || /^\\/api\\/backups\\/[^/]+\\/restore$/.test(route);
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
"""
replace_once(app, old_maintenance, new_maintenance)
replace_once(
    app,
    """  const runMaintenance = async (snapshotLabel, action) => {
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
""",
    """  const runMaintenance = (snapshotLabel, action) => mutationBarrier.runMaintenance(async () => {
    await drainUserMutations();
    if (snapshotLabel) await db.createSnapshot(snapshotLabel);
    return action();
  });
""",
)
replace_once(app, "status: maintenanceMode ? 'maintenance' : 'ok',", "status: mutationBarrier.isMaintenance ? 'maintenance' : 'ok',")
replace_once(app, "maintenance: maintenanceMode,", "maintenance: mutationBarrier.isMaintenance,\n    dataEpoch: getAuthEpoch(),")

# First admin input normalization and session version.
replace_once(
    app,
    """        const passwordHash = await hashPassword(password);
        const firstUser = await mutateUsers(async (users) => {
""",
    """        const email = String(req.body?.email || `${username}@crm.local`).trim();
        const firstName = String(req.body?.firstName || 'Amministratore').trim();
        const lastName = String(req.body?.lastName || 'Sistema').trim();
        if (!validEmail(email) || !firstName || !lastName) {
          return res.status(400).json({ error: 'Nome, cognome ed email validi sono richiesti' });
        }
        const passwordHash = await hashPassword(password);
        const firstUser = await mutateUsers(async (users) => {
""",
)
replace_once(app, "email: String(req.body?.email || `${username}@crm.local`).trim(),", "email,")
replace_once(app, "firstName: String(req.body?.firstName || 'Amministratore').trim(),", "firstName,")
replace_once(app, "lastName: String(req.body?.lastName || 'Sistema').trim(),", "lastName,")
replace_once(app, "isActive: true,\n            createdAt:", "isActive: true,\n            sessionVersion: 1,\n            createdAt:")

account_block = r'''  app.put('/api/auth/profile', authenticateToken, async (req, res) => {
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
      const permissions = normalizePermissions(req.body?.permissions || []);
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
        if (req.body.permissions !== undefined) updates.permissions = normalizePermissions(req.body.permissions);
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

'''
replace_block(app, "  app.put('/api/auth/profile'", "  app.get('/api/clients/search'", account_block)

# All entity modifications require an explicit optimistic-concurrency version.
text = app.read_text().replace('expectedVersionFrom(req)', 'expectedVersionFrom(req, true)')
app.write_text(text)

# Recheck entity existence after asynchronous upload has completed.
replace_once(
    app,
    """      if (!req.files?.length) return res.status(400).json({ error: 'Nessun file ricevuto' });
      const items = db.addAttachments(req.files.map((file) => ({
""",
    """      if (!req.files?.length) return res.status(400).json({ error: 'Nessun file ricevuto' });
      if (!db.get(req.params.type, req.params.id)) {
        removeUploadedFiles(req.files);
        return res.status(409).json({ error: 'L’elemento è stato eliminato durante il caricamento' });
      }
      const items = db.addAttachments(req.files.map((file) => ({
""",
)

# Snapshot creation also runs with a fully drained request barrier.
replace_once(
    app,
    """  app.post('/api/backups', authenticateToken, requirePermission('settings.edit'), async (req, res) => {
    try {
      await drainUserMutations();
      return res.status(201).json(await db.createSnapshot(req.body?.label || 'manuale'));
    } catch (error) {
      return respondError(res, error);
    }
  });
""",
    """  app.post('/api/backups', authenticateToken, requirePermission('settings.edit'), async (req, res) => {
    try {
      const snapshot = await runMaintenance(null, () => db.createSnapshot(req.body?.label || 'manuale'));
      return res.status(201).json(snapshot);
    } catch (error) {
      return respondError(res, error);
    }
  });
""",
)

# Rotate both session and data generation after every destructive restore.
text = app.read_text()
for old in [
    "await runMaintenance('pre-importazione', () => db.restoreJson(req.body, req.user));\n      realtime.broadcast",
    "await runMaintenance('pre-ripristino', () => db.restoreJson(backup, req.user));\n      realtime.broadcast",
    "await runMaintenance('pre-cancellazione', () => db.restoreJson({\n        data: Object.fromEntries(ENTITY_TYPES.map((type) => [type, []])),\n      }, req.user));\n      realtime.broadcast",
]:
    if old not in text:
        raise RuntimeError(f'Restore pattern missing: {old[:80]}')
    text = text.replace(old, old.replace('\n      realtime.broadcast', '\n      rotateAuthEpoch();\n      realtime.broadcast'), 1)
old = """      const snapshot = await runMaintenance(
        'pre-ripristino',
        () => db.restoreSnapshot(req.params.name, req.user),
      );
      realtime.broadcast"""
new = """      const snapshot = await runMaintenance(
        'pre-ripristino',
        () => db.restoreSnapshot(req.params.name, req.user),
      );
      rotateAuthEpoch();
      realtime.broadcast"""
if old not in text:
    raise RuntimeError('Snapshot restore epoch pattern missing')
text = text.replace(old, new, 1)
app.write_text(text)

replace_once(
    app,
    """  const ensureDailyBackup = async () => {
    try {
      const today = localToday();
      const alreadyCreated = db.listSnapshots().some(
        (item) => localDateKey(item.createdAt) === today && item.label === 'automatico',
      );
      if (!alreadyCreated) {
        await drainUserMutations();
        await db.createSnapshot('automatico');
      }
    } catch (error) {
      console.error('Backup automatico fallito:', error);
    }
  };
""",
    """  const ensureDailyBackup = async () => {
    try {
      if (!readUsers().some((user) => user.role === 'admin' && user.isActive)) return;
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
""",
)


# ---------------------------------------------------------------------------
# server/restore-safety.js
# ---------------------------------------------------------------------------
restore = ROOT / 'server/restore-safety.js'
replace_once(
    restore,
    """const atomicWriteJson = (filePath, value) => {
""",
    """const syncTree = (target) => {
  if (!target || !fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) {
    const error = new Error(`Collegamento simbolico non consentito nel backup: ${target}`);
    error.status = 400;
    throw error;
  }
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) syncTree(path.join(target, entry));
    syncDirectory(target);
    return;
  }
  syncFile(target);
};

const atomicWriteJson = (filePath, value) => {
""",
)
replace_once(
    restore,
    """  syncFile,
  validateDatabase,
""",
    """  syncFile,
  syncTree,
  validateDatabase,
""",
)


# ---------------------------------------------------------------------------
# server/database.js
# ---------------------------------------------------------------------------
database = ROOT / 'server/database.js'
replace_once(
    database,
    """  restorePaths,
  validateDatabase,
""",
    """  restorePaths,
  syncDirectory,
  syncFile,
  syncTree,
  validateDatabase,
""",
)
# restore-safety must export syncDirectory as well; patched below.
replace_once(
    restore,
    """  restorePaths,
  syncFile,
""",
    """  restorePaths,
  syncDirectory,
  syncFile,
""",
)
replace_once(database, 'const parsed = Number.parseFloat(normalized);', 'const parsed = Number(normalized);')
replace_once(
    database,
    """    if (isInside(this.attachmentsDir, this.backupDir)) {
      throw new Error('La cartella dei backup non può trovarsi dentro la cartella allegati');
    }
""",
    """    if (isInside(this.attachmentsDir, this.backupDir)
      || isInside(this.backupDir, this.attachmentsDir)) {
      throw new Error('Le cartelle backup e allegati non possono contenersi a vicenda');
    }
""",
)

# Snapshot files are fully synchronized before the directory becomes visible.
replace_once(
    database,
    """      fs.writeFileSync(
        path.join(temporary, 'metadata.json'),
        JSON.stringify(metadata, null, 2),
      );
      fs.renameSync(temporary, destination);
      this.pruneSnapshots(30);
""",
    """      atomicWriteJson(path.join(temporary, 'metadata.json'), metadata);
      syncTree(temporary);
      fs.renameSync(temporary, destination);
      syncDirectory(this.backupDir);
      try {
        this.pruneSnapshots(30);
      } catch (error) {
        console.error('Pulizia vecchi snapshot fallita:', error);
      }
""",
)

# A committed restore is only declared after audit and disk synchronization.
text = database.read_text()
start = text.index('  restoreSnapshot(name, user) {')
end = text.index('\n  }\n\n}', start) + len('\n  }')
method = r'''  restoreSnapshot(name, user) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(String(name))) {
      const error = new Error('Nome backup non valido');
      error.status = 400;
      throw error;
    }

    const source = path.join(this.backupDir, String(name));
    const dbSource = path.join(source, 'crm-marmeria.db');
    const usersSource = path.join(source, 'users.json');
    const attachmentsSource = path.join(source, 'attachments');
    if (!fs.existsSync(dbSource)) {
      const error = new Error('Backup non trovato');
      error.status = 404;
      throw error;
    }

    const stageRoot = path.join(this.dataDir, `.restore-${crypto.randomUUID()}`);
    const stageDb = path.join(stageRoot, 'crm-marmeria.db');
    const stageUsers = path.join(stageRoot, 'users.json');
    const stageAttachments = path.join(stageRoot, 'attachments');
    const {
      journalPath,
      previousDb,
      previousUsers,
      previousAttachments,
    } = this.restorePaths;
    const journalBase = {
      stageRoot,
      previousDb,
      previousUsers,
      previousAttachments,
      snapshot: String(name),
      startedAt: now(),
    };
    let committed = false;
    fs.mkdirSync(stageRoot, { recursive: true });

    try {
      fs.copyFileSync(dbSource, stageDb);
      if (fs.existsSync(usersSource)) fs.copyFileSync(usersSource, stageUsers);
      else if (fs.existsSync(this.usersPath)) fs.copyFileSync(this.usersPath, stageUsers);
      else {
        const error = new Error('Il backup non contiene account e non esistono account correnti da conservare');
        error.status = 400;
        throw error;
      }

      if (fs.existsSync(attachmentsSource)) {
        fs.cpSync(attachmentsSource, stageAttachments, { recursive: true, verbatimSymlinks: true });
      } else if (fs.existsSync(this.attachmentsDir)) {
        fs.cpSync(this.attachmentsDir, stageAttachments, { recursive: true, verbatimSymlinks: true });
      } else {
        fs.mkdirSync(stageAttachments, { recursive: true });
      }

      validateDatabase(stageDb);
      validateUsers(stageUsers);
      syncTree(stageRoot);

      this.db.pragma('wal_checkpoint(TRUNCATE)');
      this.close();
      if (fs.existsSync(this.dbPath)) syncFile(this.dbPath);
      if (fs.existsSync(this.usersPath)) syncFile(this.usersPath);
      if (fs.existsSync(this.attachmentsDir)) syncTree(this.attachmentsDir);
      for (const suffix of ['-wal', '-shm']) fs.rmSync(`${this.dbPath}${suffix}`, { force: true });
      fs.rmSync(previousDb, { force: true });
      fs.rmSync(previousUsers, { force: true });
      fs.rmSync(previousAttachments, { recursive: true, force: true });

      atomicWriteJson(journalPath, { ...journalBase, state: 'swapping' });
      if (fs.existsSync(this.dbPath)) fs.renameSync(this.dbPath, previousDb);
      if (fs.existsSync(this.usersPath)) fs.renameSync(this.usersPath, previousUsers);
      if (fs.existsSync(this.attachmentsDir)) fs.renameSync(this.attachmentsDir, previousAttachments);

      fs.renameSync(stageDb, this.dbPath);
      fs.renameSync(stageUsers, this.usersPath);
      fs.renameSync(stageAttachments, this.attachmentsDir);
      syncDirectory(this.dataDir);

      validateDatabase(this.dbPath);
      validateUsers(this.usersPath);
      this.open();
      this.writeAudit({
        user,
        type: 'database',
        id: 'all',
        action: 'restore.snapshot',
        previous: null,
        next: { snapshot: String(name) },
      });
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      syncFile(this.dbPath);
      syncFile(this.usersPath);
      syncTree(this.attachmentsDir);

      atomicWriteJson(journalPath, { ...journalBase, state: 'committed' });
      committed = true;
      fs.rmSync(previousDb, { force: true });
      fs.rmSync(previousUsers, { force: true });
      fs.rmSync(previousAttachments, { recursive: true, force: true });
      fs.rmSync(journalPath, { force: true });
      syncDirectory(this.dataDir);
    } catch (error) {
      if (this.db?.open) this.close();
      if (!committed) {
        recoverInterruptedRestore({
          dataDir: this.dataDir,
          dbPath: this.dbPath,
          usersPath: this.usersPath,
          attachmentsDir: this.attachmentsDir,
        });
      }
      throw error;
    } finally {
      fs.rmSync(stageRoot, { recursive: true, force: true });
      if (!this.db?.open) this.open();
    }

    return this.listSnapshots().find((snapshot) => snapshot.name === name) || { name };
  }'''
database.write_text(text[:start] + method + text[end:])


# ---------------------------------------------------------------------------
# electron/discovery.cjs and main.cjs
# ---------------------------------------------------------------------------
discovery = ROOT / 'electron/discovery.cjs'
replace_once(
    discovery,
    "masters.set(String(message.serverId), {",
    "masters.set(`${String(message.serverId)}|${address}|${port}`, {",
)

main = ROOT / 'electron/main.cjs'
replace_once(
    main,
    """const CentralCrmServer = require('./server.cjs');
const { discoverMasters } = require('./discovery.cjs');
""",
    """const CentralCrmServer = require('./server.cjs');
const { discoverMasters } = require('./discovery.cjs');
const {
  defaultPrefs,
  normalizeApiUrl,
  safeClientPrefs,
  selectSingleMaster,
  validatePrefs,
} = require('./network-config.cjs');
""",
)
# Remove duplicated preference helpers now imported from network-config.
text = main.read_text()
start = text.index('const defaultPrefs = () => ({')
end = text.index('const readPrefs = () => {', start)
text = text[:start] + "const prefsPath = () => path.join(app.getPath('userData'), 'network-prefs.json');\nconst productionEntryUrl = () => pathToFileURL(path.join(__dirname, '../dist/index.html')).toString();\n\n" + text[end:]
main.write_text(text)
replace_once(
    main,
    """  } catch (error) {
    console.error('Configurazione rete non valida, uso valori predefiniti:', error.message);
    return defaultPrefs();
  }
};
""",
    """  } catch (error) {
    console.error('Configurazione rete non valida, avvio sicuro come client:', error.message);
    try {
      if (fs.existsSync(prefsPath())) {
        fs.renameSync(prefsPath(), `${prefsPath()}.corrupt-${Date.now()}`);
      }
    } catch (renameError) {
      console.error('Archiviazione configurazione corrotta fallita:', renameError.message);
    }
    return safeClientPrefs(error);
  }
};
""",
)
replace_once(
    main,
    """  fs.writeFileSync(temporary, JSON.stringify(prefs, null, 2));
  fs.renameSync(temporary, filePath);
};
""",
    """  const descriptor = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify(prefs, null, 2));
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch { /* Windows */ }
};
""",
)
# Remove duplicated selectSingleMaster helper.
text = main.read_text()
start = text.index('const selectSingleMaster = (masters, expectedServerId = null) => {')
end = text.index('const applyNetworkMode = async', start)
main.write_text(text[:start] + text[end:])

first_launch = r'''const configureFirstLaunch = async (prefs) => {
  while (true) {
    const masters = await discoverMasters(2000);
    if (masters.length === 1) {
      const master = masters[0];
      const choice = await dialog.showMessageBox({
        type: 'question',
        title: 'Configurazione rete CRM Marmeria',
        message: 'Server principale trovato',
        detail: `${master.name || master.hostname || 'CRM Marmeria'}\n${master.apiUrl}\nID installazione: ${master.serverId}\n\nConferma che questo sia il PC principale della marmeria.`,
        buttons: ['Connetti', 'Cerca di nuovo', 'Chiudi'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      if (choice.response === 0) {
        return applyNetworkMode({
          ...prefs,
          mode: 'client',
          apiUrl: master.apiUrl,
          discoveredServerId: master.serverId,
        });
      }
      if (choice.response === 2) return null;
      continue;
    }

    if (masters.length > 1) {
      const choice = await dialog.showMessageBox({
        type: 'error',
        title: 'Configurazione rete CRM Marmeria',
        message: 'Rilevati più server principali',
        detail: `Sono stati trovati ${masters.length} server o indirizzi concorrenti. Arresta quelli duplicati prima di continuare.`,
        buttons: ['Cerca di nuovo', 'Chiudi'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (choice.response === 1) return null;
      continue;
    }

    const choice = await dialog.showMessageBox({
      type: 'question',
      title: 'Configurazione rete CRM Marmeria',
      message: 'Nessun server principale trovato',
      detail: 'Scegli “PC principale” soltanto sul computer che deve conservare il database della marmeria.',
      buttons: ['Questo è il PC principale', 'Cerca di nuovo', 'Chiudi'],
      defaultId: 1,
      cancelId: 2,
      noLink: true,
    });
    if (choice.response === 0) return applyNetworkMode({ ...prefs, mode: 'master' });
    if (choice.response === 2) return null;
  }
};

'''
replace_block(main, 'const configureFirstLaunch = async (prefs) => {', 'const initializeNetwork = async () => {', first_launch)


# ---------------------------------------------------------------------------
# server tests and scripts
# ---------------------------------------------------------------------------
server_package = ROOT / 'server/package.json'
text = server_package.read_text()
text = text.replace(
    'node --check restore-safety.js && node --check middleware/auth.js',
    'node --check restore-safety.js && node --check mutation-barrier.js && node --check middleware/auth.js',
)
text = text.replace(
    'node setup-test.js && node smoke-test.js create',
    'node mutation-barrier.test.js && node setup-test.js && node smoke-test.js create',
)
server_package.write_text(text)

# Update WebSocket test to authenticate in the first frame and require acknowledgement.
smoke = ROOT / 'server/smoke-test.js'
replace_once(
    smoke,
    """    workerSocket = new WebSocket(
      `ws://127.0.0.1:${instance.port}/ws?token=${encodeURIComponent(workerToken)}`,
    );
    const workerEvents = [];
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout connessione WebSocket')), 2000);
      workerSocket.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      workerSocket.once('error', reject);
    });
    workerSocket.on('message', (message) => {
      try {
        const event = JSON.parse(message.toString());
        if (event.event !== 'connected') workerEvents.push(event);
      } catch {
        // Ignora ping/pong testuali.
      }
    });
""",
    """    workerSocket = new WebSocket(`ws://127.0.0.1:${instance.port}/ws`);
    const workerEvents = [];
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout autenticazione WebSocket')), 2000);
      workerSocket.once('open', () => {
        workerSocket.send(JSON.stringify({ type: 'auth', token: workerToken }));
      });
      workerSocket.on('message', (message) => {
        try {
          const event = JSON.parse(message.toString());
          if (event.event === 'connected') {
            clearTimeout(timer);
            resolve();
          } else {
            workerEvents.push(event);
          }
        } catch {
          // Ignora ping/pong testuali.
        }
      });
      workerSocket.once('error', reject);
    });
""",
)
# Require versions and reject malformed numeric input.
insert = """    const blindUpdate = await requestJson(baseUrl, `/projects/${createdProject.body.id}`, {
      method: 'PUT',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ status: 'Completato' }),
    });
    assert.equal(blindUpdate.response.status, 428, 'Gli aggiornamenti senza versione devono essere rifiutati');

    const malformedMaterial = await requestJson(baseUrl, '/materials', {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        name: 'Materiale non valido',
        unitPrice: '12abc',
        stockQuantity: 1,
        minStockLevel: 0,
      }),
    });
    assert.equal(malformedMaterial.response.status, 400, 'I numeri parzialmente validi non devono essere accettati');

"""
marker = """    const createdMaterial = await requestJson(baseUrl, '/materials', {
"""
replace_once(smoke, marker, insert + marker)
# Preserve custom worker permissions: a user created with dashboard-only must remain dashboard-only.
marker = """    assert.ok(users.body.some((entry) => entry.username === 'utente-b'));
"""
replace_once(
    smoke,
    marker,
    marker + """    const limited = users.body.find((entry) => entry.username === 'utente-a');
    assert.deepEqual(limited.permissions, ['dashboard.view'], 'Il riavvio non deve riaggiungere permessi rimossi');
""",
)

# Directory overlap regression test.
marker = """  const {
    root,
    dataDir,
    backupDir,
    attachmentsDir,
    db,
  } = makeDatabase(`crm-${mode}-`);
"""
replace_once(
    smoke,
    marker,
    marker + """
  if (mode === 'integrity') {
    const overlapRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-overlap-'));
    assert.throws(() => new CrmDatabase({
      dataDir: path.join(overlapRoot, 'data'),
      backupDir: path.join(overlapRoot, 'backups'),
      attachmentsDir: path.join(overlapRoot, 'backups', 'attachments'),
    }), /non possono contenersi/);
    fs.rmSync(overlapRoot, { recursive: true, force: true });
  }
""",
)

# setup-test: duplicate identities and invalid boolean.
setup = ROOT / 'server/setup-test.js'
marker = """    const demoteLastAdmin = await requestJson(baseUrl, `/users/${setup.body.user.id}`, {
"""
addition = """    const duplicateIdentity = await requestJson(baseUrl, '/users', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        username: ' PROPRIETARIO ',
        email: 'altro@example.test',
        password: 'Password-forte-789',
        firstName: 'Duplicato',
        lastName: 'CI',
        role: 'worker',
        permissions: ['dashboard.view'],
      }),
    });
    assert.equal(duplicateIdentity.response.status, 400, 'Username duplicati con spazi o maiuscole devono essere rifiutati');

    const invalidActive = await requestJson(baseUrl, `/users/${setup.body.user.id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ isActive: 'false' }),
    });
    assert.equal(invalidActive.response.status, 400, 'isActive deve essere strettamente booleano');

""" + marker
replace_once(setup, marker, addition)
