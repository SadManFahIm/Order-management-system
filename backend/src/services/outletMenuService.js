import OutletMenuOverride from '../models/OutletMenuOverride.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Per-outlet menu override helpers (Sector: outlet menu overrides).
 *
 * outlet_menu_overrides lets a branch override the central catalog per item:
 *   price_override  — non-null → use this price instead of base_price
 *   is_available    — non-null → force available (true) / unavailable (false)
 *   stock_override  — non-null → force the storefront stock snapshot
 *   visible         — false → hide the item at this outlet
 * NULL fields mean "use the central catalog value".
 */

/** Returns a Map<menu_item_id, { price_override, is_available, stock_override, visible }>. */
export async function resolveOutletMenuOverrides(tenantId, outletId) {
  if (!outletId) return new Map();
  const overrides = await OutletMenuOverride.findAll({
    where: { tenant_id: tenantId, outlet_id: outletId },
  });
  return new Map(overrides.map((o) => [
    o.menu_item_id,
    {
      priceOverride: o.price_override != null ? Number(o.price_override) : null,
      isAvailable: o.is_available,
      stockOverride: o.stock_override != null ? Number(o.stock_override) : null,
      visible: o.visible,
    },
  ]));
}

/** Applies a price override to a base price, falling back to the base price. */
export function overridePrice(basePrice, overrideMap, itemId) {
  const ov = overrideMap?.get(itemId);
  if (ov && ov.priceOverride != null && ov.priceOverride >= 0) return ov.priceOverride;
  return basePrice;
}

/** Applies the outlet-level availability override (null = no override). */
export function overrideAvailable(baseAvailable, overrideMap, itemId) {
  const ov = overrideMap?.get(itemId);
  if (ov && ov.isAvailable != null) return ov.isAvailable;
  return baseAvailable;
}

/** Applies the outlet-level visibility override (null = inherit visible=true). */
export function overrideVisible(baseVisible = true, overrideMap, itemId) {
  const ov = overrideMap?.get(itemId);
  if (ov && ov.visible != null) return ov.visible;
  return baseVisible;
}

/**
 * Replaces the full override set for one outlet with the given rows
 * (replace-all semantics, mirroring replaceAvailabilityOverrides). Each row
 * must reference a menu item that exists in the tenant, and null-out any
 * field you want to fall back to the catalog default. */
export async function replaceOutletMenuOverrides(tenantId, outletId, menuItemId, body) {
  const fields = {};

  if (body.price_override !== undefined && body.price_override !== null) {
    const p = Number(body.price_override);
    if (!Number.isFinite(p) || p < 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'price_override must be a non-negative number');
    }
    fields.price_override = p;
  }

  if (body.is_available !== undefined && body.is_available !== null) {
    fields.is_available = Boolean(body.is_available);
  }

  if (body.stock_override !== undefined && body.stock_override !== null) {
    const s = Number(body.stock_override);
    if (!Number.isFinite(s) || s < 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'stock_override must be a non-negative number');
    }
    fields.stock_override = s;
  }

  if (body.visible !== undefined && body.visible !== null) {
    fields.visible = Boolean(body.visible);
  }

  const [res, created] = await OutletMenuOverride.upsert({
    outlet_id: outletId,
    menu_item_id: menuItemId,
    tenant_id: tenantId,
    ...fields,
  });

  return { override: res, created };
}

/** Removes any override row for a single outlet/menu-item pair. */
export async function clearOutletMenuOverride(tenantId, outletId, menuItemId) {
  const row = await OutletMenuOverride.findOne({
    where: { tenant_id: tenantId, outlet_id: outletId, menu_item_id: menuItemId },
  });
  if (!row) return false;
  await row.destroy();
  return true;
}
