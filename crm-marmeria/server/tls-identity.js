const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

const writePrivate = (filePath, value) => {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, value, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch { /* Windows */ }
};

const readIdentity = (directory) => {
  const key = path.join(directory, 'server-key.pem');
  const cert = path.join(directory, 'server-cert.pem');
  const fingerprint = path.join(directory, 'server-fingerprint.txt');
  if (!fs.existsSync(key) || !fs.existsSync(cert) || !fs.existsSync(fingerprint)) return null;
  return {
    key: fs.readFileSync(key),
    cert: fs.readFileSync(cert),
    fingerprint: fs.readFileSync(fingerprint, 'utf8').trim(),
  };
};

const readOrCreateTlsIdentity = async (directory, commonName) => {
  fs.mkdirSync(directory, { recursive: true });
  const current = readIdentity(directory);
  if (current?.fingerprint) return current;

  const generated = await selfsigned.generate([{ name: 'commonName', value: commonName }], {
    algorithm: 'sha256',
    keySize: 2048,
    extensions: [{ name: 'basicConstraints', cA: false }],
  });
  writePrivate(path.join(directory, 'server-key.pem'), generated.private);
  writePrivate(path.join(directory, 'server-cert.pem'), generated.cert);
  writePrivate(path.join(directory, 'server-fingerprint.txt'), generated.fingerprint);
  return {
    key: Buffer.from(generated.private),
    cert: Buffer.from(generated.cert),
    fingerprint: generated.fingerprint,
  };
};

module.exports = { readOrCreateTlsIdentity };
