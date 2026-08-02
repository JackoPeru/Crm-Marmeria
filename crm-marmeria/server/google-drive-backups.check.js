const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGoogleDriveBackupService } = require('./google-drive-backups');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-google-drive-backup-'));
  const dataDir = path.join(root, 'data');
  const snapshotOne = path.join(root, 'snapshot-one');
  const snapshotTwo = path.join(root, 'snapshot-two');
  fs.mkdirSync(path.join(snapshotOne, 'attachments', 'project'), { recursive: true });
  fs.mkdirSync(snapshotTwo, { recursive: true });
  fs.writeFileSync(path.join(snapshotOne, 'metadata.json'), '{}');
  fs.writeFileSync(path.join(snapshotOne, 'attachments', 'project', 'foto.jpg'), 'foto');
  fs.writeFileSync(path.join(snapshotTwo, 'crm-marmeria.db'), 'database');

  const calls = [];
  let fileId = 0;
  let sessionId = 0;
  let failUpload = false;
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith('https://upload.example/')) {
      for await (const _chunk of options.body) { /* consuma stream come Drive */ }
      if (failUpload) return new Response(JSON.stringify({ error: { message: 'spazio esaurito' } }), { status: 507 });
      return new Response(JSON.stringify({ id: `file-${++fileId}` }), { status: 200 });
    }
    if (String(url).includes('uploadType=resumable')) {
      return new Response('', { status: 200, headers: { location: `https://upload.example/${++sessionId}` } });
    }
    if (options.method === 'POST' && String(url).startsWith('https://www.googleapis.com/drive/v3/files')) {
      return new Response(JSON.stringify({ id: `folder-${++fileId}` }), { status: 200 });
    }
    if (String(url).includes('?fields=id') && options.method !== 'DELETE') return new Response(JSON.stringify({ id: 'folder-1' }), { status: 200 });
    if (String(url).includes('q=')) return new Response(JSON.stringify({ files: [] }), { status: 200 });
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    return new Response('', { status: 404 });
  };
  const google = {
    status: () => ({ driveBackupReady: true, email: 'admin@example.test' }),
    getDriveAccessToken: async () => ({ token: 'drive-token' }),
  };
  try {
    const service = createGoogleDriveBackupService({ dataDir, google, fetchImpl: fakeFetch });
    assert.equal(service.status().connected, true);
    assert.equal(service.isDue(), true);
    service.configure({ intervalHours: 6, retentionCount: 1 });
    const first = await service.uploadSnapshot({ snapshot: { name: 'snapshot-one' }, snapshotDirectory: snapshotOne });
    assert.equal(first.snapshot, 'snapshot-one');
    assert.equal(service.status().remoteBackupCount, 1);
    assert.equal(service.status().lastError, null);
    await service.uploadSnapshot({ snapshot: { name: 'snapshot-two' }, snapshotDirectory: snapshotTwo });
    assert.equal(service.status().remoteBackupCount, 1);
    assert.equal(service.status().lastSnapshotName, 'snapshot-two');
    assert.ok(calls.some((call) => call.options.method === 'DELETE'));
    assert.ok(calls.filter((call) => call.url.includes('uploadType=resumable')).length >= 3);

    failUpload = true;
    const deletesBeforeFailure = calls.filter((call) => call.options.method === 'DELETE').length;
    const failed = createGoogleDriveBackupService({ dataDir: path.join(root, 'failed-data'), google, fetchImpl: fakeFetch });
    await assert.rejects(
      () => failed.uploadSnapshot({ snapshot: { name: 'snapshot-failed' }, snapshotDirectory: snapshotTwo }),
      /spazio esaurito/,
    );
    assert.equal(failed.status().remoteBackupCount, 0);
    assert.ok(calls.filter((call) => call.options.method === 'DELETE').length > deletesBeforeFailure);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
