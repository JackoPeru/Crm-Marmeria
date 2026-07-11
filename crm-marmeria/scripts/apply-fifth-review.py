from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if old not in text:
        raise RuntimeError(f'Pattern not found in {path}: {old[:180]!r}')
    path.write_text(text.replace(old, new, 1))


def replace_block(path: Path, start_marker: str, end_marker: str, replacement: str) -> None:
    text = path.read_text()
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    path.write_text(text[:start] + replacement + text[end:])


# ---------------------------------------------------------------------------
# Electron main process: restore executable helpers that syntax checks missed.
# ---------------------------------------------------------------------------
main = ROOT / 'electron/main.cjs'
replace_once(
    main,
    """} = require('./network-config.cjs');

const isDev = process.env.NODE_ENV === 'development';
""",
    """} = require('./network-config.cjs');
const {
  assertTrustedSender: assertTrustedIpcSender,
  createRendererTrustChecker,
  createSerializedExecutor,
  probeApi: probeCentralApi,
} = require('./main-helpers.cjs');

const isDev = process.env.NODE_ENV === 'development';
""",
)
replace_once(main, 'let networkOperationQueue = Promise.resolve();\n', '')
replace_once(
    main,
    """const prefsPath = () => path.join(app.getPath('userData'), 'network-prefs.json');
const productionEntryUrl = () => pathToFileURL(path.join(__dirname, '../dist/index.html')).toString();

""",
    """const prefsPath = () => path.join(app.getPath('userData'), 'network-prefs.json');
const productionEntryUrl = () => pathToFileURL(path.join(__dirname, '../dist/index.html')).toString();
const isTrustedRendererUrl = createRendererTrustChecker({
  isDev,
  productionFile: productionEntryUrl(),
});
const serializeNetworkOperation = createSerializedExecutor();
const probeApi = (apiUrl, expectedServerId = null) => probeCentralApi(
  apiUrl,
  expectedServerId,
  { normalizeApiUrl },
);
const assertTrustedSender = (event) => assertTrustedIpcSender(event, isTrustedRendererUrl);

""",
)


# ---------------------------------------------------------------------------
# Electron central server: persistent identity validation and clone detection.
# ---------------------------------------------------------------------------
electron_server = ROOT / 'electron/server.cjs'
replace_once(
    electron_server,
    """const { upgradeLegacySnapshots } = require('../server/snapshot-compat');
""",
    """const { upgradeLegacySnapshots } = require('../server/snapshot-compat');
const { readOrCreateServerId } = require('./server-identity.cjs');
""",
)
replace_once(
    electron_server,
    """  getServerId() {
    if (this.serverId) return this.serverId;
    const filePath = this.identityPath();
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, crypto.randomUUID());
    this.serverId = fs.readFileSync(filePath, 'utf8').trim();
    return this.serverId;
  }
""",
    """  getServerId() {
    if (this.serverId) return this.serverId;
    this.serverId = readOrCreateServerId(this.identityPath());
    return this.serverId;
  }
""",
)
replace_once(
    electron_server,
    """  async findOtherMasters(ownId) {
    const discovered = await discoverMasters(1200);
    return discovered.filter((master) => master.serverId !== ownId);
  }
""",
    """  async findOtherMasters() {
    // L'advertiser locale non è ancora attivo durante start(). Qualunque risposta
    // verificata appartiene quindi a un altro processo o PC, anche con lo stesso ID
    // copiato accidentalmente insieme alla cartella userData.
    return discoverMasters(1200);
  }
""",
)
replace_once(electron_server, 'let otherMasters = await this.findOtherMasters(ownId);', 'let otherMasters = await this.findOtherMasters();')
replace_once(electron_server, 'otherMasters = await this.findOtherMasters(ownId);', 'otherMasters = await this.findOtherMasters();')


