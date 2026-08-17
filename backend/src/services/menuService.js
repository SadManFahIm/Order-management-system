import { Op } from 'sequelize';
import { AppError } from '../middleware/errorHandler.js';
import sequelize from '../config/db.js';
import {
  Product,
  ItemVariant,
  ItemAddon,
  MenuCategory,
  InventoryItem,
  AvailabilityOverride,
  TenantClosureDate,
  AvailabilityWeekdayRule,
} from '../models/index.js';
import { audit } from './auditService.js';

/**
 * Menu & media helpers (Phase 4):
 *
 *   - isAvailableNow — time-window check for the item-level availability
 *     schedule (HH:MM local clock; NULL bounds mean "any time"), with an
 *     optional per-day override (Phase 4 follow-up: an override with no
 *     bounds means "closed all day" for that date).
 *   - replaceAvailabilityOverrides — persists the per-day override set for
 *     one item (replace-all, validated + audited).
 *   - tagsIn — validates dietary/merchandising tags against the allowed set.
 *   - bulkUpdateItems — one-request price / stock / enabled / tags / window /
 *     category edit across many items (same optimistic-lock and quota rules).
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

/** Local date → 'YYYY-MM-DD' (the availability-override calendar key). */
export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Normalizes an 'HH:MM' window bound for storage: trims, pads, and rejects
 * malformed / out-of-range values with a clear 400. Empty/null → null
 * ("no bound"). Used for writes (overrides + bulk window edit); reads stay
 * lenient via toMinutes.
 */
