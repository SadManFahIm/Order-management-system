import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';
import { AppError } from '../middleware/errorHandler.js';
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

router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    res.json(await buildSummary(req.tenant.id, filtersOf(req)));
  })
);

router.get(
  '/funnel',
  asyncHandler(async (req, res) => {
    res.json(await buildFunnel(req.tenant.id, filtersOf(req)));
  })
);

router.get(
  '/riders',
  asyncHandler(async (req, res) => {
    const sort = ['deliveries', 'avg', 'onTimeRate', 'late'].includes(req.query.sort)
      ? req.query.sort
      : 'deliveries';
    res.json(await buildRiderPerformance(req.tenant, filtersOf(req), sort));
  })
);

router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    res.json(await buildCategoryMix(req.tenant.id, filtersOf(req)));
  })
);

router.get(
  '/top-items',
  asyncHandler(async (req, res) => {
    res.json(await buildTopItems(req.tenant.id, filtersOf(req)));
  })
);

router.get(
  '/peak-hours',
  asyncHandler(async (req, res) => {
    res.json(await buildPeakHours(req.tenant.id, filtersOf(req)));
  })
);

router.get(
  '/retention',
  asyncHandler(async (req, res) => {
    res.json(await buildRetention(req.tenant.id, filtersOf(req)));
  })
);

router.get(
  '/anomalies',
  asyncHandler(async (req, res) => {
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
    const filters = filtersOf(req);
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
