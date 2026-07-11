from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if old not in text:
        raise RuntimeError(f'Pattern not found in {path}: {old[:100]!r}')
    path.write_text(text.replace(old, new, 1))


# ---------------------------------------------------------------------------
# Recoverable, validated snapshot restore
# ---------------------------------------------------------------------------
database = ROOT / 'server/database.js'
replace_once(
    database,
    "const Database = require('better-sqlite3');\n",
    "const Database = require('better-sqlite3');\nconst {\n"
    "  atomicWriteJson,\n"
    "  recoverInterruptedRestore,\n"
    "  restorePaths,\n"
    "  validateDatabase,\n"
    "  validateUsers,\n"
    "} = require('./restore-safety');\n",
)
replace_once(
    database,
    """    this.usersPath = path.join(this.dataDir, 'users.json');
    this.snapshotQueue = Promise.resolve();

    if (isInside(this.attachmentsDir, this.backupDir)) {
""",
    """    this.usersPath = path.join(this.dataDir, 'users.json');
    this.snapshotQueue = Promise.resolve();
    this.restorePaths = restorePaths({
      dataDir: this.dataDir,
      dbPath: this.dbPath,
      usersPath: this.usersPath,
      attachmentsDir: this.attachmentsDir,
    });

    if (isInside(this.attachmentsDir, this.backupDir)) {
""",
)
replace_once(
    database,
    """    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    fs.mkdirSync(this.attachmentsDir, { recursive: true });
    this.open();
""",
    """    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    fs.mkdirSync(this.attachmentsDir, { recursive: true });
    recoverInterruptedRestore({
      dataDir: this.dataDir,
      dbPath: this.dbPath,
      usersPath: this.usersPath,
      attachmentsDir: this.attachmentsDir,
    });
    this.open();
""",
)
text = database.read_text()
start = text.index('  restoreSnapshot(name, user) {')
suffix_start = text.index('\n}\n\nmodule.exports = { CrmDatabase, ENTITY_TYPES };', start)
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
    fs.mkdirSync(stageRoot, { recursive: true });

    try {
      fs.copyFileSync(dbSource, stageDb);
      if (fs.existsSync(usersSource)) {
        fs.copyFileSync(usersSource, stageUsers);
      } else if (fs.existsSync(this.usersPath)) {
        fs.copyFileSync(this.usersPath, stageUsers);
      } else {
        const error = new Error('Il backup non contiene account e non esistono account correnti da conservare');
        error.status = 400;
        throw error;
      }

      if (fs.existsSync(attachmentsSource)) {
        fs.cpSync(attachmentsSource, stageAttachments, { recursive: true });
      } else if (fs.existsSync(this.attachmentsDir)) {
        fs.cpSync(this.attachmentsDir, stageAttachments, { recursive: true });
      } else {
        fs.mkdirSync(stageAttachments, { recursive: true });
      }

      validateDatabase(stageDb);
      validateUsers(stageUsers);

      this.close();
      for (const suffix of ['-wal', '-shm']) {
        fs.rmSync(`${this.dbPath}${suffix}`, { force: true });
      }
      fs.rmSync(previousDb, { force: true });
      fs.rmSync(previousUsers, { force: true });
      fs.rmSync(previousAttachments, { recursive: true, force: true });

      atomicWriteJson(journalPath, { ...journalBase, state: 'swapping' });
      if (fs.existsSync(this.dbPath)) fs.renameSync(this.dbPath, previousDb);
      if (fs.existsSync(this.usersPath)) fs.renameSync(this.usersPath, previousUsers);
      if (fs.existsSync(this.attachmentsDir)) {
        fs.renameSync(this.attachmentsDir, previousAttachments);
      }

      fs.renameSync(stageDb, this.dbPath);
      fs.renameSync(stageUsers, this.usersPath);
      fs.renameSync(stageAttachments, this.attachmentsDir);
      atomicWriteJson(journalPath, { ...journalBase, state: 'committed' });

      validateDatabase(this.dbPath);
      validateUsers(this.usersPath);
      this.open();

      fs.rmSync(previousDb, { force: true });
      fs.rmSync(previousUsers, { force: true });
      fs.rmSync(previousAttachments, { recursive: true, force: true });
      fs.rmSync(journalPath, { force: true });
    } catch (error) {
      if (this.db?.open) this.close();
      if (fs.existsSync(journalPath)) {
        try {
          atomicWriteJson(journalPath, { ...journalBase, state: 'swapping' });
        } catch {
          // Il recupero usa comunque i percorsi .previous noti.
        }
      }
      recoverInterruptedRestore({
        dataDir: this.dataDir,
        dbPath: this.dbPath,
        usersPath: this.usersPath,
        attachmentsDir: this.attachmentsDir,
      });
      throw error;
    } finally {
      fs.rmSync(stageRoot, { recursive: true, force: true });
      if (!this.db?.open) this.open();
    }

    this.writeAudit({
      user,
      type: 'database',
      id: 'all',
      action: 'restore.snapshot',
      previous: null,
      next: { snapshot: String(name) },
    });
    return this.listSnapshots().find((snapshot) => snapshot.name === name) || { name };
  }
