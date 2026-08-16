import { Op } from 'sequelize';
import { AppError } from '../middleware/errorHandler.js';
import {
  Product,
  ItemVariant,
  ItemAddon,
  MenuCategory,
  InventoryItem,
} from '../models/index.js';
import { audit } from './auditService.js';

/**
 * Menu & media helpers (Phase 4):
 *
 *   - isAvailableNow — time-window check for the item-level availability
 *     schedule (HH:MM local clock; NULL bounds mean "any time").
 *   - tagsIn — validates dietary/merchandising tags against the allowed set.
 *   - bulkUpdateItems — one-request price / stock / enabled / tags edit
 *     across many items (with the same optimistic-lock and quota rules).
 *   - duplicateCategory — deep-copies a category with its items, variants
 *     and add-ons (fresh ids, bumped version, " (copy)" suffix).
 */

export const ITEM_TAGS = ['veg', 'spicy', 'new', 'bestseller'];

const ALLOWED_TAG = new Set(ITEM_TAGS);

/** Validates an array of tags, returning a normalized de-duped array. */
export function normalizeTags(tags) {
  if (tags === undefined || tags === null) return [];
  const list = Array.isArray(tags) ? tags : [tags];
  const seen = new Set();
  const out = [];
  for (const tag of list) {
    const clean = String(tag).trim().toLowerCase();
    if (!clean) continue;
    if (!ALLOWED_TAG.has(clean)) {
      throw new AppError(
        400,
        'INVALID_TAG',
        `Unknown tag "${tag}" — allowed: ${ITEM_TAGS.join(', ')}`
      );
    }
    if (!seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

/** 'HH:MM' (24h) → minutes-since-midnight, or null for malformed/NULL. */
function toMinutes(value) {
  if (!value || typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Is the item orderable right now? `enabled` is a hard switch; the time
 * window (available_from / available_to, HH:MM) further gates it. A window
 * that wraps midnight (from > to) spans into the next day.
 */
export function isAvailableNow(item, now = new Date()) {
  if (!item) return false;
  if (item.enabled === false) return false;
  const from = toMinutes(item.available_from);
  const to = toMinutes(item.available_to);
  if (from === null && to === null) return true; // no window → any time
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (from !== null && to !== null) {
    if (from <= to) return nowMin >= from && nowMin < to;
    // Overnight window: from … 23:59 + 00:00 … to.
    return nowMin >= from || nowMin < to;
  }
  // One-sided window: only the start or only the end bound.
  if (from !== null) return nowMin >= from;
  return nowMin < to;
}

/**
 * Bulk menu edit (Phase 4): apply price / enabled / tags / vat_rate and/or
 * inventory stock across the given item ids in one transaction. Returns the
 * updated rows. Price changes bump each item's optimistic-lock version.
 */
export async function bulkUpdateItems(tenantId, actorUser, body, req) {
  const { ids, price, enabled, vatRate, tags, inventory } = body;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'At least one item id is required');
  }
  if (ids.length > 200) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Bulk edit supports up to 200 items at once');
  }
  if (price !== undefined && (typeof price !== 'number' || price < 0)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'price must be a non-negative number');
  }
  if (vatRate !== undefined && (typeof vatRate !== 'number' || vatRate < 0 || vatRate > 100)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'vatRate must be between 0 and 100');
  }
  const cleanTags = tags !== undefined ? normalizeTags(tags) : undefined;
  if (cleanTags !== undefined && cleanTags.length === 0 && !Array.isArray(tags)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'tags must be an array');
  }

  const items = await Product.findAll({
    where: { id: { [Op.in]: ids }, tenant_id: tenantId },
  });
  if (items.length === 0) {
    throw new AppError(404, 'NOT_FOUND', 'No matching menu items found in this workspace');
  }

  for (const item of items) {
    if (price !== undefined) item.price = price;
    if (enabled !== undefined) item.enabled = Boolean(enabled);
    if (vatRate !== undefined) item.vat_rate = vatRate;
    if (cleanTags !== undefined) item.tags = cleanTags;
    if (price !== undefined || vatRate !== undefined) {
      item.version = (item.version ?? 1) + 1;
    }
    await item.save();
  }

  // Inventory bulk-adjust (same shape as the per-item quick PATCH).
  if (inventory && (inventory.stock_qty !== undefined || inventory.low_stock_at !== undefined)) {
    for (const item of items) {
      const [row] = await InventoryItem.findOrCreate({
        where: { tenant_id: tenantId, menu_item_id: item.id },
        defaults: {
          tenant_id: tenantId,
          menu_item_id: item.id,
          name: item.name,
          stock_qty: Number(inventory.stock_qty) || 0,
          low_stock_at: Number(inventory.low_stock_at) || 0,
          unit: inventory.unit || 'pcs',
        },
      });
      if (inventory.stock_qty !== undefined) row.stock_qty = Number(inventory.stock_qty) || 0;
      if (inventory.low_stock_at !== undefined) row.low_stock_at = Number(inventory.low_stock_at) || 0;
      if (inventory.unit !== undefined) row.unit = inventory.unit || 'pcs';
      await row.save();
    }
  }

  await audit({
    action: 'menu.bulk_edit',
    actorId: actorUser.id,
    tenantId,
    entityType: 'Product',
    entityId: ids.join(','),
    metadata: { count: items.length, price, enabled, tags: cleanTags, vatRate },
    req,
  });

  return Product.findAll({
    where: { id: { [Op.in]: items.map((i) => i.id) }, tenant_id: tenantId },
  });
}