# ---------------------------------------------------------------------------
# Browser API client: bind a replay to its original server and generation.
# ---------------------------------------------------------------------------
api = ROOT / 'src/services/api.ts'
replace_once(
    api,
    """import { getCurrentQueueScope, offlineQueue } from './offlineQueue';
""",
    """import { getCurrentQueueScope, offlineQueue } from './offlineQueue';
import type { QueueScope } from './offlineQueue';
import { bindRequestToScope, queueScopesEqual } from './requestScope';
""",
)
replace_once(
    api,
    """interface ReplayConfig extends AxiosRequestConfig {
  _replay?: boolean;
  _crmContext?: string;
}
""",
    """interface ReplayConfig extends AxiosRequestConfig {
  _replay?: boolean;
  _crmContext?: string;
  _replayScope?: QueueScope;
}
""",
)
replace_once(
    api,
    """    this.axiosInstance.interceptors.request.use((config: any) => {
      config.baseURL = this.getBaseURL();
      config._crmContext = clientContextFingerprint();
      config.headers = config.headers || {};
""",
    """    this.axiosInstance.interceptors.request.use((config: ReplayConfig & any) => {
      const binding = bindRequestToScope(
        config._replayScope,
        getCurrentQueueScope(),
        this.getBaseURL(),
        clientContextFingerprint(),
      );
      config.baseURL = binding.baseURL;
      config._crmContext = binding.fingerprint;
      config.headers = config.headers || {};
""",
)
replace_once(
    api,
    """      for (const request of await offlineQueue.list(scope)) {
        if (request.blocked) continue;
        try {
          const stableServerMatch = request.serverId === scope.serverId
            && request.dataEpoch === scope.dataEpoch;
          if (!stableServerMatch) continue;
          await this.axiosInstance.request({
""",
    """      for (const request of await offlineQueue.list(scope)) {
        if (request.blocked) continue;
        const currentScope = getCurrentQueueScope();
        if (!queueScopesEqual(scope, currentScope)) break;
        try {
          const stableServerMatch = request.serverId === scope.serverId
            && request.dataEpoch === scope.dataEpoch;
          if (!stableServerMatch) continue;
          await this.axiosInstance.request({
""",
)
replace_once(
    api,
    """            baseURL: scope.apiBaseUrl,
            _replay: true,
          } as ReplayConfig);
""",
    """            baseURL: scope.apiBaseUrl,
            _replay: true,
            _replayScope: scope,
          } as ReplayConfig);
""",
)
replace_once(
    api,
    """        } catch (error: any) {
          const responseStatus = error.response?.status;
""",
    """        } catch (error: any) {
          if (['QUEUE_SCOPE_CHANGED', 'STALE_CONTEXT_RESPONSE'].includes(error?.code)) break;
          const responseStatus = error.response?.status;
""",
)