export function normalizeWindowTime(value, field = 'time') {
  if (value === undefined || value === null || value === '') return null;
  const str = String(value).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(str);
  if (!m) {
    throw new AppError(400, 'VALIDATION_ERROR', `${field} must be an HH:MM time (e.g. 09:00)`);
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) {
    throw new AppError(400, 'VALIDATION_ERROR', `${field} must be a valid 24h time (00:00–23:59)`);
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
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
 * Is the clock inside a window? `src` is an item or an override/rule row
 * with optional available_from / available_to (HH:MM). Both bounds NULL =
 * any time; from > to wraps midnight; one-sided bounds supported.
 */
export function withinWindow(src, at = new Date()) {
  const from = toMinutes(src.available_from);
  const to = toMinutes(src.available_to);
  if (from === null && to === null) return true; // no window → any time
  const nowMin = at.getHours() * 60 + at.getMinutes();
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
 * Is the item orderable at `now`? `enabled` is a hard switch; the time
 * window (available_from / available_to, HH:MM) further gates it.
 *
 * `override` (a per-day AvailabilityOverride row, Phase 4 follow-up)
 * replaces the repeating window for that date when present: an override
 * with NO bounds means "closed all day", and a windowed override follows
 * the same rules as the base schedule (one-sided + overnight included).
 *
 * Legacy helper — full resolution (restaurant closures + weekday rules +
 * overrides) goes through buildAvailabilityContext + isAvailableAt.
 */
export function isAvailableNow(item, now = new Date(), override = null) {
  if (!item) return false;
  if (item.enabled === false) return false;
  if (override && override.available_from === null && override.available_to === null) {
    return false; // explicit per-date override → closed all day
  }
  return withinWindow(override || item, now);
}

/**
 * Fetches everything needed to resolve availability at a single instant:
 * the restaurant-wide closure for `at`'s date, that date's per-item
 * overrides, and every weekday rule (filtered to `at`'s weekday). Call ONCE
 * per request (public menu, checkout, availability-check) and reuse.
 */
export async function buildAvailabilityContext(tenantId, at = new Date()) {
  const date = dateKey(at);
  const weekday = at.getDay(); // 0=Sun … 6=Sat
  const [closureRow, overrides, weekdayRules] = await Promise.all([
    TenantClosureDate.findOne({ where: { tenant_id: tenantId, date } }),
    AvailabilityOverride.findAll({ where: { tenant_id: tenantId, date } }),
    AvailabilityWeekdayRule.findAll({ where: { tenant_id: tenantId } }),
  ]);

  const overrideByItem = new Map(overrides.map((o) => [o.menu_item_id, o]));
  const weekdayByItem = new Map();
  let restaurantWeekdayClosed = false;
  for (const rule of weekdayRules) {
    if (rule.weekday !== weekday) continue;
    if (rule.menu_item_id === null) {
      if (rule.available_from === null && rule.available_to === null) {
        restaurantWeekdayClosed = true; // restaurant-wide weekday closure
      }
      continue;
    }
    weekdayByItem.set(rule.menu_item_id, rule);
  }

  return {
    at,
    date,
    weekday,
    restaurantClosed: !!closureRow,
    restaurantWeekdayClosed,
    overrideByItem,
    weekdayByItem,
  };
}

/**
 * Is the item orderable at the context's instant? Full resolution order:
 *   enabled → restaurant-wide closure date → restaurant-wide weekday
 *   closure → per-item weekday rule → per-day override → base window.
 */
export function isAvailableAt(item, ctx) {
  if (!item) return false;
  if (item.enabled === false) return false;
  if (ctx.restaurantClosed || ctx.restaurantWeekdayClosed) return false;
  const weekdayRule = ctx.weekdayByItem.get(item.id);
  if (weekdayRule) {
    if (weekdayRule.available_from === null && weekdayRule.available_to === null) return false;
    return withinWindow(weekdayRule, ctx.at);
  }
  const override = ctx.overrideByItem.get(item.id);
  if (override) {
    if (override.available_from === null && override.available_to === null) return false;
    return withinWindow(override, ctx.at);
  }
  return withinWindow(item, ctx.at);
}

/**
 * Replaces the per-day override set for one menu item (Phase 4 follow-up).
 *
 * The body is the full list — any stored override for the item that is not
 * in `overrides` is removed (replace-all semantics keep the UI a simple
 * list editor). Each entry is validated (real YYYY-MM-DD date, deduped,
 * normalized HH:MM bounds; both bounds null = closed all day). Audited as
 * `menu.availability_overrides`. Returns the saved rows, date-ascending.
 */
export async function replaceAvailabilityOverrides(tenantId, actorUser, productId, overrides, req) {
  if (!Array.isArray(overrides)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'overrides must be an array');
  }
  if (overrides.length > 366) {
    throw new AppError(400, 'VALIDATION_ERROR', 'At most 366 date overrides per item');
  }

  const seen = new Set();
  const clean = [];
  for (const entry of overrides) {
    if (!entry || typeof entry !== 'object') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Each override needs a date and optional window');
    }
    const date = String(entry.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00`).getTime())) {
      throw new AppError(400, 'VALIDATION_ERROR', `"${date}" is not a valid YYYY-MM-DD date`);
    }
    if (seen.has(date)) {
      throw new AppError(400, 'VALIDATION_ERROR', `Duplicate override for ${date} — one per item per day`);
    }
    seen.add(date);
    clean.push({
      date,
      available_from: normalizeWindowTime(entry.available_from, `available_from (${date})`),
      available_to: normalizeWindowTime(entry.available_to, `available_to (${date})`),
    });
  }

  await sequelize.transaction(async (transaction) => {
    await AvailabilityOverride.destroy({
      where: { tenant_id: tenantId, menu_item_id: productId },
      transaction,
    });
    if (clean.length > 0) {
      await AvailabilityOverride.bulkCreate(
        clean.map((o) => ({ ...o, tenant_id: tenantId, menu_item_id: productId })),
        { transaction }
      );
    }
  });

  await audit({
    action: 'menu.availability_overrides',
    actorId: actorUser.id,
    tenantId,
    entityType: 'Product',
    entityId: String(productId),
    metadata: { count: clean.length, dates: clean.map((o) => o.date) },
    req,
  });

  return AvailabilityOverride.findAll({
    where: { tenant_id: tenantId, menu_item_id: productId },
    order: [['date', 'ASC']],
  });
}

/**
 * Computes the orderable time segments of one item on the context's date,
 * after the full resolution (closure → weekday rule → override → base
 * window). Returns 'HH:MM' pairs; overnight windows split into two
 * segments (e.g. 22:00→24:00 + 00:00→04:00); all-day = [{00:00,24:00}].
 * Empty array = not orderable that day.
 */
export function effectiveWindowSegments(item, ctx) {
  if (!item || item.enabled === false) return [];
  if (ctx.restaurantClosed || ctx.restaurantWeekdayClosed) return [];
  const rule = ctx.weekdayByItem.get(item.id);
  const override = ctx.overrideByItem.get(item.id);
  const src = rule || override || item;
  const from = toMinutes(src.available_from);
  const to = toMinutes(src.available_to);
  if (from === null && to === null) return [{ from: '00:00', to: '24:00' }];
  if (from !== null && to !== null) {
    if (from <= to) return [{ from: src.available_from, to: src.available_to }];
    // Overnight window: wraps past midnight.
    return [
      { from: src.available_from, to: '24:00' },
      { from: '00:00', to: src.available_to },
    ];
  }
  if (from !== null) return [{ from: src.available_from, to: '24:00' }];
  return [{ from: '00:00', to: src.available_to }];
}

/**
 * Closure conflict scan (Phase 5 follow-up): when a restaurant-wide closure
 * date or weekday closure overlaps an item that has a WINDOWED override or
 * weekday rule opening it that same day, the two settings contradict each
 * other (the item would be open while the restaurant is closed). Returns
 * the conflicting items per closure date / weekday so the merchant UI can
 * warn before saving. Items closed by their own override/rule (both bounds
 * NULL) are consistent and never reported.
 */
export async function closureConflicts(tenantId) {
  const [closures, weekdayRules] = await Promise.all([
    TenantClosureDate.findAll({
      where: { tenant_id: tenantId },
      order: [['date', 'ASC']],
    }),
    AvailabilityWeekdayRule.findAll({ where: { tenant_id: tenantId } }),
  ]);

  const names = await Product.findAll({
    where: { tenant_id: tenantId },
    attributes: ['id', 'name'],
  });
  const nameById = new Map(names.map((n) => [n.id, n.name]));

  // Date conflicts: a windowed override on a closed day.
  const overrides = closures.length
    ? await AvailabilityOverride.findAll({
        where: { tenant_id: tenantId, date: { [Op.in]: closures.map((c) => c.date) } },
      })
    : [];
  const byDate = new Map();
  for (const o of overrides) {
    if (o.available_from === null && o.available_to === null) continue; // consistent with the closure
    if (!byDate.has(o.date)) byDate.set(o.date, []);
    byDate.get(o.date).push({
      itemId: o.menu_item_id,
      itemName: nameById.get(o.menu_item_id),
      availableFrom: o.available_from,
      availableTo: o.available_to,
    });
  }

  // Weekday conflicts: a windowed per-item rule on a closed weekday.
  const closedWeekdays = new Set(
    weekdayRules.filter((r) => r.menu_item_id === null).map((r) => r.weekday)
  );
  const byWeekday = new Map();
  for (const r of weekdayRules) {
    if (r.menu_item_id === null) continue;
    if (!closedWeekdays.has(r.weekday)) continue;
    if (r.available_from === null && r.available_to === null) continue;
    if (!byWeekday.has(r.weekday)) byWeekday.set(r.weekday, []);
    byWeekday.get(r.weekday).push({
      itemId: r.menu_item_id,
      itemName: nameById.get(r.menu_item_id),
      availableFrom: r.available_from,
      availableTo: r.available_to,
    });
  }

  return {
    dates: [...byDate.entries()].map(([date, conflicts]) => ({ date, conflicts })),
    weekdays: [...byWeekday.entries()].map(([weekday, conflicts]) => ({ weekday, conflicts })),
  };
}

/**
 * Next instant the restaurant is open (Phase 5 follow-up): scans up to 14
 * days forward from `now`, skipping restaurant-closed days (closure dates +
 * weekday closures), and returns the ISO timestamp of the earliest moment
 * any enabled item is orderable — used by the storefront's closed banner
 * ("back open {weekday} at {time}"). If the restaurant is open right now,
 * returns now. Returns null when nothing opens within the horizon.
 */
export async function computeNextOpenAt(tenantId, now = new Date()) {
  const MAX_DAYS = 14;
  for (let d = 0; d < MAX_DAYS; d += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    const ctx = await buildAvailabilityContext(tenantId, day);
    if (ctx.restaurantClosed || ctx.restaurantWeekdayClosed) continue;

    const items = await Product.findAll({
      where: { tenant_id: tenantId, enabled: true },
      attributes: ['id', 'available_from', 'available_to'],
    });
    let earliest = null;
    for (const item of items) {
      const segments = effectiveWindowSegments(item, ctx);
      if (segments.length === 0) continue;
      const from = segments[0].from; // segments are ascending
      if (earliest === null || from < earliest) earliest = from;
    }
    if (earliest === null) continue;

    const [h, m] = earliest.split(':').map(Number);
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
    // d === 0 with an opening earlier than now ⇒ the restaurant is already
    // open — "next open" is right now.
    return at.getTime() > now.getTime() ? at.toISOString() : now.toISOString();
  }
  return null;
}

/**
 * Restaurant-wide closure dates (Phase 5): replace-all save of the
 * workspace's closed days (holidays, private events). `dates` is the full
 * list of YYYY-MM-DD strings — any stored closure not in the list is
 * removed. Validated (real dates), deduped, audited as
 * `menu.tenant_closures`. Returns the saved rows, date-ascending.
 */
export async function replaceTenantClosures(tenantId, actorUser, dates, req) {
  if (!Array.isArray(dates)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'dates must be an array of YYYY-MM-DD');
  }
  if (dates.length > 366) {
    throw new AppError(400, 'VALIDATION_ERROR', 'At most 366 closure dates per workspace');
  }

  const seen = new Set();
  const clean = [];
  for (const raw of dates) {
    const date = String(raw ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00`).getTime())) {
      throw new AppError(400, 'VALIDATION_ERROR', `"${date}" is not a valid YYYY-MM-DD date`);
    }
    if (seen.has(date)) {
      throw new AppError(400, 'VALIDATION_ERROR', `Duplicate closure for ${date}`);
    }
    seen.add(date);
    clean.push(date);
  }

  await sequelize.transaction(async (transaction) => {
    await TenantClosureDate.destroy({ where: { tenant_id: tenantId }, transaction });
    if (clean.length > 0) {
      await TenantClosureDate.bulkCreate(
        clean.map((date) => ({ tenant_id: tenantId, date })),
        { transaction }
      );
    }
  });

  await audit({
    action: 'menu.tenant_closures',
    actorId: actorUser.id,
    tenantId,
    entityType: 'Tenant',
    entityId: String(tenantId),
    metadata: { count: clean.length, dates: clean },
    req,
  });

  return TenantClosureDate.findAll({
    where: { tenant_id: tenantId },
    order: [['date', 'ASC']],
  });
}

