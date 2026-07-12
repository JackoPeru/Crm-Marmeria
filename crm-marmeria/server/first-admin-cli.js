const fs = require('fs');
const https = require('https');
const path = require('path');

const dataDir = process.env.CRM_DATA_DIR || path.join(__dirname, 'data');
const port = Number(process.env.PORT || 3001);
const secretPath = path.join(dataDir, '.setup-secret');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const request = (options, body = null) => new Promise((resolve, reject) => {
  const pending = https.request({ rejectUnauthorized: false, ...options }, (response) => {
    let raw = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { raw += chunk; });
    response.on('end', () => {
      try { resolve({ status: response.statusCode, body: JSON.parse(raw) }); } catch { resolve({ status: response.statusCode, body: {} }); }
    });
  });
  pending.on('error', reject);
  if (body) pending.write(body);
  pending.end();
});

async function run() {
  const payload = JSON.parse(process.env.CRM_FIRST_ADMIN_JSON || '{}');
  if (!payload.username || !payload.password || !payload.email || !payload.firstName || !payload.lastName) {
    throw new Error('Dati del primo amministratore incompleti');
  }
  if (String(payload.password).length < 10) throw new Error('La password deve contenere almeno 10 caratteri');
  const deadline = Date.now() + 45000;
  while (!fs.existsSync(secretPath) && Date.now() < deadline) await wait(300);
  if (!fs.existsSync(secretPath)) throw new Error('Server non avviato: segreto setup non trovato');
  const setupSecret = fs.readFileSync(secretPath, 'utf8').trim();
  let health = null;
  while (Date.now() < deadline) {
    try {
      health = await request({ hostname: '127.0.0.1', port, path: '/api/health', method: 'GET' });
      if (health.status === 200) break;
    } catch { /* Server ancora in avvio. */ }
    await wait(500);
  }
  if (health?.status !== 200) throw new Error('Server non raggiungibile entro 45 secondi');
  if (!health.body.setupRequired) return console.log('Amministratore iniziale già configurato.');
  const body = JSON.stringify(payload);
  const result = await request({
    hostname: '127.0.0.1',
    port,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-CRM-Setup-Secret': setupSecret,
    },
  }, body);
  if (result.status !== 201) throw new Error(result.body?.error || 'Creazione amministratore non riuscita');
  console.log('Primo amministratore creato.');
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
