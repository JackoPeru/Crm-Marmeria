const { pathToFileURL } = require('url');
const https = require('https');

const normalizeUrlForComparison = (value) => {
  const parsed = new URL(String(value || ''));
  parsed.hash = '';
  return parsed;
};

const createRendererTrustChecker = ({ isDev, productionFile, devOrigin = 'http://localhost:5173' }) => {
  const expectedProduction = normalizeUrlForComparison(
    productionFile.startsWith('file:') ? productionFile : pathToFileURL(productionFile).toString(),
  );
  const expectedDev = new URL(devOrigin);

  return (value) => {
    try {
      const parsed = normalizeUrlForComparison(value);
      if (isDev) {
        return parsed.origin === expectedDev.origin;
      }
      return parsed.protocol === 'file:'
        && parsed.pathname === expectedProduction.pathname
        && parsed.host === expectedProduction.host;
    } catch {
      return false;
    }
  };
};

const createSerializedExecutor = () => {
  let queue = Promise.resolve();
  return (task) => {
    const current = queue.then(task, task);
    queue = current.catch(() => undefined);
    return current;
  };
};

const probeApi = async (
  apiUrl,
  expectedServerId = null,
  {
    normalizeApiUrl,
    fetchImpl = global.fetch,
    timeoutMs = 5000,
    expectedTlsFingerprint = null,
    trustOnFirstUse = false,
  } = {},
) => {
  if (typeof normalizeApiUrl !== 'function') throw new Error('Normalizzatore API non disponibile');
  if (typeof fetchImpl !== 'function') throw new Error('Client HTTP non disponibile');

  const normalized = normalizeApiUrl(apiUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = (expectedTlsFingerprint || trustOnFirstUse) && normalized.startsWith('https:')
      ? await new Promise((resolve, reject) => {
        const request = https.get(`${normalized}/health`, { rejectUnauthorized: false, timeout: timeoutMs }, (result) => {
          let body = '';
          const fingerprint = result.socket?.getPeerCertificate?.().fingerprint || '';
          result.setEncoding('utf8');
          result.on('data', (chunk) => { body += chunk; });
          result.on('end', () => {
            if (!fingerprint) return reject(new Error('Il server non ha presentato un certificato TLS'));
            if (expectedTlsFingerprint && fingerprint.toLowerCase() !== String(expectedTlsFingerprint).toLowerCase()) {
              return reject(new Error('Certificato server non corrispondente'));
            }
            try {
              resolve({
                ok: result.statusCode === 200,
                status: result.statusCode,
                tlsFingerprint: fingerprint,
                json: async () => JSON.parse(body),
              });
            } catch (error) { reject(error); }
          });
        });
        request.on('timeout', () => request.destroy(new Error('Timeout server')));
        request.on('error', reject);
      })
      : await fetchImpl(`${normalized}/health`, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) {
      const error = new Error(`Il server ha risposto con stato ${response.status}`);
      error.code = 'SERVER_UNREACHABLE';
      throw error;
    }
    const data = await response.json();
    if (data?.mode !== 'central-server' || !data?.serverId || !data?.dataEpoch) {
      const error = new Error('L’indirizzo non appartiene a un server CRM Marmeria valido');
      error.code = 'INVALID_CRM_SERVER';
      throw error;
    }
    if (expectedServerId && String(data.serverId) !== String(expectedServerId)) {
      const error = new Error('Il server trovato ha un’identità diversa da quella configurata');
      error.code = 'SERVER_ID_MISMATCH';
      error.expectedServerId = String(expectedServerId);
      error.actualServerId = String(data.serverId);
      throw error;
    }
    return { apiUrl: normalized, data, tlsFingerprint: response.tlsFingerprint || null };
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Timeout durante la verifica del server centrale');
      timeoutError.code = 'SERVER_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const assertTrustedSender = (event, isTrustedRendererUrl) => {
  const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
  if (!isTrustedRendererUrl(senderUrl)) {
    const error = new Error('Chiamata IPC rifiutata da un’origine non autorizzata');
    error.code = 'UNTRUSTED_IPC_SENDER';
    throw error;
  }
};

module.exports = {
  assertTrustedSender,
  createRendererTrustChecker,
  createSerializedExecutor,
  probeApi,
};