/**
 * Restaurant-wide weekday closures (Phase 5): replace-all save of the
 * weekdays the whole workspace is closed every week (e.g. [5] = "closed
 * every Saturday"). Stored as AvailabilityWeekdayRule rows with NULL
 * menu_item_id and NULL bounds (enforced here). `weekdays` is the full
 * list of 0=Sun … 6=Sat. Audited as `menu.weekday_closures`.
 */
export async function replaceTenantWeekdayClosures(tenantId, actorUser, weekdays, req) {
  if (!Array.isArray(weekdays)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'weekdays must be an array of 0 (Sun) … 6 (Sat)');
  }
  if (weekdays.length > 7) {
    throw new AppError(400, 'VALIDATION_ERROR', 'At most 7 weekday closures');
  }

  const seen = new Set();
  const clean = [];
  for (const raw of weekdays) {
    const w = Number(raw);
    if (!Number.isInteger(w) || w < 0 || w > 6) {
      throw new AppError(400, 'VALIDATION_ERROR', 'weekday must be 0 (Sun) … 6 (Sat)');
    }
    if (seen.has(w)) {
      throw new AppError(400, 'VALIDATION_ERROR', `Duplicate weekday ${w}`);
    }
    seen.add(w);
    clean.push(w);
  }

  await sequelize.transaction(async (transaction) => {
    await AvailabilityWeekdayRule.destroy({
      where: { tenant_id: tenantId, menu_item_id: null },
      transaction,
    });
    if (clean.length > 0) {
      await AvailabilityWeekdayRule.bulkCreate(
        clean.map((weekday) => ({
          tenant_id: tenantId,
          menu_item_id: null,
          weekday,
          available_from: null,
          available_to: null,
        })),
        { transaction }
      );
    }
  });

  await audit({
    action: 'menu.weekday_closures',
    actorId: actorUser.id,
    tenantId,
    entityType: 'Tenant',
    entityId: String(tenantId),
    metadata: { count: clean.length, weekdays: clean },
    req,
  });

  return AvailabilityWeekdayRule.findAll({
    where: { tenant_id: tenantId, menu_item_id: null },
    order: [['weekday', 'ASC']],
  });
}

