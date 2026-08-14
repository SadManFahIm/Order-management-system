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

function serializeItem(item) {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    price: item.price,
    weightGm: item.weight_gm,
    prepMinutes: item.prep_minutes,
    imageUrl: item.image_url,
    available: item.enabled,
    categoryId: item.category_id,
    variants: (item.variants || []).map((v) => ({
      id: v.id,
      name: v.name,
      priceAdjustment: v.price_adjustment,
      sortOrder: v.sort_order,
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
    if (onlyAvailable) itemWhere.enabled = true;
    if (categoryId && Number.isInteger(categoryId)) itemWhere.category_id = categoryId;

    // X-Total-Count reflects ALL matching items (before pagination) so
    // storefronts can render a "load more" affordance from the header.
    const totalItems = await Product.count({ where: itemWhere });

    const items = await Product.findAll({
      where: itemWhere,
      include: [
        { model: ItemVariant, as: 'variants', order: [['sort_order', 'ASC'], ['id', 'ASC']] },
        { model: ItemAddon, as: 'addons', order: [['sort_order', 'ASC'], ['id', 'ASC']] },
      ],
      order: [['id', 'ASC']],
      limit,
      offset,
    });

    const itemsByCategory = new Map();
    for (const item of items) {
      const key = item.category_id ?? null;
      if (!itemsByCategory.has(key)) itemsByCategory.set(key, []);
      itemsByCategory.get(key).push(serializeItem(item));
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

    const payload = JSON.stringify({
      restaurant: serializeTenant(tenant),
      categories: menu,
    });
    if (applyPublicCache(req, res, payload)) return;
    res.set('X-Total-Count', String(totalItems));
    res.json(JSON.parse(payload));
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
