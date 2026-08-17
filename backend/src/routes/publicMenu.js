import express from 'express';
import QRCode from 'qrcode';
import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import Tenant from '../models/Tenant.js';
import MenuCategory from '../models/MenuCategory.js';
import Product from '../models/Product.js';
import ItemVariant from '../models/ItemVariant.js';
import ItemAddon from '../models/ItemAddon.js';
import InventoryItem from '../models/InventoryItem.js';
import Table from '../models/Table.js';
import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import Payment from '../models/Payment.js';
import { parsePagination } from '../utils/pagination.js';
import {
  enabledPaymentMethods,
  paymentMethodsConfig,
} from '../services/paymentsService.js';
import { deliveryConfig } from '../services/checkoutService.js';
import {
  buildAvailabilityContext,
  isAvailableAt,
  isAvailableNow,
  effectiveWindowSegments,
  computeNextOpenAt,
} from '../services/menuService.js';
import { wallToUtc } from '../utils/timezone.js';

/**
 * Public, read-only storefront menu API (Phase 4).
 *
 * NO authentication middleware — intentionally open to unauthenticated
 * clients (the customer storefront). Only exposes a curated whitelist of
 * fields; never internal columns, tenant settings, or user data. Tenants
 * must be `active` or `trial` — suspended/archived workspaces 404.
 *
 * Response shape (both endpoints):
 *   GET /api/public/restaurants/:slug          → restaurant summary
 *   GET /api/public/restaurants/:slug/menu     → categories + items
 *   GET /api/public/restaurants/:slug/tables   → active table numbers (QR menu)
 */
const router = express.Router();

const VISIBLE_TENANT_STATUS = ['active', 'trial'];

// Storefront data is safe to cache: it changes only when the merchant edits
// the menu, so a short public max-age + ETag gives clients (and CDNs) a real
// performance win without ever serving stale data for long.
const CACHE_MAX_AGE = 60; // seconds

