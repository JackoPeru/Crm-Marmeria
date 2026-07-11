const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let dataDirectory = path.join(__dirname, '../data');
const configuredJwtSecret = process.env.JWT_SECRET || null;
let jwtSecret = configuredJwtSecret;
let authEpoch = null;
let usersMutationQueue = Promise.resolve();
const seedUsersPath = path.join(__dirname, '../data/users.json');
const JWT_EXPIRES_IN = '24h';
const COMPROMISED_DEFAULT_HASHES = new Set([
  '$2b$10$xgjipj3RtM9D8nyR2J8RnOPAtJ.aAyxrVpPmAXDbFnJmbfrdQVTsG',
  '$2b$10$1rfGdxxl/DQDLqJn6lE0HuYAiBNC4f/KVSCUCQ1Gc6hgeOWTKrnJG',
]);
const PUBLIC_DEFAULT_PASSWORDS = ['admin123', 'operaio123'];
const compromisedHashCache = new Map();

const usersFile = () => path.join(dataDirectory, 'users.json');
const authEpochFile = () => path.join(dataDirectory, '.auth-epoch');

const setPrivatePermissions = (filePath) => {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Alcuni filesystem Windows non applicano i permessi POSIX.
  }
};

const writePrivateFile = (filePath, value) => {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'w', 0o600);
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, filePath);
    setPrivatePermissions(filePath);
  } catch (error) {
    if (descriptor != null) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    throw error;
  }
};

const isCompromisedLegacyAccount = (user) => {
  const hash = String(user?.password || '');
  if (!hash) return false;
  if (COMPROMISED_DEFAULT_HASHES.has(hash)) return true;
  if (compromisedHashCache.has(hash)) return compromisedHashCache.get(hash);
  let compromised = false;
  try {
    compromised = PUBLIC_DEFAULT_PASSWORDS.some((password) => bcrypt.compareSync(password, hash));
  } catch {
    compromised = false;
  }
  if (compromisedHashCache.size > 500) compromisedHashCache.clear();
  compromisedHashCache.set(hash, compromised);
  return compromised;
};

const readUsersRaw = () => {
  if (!fs.existsSync(usersFile())) return [];
  const users = JSON.parse(fs.readFileSync(usersFile(), 'utf8'));
  if (!Array.isArray(users)) throw new Error('Il file utenti non contiene un elenco valido');
  return users;
};

const readUsers = () => readUsersRaw().filter((user) => !isCompromisedLegacyAccount(user));

const writeUsers = (users) => {
  try {
    writePrivateFile(usersFile(), JSON.stringify(users, null, 2));
    return true;
  } catch (error) {
    console.error('Errore scrittura utenti:', error);
    return false;
  }
};

const mutateUsers = (mutator) => {
  const task = usersMutationQueue.then(async () => {
    const users = readUsers();
    const result = await mutator(users);
    const activeAdmins = users.filter((user) => user.role === 'admin' && user.isActive);
    if (users.length > 0 && activeAdmins.length === 0) {
      const error = new Error('Deve rimanere almeno un amministratore attivo');
      error.status = 400;
      throw error;
    }
    if (result?.write !== false && !writeUsers(users)) {
      throw new Error('Salvataggio utenti fallito');
    }
    return result?.value;
  });
  usersMutationQueue = task.catch(() => undefined);
  return task;
};

const drainUserMutations = async () => {
  await usersMutationQueue;
};

const writeJsonAtomically = (filePath, value) => {
  writePrivateFile(filePath, JSON.stringify(value, null, 2));
};

const rotateAuthEpoch = () => {
  authEpoch = crypto.randomBytes(32).toString('hex');
  writePrivateFile(authEpochFile(), authEpoch);
  return authEpoch;
};

const getAuthEpoch = () => authEpoch;

