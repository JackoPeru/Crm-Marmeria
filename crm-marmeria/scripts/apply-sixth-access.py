from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if old not in text:
        raise RuntimeError(f'Pattern not found in {path}: {old[:180]!r}')
    path.write_text(text.replace(old, new, 1))


def replace_all(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if old not in text:
        raise RuntimeError(f'Pattern not found in {path}: {old[:180]!r}')
    path.write_text(text.replace(old, new))


app = ROOT / 'server/app.js'
replace_once(
    app,
    "const { MutationBarrier } = require('./mutation-barrier');\n",
    """const { MutationBarrier } = require('./mutation-barrier');
const {
  canViewFinancials,
  ensureRolePermissions,
  hasEntityPermission,
  permissionForType,
} = require('./access-policy');
""",
)
replace_once(app, "const canViewFinancials = (user) => ['admin', 'manager'].includes(user?.role);\n", '')
replace_once(
    app,
    """const routeForType = (type) => Object.entries(ROUTES).find(([, config]) => config.type === type);
const permissionForType = (type, action = 'view') => {
  const entry = routeForType(type);
  return entry ? `${entry[1].permission}.${action}` : null;
};
const hasEntityPermission = (user, type, action) => {
  const permission = permissionForType(type, action);
  return Boolean(permission && user?.permissions?.includes(permission));
};
""",
    '',
)
replace_once(app, "const permissions = normalizePermissions(req.body?.permissions || []);", "const permissions = ensureRolePermissions(role, normalizePermissions(req.body?.permissions || []));")
replace_once(
    app,
    "if (req.body.permissions !== undefined) updates.permissions = normalizePermissions(req.body.permissions);",
    """if (req.body.permissions !== undefined) {
          updates.permissions = ensureRolePermissions(
            String(req.body.role ?? previous.role),
            normalizePermissions(req.body.permissions),
          );
        } else if (req.body.role !== undefined) {
          updates.permissions = ensureRolePermissions(String(req.body.role), previous.permissions || []);
        }""",
)
replace_once(
    app,
    """  const allWork = () => [...db.list('project'), ...db.list('order')];
  const invoiceRevenue = (start, end) => db.list('invoice')
    .filter((item) => betweenDates(item.date || item.createdAt, start, end))
    .reduce((sum, item) => sum + numeric(item.total ?? item.amount), 0);
""",
    """  const visibleList = (user, type) => (
    hasEntityPermission(user, type, 'view') ? db.list(type) : []
  );
  const allWork = (user) => [
    ...visibleList(user, 'project'),
    ...visibleList(user, 'order'),
  ];
  const invoiceRevenue = (user, start, end) => (
    canViewFinancials(user)
      ? db.list('invoice')
        .filter((item) => betweenDates(item.date || item.createdAt, start, end))
        .reduce((sum, item) => sum + numeric(item.total ?? item.amount), 0)
      : 0
  );
""",
)
replace_once(app, "const projects = db.list('project');\n    const materials = db.list('material');\n    const clients = db.list('client');", "const projects = visibleList(req.user, 'project');\n    const materials = visibleList(req.user, 'material');\n    const clients = visibleList(req.user, 'client');")
replace_all(app, 'invoiceRevenue(monthStart, current)', 'invoiceRevenue(req.user, monthStart, current)')
replace_all(app, 'const work = allWork();', 'const work = allWork(req.user);')
replace_all(app, "const materials = db.list('material');", "const materials = visibleList(req.user, 'material');")
replace_all(app, 'invoiceRevenue(dayStart, dayEnd)', 'invoiceRevenue(req.user, dayStart, dayEnd)')
replace_all(app, 'invoiceRevenue(start, end)', 'invoiceRevenue(req.user, start, end)')
replace_once(app, "newClients: db.list('client').filter((item) => betweenDates(item.createdAt, start, end)).length,", "newClients: visibleList(req.user, 'client').filter((item) => betweenDates(item.createdAt, start, end)).length,")
replace_once(
    app,
    """    if (metric === 'revenue' && !canViewFinancials(req.user)) {
      return res.status(403).json({ error: 'Permessi insufficienti per i dati finanziari' });
    }
""",
    """    const metricAllowed = metric === 'revenue'
      ? canViewFinancials(req.user)
      : metric === 'clients'
        ? hasEntityPermission(req.user, 'client', 'view')
        : metric === 'orders'
          ? hasEntityPermission(req.user, 'project', 'view') || hasEntityPermission(req.user, 'order', 'view')
          : true;
    if (!metricAllowed) {
      return res.status(403).json({ error: 'Permessi insufficienti per la metrica richiesta' });
    }
""",
)
replace_once(app, "const clients = db.list('client');\n    const invoices = db.list('invoice');", "const clients = visibleList(req.user, 'client');\n    const invoices = visibleList(req.user, 'invoice');")

auth = ROOT / 'server/middleware/auth.js'
replace_once(auth, "const crypto = require('crypto');\n", "const crypto = require('crypto');\nconst { ensureRolePermissions } = require('../access-policy');\n")
replace_once(
    auth,
    """  const safeUsers = users.filter((user) => !isCompromisedLegacyAccount(user));
  if (safeUsers.length !== users.length) {
    if (!writeUsers(safeUsers)) throw new Error('Rimozione account predefiniti non sicuri fallita');
    console.warn('Account con password predefinite pubbliche rimossi: completare la configurazione iniziale sul PC principale.');
  }
""",
    """  const filteredUsers = users.filter((user) => !isCompromisedLegacyAccount(user));
  const safeUsers = filteredUsers.map((user) => ({
    ...user,
    permissions: ensureRolePermissions(user.role, user.permissions || []),
  }));
  if (JSON.stringify(safeUsers) !== JSON.stringify(users)) {
    if (!writeUsers(safeUsers)) throw new Error('Aggiornamento account sicuri fallito');
    if (filteredUsers.length !== users.length) {
      console.warn('Account con password predefinite pubbliche rimossi: completare la configurazione iniziale sul PC principale.');
    }
  }
""",
)

ui = ROOT / 'src/components/UserManagement.tsx'
replace_once(
    ui,
    """  const togglePermission = (permission: string) => {
    setForm((previous) => ({
""",
    """  const togglePermission = (permission: string) => {
    if (form.role === 'admin' && permission === 'settings.view') {
      toast.error('Un amministratore deve mantenere l’accesso alle impostazioni');
      return;
    }
    setForm((previous) => ({
""",
)
replace_once(ui, "permissions: [...new Set(form.permissions)],", "permissions: [...new Set([...(form.role === 'admin' ? ['settings.view'] : []), ...form.permissions])],")
replace_once(
    ui,
    """                        checked={form.permissions.includes(permission)}
                        onChange={() => togglePermission(permission)}
""",
    """                        checked={form.permissions.includes(permission)}
                        disabled={form.role === 'admin' && permission === 'settings.view'}
                        onChange={() => togglePermission(permission)}
""",
)

smoke = ROOT / 'server/smoke-test.js'
replace_once(
    smoke,
    """    assert.ok(createUsers.every((result) => result.response.status === 201));
    const auditViewerCreated = await requestJson(baseUrl, '/users', {
""",
    """    assert.ok(createUsers.every((result) => result.response.status === 201));
    const dashboardOnlyToken = await login('utente-a');
    const dashboardOnly = await requestJson(baseUrl, '/analytics/dashboard', {
      headers: authHeaders(dashboardOnlyToken),
    });
    assert.equal(dashboardOnly.response.status, 200);
    assert.equal(dashboardOnly.body.totalProjects, 0);
    assert.equal(dashboardOnly.body.totalClients, 0);
    assert.equal(dashboardOnly.body.totalMaterials, 0);
    assert.equal(dashboardOnly.body.totalRevenue, null);
    const deniedOrderTrend = await requestJson(
      baseUrl,
      '/analytics/trends?metric=orders&startDate=2030-01-01&endDate=2030-01-03',
      { headers: authHeaders(dashboardOnlyToken) },
    );
    assert.equal(deniedOrderTrend.response.status, 403);

    const constrainedAdmin = await requestJson(baseUrl, '/users', {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        username: 'admin-minimo',
        email: 'admin-minimo@example.test',
        password,
        firstName: 'Admin',
        lastName: 'Minimo',
        role: 'admin',
        permissions: [],
      }),
    });
    assert.equal(constrainedAdmin.response.status, 201);
    assert.ok(constrainedAdmin.body.permissions.includes('settings.view'));

    const auditViewerCreated = await requestJson(baseUrl, '/users', {
""",
)