# ---------------------------------------------------------------------------
# Express API: admin recovery, strict backup schema, audit filtering and
# idempotent realtime events.
# ---------------------------------------------------------------------------
app = ROOT / 'server/app.js'
replace_once(
    app,
    """const publicActor = (user) => ({ id: String(user.id), username: user.username });
""",
    """const publicActor = (user) => ({ id: String(user.id), username: user.username });
const hasActiveAdmin = () => readUsers().some((user) => user.role === 'admin' && user.isActive);
""",
)
replace_once(
    app,
    """const hasEntityPermission = (user, type, action) => {
  const permission = permissionForType(type, action);
  return Boolean(permission && user?.permissions?.includes(permission));
};

""",
    """const hasEntityPermission = (user, type, action) => {
  const permission = permissionForType(type, action);
  return Boolean(permission && user?.permissions?.includes(permission));
};
const canViewAuditEntry = (user, item) => item.entityType === 'database'
  ? user?.role === 'admin' || user?.permissions?.includes('settings.edit')
  : hasEntityPermission(user, item.entityType, 'view');

""",
)
backup_helper = r'''const normalizeBackupPayload = (raw) => {
  if (!raw?.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) return raw;
  const data = raw.data;
  if (ENTITY_TYPES.some((type) => Object.prototype.hasOwnProperty.call(data, type))) return raw;

  const legacyKeys = ['clients', 'orders', 'projects', 'materials', 'quotes', 'invoices'];
  if (!legacyKeys.some((key) => Object.prototype.hasOwnProperty.call(data, key))) return raw;
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

'''
replace_once(app, 'const createRealtime = (server) => {', backup_helper + 'const createRealtime = (server) => {')
replace_once(app, "setupRequired: readUsers().length === 0,", "setupRequired: !hasActiveAdmin(),")
replace_once(app, "if (readUsers().length === 0) {", "if (!hasActiveAdmin()) {")
replace_once(
    app,
    """          if (users.length) {
            const error = new Error('Configurazione iniziale già completata');
            error.status = 409;
            throw error;
          }
          const user = {
""",
    """          if (users.some((entry) => entry.role === 'admin' && entry.isActive)) {
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
""",
)
# Do not emit stale realtime events on idempotent response replay.
replace_once(
    app,
    """      realtime.broadcast({
        event: 'orders.updated', entityType: 'order', item: result.item, actor: publicActor(req.user),
      }, 'orders.view');
      return res.json(presentEntity(req.user, 'order', result.item));
""",
    """      if (!result.replayed) {
        realtime.broadcast({
          event: 'orders.updated', entityType: 'order', item: result.item, actor: publicActor(req.user),
        }, 'orders.view');
      } else {
        res.set('X-Idempotent-Replay', 'true');
      }
      return res.json(presentEntity(req.user, 'order', result.item));
""",
)
replace_once(
    app,
    """        realtime.broadcast({
          event: `${route}.created`, entityType: config.type, item: result.item, actor: publicActor(req.user),
        }, `${config.permission}.view`);
        return res.status(result.replayed ? 200 : 201)
""",
    """        if (!result.replayed) {
          realtime.broadcast({
            event: `${route}.created`, entityType: config.type, item: result.item, actor: publicActor(req.user),
          }, `${config.permission}.view`);
        } else {
          res.set('X-Idempotent-Replay', 'true');
        }
        return res.status(result.replayed ? 200 : 201)
""",
)
replace_once(
    app,
    """        realtime.broadcast({
          event: `${route}.updated`, entityType: config.type, item: result.item, actor: publicActor(req.user),
        }, `${config.permission}.view`);
        return res.json(presentEntity(req.user, config.type, result.item));
""",
    """        if (!result.replayed) {
          realtime.broadcast({
            event: `${route}.updated`, entityType: config.type, item: result.item, actor: publicActor(req.user),
          }, `${config.permission}.view`);
        } else {
          res.set('X-Idempotent-Replay', 'true');
        }
        return res.json(presentEntity(req.user, config.type, result.item));
""",
)
replace_once(
    app,
    """        realtime.broadcast({
          event: `${route}.deleted`, entityType: config.type, id: result.id, actor: publicActor(req.user),
        }, `${config.permission}.view`);
        return res.json(result);
""",
    """        if (!result.replayed) {
          realtime.broadcast({
            event: `${route}.deleted`, entityType: config.type, id: result.id, actor: publicActor(req.user),
          }, `${config.permission}.view`);
        } else {
          res.set('X-Idempotent-Replay', 'true');
        }
        return res.json(result);
""",
)
replace_once(
    app,
    """  app.get('/api/audit', authenticateToken, requirePermission('settings.view'), (req, res) => {
    res.json(db.listAudit({ type: req.query.type, id: req.query.id, limit: req.query.limit })
      .map((item) => presentAudit(req.user, item)));
  });
""",
    """  app.get('/api/audit', authenticateToken, requirePermission('settings.view'), (req, res) => {
    res.json(db.listAudit({ type: req.query.type, id: req.query.id, limit: req.query.limit })
      .filter((item) => canViewAuditEntry(req.user, item))
      .map((item) => presentAudit(req.user, item)));
  });
""",
)
replace_once(
    app,
    """  app.post('/api/backup/import', authenticateToken, requirePermission('settings.edit'), async (req, res) => {
    try {
      await runMaintenance('pre-importazione', () => db.restoreJson(req.body, req.user));
""",
    """  app.post('/api/backup/import', authenticateToken, requirePermission('settings.edit'), async (req, res) => {
    try {
      const backup = normalizeBackupPayload(req.body);
      await runMaintenance('pre-importazione', () => db.restoreJson(backup, req.user));
""",
)
restore_start = """      const backup = req.body?.data && !req.body.data.client && req.body.data.clients
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
"""
replace_once(app, restore_start, "      const backup = normalizeBackupPayload(req.body);\n")
replace_once(
    app,
    "if (!readUsers().some((user) => user.role === 'admin' && user.isActive)) return;",
    "if (!hasActiveAdmin()) return;",
)


