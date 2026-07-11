const TYPE_PERMISSIONS = {
  client: 'clients',
  order: 'orders',
  project: 'projects',
  material: 'materials',
  quote: 'quotes',
  invoice: 'invoices',
};

const REQUIRED_ROLE_PERMISSIONS = {
  admin: ['settings.view'],
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