/** Sets public caching headers and answers 304 when the client has it fresh. */
function applyPublicCache(req, res, payload) {
  const etag = `"${createHash('sha1').update(payload).digest('hex').slice(0, 16)}"`;
  res.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE}`);
  res.set('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return true;
  }
  return false;
}

/** Fetches a tenant by slug, rejecting non-public ones with 404. */
async function findPublicTenant(slug) {
  const tenant = await Tenant.findOne({ where: { slug } });
  if (!tenant || !VISIBLE_TENANT_STATUS.includes(tenant.status)) {
    // 404 (not 403) — never reveal that a workspace exists but is hidden.
    throw new AppError(404, 'NOT_FOUND', 'Restaurant not found');
  }
  return tenant;
}

/** Whitelist serializer — only storefront-safe fields leave the API. */
function serializeTenant(tenant) {
  // Brand theme (Phase 4 R3): only the public-safe fields the storefront
  // needs to theme itself. Full settings/sensitive data never leave.
  const brand = tenant.settings?.brand;
  // Checkout config (Phase 5): the storefront needs to know which payment
  // methods are enabled, whether delivery is available + its fee, and the
  // merchant's wallet receiving numbers so customers can pay — all
  // public-safe (gateway credentials and internal settings never leave).
  const delivery = deliveryConfig(tenant);
  const methodsConfig = paymentMethodsConfig(tenant);
  const walletNumbers = {};
  for (const m of ['bkash', 'nagad']) {
    if (methodsConfig[m]?.enabled && methodsConfig[m]?.number) {
      walletNumbers[m] = methodsConfig[m].number;
    }
  }
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    logoUrl: tenant.logo_url,
    status: tenant.status,
    // IANA timezone (Phase 5 follow-up): availability windows and closure
    // days resolve against this wall clock when set (null = server local).
    timezone: tenant.settings?.timezone || null,
    brand: brand
      ? {
          primaryColor: brand.primaryColor || null,
          accentColor: brand.accentColor || null,
          tagline: brand.tagline || null,
        }
      : null,
    checkout: {
      paymentMethods: enabledPaymentMethods(tenant),
      // The merchant's wallet receiving numbers (public-safe — customers
      // need them to send money): { bkash: '01711…', nagad: '01722…' }.
      walletNumbers,
      deliveryEnabled: delivery.enabled,
      deliveryFee: delivery.fee,
    },
  };
}

function serializeItem(item, override = null, timeZone = null) {
  const inv = item.inventory;
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    price: item.price,
    weightGm: item.weight_gm,
    prepMinutes: item.prep_minutes,
    imageUrl: item.image_url,
    // Hard switch + base time window + today's per-day override (Phase 4
    // follow-up: an override with no bounds closes the item for the day).
    // Restaurant-wide closure days / weekday closures (Phase 5) are exposed
    // separately on the menu payload (`closedToday`) so the storefront can
    // render a "closed today" state without per-item noise. Windows resolve
    // against the tenant's configured timezone when set (Phase 5 follow-up).
    available: isAvailableNow(item, new Date(), override, timeZone),
    // Storefront scarcity cue (Phase 4 follow-up): the product-level
    // inventory snapshot (null when untracked) + low-stock threshold, so
    // the storefront can show "Only N left" / "Sold out" honestly.
    stock: inv ? Math.floor(Number(inv.stock_qty) || 0) : null,
    lowStockAt: inv ? Math.floor(Number(inv.low_stock_at) || 0) : null,
    tags: item.tags || [],
    categoryId: item.category_id,
    variants: (item.variants || []).map((v) => ({
      id: v.id,
      name: v.name,
      priceAdjustment: v.price_adjustment,
      sortOrder: v.sort_order,
      stock: v.stock ?? null,
      lowStockAt: v.low_stock_at ?? null,
    })),
    addons: (item.addons || []).map((a) => ({
      id: a.id,
      name: a.name,
      price: a.price,
      sortOrder: a.sort_order,
    })),
  };
}

/** GET /api/public/restaurants/:slug — public restaurant summary. */
router.get(
  '/restaurants/:slug',
  asyncHandler(async (req, res) => {
    const tenant = await findPublicTenant(req.params.slug);
    const payload = JSON.stringify(serializeTenant(tenant));
    if (applyPublicCache(req, res, payload)) return;
    res.json(JSON.parse(payload));
  })
);

/** GET /api/public/restaurants/:slug/menu — grouped menu (categories → items). */
router.get(
  '/restaurants/:slug/menu',
  asyncHandler(async (req, res) => {
    const tenant = await findPublicTenant(req.params.slug);
    const timeZone = tenant.settings?.timezone || null;

    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
    const onlyAvailable = req.query.available !== 'false';
    // Pagination applies to the item stream (across categories); the grouped
    // response keeps every category, with only the requested page of items.
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 200, maxLimit: 200 });

    const categories = await MenuCategory.findAll({
      where: { tenant_id: tenant.id },
      order: [
        ['sort_order', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const itemWhere = { tenant_id: tenant.id };
    if (categoryId && Number.isInteger(categoryId)) itemWhere.category_id = categoryId;

    // Availability: the hard `enabled` switch AND the time-of-day window
    // AND today's per-day override (Phase 4 follow-up) AND restaurant-wide
    // closure dates / weekday closures (Phase 5). Window/override filtering
    // happens in JS (isAvailableAt) because the bounds are 'HH:MM' strings
    // compared against the server's local clock — the SQL where-clause only
    // removes hard-disabled items. The full resolution context is fetched
    // once for the whole workspace (bounded by the tenant + date index) so
    // a merchant holiday closure hides items instantly.
    if (onlyAvailable) {
      itemWhere.enabled = true;
    }

    const ctx = await buildAvailabilityContext(tenant.id, undefined, timeZone);

    // X-Total-Count reflects ALL matching items (before pagination) so
    // storefronts can render a "load more" affordance from the header.
    const totalItems = await Product.count({ where: itemWhere });

    const items = await Product.findAll({
      where: itemWhere,
      include: [
        { model: ItemVariant, as: 'variants', order: [['sort_order', 'ASC'], ['id', 'ASC']] },
        { model: ItemAddon, as: 'addons', order: [['sort_order', 'ASC'], ['id', 'ASC']] },
        { model: InventoryItem, as: 'inventory' },
      ],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      limit,
      offset,
    });

    // Full availability filtering (only when the storefront asked for
    // available items): drop anything currently outside its effective
    // availability — restaurant closures, weekday rules, per-day overrides
    // and the base window. NB: arrow wrapper — Array#filter would pass the
    // index as `now`.
    const visibleItems = onlyAvailable
      ? items.filter((i) => isAvailableAt(i, ctx))
      : items;

    const itemsByCategory = new Map();
    for (const item of visibleItems) {
      const key = item.category_id ?? null;
      if (!itemsByCategory.has(key)) itemsByCategory.set(key, []);
      itemsByCategory.get(key).push(serializeItem(item, ctx.overrideByItem.get(item.id), timeZone));
    }

    const menu = categories.map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parent_id,
      sortOrder: c.sort_order,
      items: itemsByCategory.get(c.id) || [],
    }));

    // Uncategorised items surface at the end (a category the storefront may
    // still choose to show), not silently dropped.
    if (itemsByCategory.has(null) && itemsByCategory.get(null).length > 0) {
      menu.push({
        id: null,
        name: 'Other',
        parentId: null,
        sortOrder: Number.MAX_SAFE_INTEGER,
        items: itemsByCategory.get(null),
      });
    }

    const closedToday = ctx.restaurantClosed || ctx.restaurantWeekdayClosed;
    // When closed, tell the storefront when it reopens (Phase 5 follow-up)
    // so the banner can say "back open {weekday} at {time}" instead of a
    // dead-end. Computed only while closed (a 14-day forward scan); day
    // boundaries follow the tenant's timezone when set.
    const nextOpenAt = closedToday ? await computeNextOpenAt(tenant.id, new Date(), timeZone) : null;

    const payload = JSON.stringify({
      restaurant: serializeTenant(tenant),
      // Restaurant-wide closure state at request time (Phase 5): the
      // storefront shows a "We're closed today" banner and disables ordering
      // when the workspace is closed by a closure date or weekday closure.
      closedToday,
      nextOpenAt,
      categories: menu,
    });
    if (applyPublicCache(req, res, payload)) return;
    res.set('X-Total-Count', String(totalItems));
    res.json(JSON.parse(payload));
  })
);

/** GET /api/public/restaurants/:slug/availability?date=&time= — Phase 5.
 *
 * Availability preview for a date (or instant): whether the restaurant is
 * closed-wide (closure date / weekday closure) and, for every enabled item,
 * its orderable state.
 *
 *   ?date=YYYY-MM-DD&time=HH:MM  → instant check: per-item `available` +
 *     `reason` (checkout's scheduled-order preview).
 *   ?date=YYYY-MM-DD            → windows mode: per-item `windows` — the
 *     effective open segments that day (overnight windows split; all-day =
 *     [{00:00,24:00}]; [] = closed) — powering the storefront's per-dish
 *     availability calendar.
 *
 * Public + read-only; local server clock when `time` is omitted.
 */
router.get(
  '/restaurants/:slug/availability',
  asyncHandler(async (req, res) => {
    const tenant = await findPublicTenant(req.params.slug);
    const timeZone = tenant.settings?.timezone || null;

    let at = new Date();
    let requestedDate = null;
    const { date, time } = req.query;
    if (date !== undefined && date !== '') {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
      if (!m || Number.isNaN(new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`).getTime())) {
        throw new AppError(400, 'VALIDATION_ERROR', 'date must be a valid YYYY-MM-DD');
      }
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      requestedDate = { y, mo, d };
      // Date + time are the tenant's WALL CLOCK (Phase 5 follow-up): convert
      // to the UTC instant in the configured timezone (server-local when
      // none is set).
      if (time !== undefined && time !== '') {
        const hhmm = /^(\d{1,2}):(\d{2})$/.exec(String(time));
        const h = hhmm ? Number(hhmm[1]) : 12;
        const mi = hhmm ? Number(hhmm[2]) : 0;
        if (h > 23 || mi > 59) {
          throw new AppError(400, 'VALIDATION_ERROR', 'time must be a valid HH:MM');
        }
        at = wallToUtc({ year: y, month: mo, day: d, hour: h, minute: mi }, timeZone);
      } else {
        // windows mode — noon wall-clock anchor.
        at = wallToUtc({ year: y, month: mo, day: d, hour: 12, minute: 0 }, timeZone);
      }
    }

    const ctx = await buildAvailabilityContext(tenant.id, at, timeZone);
    const items = await Product.findAll({
      where: { tenant_id: tenant.id, enabled: true },
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
    });

    const reasons = (item) => {
      if (item.enabled === false) return 'disabled';
      if (ctx.restaurantClosed) return 'restaurant_closed';
      if (ctx.restaurantWeekdayClosed) return 'restaurant_closed';
      const weekdayRule = ctx.weekdayByItem.get(item.id);
      if (weekdayRule) {
        if (weekdayRule.available_from === null && weekdayRule.available_to === null) {
          return 'weekday_closed';
        }
        if (!isAvailableAt(item, ctx)) return 'weekday_window';
        return 'open';
      }
      const override = ctx.overrideByItem.get(item.id);
      if (override) {
        if (override.available_from === null && override.available_to === null) {
          return 'closed_today';
        }
        if (!isAvailableAt(item, ctx)) return 'override_window';
        return 'open';
      }
      if (!isAvailableAt(item, ctx)) return 'window';
      return 'open';
    };

    const base = {
      date: ctx.date,
      restaurantClosed: ctx.restaurantClosed || ctx.restaurantWeekdayClosed,
      // IANA zone the windows are expressed in (null = server local) — lets
      // the storefront show availability in the customer's own timezone
      // (Phase 4 follow-up round 7).
      timezone: timeZone,
    };

    // Windows mode (date-only): the calendar needs the open segments, not a
    // single instant. No `time` in the response — the segments carry it.
    if (requestedDate && (time === undefined || time === '')) {
      res.json({
        ...base,
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          categoryId: item.category_id,
          windows: effectiveWindowSegments(item, ctx),
        })),
      });
      return;
    }

    // Instant mode (with time, or defaulting to now): the checkout preview.
    const wall = timeZone
      ? (() => {
          const p = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).formatToParts(ctx.at);
          const get = (t) => Number(p.find((x) => x.type === t).value) % 24;
          return { h: get('hour'), m: get('minute') };
        })()
      : { h: ctx.at.getHours(), m: ctx.at.getMinutes() };
    res.json({
      ...base,
      time: `${String(wall.h).padStart(2, '0')}:${String(wall.m).padStart(2, '0')}`,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        categoryId: item.category_id,
        available: isAvailableAt(item, ctx),
        reason: reasons(item),
      })),
    });
  })
);

