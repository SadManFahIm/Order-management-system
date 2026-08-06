import { asyncHandler } from './asyncHandler.js';
import UserTenant from '../models/UserTenant.js';

/**
 * Resolves the tenant context for an authenticated request.
 *
 * Priority:
 *   1. `X-Tenant` header  (explicit tenant switch)
 *   2. `?tenant=` query param
 *   3. The tenant baked into the access token at login
 *
 * If a tenant is resolved, the user's membership is validated against the DB
 * (never trusting client claims) and `req.tenant` = { id, role } is attached.
 * When no tenant context is present the middleware is a no-op so legacy
 * single-tenant routes keep working; use requireTenant to enforce one.
 */
export const resolveTenant = asyncHandler(async (req, res, next) => {
  if (!req.user) return next();

  const header = req.headers['x-tenant'];
  const query = req.query.tenant;
  const claimed = header || query || req.user.tenant_id;
  if (!claimed) return next();

  const tenantId = Number(claimed);
  if (!Number.isInteger(tenantId) || tenantId <= 0) return next();

  const membership = await UserTenant.findOne({
    where: { user_id: req.user.id, tenant_id: tenantId },
  });

  if (!membership) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'You are not a member of this workspace' },
    });
  }

  req.tenant = { id: membership.tenant_id, role: membership.role };
  req.user.tenant_role = membership.role;
  req.user.tenant_id = membership.tenant_id;
  next();
});

/**
 * Requires a resolved tenant context. Use on routes that must be scoped to a
 * workspace (Phase 3 enforces this on business data).
 */
export function requireTenant(req, res, next) {
  if (!req.tenant) {
    return res.status(403).json({
      error: { code: 'TENANT_REQUIRED', message: 'A workspace (tenant) context is required' },
    });
  }
  next();
}