const configureAuth = ({ dataDir }) => {
  dataDirectory = dataDir || dataDirectory;
  usersMutationQueue = Promise.resolve();
  compromisedHashCache.clear();
  fs.mkdirSync(dataDirectory, { recursive: true });
  const usersPath = usersFile();
  if (!fs.existsSync(usersPath)) {
    if (fs.existsSync(seedUsersPath) && path.resolve(seedUsersPath) !== path.resolve(usersPath)) {
      fs.copyFileSync(seedUsersPath, usersPath);
      setPrivatePermissions(usersPath);
    } else {
      writePrivateFile(usersPath, '[]');
    }
  } else {
    setPrivatePermissions(usersPath);
  }

  jwtSecret = configuredJwtSecret;
  if (!jwtSecret) {
    const secretPath = path.join(dataDirectory, '.jwt-secret');
    if (!fs.existsSync(secretPath)) {
      writePrivateFile(secretPath, crypto.randomBytes(48).toString('hex'));
    } else {
      setPrivatePermissions(secretPath);
    }
    jwtSecret = fs.readFileSync(secretPath, 'utf8').trim();
  }
  if (!jwtSecret) throw new Error('Segreto JWT non disponibile');

  if (!fs.existsSync(authEpochFile())) rotateAuthEpoch();
  else {
    setPrivatePermissions(authEpochFile());
    authEpoch = fs.readFileSync(authEpochFile(), 'utf8').trim();
  }
  if (!authEpoch) rotateAuthEpoch();

  const users = readUsersRaw();
  const safeUsers = users.filter((user) => !isCompromisedLegacyAccount(user));
  if (safeUsers.length !== users.length) {
    if (!writeUsers(safeUsers)) throw new Error('Rimozione account predefiniti non sicuri fallita');
    console.warn('Account con password predefinite pubbliche rimossi: completare la configurazione iniziale sul PC principale.');
  }

  const clientsPath = path.join(dataDirectory, 'clients.json');
  if (fs.existsSync(clientsPath)) {
    try {
      const clients = JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
      if (Array.isArray(clients)) {
        let changed = false;
        const migrated = clients.map((client) => {
          if (!client.clientType && client.type && client.type !== 'client') {
            changed = true;
            return { ...client, clientType: client.type };
          }
          return client;
        });
        if (changed) writeJsonAtomically(clientsPath, migrated);
      }
    } catch (error) {
      console.error('Migrazione tipo cliente fallita:', error);
    }
  }
};

const verifyToken = (token) => {
  if (!token || !jwtSecret || !authEpoch) return null;
  try {
    const payload = jwt.verify(token, jwtSecret);
    if (payload.epoch !== authEpoch) return null;
    const user = readUsers().find(
      (entry) => String(entry.id) === String(payload.id) && entry.isActive,
    );
    if (!user) return null;
    if (Number(payload.sessionVersion || 1) !== Number(user.sessionVersion || 1)) return null;
    return user;
  } catch {
    return null;
  }
};

const authenticateToken = (req, res, next) => {
  const authorization = String(req.headers.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];
  if (!token) return res.status(401).json({ error: 'Token di accesso richiesto' });
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Sessione scaduta o utente disattivato' });
  req.user = user;
  req.authToken = token;
  next();
};

const requirePermission = (permission) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Autenticazione richiesta' });
  if (!Array.isArray(req.user.permissions) || !req.user.permissions.includes(permission)) {
    return res.status(403).json({ error: 'Permessi insufficienti' });
  }
  next();
};

const requireRole = (roles) => {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Autenticazione richiesta' });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Ruolo insufficiente' });
    }
    next();
  };
};

const generateToken = (user) => jwt.sign(
  {
    id: String(user.id),
    epoch: authEpoch,
    sessionVersion: Number(user.sessionVersion || 1),
  },
  jwtSecret,
  { expiresIn: JWT_EXPIRES_IN },
);

const hashPassword = (password) => {
  const normalized = String(password || '');
  if (PUBLIC_DEFAULT_PASSWORDS.includes(normalized)) {
    const error = new Error('Questa password predefinita è pubblica e non può essere utilizzata');
    error.status = 400;
    throw error;
  }
  return bcrypt.hash(normalized, 10);
};

const verifyPassword = (password, hashedPassword) => bcrypt.compare(password, hashedPassword);
const findUserByCredentials = (identifier) => {
  const normalized = String(identifier || '').trim().toLowerCase();
  return readUsers().find((user) => (
    (String(user.username || '').toLowerCase() === normalized
      || String(user.email || '').toLowerCase() === normalized)
    && user.isActive
  ));
};

module.exports = {
  configureAuth,
  authenticateToken,
  requirePermission,
  requireRole,
  generateToken,
  hashPassword,
  verifyPassword,
  verifyToken,
  findUserByCredentials,
  readUsers,
  writeUsers,
  mutateUsers,
  drainUserMutations,
  usersFile,
  rotateAuthEpoch,
  getAuthEpoch,
};
