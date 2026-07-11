const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let dataDirectory = path.join(__dirname, '../data');
const configuredJwtSecret = process.env.JWT_SECRET || null;
let jwtSecret = configuredJwtSecret;
let usersMutationQueue = Promise.resolve();
const seedUsersPath = path.join(__dirname, '../data/users.json');
const JWT_EXPIRES_IN = '24h';
const COMPROMISED_DEFAULT_HASHES = new Set([
  '$2b$10$xgjipj3RtM9D8nyR2J8RnOPAtJ.aAyxrVpPmAXDbFnJmbfrdQVTsG',
  '$2b$10$1rfGdxxl/DQDLqJn6lE0HuYAiBNC4f/KVSCUCQ1Gc6hgeOWTKrnJG',
]);

const usersFile = () => path.join(dataDirectory, 'users.json');

const readUsersRaw = () => {
  if (!fs.existsSync(usersFile())) return [];
  const users = JSON.parse(fs.readFileSync(usersFile(), 'utf8'));
  if (!Array.isArray(users)) throw new Error('Il file utenti non contiene un elenco valido');
  return users;
};

const readUsers = () => readUsersRaw().filter(
  (user) => !COMPROMISED_DEFAULT_HASHES.has(user.password),
);

const writeUsers = (users) => {
  const filePath = usersFile();
  const temporary = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(users, null, 2));
    fs.renameSync(temporary, filePath);
    return true;
  } catch (error) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    console.error('Errore scrittura utenti:', error);
    return false;
  }
};

const mutateUsers = (mutator) => {
  const task = usersMutationQueue.then(async () => {
    const users = readUsers();
    const result = await mutator(users);
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
  const temporary = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, filePath);
};

const configureAuth = ({ dataDir }) => {
  dataDirectory = dataDir || dataDirectory;
  usersMutationQueue = Promise.resolve();
  fs.mkdirSync(dataDirectory, { recursive: true });
  const usersPath = usersFile();
  if (!fs.existsSync(usersPath)) {
    if (fs.existsSync(seedUsersPath) && path.resolve(seedUsersPath) !== path.resolve(usersPath)) {
      fs.copyFileSync(seedUsersPath, usersPath);
    } else {
      fs.writeFileSync(usersPath, '[]');
    }
  }

  jwtSecret = configuredJwtSecret;
  if (!jwtSecret) {
    const secretPath = path.join(dataDirectory, '.jwt-secret');
    if (!fs.existsSync(secretPath)) {
      fs.writeFileSync(secretPath, crypto.randomBytes(48).toString('hex'));
    }
    jwtSecret = fs.readFileSync(secretPath, 'utf8').trim();
  }
  if (!jwtSecret) throw new Error('Segreto JWT non disponibile');

  let users = readUsersRaw();
  const safeUsers = users.filter((user) => !COMPROMISED_DEFAULT_HASHES.has(user.password));
  if (safeUsers.length !== users.length) {
    if (!writeUsers(safeUsers)) throw new Error('Rimozione account predefiniti non sicuri fallita');
    users = safeUsers;
    console.warn('Account predefiniti rimossi: completare la configurazione iniziale sul PC principale.');
  }

  let usersChanged = false;
  const requiredWorkerPermissions = [
    'dashboard.view',
    'projects.view', 'projects.edit',
    'materials.view', 'materials.edit',
    'orders.view', 'orders.edit',
  ];
  const migratedUsers = users.map((user) => {
    if (user.role !== 'worker') return user;
    const permissions = new Set(Array.isArray(user.permissions) ? user.permissions : []);
    const before = permissions.size;
    requiredWorkerPermissions.forEach((permission) => permissions.add(permission));
    if (permissions.size !== before) usersChanged = true;
    return { ...user, permissions: [...permissions] };
  });
  if (usersChanged && !writeUsers(migratedUsers)) {
    throw new Error('Migrazione permessi operai fallita');
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
  if (!token || !jwtSecret) return null;
  try {
    const payload = jwt.verify(token, jwtSecret);
    return readUsers().find(
      (user) => String(user.id) === String(payload.id) && user.isActive,
    ) || null;
  } catch {
    return null;
  }
};

const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
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
  { id: String(user.id) },
  jwtSecret,
  { expiresIn: JWT_EXPIRES_IN },
);
const hashPassword = (password) => bcrypt.hash(password, 10);
const verifyPassword = (password, hashedPassword) => bcrypt.compare(password, hashedPassword);
const findUserByCredentials = (identifier) => readUsers().find((user) => (
  (user.username === identifier || user.email === identifier) && user.isActive
));

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
};
