const assert = require('assert');
const {
  canViewFinancials,
  ensureRolePermissions,
  hasEntityPermission,
} = require('./access-policy');

assert.deepEqual(
  ensureRolePermissions('admin', []),
  ['settings.view', 'payments.view', 'payments.create', 'payments.edit', 'payments.delete', 'suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.delete'],
  'Un amministratore deve poter raggiungere la gestione amministrativa',
);
assert.deepEqual(
  ensureRolePermissions('worker', ['dashboard.view']),
  ['dashboard.view'],
);
assert.equal(
  hasEntityPermission({ permissions: ['projects.view'] }, 'project', 'view'),
  true,
);
assert.equal(
  canViewFinancials({ role: 'manager', permissions: ['dashboard.view'] }),
  false,
  'Il ruolo non deve bastare senza invoices.view',
);
assert.equal(
  canViewFinancials({ role: 'manager', permissions: ['invoices.view'] }),
  true,
);
