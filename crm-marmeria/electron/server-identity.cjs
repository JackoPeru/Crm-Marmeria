const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidServerId = (value) => UUID_PATTERN.test(String(value || '').trim());

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

const readOrCreateServerId = (filePath) => {
  let current = '';
  try {
    current = fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    current = '';
  }
  if (isValidServerId(current)) {
    try { fs.chmodSync(filePath, 0o600); } catch { /* Windows */ }
    return current;
  }
  const generated = crypto.randomUUID();
  writePrivateTextAtomically(filePath, generated);
  return generated;
};

module.exports = {
  isValidServerId,
  readOrCreateServerId,
  writePrivateTextAtomically,
};
