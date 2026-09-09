import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';
import { AppError } from '../middleware/errorHandler.js';
import Outlet from '../models/Outlet.js';
import OutletMembership from '../models/OutletMembership.js';
import { hasPermission } from '../config/roles.js';
import {
  parseAnalyticsFilters,
  buildSummary,
  buildFunnel,
  buildRiderPerformance,
  evaluateRevenueAnomalies,
  listAnomalies,
  buildCategoryMix,
  buildTopItems,
  buildPeakHours,
  buildRetention,
  buildAnalyticsCsv,
  csvFilename,
  CSV_TYPES,
} from '../services/analyticsService.js';

/**
 * Analytics API (Phase 7) — custom-range, channel/order-type-filtered
 * aggregations beyond the fixed ?days= dashboard. Every endpoint is gated
 * by `view:analytics` (owner/manager/platform_admin) and shares one filter
 * engine so all charts agree on window + filters.
 *
 * Sector 3 (multi-outlet): order-based endpoints accept an optional
 * `outlet_id` query param scoping every metric to one branch. The outlet
 * must belong to the tenant (INVALID_OUTLET) and, for viewers without
 * `manage:outlets`, to one of their memberships (FORBIDDEN). The funnel and
 * anomaly endpoints reject `outlet_id` — storefront funnel events and
 * persisted alerts are not outlet-attributed.
 *
 *   GET  /api/analytics/summary            KPIs + revenue/orders series + mixes
 *   GET  /api/analytics/funnel             Browse → Cart → Checkout → Paid
 *   GET  /api/analytics/riders             per-rider delivery performance
 *   GET  /api/analytics/categories         category mix
 *   GET  /api/analytics/top-items          top items by quantity
 *   GET  /api/analytics/peak-hours         day×hour heatmap
 *   GET  /api/analytics/retention          repeat customers over the range
 *   GET  /api/analytics/anomalies          persisted revenue-anomaly alerts
 *   POST /api/analytics/anomalies/evaluate run detection for the range now
 *   GET  /api/analytics/export.csv?type=…  CSV export of any chart dataset
 */
const router = express.Router();
router.use(authMiddleware, resolveTenant, requireTenant, requirePermission('view:analytics'));

const filtersOf = (req) => parseAnalyticsFilters(req.query, req.tenant);

/**
 * Sector 3 outlet scope on the shared filter: the branch must exist in the
 * tenant (INVALID_OUTLET) and, for viewers without `manage:outlets`, be one
 * they hold an OutletMembership in (FORBIDDEN) — analytics can never leak a
 * branch the caller isn't allowed to see.
 */
async function assertAnalyticsOutletScope(req, filters) {
  if (filters.outletId == null) return;
  const outlet = await Outlet.findOne({
    where: { id: filters.outletId, tenant_id: req.tenant.id },
  });
  if (!outlet) {
    throw new AppError(400, 'INVALID_OUTLET', `Outlet ${filters.outletId} does not exist in this workspace`);
  }
  if (!hasPermission(req.user, 'manage:outlets')) {
    const membership = await OutletMembership.findOne({
      where: { outlet_id: outlet.id, user_id: req.user.id, tenant_id: req.tenant.id },
    });
    if (!membership) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this outlet');
    }
  }
}

/** Parses the shared filters + enforces outlet scope. */
const filtersOfScoped = async (req) => {
  const filters = filtersOf(req);
  await assertAnalyticsOutletScope(req, filters);
  return filters;
};

router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    res.json(await buildSummary(req.tenant.id, await filtersOfScoped(req)));
  })
);

router.get(
  '/funnel',
  asyncHandler(async (req, res) => {
    res.json(await buildFunnel(req.tenant.id, await filtersOfScoped(req)));
  })
);

router.get(
  '/riders',
  asyncHandler(async (req, res) => {
    const sort = ['deliveries', 'avg', 'onTimeRate', 'late'].includes(req.query.sort)
      ? req.query.sort
      : 'deliveries';
    res.json(await buildRiderPerformance(req.tenant, await filtersOfScoped(req), sort));
  })
);

router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    res.json(await buildCategoryMix(req.tenant.id, await filtersOfScoped(req)));
  })
);

router.get(
  '/top-items',
  asyncHandler(async (req, res) => {
    res.json(await buildTopItems(req.tenant.id, await filtersOfScoped(req)));
  })
);

router.get(
  '/peak-hours',
  asyncHandler(async (req, res) => {
    res.json(await buildPeakHours(req.tenant.id, await filtersOfScoped(req)));
  })
);

router.get(
  '/retention',
  asyncHandler(async (req, res) => {
    res.json(await buildRetention(req.tenant.id, await filtersOfScoped(req)));
  })
);

router.get(
  '/anomalies',
  asyncHandler(async (req, res) => {
    const filters = filtersOf(req);
    if (filters.outletId != null) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Outlet filtering is not supported for anomaly alerts');
    }
    const limit = Number.parseInt(req.query.limit, 10);
    const alerts = await listAnomalies(req.tenant.id, Number.isInteger(limit) ? limit : 20);
    res.json({ alerts });
  })
);

router.post(
  '/anomalies/evaluate',
  asyncHandler(async (req, res) => {
    // Body may carry the same filter params as GET endpoints.
    const filters = parseAnalyticsFilters({ ...req.query, ...req.body }, req.tenant);
    if (filters.outletId != null) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Outlet filtering is not supported for anomaly detection');
    }
    res.json(await evaluateRevenueAnomalies({ tenant: req.tenant, filters }));
  })
);

router.get(
  '/export.csv',
  asyncHandler(async (req, res) => {
    const type = String(req.query.type || '');
    if (!CSV_TYPES.includes(type)) {
      throw new AppError(400, 'VALIDATION_ERROR', `Unknown export type — allowed: ${CSV_TYPES.join(', ')}`);
    }
    const filters = await filtersOfScoped(req);
    // Alert exports are tenant-wide (persisted alerts carry no outlet).
    if (type === 'anomalies' && filters.outletId != null) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Outlet filtering is not supported for anomaly alerts');
    }
    let payload;
    switch (type) {
      case 'revenue':
      case 'methods':
      case 'status':
        payload = await buildSummary(req.tenant.id, filters);
        break;
      case 'categories':
        payload = await buildCategoryMix(req.tenant.id, filters);
        break;
      case 'top-items':
        payload = await buildTopItems(req.tenant.id, filters);
        break;
      case 'peak-hours':
        payload = await buildPeakHours(req.tenant.id, filters);
        break;
      case 'retention':
        payload = await buildRetention(req.tenant.id, filters);
        break;
      case 'funnel':
        payload = await buildFunnel(req.tenant.id, filters);
        break;
      case 'riders':
        payload = await buildRiderPerformance(req.tenant, filters);
        break;
      case 'anomalies': {
        const alerts = await listAnomalies(req.tenant.id, 100);
        payload = { alerts };
        break;
      }
      default:
        throw new AppError(400, 'VALIDATION_ERROR', `Unknown export type: ${type}`);
    }
    const csv = buildAnalyticsCsv(type, payload);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${csvFilename(type, filters)}"`);
    res.send(csv);
  })
);

export default router;