/** GET /api/public/track?orderNo=&phone= — customer order tracking (Phase 5).
 *
 * Public but privacy-safe: the customer must supply the phone the order was
 * placed with (last 10 digits must match), and only status/items/totals are
 * returned — never other customers, internal columns or tenant settings. A
 * mismatch 404s identically to a missing order (no existence oracle). */
router.get(
  '/track',
  asyncHandler(async (req, res) => {
    const { orderNo, phone } = req.query;
    if (!orderNo || !phone) {
      throw new AppError(400, 'VALIDATION_ERROR', 'orderNo and phone are required');
    }
    const digits = (v) => String(v || '').replace(/\D/g, '');
    const phoneTail = digits(phone).slice(-10);
    if (phoneTail.length < 10) {
      throw new AppError(400, 'VALIDATION_ERROR', 'phone must be a valid number');
    }

    const order = await Order.findOne({
      where: { order_no: String(orderNo).trim() },
      include: [
        { model: OrderItem, as: 'items' },
        { model: Payment, as: 'payments' },
      ],
    });

    // Identical 404 for unknown order / wrong phone — never reveal existence.
    if (!order || digits(order.customer_phone).slice(-10) !== phoneTail) {
      throw new AppError(404, 'NOT_FOUND', 'Order not found — check the order number and phone');
    }

    const tenant = order.tenant_id ? await Tenant.findByPk(order.tenant_id) : null;
    res.json({
      orderNo: order.order_no,
      status: order.status,
      tableNo: order.table_no ?? null,
      paymentStatus: order.payment_status,
      paymentMethod: order.payment_method ?? null,
      total: Math.round(Number(order.grand_total || 0) * 100) / 100,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      restaurant: tenant ? { name: tenant.name, slug: tenant.slug } : null,
      items: (order.items || []).map((i) => ({
        name: i.item_name,
        quantity: Number(i.quantity || 0),
        lineTotal: Math.round(Number(i.line_total || 0) * 100) / 100,
      })),
    });
  })
);