/**
 * Persists a drag-and-drop sort order (Phase 4): assigns sequential
 * sort_order values to the given item ids, in array order. Only items
 * belonging to the tenant are touched; unknown ids are ignored so the
 * client can send its whole visible list. Returns the re-ordered rows.
 */
export async function sortItems(tenantId, actorUser, orderedIds, req) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'An ordered list of item ids is required');
  }
  if (orderedIds.length > 500) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Sort supports up to 500 items at once');
  }
  const numericIds = [...new Set(orderedIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  const items = await Product.findAll({
    where: { id: { [Op.in]: numericIds }, tenant_id: tenantId },
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  let idx = 0;
  for (const id of numericIds) {
    const item = byId.get(id);
    if (item && Number(item.sort_order ?? 0) !== idx) {
      item.sort_order = idx;
      await item.save();
    }
    idx += 1;
  }
  await audit({
    action: 'menu.sorted',
    actorId: actorUser.id,
    tenantId,
    entityType: 'Product',
    entityId: numericIds.join(','),
    metadata: { count: numericIds.length },
    req,
  });
  return Product.findAll({
    where: { id: { [Op.in]: numericIds }, tenant_id: tenantId },
    order: [['sort_order', 'ASC'], ['id', 'ASC']],
  });
}

/**
 * Duplicates a category with all of its items, variants and add-ons.
 * New rows get fresh ids and the copy's name is suffixed " (copy)";
 * product versions start at 1 (new rows). Returns the new category.
 */
export async function duplicateCategory(tenantId, actorUser, categoryId, req) {
  const category = await MenuCategory.findOne({
    where: { id: categoryId, tenant_id: tenantId },
  });
  if (!category) throw new AppError(404, 'NOT_FOUND', 'Category not found');

  const items = await Product.findAll({
    where: { tenant_id: tenantId, category_id: category.id },
    include: [
      { model: ItemVariant, as: 'variants' },
      { model: ItemAddon, as: 'addons' },
    ],
  });

  const copy = await MenuCategory.create({
    tenant_id: tenantId,
    name: `${category.name} (copy)`,
    parent_id: category.parent_id,
    sort_order: (category.sort_order ?? 0) + 1,
  });

  for (const item of items) {
    const newItem = await Product.create({
      tenant_id: tenantId,
      name: item.name,
      description: item.description,
      price: item.price,
      weight_gm: item.weight_gm,
      enabled: item.enabled,
      category_id: copy.id,
      prep_minutes: item.prep_minutes,
      image_url: item.image_url,
      vat_rate: item.vat_rate,
      available_from: item.available_from,
      available_to: item.available_to,
      tags: item.tags || [],
      sort_order: item.sort_order,
      version: 1,
    });
    for (const v of item.variants || []) {
      await ItemVariant.create({
        tenant_id: tenantId,
        product_id: newItem.id,
        name: v.name,
        price_adjustment: v.price_adjustment,
        sort_order: v.sort_order,
        stock: v.stock,
      });
    }
    for (const a of item.addons || []) {
      await ItemAddon.create({
        tenant_id: tenantId,
        product_id: newItem.id,
        name: a.name,
        price: a.price,
        sort_order: a.sort_order,
      });
    }
  }

  await audit({
    action: 'menu.category_duplicated',
    actorId: actorUser.id,
    tenantId,
    entityType: 'MenuCategory',
    entityId: category.id,
    metadata: { copiedItems: items.length, newCategoryId: copy.id },
    req,
  });

  return MenuCategory.findByPk(copy.id, {
    include: [
      {
        model: Product,
        as: 'products',
        include: [
          { model: ItemVariant, as: 'variants' },
          { model: ItemAddon, as: 'addons' },
        ],
      },
    ],
  });
}

/**
 * Decrements variant stock when an order is placed. Best-effort: tracked
 * variants (stock not NULL) are reduced by the ordered quantity, floored at
 * zero; a stale/removed variant never fails the order.
 * @param {Array<{variant: object|null, quantity: number}>} lines
 */
export async function decrementVariantStock(lines) {
  const tracked = (lines || []).filter(
    (l) => l.variant && l.variant.id && l.variant.stock !== null && l.variant.stock !== undefined
  );
  if (tracked.length === 0) return;

  const ids = [...new Set(tracked.map((l) => l.variant.id))];
  const variants = await ItemVariant.findAll({ where: { id: ids } });
  const byId = new Map(variants.map((v) => [v.id, v]));

  for (const line of tracked) {
    const variant = byId.get(line.variant.id);
    if (!variant) continue; // removed between cart and placement — skip
    const qty = Number(line.quantity) || 0;
    if (qty <= 0) continue;
    const next = Math.max(0, (Number(variant.stock) || 0) - qty);
    await variant.update({ stock: next });
  }
}
