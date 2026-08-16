import express from 'express';
import { Op } from 'sequelize';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRole } from '../middleware/rbac.js';
import Tenant from '../models/Tenant.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import { TenantSamlConfig, AuditLog, User } from '../models/index.js';

const router = express.Router();

// Platform admins only — this is the SaaS-level (cross-tenant) view. Tenant
// members never reach it; requireRole checks the account-level platform role,
// so membership in a workspace is neither sufficient nor required.
router.use(authMiddleware, requireRole('platform_admin'));

const METHOD_ORDER = ['cash', 'bkash', 'nagad', 'card', 'online', 'other'];
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000; // UTC+6, no DST

/** Dhaka-local date-only key (matches the closeout/merchant bounds). */
const dhakaDayKey = (d) =>
  new Date(new Date(d).getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);

/** Clamps the ?days= window to 7..30 (default 30 — the SaaS view). */
const parseDays = (raw) => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n)) return 30;
  return Math.min(Math.max(n, 7), 30);
};

/**
 * GET /api/admin/analytics — platform overview (Phase 7).
 *
 * Aggregates across ALL workspaces (not tenant-scoped): tenant counts by
 * status, 7/30-day platform revenue + order curve (Dhaka days), top
 * restaurants by revenue, platform-wide paid method mix, and all-time order
 * volume. Bounded window queries keep the SaaS view cheap regardless of
 * tenant count; per-workspace rollups (migration 011) are the Phase 7
 * performance layer for deeper drill-downs.
 */
router.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const startOfWindow = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
    startOfWindow.setHours(0, 0, 0, 0);

    const [tenants, windowOrders, windowPayments, allTimeOrders] = await Promise.all([
      Tenant.findAll({
        attributes: ['id', 'name', 'slug', 'status'],
        order: [['id', 'ASC']],
      }),
      Order.findAll({
        where: { createdAt: { [Op.gte]: startOfWindow } },
        attributes: ['tenant_id', 'grand_total', 'payment_status', 'createdAt'],
      }),
      Payment.findAll({
        where: { status: 'paid', createdAt: { [Op.gte]: startOfWindow } },
        attributes: ['method', 'amount', 'createdAt'],
      }),
      Order.count(),
    ]);

    const tenantById = new Map(tenants.map((t) => [t.id, t]));

    // ── Trend (Dhaka days, zero-filled) ────────────────────────────────
    const trendByDay = new Map();
    const dhakaNow = new Date(Date.now() + DHAKA_OFFSET_MS);
    const windowStartDhaka = new Date(dhakaNow.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    for (let i = 0; i < days; i += 1) {
      const key = new Date(windowStartDhaka.getTime() + i * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      trendByDay.set(key, { date: key, revenue: 0, orders: 0 });
    }
    for (const o of windowOrders) {
      const entry = trendByDay.get(dhakaDayKey(o.createdAt));
      if (!entry) continue;
      entry.orders += 1;
      if (o.payment_status === 'paid') entry.revenue += Number(o.grand_total || 0);
    }
    const trend = [...trendByDay.values()].map((d) => ({
      date: d.date,
      revenue: Math.round(d.revenue * 100) / 100,
      orders: d.orders,
    }));

    // ── Top restaurants (30-day paid revenue) ──────────────────────────
    const byTenant = new Map();
    for (const o of windowOrders) {
      const entry = byTenant.get(o.tenant_id) || { revenue: 0, orders: 0 };
      entry.orders += 1;
      if (o.payment_status === 'paid') entry.revenue += Number(o.grand_total || 0);
      byTenant.set(o.tenant_id, entry);
    }
    const topRestaurants = [...byTenant.entries()]
      .map(([id, e]) => ({
        id,
        name: tenantById.get(id)?.name || `Tenant #${id}`,
        slug: tenantById.get(id)?.slug || null,
        revenue: Math.round(e.revenue * 100) / 100,
        orders: e.orders,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // ── Platform-wide method mix ───────────────────────────────────────
    const byMethod = new Map();
    for (const p of windowPayments) {
      const method = METHOD_ORDER.includes(p.method) ? p.method : 'other';
      const entry = byMethod.get(method) || { method, amount: 0, count: 0 };
      entry.amount += Number(p.amount || 0);
      entry.count += 1;
      byMethod.set(method, entry);
    }
    const methodMix = [...byMethod.values()]
      .sort((a, b) => b.amount - a.amount)
      .map((m) => ({
        method: m.method,
        amount: Math.round(m.amount * 100) / 100,
        count: m.count,
      }));

    // ── Tenant status breakdown + overview ─────────────────────────────
    const statusCounts = new Map();
    for (const t of tenants) {
      statusCounts.set(t.status, (statusCounts.get(t.status) || 0) + 1);
    }
    const tenantStatusBreakdown = [...statusCounts.entries()].map(([status, count]) => ({
      status,
      count,
    }));

    const totalRevenue = trend.reduce((s, d) => s + d.revenue, 0);
    const totalOrders = trend.reduce((s, d) => s + d.orders, 0);
    const overview = {
      days,
      tenants: tenants.length,
      activeTenants: statusCounts.get('active') || 0,
      trialTenants: statusCounts.get('trial') || 0,
      suspendedTenants: statusCounts.get('suspended') || 0,
      archivedTenants: statusCounts.get('archived') || 0,
      ordersWindow: totalOrders,
      revenueWindow: Math.round(totalRevenue * 100) / 100,
      avgOrderValue: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
      allTimeOrders,
    };

    res.json({
      overview,
      trend,
      topRestaurants,
      methodMix,
      tenantStatusBreakdown,
    });
  })
);

/**
 * GET /api/admin/sso — platform-wide SSO overview (Phase 3 follow-up).
 *
 * Every tenant with its SAML configuration status (enabled / IdP / SLO /
 * default role / last updated), plus the most recent `auth.saml_login`
 * events with actor email, workspace and timestamp — so a platform admin
 * can see at a glance which workspaces use enterprise SSO and how active
 * it is. No certificates are ever serialized.
 */
router.get(
  '/sso',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 10, 1), 50);

    const [tenants, configs, recentLogins] = await Promise.all([
      Tenant.findAll({
        attributes: ['id', 'name', 'slug', 'status'],
        order: [['id', 'ASC']],
      }),
      TenantSamlConfig.findAll(),
      AuditLog.findAll({
        where: { action: 'auth.saml_login' },
        order: [['id', 'DESC']],
        limit,
        include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'email'], required: false }],
      }),
    ]);

    const configByTenant = new Map(configs.map((c) => [c.tenant_id, c]));
    const workspaces = tenants.map((t) => {
      const c = configByTenant.get(t.id);
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status,
        sso: c
          ? {
              enabled: Boolean(c.enabled),
              idpEntityId: c.idp_entity_id,
              idpSsoUrl: c.idp_sso_url,
              idpSloUrl: c.idp_slo_url || null,
              defaultRole: c.default_role,
              attributeEmail: c.attribute_email,
              updatedAt: c.updated_at,
            }
          : null,
      };
    });

    res.json({
      workspaces,
      recentLogins: recentLogins.map((l) => ({
        id: l.id,
        email: l.actor?.email ?? l.metadata?.email ?? null,
        name: l.actor?.name ?? null,
        tenantId: l.tenant_id,
        at: l.createdAt,
        metadata: l.metadata ?? {},
      })),
      totals: {
        tenants: tenants.length,
        configured: configs.length,
        enabled: configs.filter((c) => c.enabled).length,
      },
    });
  })
);

export default router;
