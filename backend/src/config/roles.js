/**
 * Role-based access control definitions.
 *
 * Roles:
 *  - platform_admin : SaaS platform administrator (can do everything)
 *  - owner          : restaurant owner (tenant role)
 *  - manager        : restaurant manager (tenant role)
 *  - cashier        : takes orders at the counter (tenant role)
 *  - kitchen        : prepares orders (tenant role)
 *  - delivery       : delivers orders (tenant role)
 *  - customer       : storefront account (no merchant access)
 *  - staff          : legacy single-tenant staff (full access — backward
 *                     compatibility for users created before RBAC existed)
 */

export const ROLES = [
  'platform_admin',
  'owner',
  'manager',
  'cashier',
  'kitchen',
  'delivery',
  'customer',
  'staff',
];

/**
 * Granular permission catalogue — the per-action layer under RBAC.
 *
 * 'manage:members' gates team editing, 'refund:orders' gates money-leaving
 * actions (refunds), 'manage:inventory' gates stock writes, 'view:reports'
 * gates financial exports, 'manage:billing' gates plans/subscriptions.
 * Routes guard with requirePermission('<name>'), so a role's access is
 * exactly the union of its matrix below.
 */
export const PERMISSION_CATALOG = [
  'manage:menu',
  'manage:promotions',
  'manage:users',
  'manage:orders',
  'manage:members',
  'manage:settings',
  'manage:tenants',
  'manage:inventory',
  'manage:billing',
  'manage:outlets',
  'place:orders',
  'view:orders',
  'view:menu',
  'view:analytics',
  'view:reports',
  'refund:orders',
  'fulfill:orders',
  'deliver:orders',
];

/** Permissions granted to each role. '*' means unrestricted. */
export const ROLE_PERMISSIONS = {
  platform_admin: ['*'],
  manager: [
    'manage:menu',
    'manage:promotions',
    'manage:users',
    'manage:orders',
    'manage:members',
    'manage:settings',
    'manage:inventory',
    'manage:outlets',
    'place:orders',
    'view:orders',
    'view:menu',
    'view:analytics',
    'view:reports',
    // Refunds move money out — manager-and-above only, never cashier.
    'refund:orders',
  ],
  owner: [
    'manage:menu',
    'manage:promotions',
    'manage:users',
    'manage:orders',
    'manage:members',
    'manage:settings',
    'manage:tenants',
    'manage:inventory',
    'manage:billing',
    'manage:outlets',
    'place:orders',
    'view:orders',
    'view:menu',
    'view:analytics',
    'view:reports',
    'refund:orders',
  ],
  cashier: ['place:orders', 'view:orders', 'view:menu'],
  kitchen: ['view:orders', 'fulfill:orders', 'view:menu'],
  delivery: ['view:orders', 'deliver:orders', 'view:menu'],
  customer: [],
  // Legacy accounts retain full access so existing functionality keeps working.
  staff: ['*'],
};

/**
 * Validates a permission flag (possibly negated with a leading '-').
 * Unknown names are rejected so typos cannot silently widen access.
 */
export function isPermissionFlag(value) {
  if (typeof value !== 'string') return false;
  const name = value.startsWith('-') ? value.slice(1) : value;
  return PERMISSION_CATALOG.includes(name);
}

/**
 * Resolves the effective permission role for a request, honoring platform
 * admin and per-tenant roles.
 */
export function effectiveRole(user) {
  if (!user) return 'customer';
  if (user.platform_role === 'platform_admin') return 'platform_admin';
  // A workspace membership outranks the account-level 'customer' role: owners
  // invite registered customers into their team (cashier/manager/kitchen/…),
  // and that tenant role is what must gate their requests. Without this,
  // staff invited after registering could never place orders or view anything.
  if (user.tenant_role && ROLES.includes(user.tenant_role)) return user.tenant_role;
  if (user.platform_role === 'customer') return 'customer';
  // Members use their per-tenant role when present, else legacy staff.
  return user.tenant_role || 'staff';
}

/**
 * Returns true if the user holds the permission.
 *
 * Per-user flags (attached by resolveTenant from user_tenants.permissions)
 * override the role matrix: a negated flag ('-perm') always denies, a
 * positive flag grants even when the role lacks it. Flags never widen a
 * platform admin (they are already '*').
 */
export function hasPermission(user, permission) {
  const role = effectiveRole(user);
  const rolePerms = ROLE_PERMISSIONS[role] || [];
  const flags = Array.isArray(user?.permissions) ? user.permissions : [];
  const effective = role === 'platform_admin' && rolePerms.includes('*')
    ? ['*']
    : [...rolePerms, ...flags];

  // A negated flag beats everything (except platform-admin wildcard).
  if (role !== 'platform_admin' && effective.includes(`-${permission}`)) {
    return false;
  }
  return effective.includes('*') || effective.includes(permission);
}
