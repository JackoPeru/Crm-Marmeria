const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_SECRET_PATTERN = /^[0-9a-f]{64,}$/i;

const writePrivateTextAtomically = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(descriptor, String(value));
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch { /* Windows */ }
};

const readText = (filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
};

const readOrCreateServerId = (filePath) => {
  const current = readText(filePath);
  if (UUID_PATTERN.test(current)) {
    try { fs.chmodSync(filePath, 0o600); } catch { /* Windows */ }
    return current;
  }
  const generated = crypto.randomUUID();
  writePrivateTextAtomically(filePath, generated);
  return generated;
};

const readOrCreateSetupSecret = (filePath) => {
  const current = readText(filePath);
  if (HEX_SECRET_PATTERN.test(current)) {
    try { fs.chmodSync(filePath, 0o600); } catch { /* Windows */ }
    return current;
  }
  const generated = crypto.randomBytes(48).toString('hex');
  writePrivateTextAtomically(filePath, generated);
  return generated;
};

module.exports = {
  readOrCreateServerId,
  readOrCreateSetupSecret,
  writePrivateTextAtomically,
};
