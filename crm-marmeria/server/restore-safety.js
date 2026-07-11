const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');

const REQUIRED_TABLES = new Set([
  'entities',
  'audit_log',
  'operations',
  'attachments',
  'metadata',
]);

const COMPROMISED_DEFAULT_HASHES = new Set([
  '$2b$10$xgjipj3RtM9D8nyR2J8RnOPAtJ.aAyxrVpPmAXDbFnJmbfrdQVTsG',
  '$2b$10$1rfGdxxl/DQDLqJn6lE0HuYAiBNC4f/KVSCUCQ1Gc6hgeOWTKrnJG',
]);
const PUBLIC_DEFAULT_PASSWORDS = ['admin123', 'operaio123'];

const removePath = (target) => {
  if (!target || !fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
};

const isCompromisedLegacyAccount = (user) => {
  if (!user?.password) return false;
  if (COMPROMISED_DEFAULT_HASHES.has(user.password)) return true;
  try {
    return PUBLIC_DEFAULT_PASSWORDS.some((password) => (
      bcrypt.compareSync(password, user.password)
    ));
  } catch {
    return false;
  }
};

const syncFile = (filePath) => {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
};

const syncDirectory = (directoryPath) => {
  try {
    const descriptor = fs.openSync(directoryPath, 'r');
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    // Windows non consente sempre fsync su una directory; i file sono già sincronizzati.
  }
};

const syncTree = (target) => {
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
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, 'w');
  try {
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2));
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, filePath);
  syncDirectory(path.dirname(filePath));
};

const parseStoredJson = (value, label) => {
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

const restorePaths = ({ dataDir, dbPath, usersPath, attachmentsDir }) => ({
  journalPath: path.join(dataDir, '.restore-journal.json'),
  previousDb: `${dbPath}.previous`,
  previousUsers: `${usersPath}.previous`,
  previousAttachments: `${attachmentsDir}.previous`,
});

const recoverInterruptedRestore = ({ dataDir, dbPath, usersPath, attachmentsDir }) => {
  const defaults = restorePaths({ dataDir, dbPath, usersPath, attachmentsDir });
  if (!fs.existsSync(defaults.journalPath)) return false;

  let journal;
  try {
    journal = JSON.parse(fs.readFileSync(defaults.journalPath, 'utf8'));
  } catch {
    journal = { state: 'swapping' };
  }

  const previousDb = journal.previousDb || defaults.previousDb;
  const previousUsers = journal.previousUsers || defaults.previousUsers;
  const previousAttachments = journal.previousAttachments || defaults.previousAttachments;
  let shouldRollback = journal.state !== 'committed'
    || !fs.existsSync(dbPath)
    || !fs.existsSync(usersPath)
    || !fs.existsSync(attachmentsDir);

  if (!shouldRollback) {
    try {
      validateDatabase(dbPath, attachmentsDir);
      validateUsers(usersPath);
    } catch (error) {
      console.error('Ripristino committato non valido, recupero la versione precedente:', error.message);
      shouldRollback = true;
    }
  }

  if (shouldRollback) {
    if (fs.existsSync(previousDb)) {
      removePath(dbPath);
      fs.renameSync(previousDb, dbPath);
    }
    if (fs.existsSync(previousUsers)) {
      removePath(usersPath);
      fs.renameSync(previousUsers, usersPath);
    }
    if (fs.existsSync(previousAttachments)) {
      removePath(attachmentsDir);
      fs.renameSync(previousAttachments, attachmentsDir);
    }
  }

  removePath(previousDb);
  removePath(previousUsers);
  removePath(previousAttachments);
  removePath(journal.stageRoot);
  removePath(defaults.journalPath);
  syncDirectory(dataDir);
  return true;
};

module.exports = {
  atomicWriteJson,
  recoverInterruptedRestore,
  restorePaths,
  syncDirectory,
  syncFile,
  syncTree,
  validateDatabase,
  validateUsers,
};