/**
 * Per-item weekday rules (Phase 5): replace-all save. `rules` is the full
 * list of { weekday, available_from?, available_to? } entries for ONE item
 * (0=Sun … 6=Sat, at most one per weekday) — any stored rule for the item
 * not in the list is removed; omitting a weekday clears it (falls back to
 * the base window). Both bounds null = closed every that-weekday. Audited
 * as `menu.weekday_rules`. Returns the saved rows, weekday-ascending.
 */
export async function replaceItemWeekdayRules(tenantId, actorUser, productId, rules, req) {
  if (!Array.isArray(rules)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'rules must be an array');
  }
  if (rules.length > 7) {
    throw new AppError(400, 'VALIDATION_ERROR', 'At most one rule per weekday (7 total)');
  }

  const seen = new Set();
  const clean = [];
  for (const entry of rules) {
    if (!entry || typeof entry !== 'object') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Each rule needs a weekday and optional window');
    }
    const weekday = Number(entry.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new AppError(400, 'VALIDATION_ERROR', 'weekday must be 0 (Sun) … 6 (Sat)');
    }
    if (seen.has(weekday)) {
      throw new AppError(400, 'VALIDATION_ERROR', `Duplicate rule for weekday ${weekday}`);
    }
    seen.add(weekday);
    clean.push({
      weekday,
      available_from: normalizeWindowTime(entry.available_from, `available_from (weekday ${weekday})`),
      available_to: normalizeWindowTime(entry.available_to, `available_to (weekday ${weekday})`),
    });
  }

  await sequelize.transaction(async (transaction) => {
    await AvailabilityWeekdayRule.destroy({
      where: { tenant_id: tenantId, menu_item_id: productId },
      transaction,
    });
    if (clean.length > 0) {
      await AvailabilityWeekdayRule.bulkCreate(
        clean.map((r) => ({ ...r, tenant_id: tenantId, menu_item_id: productId })),
        { transaction }
      );
    }
  });

  await audit({
    action: 'menu.weekday_rules',
    actorId: actorUser.id,
    tenantId,
    entityType: 'Product',
    entityId: String(productId),
    metadata: { count: clean.length, weekdays: clean.map((r) => r.weekday) },
    req,
  });

  return AvailabilityWeekdayRule.findAll({
    where: { tenant_id: tenantId, menu_item_id: productId },
    order: [['weekday', 'ASC']],
  });
}

