import { asyncHandler } from './asyncHandler.js';
import { UserTenant, Tenant } from '../models/index.js';

/**
 * Resolves the tenant context for an authenticated request.
 *
 * Priority:
 *   1. `X-Tenant` header  (explicit tenant switch)
 *   2. `?tenant=` query param
 *   3. The tenant baked into the access token at login
 *
 * If a tenant is resolved, the user's membership is validated against the DB
 * (never trusting client claims) and `req.tenant` = { id, role, status } is
 * attached. Suspended/archived workspaces are rejected for everyone except
 * platform admins (they can still access to manage the workspace).
 *
 * When no tenant context is present the middleware is a no-op; use
 * requireTenant to enforce one (Phase 3 business routes).
 */
const DEFAULT_TENANT_SLUG = 'default-restaurant';

/** Platform admins bypass membership checks and default to the legacy tenant. */
const isPlatformAdmin = (user) => user?.platform_role === 'platform_admin';

const reject = (res, code, message) =>
  res.status(403).json({ error: { code, message } });

export const resolveTenant = asyncHandler(async (req, res, next) => {
  if (!req.user) return next();

  const header = req.headers['x-tenant'];
  const query = req.query.tenant;
  const claimed = header || query || req.user.tenant_id;

  let tenantId = Number(claimed);
  let role = req.user.tenant_role || 'staff';

  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    // No tenant context. Platform admins always get one (the default/legacy
    // workspace) so global admin actions work without a membership.
    if (isPlatformAdmin(req.user)) {
      // Prefer the legacy default tenant; fall back to the first workspace
      // (covers greenfield databases and tests).
      const fallback = await Tenant.findOne({
        where: { slug: DEFAULT_TENANT_SLUG },
        order: [['id', 'ASC']],
      }) || (await Tenant.findOne({ order: [['id', 'ASC']] }));
      if (!fallback) return next();
      tenantId = fallback.id;
      role = 'owner';
    } else {
      return next();
    }
  }

  const [membership, tenant] = await Promise.all([
    UserTenant.findOne({
      where: { user_id: req.user.id, tenant_id: tenantId },
    }),
    Tenant.findByPk(tenantId),
  ]);

  if (!tenant) {
    return reject(res, 'FORBIDDEN', 'You are not a member of this workspace');
  }

  // Platform admins may operate on any workspace (membership optional).
  if (!isPlatformAdmin(req.user) && !membership) {
    return reject(res, 'FORBIDDEN', 'You are not a member of this workspace');
  }

  // Always prefer the DB membership role: the token's tenant_role reflects
  // the workspace active at login, which is wrong after an X-Tenant switch.
  if (membership) role = membership.role;

  if (['suspended', 'archived'].includes(tenant.status) && !isPlatformAdmin(req.user)) {
    return reject(res, 'TENANT_UNAVAILABLE', `This workspace is ${tenant.status}`);
  }

  // name + settings ride along (server-internal — req.tenant is never
  // serialized to clients) so routes like reports/orders can read the
  // workspace name and per-tenant settings without a second lookup.
  req.tenant = {
    id: tenantId,
    role,
    status: tenant.status,
    slug: tenant.slug,
    name: tenant.name,
    settings: tenant.settings || {},
  };
  req.user.tenant_role = role;
  req.user.tenant_id = tenantId;
  next();
});

/**
 * Requires a resolved tenant context. Use on routes that must be scoped to a
 * workspace (all business data routes).
 */
export function requireTenant(req, res, next) {
  if (!req.tenant) {
    return res.status(403).json({
      error: { code: 'TENANT_REQUIRED', message: 'A workspace (tenant) context is required' },
    });
  }
  next();
}
