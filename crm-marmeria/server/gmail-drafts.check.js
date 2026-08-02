const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGmailDraftService } = require('./gmail-drafts');

async function run() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-gmail-'));
  const requests = [];
  const fakeFetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.includes('/token') && String(options.body).includes('authorization_code')) return new Response(JSON.stringify({ access_token: 'first-token', refresh_token: 'refresh-token' }), { status: 200 });
    if (url.includes('/profile')) return new Response(JSON.stringify({ emailAddress: 'ufficio@example.com' }), { status: 200 });
    if (url.includes('/token')) return new Response(JSON.stringify({ access_token: 'renewed-token' }), { status: 200 });
    if (url.includes('/drafts')) return new Response(JSON.stringify({ id: 'draft-123' }), { status: 200 });
    return new Response('', { status: 404 });
  };
  try {
    const gmail = createGmailDraftService({ dataDir, callbackUrl: 'http://127.0.0.1:3001/oauth2/gmail', fetchImpl: fakeFetch });
    assert.deepEqual(gmail.status(), {
      configured: false,
      clientId: '',
      connected: false,
      email: null,
      callbackUrl: 'http://127.0.0.1:3001/oauth2/gmail',
      driveBackupReady: false,
    });
    gmail.configure({ clientId: '123-test.apps.googleusercontent.com' });
    const authorization = gmail.beginAuthorization();
    const state = new URL(authorization.url).searchParams.get('state');
    await gmail.completeAuthorization({ code: 'code-ok', state });
    assert.equal(gmail.status().email, 'ufficio@example.com');
    assert.equal(gmail.status().driveBackupReady, true);
    assert.match(authorization.url, /drive\.file/);
    assert.equal((await gmail.getDriveAccessToken()).token, 'renewed-token');
    assert.equal(fs.readFileSync(path.join(dataDir, 'gmail.json'), 'utf8').includes('refresh-token'), false);
    const draft = await gmail.createDraft({ to: 'cliente@example.com', subject: 'Preventivo PR-10', text: 'Buongiorno, allegato preventivo.', attachmentName: 'preventivo-PR-10.docx', attachment: Buffer.from('word-file') });
    assert.equal(draft.id, 'draft-123');
    const sent = requests.find((request) => request.url.includes('/drafts'));
    const mime = Buffer.from(JSON.parse(sent.options.body).message.raw, 'base64url').toString('utf8');
    assert.match(mime, /To: cliente@example.com/);
    assert.match(mime, /Content-Disposition: attachment; filename="preventivo-PR-10.docx"/);
    assert.match(mime, /d29yZC1maWxl/);
    gmail.disconnect();
    assert.equal(gmail.status().connected, false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