/**
 * Bulk menu edit (Phase 4): apply price / enabled / tags / vat_rate and/or
 * inventory stock across the given item ids in one transaction. Returns the
 * updated rows. Price changes bump each item's optimistic-lock version.
 */
export async function bulkUpdateItems(tenantId, actorUser, body, req) {
  const { ids, price, enabled, vatRate, tags, inventory, category_id, available_from, available_to } =
    body;
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

  // Menu bulk organize (Phase 4 follow-up): move items into a category
  // (null = uncategorised) and/or stamp an availability window in the same
  // request. The category must belong to this tenant (fail-closed).
  if (category_id !== undefined && category_id !== null) {
    const category = await MenuCategory.findOne({
      where: { id: category_id, tenant_id: tenantId },
    });
    if (!category) {
      throw new AppError(400, 'INVALID_CATEGORY', 'Category not found in this workspace');
    }
  }
  const bulkFrom =
    available_from !== undefined ? normalizeWindowTime(available_from, 'available_from') : undefined;
  const bulkTo =
    available_to !== undefined ? normalizeWindowTime(available_to, 'available_to') : undefined;

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
    if (category_id !== undefined) item.category_id = category_id;
    if (bulkFrom !== undefined) item.available_from = bulkFrom;
    if (bulkTo !== undefined) item.available_to = bulkTo;
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
    metadata: {
      count: items.length,
      price,
      enabled,
      tags: cleanTags,
      vatRate,
      categoryId: category_id ?? undefined,
      availableFrom: bulkFrom ?? undefined,
      availableTo: bulkTo ?? undefined,
    },
    req,
  });

  return Product.findAll({
    where: { id: { [Op.in]: items.map((i) => i.id) }, tenant_id: tenantId },
  });
}

/**
 * Persists a drag-and-drop category order (Phase 4 follow-up): assigns
 * sequential sort_order values to the given category ids, in array order.
 * Only categories belonging to the tenant are touched; unknown ids are
 * ignored. Returns the re-ordered rows.
 */
export async function sortCategories(tenantId, actorUser, orderedIds, req) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'An ordered list of category ids is required');
  }
  if (orderedIds.length > 200) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Sort supports up to 200 categories at once');
  }
  const numericIds = [...new Set(orderedIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  const cats = await MenuCategory.findAll({
    where: { id: { [Op.in]: numericIds }, tenant_id: tenantId },
  });
  const byId = new Map(cats.map((c) => [c.id, c]));
  let idx = 0;
  for (const id of numericIds) {
    const cat = byId.get(id);
    if (cat && Number(cat.sort_order ?? 0) !== idx) {
      cat.sort_order = idx;
      await cat.save();
    }
    idx += 1;
  }
  await audit({
    action: 'menu.categories_sorted',
    actorId: actorUser.id,
    tenantId,
    entityType: 'MenuCategory',
    entityId: numericIds.join(','),
    metadata: { count: numericIds.length },
    req,
  });
  return MenuCategory.findAll({
    where: { id: { [Op.in]: numericIds }, tenant_id: tenantId },
    order: [['sort_order', 'ASC'], ['id', 'ASC']],
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