# ---------------------------------------------------------------------------
# Database: complete imports only and retryable legacy migrations.
# ---------------------------------------------------------------------------
database = ROOT / 'server/database.js'
replace_block(
    database,
    '  migrateLegacy(dataDir) {',
    '  listAudit({ type, id, limit = 100 }) {',
    r'''  migrateLegacy(dataDir) {
    const marker = this.db.prepare(
      "SELECT value FROM metadata WHERE key = 'legacy_json_migrated'",
    ).get();
    if (marker) return true;

    const staged = [];
    let failed = false;
    const stageArray = (filename, mapper) => {
      const filePath = path.join(dataDir, filename);
      if (!fs.existsSync(filePath)) return;
      try {
        const items = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!Array.isArray(items)) throw new Error('il contenuto non è un elenco');
        items.forEach((item) => staged.push(mapper(item)));
      } catch (error) {
        failed = true;
        console.error(`Migrazione ${filename} rinviata:`, error.message);
      }
    };

    for (const [filename, type] of [
      ['clients.json', 'client'],
      ['materials.json', 'material'],
      ['projects.json', 'project'],
      ['quotes.json', 'quote'],
      ['invoices.json', 'invoice'],
    ]) {
      stageArray(filename, (item) => ({ type, item }));
    }
    stageArray('orders.json', (item) => ({
      type: ENTITY_TYPES.includes(item?.type) ? item.type : 'order',
      item,
    }));

    if (failed) return false;
    this.db.transaction(() => {
      staged.forEach(({ type, item }) => this.importEntity(type, item));
      this.db.prepare(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES ('legacy_json_migrated', ?)",
      ).run(now());
    })();
    return true;
  }

''',
)
replace_once(
    database,
    """    for (const type of ENTITY_TYPES) {
      if (backup.data[type] != null && !Array.isArray(backup.data[type])) {
        const error = new Error(`La sezione ${type} del backup non è valida`);
        error.status = 400;
        throw error;
      }
    }

""",
    """    for (const type of ENTITY_TYPES) {
      if (!Object.prototype.hasOwnProperty.call(backup.data, type) || !Array.isArray(backup.data[type])) {
        const error = new Error(`Il backup deve contenere la sezione completa ${type}`);
        error.status = 400;
        throw error;
      }
      const ids = new Set();
      for (const item of backup.data[type]) {
        if (item?.id == null || item.id === '') continue;
        const id = String(item.id);
        if (ids.has(id)) {
          const error = new Error(`La sezione ${type} contiene ID duplicati`);
          error.status = 400;
          throw error;
        }
        ids.add(id);
      }
    }

""",
)
replace_once(
    database,
    """      for (const type of ENTITY_TYPES) {
        const items = Array.isArray(backup.data[type]) ? backup.data[type] : [];
        items.forEach((item) => this.importEntity(type, item));
      }
""",
    """      for (const type of ENTITY_TYPES) {
        backup.data[type].forEach((item) => this.importEntity(type, item));
      }
""",
)


# ---------------------------------------------------------------------------
# Regression tests.
# ---------------------------------------------------------------------------
setup = ROOT / 'server/setup-test.js'
replace_once(
    setup,
    """const compromisedAdmin = {
""",
    """const safeWorker = {
  id: 'worker_001',
  username: 'operaio-sicuro',
  email: 'operaio-sicuro@marmeria.com',
  password: bcrypt.hashSync('Worker-password-123', 10),
  role: 'worker',
  firstName: 'Operaio',
  lastName: 'Sicuro',
  isActive: true,
  permissions: ['dashboard.view'],
  sessionVersion: 1,
};

const compromisedAdmin = {
""",
)
replace_once(setup, 'JSON.stringify([compromisedAdmin], null, 2),', 'JSON.stringify([compromisedAdmin, safeWorker], null, 2),')
replace_once(
    setup,
    """    assert.equal(users.body.length, 1);
    assert.equal(users.body[0].username, 'proprietario');
""",
    """    assert.equal(users.body.length, 2, 'Il recupero admin non deve cancellare gli account operativi sicuri');
    assert.ok(users.body.some((entry) => entry.username === 'proprietario'));
    assert.ok(users.body.some((entry) => entry.username === 'operaio-sicuro'));
""",
)
replace_once(
    setup,
    """    assert.equal(stillAdmin.body[0].role, 'admin');
    assert.equal(stillAdmin.body[0].isActive, true);
""",
    """    const survivingAdmin = stillAdmin.body.find((entry) => entry.id === setup.body.user.id);
    assert.equal(survivingAdmin.role, 'admin');
    assert.equal(survivingAdmin.isActive, true);
""",
)

