from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if old not in text:
        raise RuntimeError(f'Pattern not found in {path}: {old[:180]!r}')
    path.write_text(text.replace(old, new, 1))


app = ROOT / 'server/app.js'
replace_once(
    app,
    """  const legacyKeys = ['clients', 'orders', 'projects', 'materials', 'quotes', 'invoices'];
  if (!legacyKeys.some((key) => Object.prototype.hasOwnProperty.call(data, key))) return raw;
  const legacyOrders = Array.isArray(data.orders) ? data.orders : [];
""",
    """  const legacyKeys = ['clients', 'orders', 'projects', 'materials', 'quotes', 'invoices'];
  if (!legacyKeys.some((key) => Object.prototype.hasOwnProperty.call(data, key))) return raw;
  for (const key of legacyKeys) {
    if (Object.prototype.hasOwnProperty.call(data, key) && !Array.isArray(data[key])) {
      const error = new Error(`La sezione legacy ${key} del backup non è valida`);
      error.status = 400;
      throw error;
    }
  }
  const legacyOrders = Array.isArray(data.orders) ? data.orders : [];
""",
)
for old, new in [
    ("app.get('/api/backup/export', authenticateToken, requirePermission('settings.view')", "app.get('/api/backup/export', authenticateToken, requireRole('admin')"),
    ("app.post('/api/backup/import', authenticateToken, requirePermission('settings.edit')", "app.post('/api/backup/import', authenticateToken, requireRole('admin')"),
    ("app.get('/api/backup', authenticateToken, requirePermission('settings.view')", "app.get('/api/backup', authenticateToken, requireRole('admin')"),
    ("app.post('/api/backup/restore', authenticateToken, requirePermission('settings.edit')", "app.post('/api/backup/restore', authenticateToken, requireRole('admin')"),
    ("app.post('/api/backup/clear', authenticateToken, requirePermission('settings.edit')", "app.post('/api/backup/clear', authenticateToken, requireRole('admin')"),
    ("app.get('/api/backups', authenticateToken, requirePermission('settings.view')", "app.get('/api/backups', authenticateToken, requireRole('admin')"),
    ("app.post('/api/backups', authenticateToken, requirePermission('settings.edit')", "app.post('/api/backups', authenticateToken, requireRole('admin')"),
    ("app.post('/api/backups/:name/restore', authenticateToken, requirePermission('settings.edit')", "app.post('/api/backups/:name/restore', authenticateToken, requireRole('admin')"),
]:
    replace_once(app, old, new)

settings = ROOT / 'src/pages/SettingsPage.jsx'
replace_once(settings, '      <DataManager />\n', "      {user?.role === 'admin' && <DataManager />}\n")

smoke = ROOT / 'server/smoke-test.js'
marker = """    const limitedAudit = await requestJson(baseUrl, '/audit', {
      headers: authHeaders(auditViewerToken),
    });
    assert.equal(limitedAudit.response.status, 200);
    assert.equal(
      limitedAudit.body.some((entry) => entry.entityType === 'client'),
      false,
      'settings.view non deve aggirare clients.view nello storico globale',
    );
"""
replacement = marker + """    const deniedFullExport = await requestJson(baseUrl, '/backup/export', {
      headers: authHeaders(auditViewerToken),
    });
    assert.equal(
      deniedFullExport.response.status,
      403,
      'settings.view non deve consentire l’esportazione dell’intero database',
    );
    const adminFullExport = await requestJson(baseUrl, '/backup/export', {
      headers: authHeaders(adminToken),
    });
    assert.equal(adminFullExport.response.status, 200);
    assert.ok(Array.isArray(adminFullExport.body.data.invoice));
"""
replace_once(smoke, marker, replacement)

marker = """    assert.equal(partialBackup.response.status, 400, 'Un backup parziale non deve cancellare le sezioni omesse');
    const projectAfterRejectedImport = await requestJson(baseUrl, `/projects/${createdProject.body.id}`, {
"""
replacement = """    assert.equal(partialBackup.response.status, 400, 'Un backup parziale non deve cancellare le sezioni omesse');
    const malformedLegacyBackup = await requestJson(baseUrl, '/backup/import', {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ data: { clients: [], orders: 'non-array' } }),
    });
    assert.equal(
      malformedLegacyBackup.response.status,
      400,
      'Una sezione legacy malformata non deve essere convertita in una lista vuota',
    );
    const projectAfterRejectedImport = await requestJson(baseUrl, `/projects/${createdProject.body.id}`, {
"""
replace_once(smoke, marker, replacement)
