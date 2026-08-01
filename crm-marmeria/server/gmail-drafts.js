const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { writePrivateTextAtomically } = require('./runtime-files');

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
const AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';
const GMAIL_DRAFTS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts';
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/;
const base64Url = (value) => Buffer.from(value).toString('base64url');

const integrationError = (message, status = 400) => Object.assign(new Error(message), { status });
const asHeader = (value, label) => {
  const normalized = String(value || '').trim();
  if (!normalized || /[\r\n]/.test(normalized)) throw integrationError(`${label} non valido`);
  return normalized;
};
const encodeHeader = (value) => `=?UTF-8?B?${Buffer.from(asHeader(value, 'Intestazione email')).toString('base64')}?=`;
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const fileName = (value) => String(value || 'preventivo.docx').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'preventivo.docx';

const createMimeDraft = ({ to, from, subject, text, attachmentName, attachment }) => {
  const recipient = String(to || '').trim();
  if (!validEmail(recipient)) throw integrationError('Il cliente non ha un indirizzo email valido');
  const sender = String(from || '').trim();
  if (!validEmail(sender)) throw integrationError('Account Gmail collegato non valido');
  const boundary = `crm-marmeria-${crypto.randomBytes(18).toString('hex')}`;
  const lines = [
    `From: ${sender}`,
    `To: ${recipient}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(String(text || ''), 'utf8').toString('base64'),
    '',
    `--${boundary}`,
    `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document; name="${fileName(attachmentName)}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${fileName(attachmentName)}"`,
    '',
    Buffer.from(attachment).toString('base64'),
    '',
    `--${boundary}--`,
    '',
  ];
  return base64Url(lines.join('\r\n'));
};

const createGmailDraftService = ({ dataDir, callbackUrl, fetchImpl = global.fetch } = {}) => {
  if (!dataDir) throw new Error('Cartella dati Gmail mancante');
  if (!callbackUrl) throw new Error('URL callback Gmail mancante');
  if (typeof fetchImpl !== 'function') throw new Error('fetch non disponibile per Gmail');
  const configPath = path.join(dataDir, 'gmail.json');
  const keyPath = path.join(dataDir, '.gmail-token-key');
  const pending = new Map();

  const readConfig = () => {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return {
        clientId: String(raw.clientId || '').trim(),
        email: String(raw.email || '').trim(),
        token: raw.token && typeof raw.token === 'object' ? raw.token : null,
      };
    } catch {
      return { clientId: '', email: '', token: null };
    }
  };
  const writeConfig = (value) => writePrivateTextAtomically(configPath, `${JSON.stringify(value, null, 2)}\n`);
  const tokenKey = () => {
    try {
      const current = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'base64url');
      if (current.length === 32) return current;
    } catch { /* crea chiave */ }
    const generated = crypto.randomBytes(32);
    writePrivateTextAtomically(keyPath, generated.toString('base64url'));
    return generated;
  };
  const encrypt = (value) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') };
  };
  const decrypt = (value) => {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(value.iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64url')), decipher.final()]).toString('utf8'));
    } catch {
      throw integrationError('Token Gmail non leggibile. Ricollegare account Gmail.', 409);
    }
  };
  const status = () => {
    const config = readConfig();
    return { configured: Boolean(config.clientId), clientId: config.clientId || '', connected: Boolean(config.token && config.email), email: config.email || null, callbackUrl };
  };
  const configure = ({ clientId }) => {
    const normalized = String(clientId || '').trim();
    if (!CLIENT_ID_PATTERN.test(normalized)) {
      throw integrationError('Inserire Client ID OAuth Desktop Google valido');
    }
    const previous = readConfig();
    const keepConnection = previous.clientId === normalized;
    writeConfig({ clientId: normalized, email: keepConnection ? previous.email : '', token: keepConnection ? previous.token : null });
    return status();
  };
  const beginAuthorization = () => {
    const config = readConfig();
    if (!CLIENT_ID_PATTERN.test(config.clientId)) throw integrationError('Configura prima Client ID OAuth Gmail', 409);
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    pending.set(state, { verifier, expiresAt: Date.now() + 10 * 60 * 1000 });
    for (const [key, value] of pending) if (value.expiresAt < Date.now()) pending.delete(key);
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: GMAIL_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    return { url: `${AUTHORIZATION_URL}?${params}` };
  };
  const apiError = async (response, fallback) => {
    let detail = '';
    try { detail = (await response.json()).error?.message || ''; } catch { /* risposta non JSON */ }
    throw integrationError(detail ? `${fallback}: ${detail}` : fallback, response.status || 502);
  };
  const completeAuthorization = async ({ code, state }) => {
    const record = pending.get(String(state || ''));
    pending.delete(String(state || ''));
    if (!record || record.expiresAt < Date.now()) throw integrationError('Autorizzazione Gmail scaduta. Riprova.', 400);
    const config = readConfig();
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, code: String(code || ''), code_verifier: record.verifier, grant_type: 'authorization_code', redirect_uri: callbackUrl }),
    });
    if (!response.ok) return apiError(response, 'Google ha rifiutato autorizzazione Gmail');
    const tokens = await response.json();
    if (!tokens.refresh_token || !tokens.access_token) throw integrationError('Google non ha restituito token Gmail. Riprova autorizzazione.', 502);
    const profile = await fetchImpl(GMAIL_PROFILE_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!profile.ok) return apiError(profile, 'Impossibile leggere account Gmail');
    const email = String((await profile.json()).emailAddress || '').trim();
    if (!validEmail(email)) throw integrationError('Google non ha restituito indirizzo Gmail valido', 502);
    writeConfig({ clientId: config.clientId, email, token: encrypt({ refreshToken: tokens.refresh_token }) });
    return status();
  };
  const accessToken = async () => {
    const config = readConfig();
    if (!config.token || !config.email) throw integrationError('Collega Gmail dalle Impostazioni prima di creare bozza', 409);
    const stored = decrypt(config.token);
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, refresh_token: String(stored.refreshToken || ''), grant_type: 'refresh_token' }),
    });
    if (!response.ok) return apiError(response, 'Connessione Gmail scaduta. Ricollega account');
    const token = await response.json();
    if (!token.access_token) throw integrationError('Google non ha restituito token accesso', 502);
    return { token: token.access_token, email: config.email };
  };
  const createDraft = async ({ to, subject, text, attachmentName, attachment }) => {
    const account = await accessToken();
    const raw = createMimeDraft({ to, from: account.email, subject, text, attachmentName, attachment });
    const response = await fetchImpl(GMAIL_DRAFTS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw } }),
    });
    if (!response.ok) return apiError(response, 'Google non ha creato la bozza');
    const draft = await response.json();
    return { id: String(draft.id || ''), gmailUrl: 'https://mail.google.com/mail/u/0/#drafts' };
  };
  const disconnect = () => {
    const config = readConfig();
    writeConfig({ clientId: config.clientId, email: '', token: null });
    return status();
  };
  return { status, configure, beginAuthorization, completeAuthorization, createDraft, disconnect };
};

module.exports = { GMAIL_SCOPE, createMimeDraft, createGmailDraftService };
