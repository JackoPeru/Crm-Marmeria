from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if old not in text:
        raise RuntimeError(f'Pattern not found in {path}: {old[:180]!r}')
    path.write_text(text.replace(old, new, 1))


restore = ROOT / 'server/restore-safety.js'
text = restore.read_text()
start = text.index('const validateDatabase = (databasePath) => {')
end = text.index('\nconst restorePaths =', start)
validation = r'''const parseStoredJson = (value, label) => {
  try {
    const parsed = JSON.parse(value);
    if (parsed == null || typeof parsed !== 'object') throw new Error('contenuto non strutturato');
    return parsed;
  } catch (error) {
    const wrapped = new Error(`JSON interno non valido in ${label}: ${error.message}`);
    wrapped.status = 400;
    throw wrapped;
  }
};

const validateDatabase = (databasePath, attachmentsDir = null) => {
  let database;
  try {
    database = new Database(databasePath, { readonly: true, fileMustExist: true });
    const integrity = database.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`Controllo integrità SQLite fallito: ${integrity}`);
    const tables = new Set(database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all().map((row) => row.name));
    const missing = [...REQUIRED_TABLES].filter((table) => !tables.has(table));
    if (missing.length) throw new Error(`Database backup incompleto: mancano ${missing.join(', ')}`);

    const entities = new Set();
    for (const row of database.prepare('SELECT * FROM entities').all()) {
      const data = parseStoredJson(row.data_json, `entities ${row.entity_type}/${row.id}`);
      if (!row.entity_type || !row.id || String(data.id || row.id) !== String(row.id)) {
        throw new Error(`Entità non coerente: ${row.entity_type}/${row.id}`);
      }
      if (!Number.isInteger(Number(row.version)) || Number(row.version) < 1) {
        throw new Error(`Versione entità non valida: ${row.entity_type}/${row.id}`);
      }
      entities.add(`${row.entity_type}|${row.id}`);
    }
    for (const row of database.prepare('SELECT * FROM audit_log').all()) {
      if (row.previous_json != null) parseStoredJson(row.previous_json, `audit previous ${row.id}`);
      if (row.next_json != null) parseStoredJson(row.next_json, `audit next ${row.id}`);
    }
    for (const row of database.prepare('SELECT * FROM operations').all()) {
      parseStoredJson(row.response_json, `operation ${row.operation_id}`);
    }
    for (const row of database.prepare('SELECT * FROM attachments').all()) {
      if (!entities.has(`${row.entity_type}|${row.entity_id}`)) {
        throw new Error(`Allegato riferito a entità inesistente: ${row.id}`);
      }
      if (!row.stored_name || path.basename(row.stored_name) !== row.stored_name) {
        throw new Error(`Nome file allegato non valido: ${row.id}`);
      }
      if (!Number.isInteger(Number(row.size_bytes)) || Number(row.size_bytes) < 0) {
        throw new Error(`Dimensione allegato non valida: ${row.id}`);
      }
      if (attachmentsDir) {
        const safeEntityId = crypto.createHash('sha256').update(String(row.entity_id)).digest('hex');
        const filePath = path.join(attachmentsDir, row.entity_type, safeEntityId, row.stored_name);
        if (!fs.existsSync(filePath)) throw new Error(`Allegato mancante: ${row.original_name || row.id}`);
        const stat = fs.lstatSync(filePath);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Allegato non regolare: ${row.id}`);
        if (stat.size !== Number(row.size_bytes)) throw new Error(`Dimensione allegato discordante: ${row.id}`);
      }
    }
    return true;
  } catch (error) {
    const wrapped = new Error(`Database del backup non valido: ${error.message}`);
    wrapped.status = 400;
    throw wrapped;
  } finally {
    if (database?.open) database.close();
  }
};

const validateUsers = (usersPath) => {
  let users;
  try {
    users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  } catch (error) {
    const wrapped = new Error(`File account del backup non valido: ${error.message}`);
    wrapped.status = 400;
    throw wrapped;
  }
  if (!Array.isArray(users) || users.length === 0) {
    const error = new Error('Il backup non contiene account utilizzabili');
    error.status = 400;
    throw error;
  }

  const ids = new Set();
  const usernames = new Set();
  const emails = new Set();
  for (const user of users) {
    const id = String(user?.id || '').trim();
    const username = String(user?.username || '').trim().toLowerCase();
    const email = String(user?.email || '').trim().toLowerCase();
    if (!id || !username || !user?.password || !['admin', 'manager', 'worker'].includes(user.role)) {
      const error = new Error('Il backup contiene un account incompleto o con ruolo non valido');
      error.status = 400;
      throw error;
    }
    try {
      const rounds = bcrypt.getRounds(String(user.password));
      if (!Number.isInteger(rounds) || rounds < 10) throw new Error('costo insufficiente');
    } catch {
      const error = new Error(`Il backup contiene un hash password non valido per ${username}`);
      error.status = 400;
      throw error;
    }
    if (typeof user.isActive !== 'boolean') {
      const error = new Error(`Il backup contiene uno stato account non valido per ${username}`);
      error.status = 400;
      throw error;
    }
    if (user.permissions != null && (!Array.isArray(user.permissions) || user.permissions.some((permission) => typeof permission !== 'string'))) {
      const error = new Error(`Il backup contiene permessi non validi per ${username}`);
      error.status = 400;
      throw error;
    }
    if (user.sessionVersion != null && (!Number.isInteger(Number(user.sessionVersion)) || Number(user.sessionVersion) < 1)) {
      const error = new Error(`Il backup contiene una versione sessione non valida per ${username}`);
      error.status = 400;
      throw error;
    }
    if (isCompromisedLegacyAccount(user)) {
      const error = new Error('Il backup contiene un vecchio account con password pubblica e non sicura');
      error.status = 400;
      throw error;
    }
    if (ids.has(id) || usernames.has(username) || (email && emails.has(email))) {
      const error = new Error('Il backup contiene account duplicati');
      error.status = 400;
      throw error;
    }
    ids.add(id);
    usernames.add(username);
    if (email) emails.add(email);
  }

  if (!users.some((user) => user.role === 'admin' && user.isActive)) {
    const error = new Error('Il backup non contiene alcun amministratore attivo');
    error.status = 400;
    throw error;
  }
  return users;
};
'''
restore.write_text(text[:start] + validation + text[end:])
replace_once(restore, 'validateDatabase(dbPath);\n      validateUsers(usersPath);', 'validateDatabase(dbPath, attachmentsDir);\n      validateUsers(usersPath);')

database = ROOT / 'server/database.js'
replace_once(database, 'validateDatabase(stageDb);\n      validateUsers(stageUsers);', 'validateDatabase(stageDb, stageAttachments);\n      validateUsers(stageUsers);')
replace_once(database, 'validateDatabase(this.dbPath);\n      validateUsers(this.usersPath);', 'validateDatabase(this.dbPath, this.attachmentsDir);\n      validateUsers(this.usersPath);')

smoke = ROOT / 'server/smoke-test.js'
text = smoke.read_text()
text = text.replace("password: '$2b$10$hash-di-test-non-pubblico',", "password: bcrypt.hashSync('Backup-credential-123', 10),")
text = text.replace("password: '$2b$10$hash-corrente-non-pubblico',", "password: bcrypt.hashSync('Current-credential-123', 10),")
text = text.replace("password: '$2b$10$hash-operaio-non-pubblico',", "password: bcrypt.hashSync('Worker-credential-123', 10),")
smoke.write_text(text)