/** GET /api/public/restaurants/:slug/qr?table=N — storefront QR (print coupon).
 *
 * Public, like the menu itself: returns the storefront URL (optionally with
 * the table pre-set) plus an SVG data URI. The storefront's print view tears
 * this off as a scannable "order again" coupon under the ticket.
 */
router.get(
  '/restaurants/:slug/qr',
  asyncHandler(async (req, res) => {
    const tenant = await Tenant.findOne({ where: { slug: req.params.slug } });
    if (!tenant || !['active', 'trial'].includes(tenant.status)) {
      throw new AppError(404, 'NOT_FOUND', 'Restaurant not found');
    }
    const tableNo = Number(req.query.table);
    const validTable = Number.isInteger(tableNo) && tableNo > 0 ? tableNo : null;
    const base = (env.APP_BASE_URL || '').replace(/\/$/, '');
    const url = `${base}/m/${tenant.slug}${validTable ? `?table=${validTable}` : ''}`;
    const svg = await QRCode.toString(url, {
      type: 'svg',
      margin: 1,
      width: 240,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    res.json({
      url,
      table: validTable,
      svg: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    });
  })
);

/** GET /api/public/restaurants/:slug/tables — active tables for QR menus.
 *
 * Lets a storefront show a table picker or validate a `?table=N` param.
 * Only active tables, and only storefront-safe fields. */
router.get(
  '/restaurants/:slug/tables',
  asyncHandler(async (req, res) => {
    const tenant = await findPublicTenant(req.params.slug);
    const rows = await Table.findAll({
      where: { tenant_id: tenant.id, is_active: true },
      order: [['table_no', 'ASC']],
      attributes: ['table_no', 'name', 'capacity'],
    });
    const payload = JSON.stringify({
      tables: rows.map((t) => ({
        tableNo: t.table_no,
        name: t.name,
        capacity: t.capacity,
      })),
    });
    if (applyPublicCache(req, res, payload)) return;
    res.json(JSON.parse(payload));
  })
);

export default router;