'''
database.write_text(text[:start] + method + text[suffix_start:])


# ---------------------------------------------------------------------------
# Local business dates, restricted CORS and setup secret
# ---------------------------------------------------------------------------
app = ROOT / 'server/app.js'
replace_once(
    app,
    """const isLoopback = (req) => [
  '127.0.0.1', '::1', '::ffff:127.0.0.1',
].includes(req.socket.remoteAddress);
""",
    """const isLoopback = (req) => [
  '127.0.0.1', '::1', '::ffff:127.0.0.1',
].includes(req.socket.remoteAddress);
const secureEqual = (left, right) => {
  const first = Buffer.from(String(left || ''));
  const second = Buffer.from(String(right || ''));
  return first.length > 0
    && first.length === second.length
    && crypto.timingSafeEqual(first, second);
};
""",
)
replace_once(
    app,
    """const dateKey = (value) => {
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
""",
    """const localDateKey = (value) => {
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(String(value || ''))) return String(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
};
const parseLocalDay = (value) => {
  const match = String(value || '').match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
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
""",
)
replace_once(
    app,
    """  const dataDir = options.dataDir || path.join(__dirname, 'data');
  const backupDir = options.backupDir || path.join(dataDir, 'backups');
  const attachmentsDir = options.attachmentsDir || path.join(dataDir, 'attachments');
""",
    """  const dataDir = options.dataDir || path.join(__dirname, 'data');
  const backupDir = options.backupDir || path.join(dataDir, 'backups');
  const attachmentsDir = options.attachmentsDir || path.join(dataDir, 'attachments');
  const setupSecret = options.setupSecret || process.env.CRM_SETUP_SECRET || null;
""",
)
replace_once(
    app,
    """  app.use(cors({
    origin: '*',
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'If-Match', 'X-Operation-Id'],
  }));
""",
    """  const corsOptions = {
    origin(origin, callback) {
      const allowed = !origin
        || origin === 'null'
        || /^file:\\/\\//i.test(origin)
        || /^https?:\\/\\/(localhost|127\\.0\\.0\\.1|\\[::1\\])(?::\\d+)?$/i.test(origin);
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
""",
)
replace_once(
    app,
    """      if (readUsers().length === 0) {
        if (!isLoopback(req)) {
          return res.status(403).json({
            error: 'La configurazione iniziale deve essere completata sul PC principale',
          });
        }
        if (password.length < 10) {
""",
    """      if (readUsers().length === 0) {
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
""",
)
replace_once(
    app,
    """    const date = req.params.date || new Date().toISOString().slice(0, 10);
    const work = allWork();
    const materials = db.list('material');
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);
    if (Number.isNaN(dayStart.getTime())) return res.status(400).json({ error: 'Data non valida' });
""",
    """    const date = req.params.date || localToday();
    const work = allWork();
    const materials = db.list('material');
    const dayStart = parseLocalDay(date);
    if (!dayStart) return res.status(400).json({ error: 'Data non valida' });
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);
""",
)
replace_once(
    app,
    """    const start = new Date(`${req.params.weekStart || new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) return res.status(400).json({ error: 'Data non valida' });
    const end = addDays(start, 6);
    end.setUTCHours(23, 59, 59, 999);
""",
    """    const start = parseLocalDay(req.params.weekStart || localToday());
    if (!start) return res.status(400).json({ error: 'Data non valida' });
    const end = addDays(start, 6);
    end.setHours(23, 59, 59, 999);
""",
)
replace_once(
    app,
    """      weekStart: start.toISOString().slice(0, 10),
      weekEnd: end.toISOString().slice(0, 10),
""",
    """      weekStart: localDateKey(start),
      weekEnd: localDateKey(end),
""",
)
replace_once(
    app,
    """    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
""",
    """    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
""",
)
replace_once(
    app,
    """    const start = new Date(String(
      req.query.startDate || new Date(Date.now() - 30 * 86400000).toISOString(),
    ));
    const end = new Date(String(req.query.endDate || new Date().toISOString()));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
""",
    """    const start = parseLocalDay(String(
      req.query.startDate || localDateKey(new Date(Date.now() - 30 * 86400000)),
    ));
    const end = parseLocalDay(String(req.query.endDate || localToday()));
    if (!start || !end || start > end) {
""",
)
replace_once(
    app,
    """    for (const current = new Date(start); current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
      const date = current.toISOString().slice(0, 10);
""",
    """    for (const current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
      const date = localDateKey(current);
""",
)
replace_once(
    app,
    """      const today = new Date().toISOString().slice(0, 10);
      const alreadyCreated = db.listSnapshots().some(
        (item) => item.createdAt.startsWith(today) && item.label === 'automatico',
      );
""",
    """      const today = localToday();
      const alreadyCreated = db.listSnapshots().some(
        (item) => localDateKey(item.createdAt) === today && item.label === 'automatico',
      );
""",
)


# ---------------------------------------------------------------------------
# Desktop-only first administrator bootstrap secret
# ---------------------------------------------------------------------------
server_cjs = ROOT / 'electron/server.cjs'
replace_once(
    server_cjs,
    """    this.backupPath = null;
    this.serverId = null;
""",
    """    this.backupPath = null;
    this.serverId = null;
    this.setupSecret = crypto.randomBytes(32).toString('hex');
""",
)
replace_once(
    server_cjs,
    """        serverName: 'CRM Marmeria',
        serverId: ownId,
""",
    """        serverName: 'CRM Marmeria',
        serverId: ownId,
        setupSecret: this.setupSecret,
""",
)
replace_once(
    server_cjs,
    """  getStatus() {
""",
    """  getSetupSecret() {
    return this.setupSecret;
  }

  getStatus() {
""",
)

main_cjs = ROOT / 'electron/main.cjs'
marker = """ipcMain.handle('sync-with-master', (event) => {
"""
addition = """ipcMain.handle('setup-first-admin', async (event, credentials) => {
  assertTrustedSender(event);
  const status = centralServer.getStatus();
  if (!status.isRunning || !status.localApiUrl) {
    return { success: false, error: 'Il server principale locale non è attivo' };
  }
  try {
    const response = await fetch(`${status.localApiUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CRM-Setup-Secret': centralServer.getSetupSecret(),
      },
      body: JSON.stringify(credentials || {}),
    });
    const data = await response.json();
    return response.ok
      ? { success: true, data }
      : { success: false, error: data?.error || 'Configurazione iniziale non riuscita' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

""" + marker
replace_once(main_cjs, marker, addition)

preload = ROOT / 'electron/preload.cjs'
replace_once(
    preload,
    """    testMasterConnection: (apiUrl, expectedServerId) => ipcRenderer.invoke(
      'network-test-api',
      apiUrl,
      expectedServerId,
    ),
""",
    """    testMasterConnection: (apiUrl, expectedServerId) => ipcRenderer.invoke(
      'network-test-api',
      apiUrl,
      expectedServerId,
    ),
    setupFirstAdmin: (credentials) => ipcRenderer.invoke('setup-first-admin', credentials),
""",
)

types = ROOT / 'src/types/electron.d.ts'
replace_once(
    types,
    """        testMasterConnection?: (apiUrl: string, expectedServerId?: string) => Promise<{
          success: boolean;
          data?: any;
          apiUrl?: string;
          error?: string;
          code?: string;
        }>;
""",
    """        testMasterConnection?: (apiUrl: string, expectedServerId?: string) => Promise<{
          success: boolean;
          data?: any;
          apiUrl?: string;
          error?: string;
          code?: string;
        }>;
        setupFirstAdmin: (credentials: LoginCredentials) => Promise<{
          success: boolean;
          data?: { token: string; user: any };
          error?: string;
        }>;
""",
)

auth = ROOT / 'src/services/auth.ts'
replace_once(
    auth,
    """  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    try {
      const response = await apiClient.post('/auth/login', credentials);
      const data: AuthResponse = response.data;
      this.setToken(data.token);
      this.setUser(data.user);
      return data;
    } catch (error: any) {
      const message = error?.response?.data?.error
        || error?.message
        || 'Errore durante il login';
      throw new Error(message);
    }
  }
""",
    """  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    try {
      let data: AuthResponse;
      const isInitialSetup = Boolean(
        credentials.firstName
        && credentials.lastName
        && credentials.email,
      );
      if (isInitialSetup && window.electronAPI?.network.setupFirstAdmin) {
        const result = await window.electronAPI.network.setupFirstAdmin(credentials);
        if (!result.success || !result.data) {
          throw new Error(result.error || 'Configurazione iniziale non riuscita');
        }
        data = result.data as AuthResponse;
      } else {
        data = (await apiClient.post('/auth/login', credentials)).data;
      }
      this.setToken(data.token);
      this.setUser(data.user);
      return data;
    } catch (error: any) {
      const message = error?.response?.data?.error
        || error?.message
        || 'Errore durante il login';
      throw new Error(message);
    }
  }
""",
)

index_js = ROOT / 'server/index.js'
replace_once(
    index_js,
    """    backupDir,
    serverName: process.env.CRM_SERVER_NAME || 'crm-marmeria',
""",
    """    backupDir,
    serverName: process.env.CRM_SERVER_NAME || 'crm-marmeria',
    setupSecret: process.env.CRM_SETUP_SECRET || null,
""",
)


# ---------------------------------------------------------------------------
# Regression tests
# ---------------------------------------------------------------------------
smoke = ROOT / 'server/smoke-test.js'
text = smoke.read_text()
if not text.startswith("process.env.TZ = 'Europe/Rome';"):
    text = "process.env.TZ = 'Europe/Rome';\n" + text
smoke.write_text(text)
replace_once(
    smoke,
    """      fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([
        { id: 'utente-backup', username: 'backup', isActive: true },
      ], null, 2));
""",
    """      fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([
        {
          id: 'utente-backup',
          username: 'backup',
          email: 'backup@example.test',
          password: '$2b$10$hash-di-test-non-pubblico',
          role: 'admin',
          isActive: true,
          permissions: ['settings.view', 'settings.edit'],
        },
      ], null, 2));
""",
)
replace_once(
    smoke,
    """      fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([
        { id: 'utente-corrente', username: 'corrente', isActive: true },
      ]));
""",
    """      fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([
        {
          id: 'utente-corrente',
          username: 'corrente',
          email: 'corrente@example.test',
          password: '$2b$10$hash-corrente-non-pubblico',
          role: 'admin',
          isActive: true,
          permissions: ['settings.view', 'settings.edit'],
        },
      ]));
""",
)
marker = """      assert.ok(
        fs.existsSync(path.join(attachmentsDir, 'corrente', 'file.txt')),
        'Uno snapshot legacy non deve cancellare gli allegati correnti',
      );
"""
replace_once(
    smoke,
    marker,
    marker + """

      const corruptName = `${snapshot.name}-corrotto`;
      const corruptPath = path.join(backupDir, corruptName);
      fs.cpSync(snapshotPath, corruptPath, { recursive: true });
      fs.writeFileSync(path.join(corruptPath, 'crm-marmeria.db'), 'database non valido');
      const beforeCorruptRestore = db.get('project', created.item.id);
      assert.throws(
        () => db.restoreSnapshot(corruptName, user),
        /Database del backup non valido/,
      );
      assert.equal(
        db.get('project', created.item.id).status,
        beforeCorruptRestore.status,
        'Un database corrotto non deve sostituire quello corrente',
      );

      const noAdminName = `${snapshot.name}-senza-admin`;
      const noAdminPath = path.join(backupDir, noAdminName);
      fs.cpSync(snapshotPath, noAdminPath, { recursive: true });
      fs.writeFileSync(path.join(noAdminPath, 'users.json'), JSON.stringify([{
        id: 'solo-operaio',
        username: 'solo-operaio',
        email: 'operaio@example.test',
        password: '$2b$10$hash-operaio-non-pubblico',
        role: 'worker',
        isActive: true,
      }]));
      assert.throws(
        () => db.restoreSnapshot(noAdminName, user),
        /amministratore attivo/,
      );

      db.close();
      const interruptedDb = `${db.dbPath}.previous`;
      const interruptedUsers = `${db.usersPath}.previous`;
      const interruptedAttachments = `${db.attachmentsDir}.previous`;
      fs.renameSync(db.dbPath, interruptedDb);
      fs.renameSync(db.usersPath, interruptedUsers);
      fs.renameSync(db.attachmentsDir, interruptedAttachments);
      fs.writeFileSync(path.join(dataDir, '.restore-journal.json'), JSON.stringify({
        state: 'swapping',
        previousDb: interruptedDb,
        previousUsers: interruptedUsers,
        previousAttachments: interruptedAttachments,
      }));
      const recovered = new CrmDatabase({ dataDir, backupDir, attachmentsDir });
      assert.ok(recovered.get('project', created.item.id));
      assert.equal(fs.existsSync(path.join(dataDir, '.restore-journal.json')), false);
      recovered.close();
      db.open();
""",
)
marker = """    const health = await requestJson(baseUrl, '/health');
    assert.equal(health.response.ok, true, 'L’endpoint health deve rispondere');
    assert.equal(health.body.mode, 'central-server');
"""
replace_once(
    smoke,
    marker,
    marker + """

    const hostileOrigin = await requestJson(baseUrl, '/health', {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(hostileOrigin.response.status, 403, 'Le origini web esterne devono essere bloccate');
    const electronOrigin = await requestJson(baseUrl, '/health', {
      headers: { Origin: 'null' },
    });
    assert.equal(electronOrigin.response.status, 200, 'Le pagine Electron file:// devono poter usare l’API');
""",
)
marker = """    const daily = await requestJson(baseUrl, '/analytics/daily/2030-01-01', {
      headers: authHeaders(adminToken),
    });
"""
replace_once(
    smoke,
    marker,
    """    instance.db.importEntity('order', {
      id: 'ordine-mezzanotte-roma',
      title: 'Ordine dopo mezzanotte locale',
      status: 'In Attesa',
      createdAt: '2030-01-01T23:30:00.000Z',
      updatedAt: '2030-01-01T23:30:00.000Z',
    });
    const localMidnightDaily = await requestJson(baseUrl, '/analytics/daily/2030-01-02', {
      headers: authHeaders(adminToken),
    });
    assert.ok(
      localMidnightDaily.body.newOrders >= 1,
      'Le 00:30 italiane devono appartenere al giorno locale, non al giorno UTC precedente',
    );

""" + marker,
)

setup_test = ROOT / 'server/setup-test.js'
replace_once(
    setup_test,
    """      serverName: 'Setup CI',
    });
""",
    """      serverName: 'Setup CI',
      setupSecret: 'segreto-setup-ci',
    });
""",
)
marker = """    const shortPassword = await requestJson(baseUrl, '/auth/login', {
"""
replace_once(
    setup_test,
    marker,
    """    const missingSecret = await requestJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'proprietario',
        password: 'Password-forte-123',
        email: 'proprietario@example.test',
        firstName: 'Mario',
        lastName: 'Bianchi',
      }),
    });
    assert.equal(missingSecret.response.status, 403, 'Il setup HTTP senza segreto desktop deve essere rifiutato');

""" + marker,
)
replace_once(
    setup_test,
    """    const setup = await requestJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({
""",
    """    const setup = await requestJson(baseUrl, '/auth/login', {
      method: 'POST',
      headers: { 'X-CRM-Setup-Secret': 'segreto-setup-ci' },
      body: JSON.stringify({
""",
)
replace_once(
    setup_test,
    """    const shortPassword = await requestJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'proprietario', password: 'corta' }),
    });
""",
    """    const shortPassword = await requestJson(baseUrl, '/auth/login', {
      method: 'POST',
      headers: { 'X-CRM-Setup-Secret': 'segreto-setup-ci' },
      body: JSON.stringify({ username: 'proprietario', password: 'corta' }),
    });
""",
)


# ---------------------------------------------------------------------------
# Scripts and final read-only CI workflow
# ---------------------------------------------------------------------------
server_package = ROOT / 'server/package.json'
text = server_package.read_text().replace(
    'node --check database.js && node --check middleware/auth.js',
    'node --check database.js && node --check restore-safety.js && node --check middleware/auth.js',
)
server_package.write_text(text)

final_workflow = '''name: Verify CRM Marmeria

