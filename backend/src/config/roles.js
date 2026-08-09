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

/** Permissions granted to each role. '*' means unrestricted. */
export const ROLE_PERMISSIONS = {
  platform_admin: ['*'],
  manager: [
    'manage:menu',
    'manage:promotions',
    'manage:users',
    'manage:orders',
    'place:orders',
    'view:orders',
    'view:menu',
    'view:analytics',
    'manage:settings',
    'manage:members',
  ],
  owner: [
    'manage:menu',
    'manage:promotions',
    'manage:users',
    'manage:orders',
    'place:orders',
    'view:orders',
    'view:menu',
    'view:analytics',
    'manage:settings',
    'manage:members',
    'manage:tenants',
  ],
  cashier: ['place:orders', 'view:orders', 'view:menu'],
  kitchen: ['view:orders', 'fulfill:orders', 'view:menu'],
  delivery: ['view:orders', 'deliver:orders', 'view:menu'],
  customer: [],
  // Legacy accounts retain full access so existing functionality keeps working.
  staff: ['*'],
};

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

/** Returns true if the user's effective role holds the permission. */
export function hasPermission(user, permission) {
  const perms = ROLE_PERMISSIONS[effectiveRole(user)] || [];
  return perms.includes('*') || perms.includes(permission);
}
