const TYPE_PERMISSIONS = {
  client: 'clients',
  supplier: 'suppliers',
  order: 'orders',
  project: 'projects',
  material: 'materials',
  edge_type: 'materials',
  linear_item: 'materials',
  quote: 'quotes',
  quote_template: 'quotes',
  invoice: 'invoices',
  payment: 'payments',
  purchase_order: 'orders',
  delivery_note: 'orders',
  service_case: 'projects',
  message_draft: 'clients',
  appointment: 'calendar',
};

const REQUIRED_ROLE_PERMISSIONS = {
  admin: ['settings.view', 'payments.view', 'payments.create', 'payments.edit', 'payments.delete', 'suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.delete'],
};

const permissionForType = (type, action = 'view') => {
  const section = TYPE_PERMISSIONS[type];
  return section ? `${section}.${action}` : null;
};

const hasEntityPermission = (user, type, action = 'view') => {
  const permission = permissionForType(type, action);
  return Boolean(permission && Array.isArray(user?.permissions) && user.permissions.includes(permission));
};

const ensureRolePermissions = (role, permissions = []) => [
  ...new Set([
    ...(Array.isArray(permissions) ? permissions : []),
    ...(REQUIRED_ROLE_PERMISSIONS[role] || []),
  ]),
];

const canViewFinancials = (user) => (
  ['admin', 'manager'].includes(user?.role)
  && hasEntityPermission(user, 'invoice', 'view')
);

module.exports = {
  REQUIRED_ROLE_PERMISSIONS,
  canViewFinancials,
  ensureRolePermissions,
  hasEntityPermission,
  permissionForType,
};