on:
  pull_request:
    branches: [master]
  push:
    branches:
      - fix/core-reliability-2026-07

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: crm-marmeria
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: |
            crm-marmeria/package-lock.json
            crm-marmeria/server/package-lock.json

      - name: Install Electron app dependencies
        run: npm ci

      - name: Install standalone server dependencies
        run: npm ci --prefix server

      - name: Check Node and Electron syntax
        run: |
          node --check server/index.js
          node --check server/app.js
          node --check server/database.js
          node --check server/restore-safety.js
          node --check server/middleware/auth.js
          node --check server/snapshot-compat.js
          node --check server/smoke-test.js
          node --check server/setup-test.js
          node --check electron/main.cjs
          node --check electron/server.cjs
          node --check electron/discovery.cjs
          node --check electron/preload.cjs
          node --check electron/native-smoke.cjs

      - name: Typecheck TypeScript
        id: typecheck
        continue-on-error: true
        run: npm run typecheck > typecheck-report.txt 2>&1

      - name: Upload TypeScript report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: typecheck-report
          path: crm-marmeria/typecheck-report.txt
          if-no-files-found: error
          retention-days: 3

      - name: Enforce TypeScript result
        if: steps.typecheck.outcome == 'failure'
        run: |
          cat typecheck-report.txt
          exit 1

      - name: Audit production dependencies
        run: npm audit --omit=dev --json > production-audit.json || true

      - name: Upload dependency audit
        uses: actions/upload-artifact@v4
        with:
          name: production-audit
          path: crm-marmeria/production-audit.json
          if-no-files-found: error
          retention-days: 3

      - name: Test frontend utilities
        run: npm test -- --run

      - name: Test secure first-run setup
        run: node server/setup-test.js

      - name: Test SQLite create
        run: node server/smoke-test.js create

      - name: Test SQLite update
        run: node server/smoke-test.js update

      - name: Test SQLite conflict detection
        run: node server/smoke-test.js conflict

      - name: Test data integrity and attachments
        run: node server/smoke-test.js integrity

      - name: Test validated snapshot restore and power-loss recovery
        run: node server/smoke-test.js snapshot

      - name: Test central server permissions, CORS, dates and realtime
        env:
          TZ: Europe/Rome
        run: node server/smoke-test.js server

      - name: Test Electron native modules
        id: electron_native
        continue-on-error: true
        run: timeout 30s xvfb-run -a ./node_modules/.bin/electron electron/native-smoke.cjs --no-sandbox > electron-native-report.txt 2>&1

      - name: Upload Electron native report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: electron-native-report
          path: crm-marmeria/electron-native-report.txt
          if-no-files-found: error
          retention-days: 3

      - name: Enforce Electron native result
        if: steps.electron_native.outcome == 'failure'
        run: |
          cat electron-native-report.txt
          exit 1

      - name: Build frontend
        run: npm run build

      - name: Package Electron directory
        run: timeout 180s npx electron-builder --linux dir --publish never
'''
(REPO / '.github/workflows/verify-crm.yml').write_text(final_workflow)
