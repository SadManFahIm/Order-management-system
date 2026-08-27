import Outlet from '../models/Outlet.js';
import OutletMembership from '../models/OutletMembership.js';
import { hasPermission } from '../config/roles.js';
import { AppError } from '../middleware/errorHandler.js';
import { asyncHandler } from './asyncHandler.js';

/**
 * Role-scoped outlet access (Sector: complex outlet permissions).
 *
 * Gates the :id-scoped outlet routes per-outlet:
 *  - Global outlet managers (owner/manager via 'manage:outlets') and wildcard
 *    roles (staff/platform_admin) can manage any outlet in the tenant.
 *  - Otherwise access is scoped to an explicit OutletMembership:
 *      * outlet_manager → manage within that outlet (or read, for read routes)
 *      * staff        → read-only within that outlet
 *      * no membership → 403
 *
 * Attaches req.outlet (the tenant-scoped outlet, 404 if missing) and
 * req.outletAccess ('full' | 'manage' | 'read') for downstream handlers.
 *
 * @param {{manage?: boolean}} opts  manage=true requires full or outlet_manager
 *                                   access; false also allows staff (read).
 */
export function requireOutletAccess({ manage = false } = {}) {
  return asyncHandler(async (req, res, next) => {
    const outlet = await Outlet.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!outlet) {
      throw new AppError(404, 'NOT_FOUND', 'Outlet not found');
    }

    if (hasPermission(req.user, 'manage:outlets')) {
      req.outlet = outlet;
      req.outletAccess = 'full';
      return next();
    }

    const membership = await OutletMembership.findOne({
      where: {
        outlet_id: outlet.id,
        user_id: req.user.id,
        tenant_id: req.tenant.id,
      },
    });

    if (!membership) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this outlet');
    }

    const canManage = membership.role === 'outlet_manager';
    if (manage && !canManage) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to manage this outlet');
    }

    req.outlet = outlet;
    req.outletAccess = canManage ? 'manage' : 'read';
    return next();
  });
}
