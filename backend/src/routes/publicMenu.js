import express from 'express';
import { createHash } from 'node:crypto';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import Tenant from '../models/Tenant.js';
import MenuCategory from '../models/MenuCategory.js';
import Product from '../models/Product.js';
import ItemVariant from '../models/ItemVariant.js';
import ItemAddon from '../models/ItemAddon.js';
import { parsePagination } from '../utils/pagination.js';

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
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    logoUrl: tenant.logo_url,
    status: tenant.status,
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

export default router;
