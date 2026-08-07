import { hasPermission, effectiveRole, ROLE_PERMISSIONS } from '../config/roles.js';

const forbidden = (res, message) =>
  res.status(403).json({ error: { code: 'FORBIDDEN', message } });

/**
 * Guards a route by permission, e.g. requirePermission('manage:menu').
 * Must run after authMiddleware (req.user populated).
 */
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No token' } });
    }
    if (hasPermission(req.user, permission)) return next();
    return forbidden(res, `Requires permission: ${permission}`);
  };
}

/**
 * Attaches req.userHas(permission) so routes can do fine-grained checks
 * beyond a single guard (e.g. different transitions for kitchen vs delivery).
 */
export function attachPermissionCheck(req, _res, next) {
  req.userHas = (permission) => {
    if (!req.user) return false;
    return hasPermission(req.user, permission);
  };
  next();
}

/**
 * Guards a route by role (accepts one or more roles).
 * 'platform_admin' and legacy 'staff' (wildcard) roles always pass.
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No token' } });
    }
    const role = effectiveRole(req.user);
    const perms = ROLE_PERMISSIONS[role] || [];
    if (roles.includes(role) || perms.includes('*')) return next();
    return forbidden(res, `Requires one of roles: ${roles.join(', ')}`);
  };
}