smoke = ROOT / 'server/smoke-test.js'
replace_once(
    smoke,
    """    assert.equal(adminUpdate.response.status, 200);
    await wait(150);
""",
    """    assert.equal(adminUpdate.response.status, 200);
    await wait(150);
""",
)
# Insert idempotent replay regression after the first realtime redaction assertion.
marker = """    assert.equal('budget' in projectEvent.item, false, 'Il realtime operaio deve rimuovere il budget');

"""
insert = marker + """    const laterUpdate = await requestJson(baseUrl, `/projects/${createdProject.body.id}`, {
      method: 'PUT',
      headers: {
        ...authHeaders(adminToken),
        'If-Match': String(adminUpdate.body.version),
        'X-Operation-Id': 'admin-later-update-ci',
      },
      body: JSON.stringify({ status: 'In Lavorazione', phase: 'Finitura' }),
    });
    assert.equal(laterUpdate.response.status, 200);
    await wait(100);
    const eventsBeforeReplay = workerEvents.length;
    const replayedUpdate = await requestJson(baseUrl, `/projects/${createdProject.body.id}`, {
      method: 'PUT',
      headers: {
        ...authHeaders(adminToken),
        'If-Match': String(adminProject.body.version),
        'X-Operation-Id': 'admin-financial-update-ci',
      },
      body: JSON.stringify({ budget: 2000, status: 'In Corso' }),
    });
    assert.equal(replayedUpdate.response.status, 200);
    assert.equal(replayedUpdate.response.headers.get('x-idempotent-replay'), 'true');
    await wait(150);
    assert.equal(
      workerEvents.length,
      eventsBeforeReplay,
      'Il replay idempotente non deve ritrasmettere un evento realtime obsoleto',
    );
    const currentAfterReplay = await requestJson(baseUrl, `/projects/${createdProject.body.id}`, {
      headers: authHeaders(adminToken),
    });
    assert.equal(currentAfterReplay.body.version, laterUpdate.body.version);
    assert.equal(currentAfterReplay.body.phase, 'Finitura');

"""
replace_once(smoke, marker, insert)
# Partial backup must be rejected without deleting current data.
marker = """    const deniedRevenueTrend = await requestJson(
"""
partial_test = """    const partialBackup = await requestJson(baseUrl, '/backup/import', {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ data: { client: [] } }),
    });
    assert.equal(partialBackup.response.status, 400, 'Un backup parziale non deve cancellare le sezioni omesse');
    const projectAfterRejectedImport = await requestJson(baseUrl, `/projects/${createdProject.body.id}`, {
      headers: authHeaders(adminToken),
    });
    assert.equal(projectAfterRejectedImport.response.status, 200);

""" + marker
replace_once(smoke, marker, partial_test)
# Global audit must respect per-entity view permissions.
marker = """    assert.ok(createUsers.every((result) => result.response.status === 201));
"""
audit_test = marker + """    const auditViewerCreated = await requestJson(baseUrl, '/users', {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        username: 'audit-limitato',
        email: 'audit-limitato@example.test',
        password,
        firstName: 'Audit',
        lastName: 'Limitato',
        role: 'worker',
        permissions: ['settings.view'],
      }),
    });
    assert.equal(auditViewerCreated.response.status, 201);
    const auditViewerToken = await login('audit-limitato');
    const auditedClient = await requestJson(baseUrl, '/clients', {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ name: 'Cliente riservato audit' }),
    });
    assert.equal(auditedClient.response.status, 201);
    const limitedAudit = await requestJson(baseUrl, '/audit', {
      headers: authHeaders(auditViewerToken),
    });
    assert.equal(limitedAudit.response.status, 200);
    assert.equal(
      limitedAudit.body.some((entry) => entry.entityType === 'client'),
      false,
      'settings.view non deve aggirare clients.view nello storico globale',
    );
"""
replace_once(smoke, marker, audit_test)
# Malformed legacy files must not permanently set the migration marker.
marker = """    if (mode === 'integrity') {
      const client = db.create(
"""
migration_test = """    if (mode === 'integrity') {
      const migrationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-migration-'));
      const migrationData = path.join(migrationRoot, 'data');
      const migrationBackups = path.join(migrationRoot, 'backups');
      const migrationAttachments = path.join(migrationRoot, 'attachments');
      fs.mkdirSync(migrationData, { recursive: true });
      fs.writeFileSync(path.join(migrationData, 'clients.json'), '{json non valido');
      const migrationDb = new CrmDatabase({
        dataDir: migrationData,
        backupDir: migrationBackups,
        attachmentsDir: migrationAttachments,
      });
      assert.equal(migrationDb.migrateLegacy(migrationData), false);
      assert.equal(
        migrationDb.db.prepare(\"SELECT value FROM metadata WHERE key = 'legacy_json_migrated'\").get(),
        undefined,
        'Una migrazione fallita deve essere ritentabile',
      );
      fs.writeFileSync(path.join(migrationData, 'clients.json'), JSON.stringify([{ id: 'legacy-client', name: 'Legacy' }]));
      assert.equal(migrationDb.migrateLegacy(migrationData), true);
      assert.ok(migrationDb.get('client', 'legacy-client'));
      migrationDb.close();
      fs.rmSync(migrationRoot, { recursive: true, force: true });

      const client = db.create(
"""
replace_once(smoke, marker, migration_test)

# Repository hygiene for generated audit reports.
gitignore = ROOT / '.gitignore'
text = gitignore.read_text()
if 'root-audit.json' not in text:
    gitignore.write_text(text + "\n# Generated dependency audit reports\nroot-audit.json\nserver-audit.json\n")
