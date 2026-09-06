const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const forge = require('node-forge');

// CA locale di lunga durata (installata una volta sui client) + certificati
// foglia con SAN firmati dalla CA. Così i browser fidano l'HTTPS senza avvisi
// dopo la prima installazione della CA, e le rotazioni della foglia restano
// trasparenti.
const CA_VALIDITY_YEARS = 10;
const LEAF_VALIDITY_DAYS = 825;
const RENEW_BEFORE_MS = 30 * 24 * 60 * 60 * 1000;

const fileNames = {
  caKey: 'ca-key.pem',
  caCert: 'ca-cert.pem',
  caFingerprint: 'ca-fingerprint.txt',
  serverKey: 'server-key.pem',
  serverCert: 'server-cert.pem',
  serverFingerprint: 'server-fingerprint.txt',
};

const writePrivate = (filePath, value) => {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, value, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch { /* Windows */ }
};

const writePublic = (filePath, value) => {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, value);
  fs.renameSync(temporary, filePath);
};

const readText = (directory, name) => {
  const filePath = path.join(directory, name);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
};

const derFromPem = (certPem) => {
  const cert = forge.pki.certificateFromPem(certPem);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return Buffer.from(der, 'binary');
};

// Impronta SHA-256 nel formato di Node (getPeerCertificate().fingerprint256).
const fingerprintOfPem = (certPem) => crypto.createHash('sha256')
  .update(derFromPem(certPem))
  .digest('hex')
  .toUpperCase()
  .replace(/(..)(?=.)/g, '$1:');

const normalizeSans = (sans) => [...new Set(
  (Array.isArray(sans) ? sans : [])
    .map((entry) => String(entry || '').trim().replace(/\/$/, ''))
    .filter(Boolean),
)];

const defaultSans = () => ['localhost', '127.0.0.1', '::1'];

const altNamesFromSans = (sans) => sans.map((entry) => {
  const ipVersion = net.isIP(entry);
  if (ipVersion !== 0) return { type: 7, ip: entry };
  return { type: 2, value: entry };
});

const distinguishedName = (commonName) => ([
  { name: 'commonName', value: commonName },
  { name: 'organizationName', value: 'CRM Marmeria LAN' },
]);

const randomSerial = () => crypto.randomBytes(16).toString('hex');

const createCa = (commonName) => {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerial();
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(now);
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + CA_VALIDITY_YEARS);
  cert.setSubject(distinguishedName(`CRM Marmeria Local CA (${commonName})`));
  cert.setIssuer(distinguishedName(`CRM Marmeria Local CA (${commonName})`));
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certPem: forge.pki.certificateToPem(cert),
  };
};

const createLeaf = ({ caKeyPem, caCertPem, commonName, sans }) => {
  const caKey = forge.pki.privateKeyFromPem(caKeyPem);
  const caCert = forge.pki.certificateFromPem(caCertPem);
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerial();
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 60 * 60 * 1000);
  cert.validity.notAfter = new Date(now.getTime() + LEAF_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
  cert.setSubject(distinguishedName(commonName));
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
    { name: 'subjectKeyIdentifier' },
    {
      name: 'authorityKeyIdentifier',
      keyIdentifier: caCert.generateSubjectKeyIdentifier().getBytes(),
    },
    {
      name: 'subjectAltName',
      altNames: altNamesFromSans(sans),
    },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  return {
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certPem: forge.pki.certificateToPem(cert),
  };
};

const leafCoversSans = (certPem, sans) => {
  try {
    const cert = forge.pki.certificateFromPem(certPem);
    const extension = cert.getExtension('subjectAltName');
    if (!extension) return false;
    const covered = new Set();
    for (const alt of extension.altNames || []) {
      if (alt.type === 7 && alt.ip) covered.add(String(alt.ip));
      if (alt.type === 2 && alt.value) covered.add(String(alt.value));
    }
    if (new Date(cert.validity.notAfter).getTime() - Date.now() < RENEW_BEFORE_MS) return false;
    return sans.every((entry) => covered.has(entry));
  } catch {
    return false;
  }
};

const issuedByCa = (leafPem, caCertPem) => {
  try {
    const leaf = forge.pki.certificateFromPem(leafPem);
    const ca = forge.pki.certificateFromPem(caCertPem);
    const caStore = forge.pki.createCaStore([ca]);
    forge.pki.verifyCertificateChain(caStore, [leaf]);
    return true;
  } catch {
    return false;
  }
};

const readOrCreateTlsIdentity = async (directory, commonName, options = {}) => {
  fs.mkdirSync(directory, { recursive: true });
  const sans = normalizeSans([...defaultSans(), ...(options.sans || [])]);

  let caKeyPem = readText(directory, fileNames.caKey);
  let caCertPem = readText(directory, fileNames.caCert);
  let caFingerprint = readText(directory, fileNames.caFingerprint)?.trim() || null;
  let caRegenerated = false;
  if (!caKeyPem || !caCertPem || !caFingerprint
    || fingerprintOfPem(caCertPem) !== caFingerprint.toUpperCase()) {
    const ca = createCa(commonName);
    caKeyPem = ca.keyPem;
    caCertPem = ca.certPem;
    caFingerprint = fingerprintOfPem(caCertPem);
    writePrivate(path.join(directory, fileNames.caKey), caKeyPem);
    writePublic(path.join(directory, fileNames.caCert), caCertPem);
    writePublic(path.join(directory, fileNames.caFingerprint), `${caFingerprint}\n`);
    caRegenerated = true;
  }

  let keyPem = readText(directory, fileNames.serverKey);
  let certPem = readText(directory, fileNames.serverCert);
  let fingerprint = readText(directory, fileNames.serverFingerprint)?.trim() || null;
  const leafValid = keyPem && certPem && fingerprint
    && !caRegenerated
    && fingerprintOfPem(certPem) === fingerprint.toUpperCase()
    && leafCoversSans(certPem, sans)
    && issuedByCa(certPem, caCertPem);
  if (!leafValid) {
    const leaf = createLeaf({ caKeyPem, caCertPem, commonName, sans });
    keyPem = leaf.keyPem;
    certPem = leaf.certPem;
    fingerprint = fingerprintOfPem(certPem);
    writePrivate(path.join(directory, fileNames.serverKey), keyPem);
    writePublic(path.join(directory, fileNames.serverCert), certPem);
    writePublic(path.join(directory, fileNames.serverFingerprint), `${fingerprint}\n`);
  }

  return {
    key: Buffer.from(keyPem),
    cert: Buffer.from(certPem),
    fingerprint,
    caCert: Buffer.from(caCertPem),
    caFingerprint,
  };
};

module.exports = { readOrCreateTlsIdentity };
