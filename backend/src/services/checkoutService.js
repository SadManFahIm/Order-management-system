import { AppError } from '../middleware/errorHandler.js';
import Product from '../models/Product.js';
import ItemVariant from '../models/ItemVariant.js';
import ItemAddon from '../models/ItemAddon.js';
import Promotion from '../models/Promotion.js';
import PromotionSlab from '../models/PromotionSlab.js';
import { applyPromotionsToCart } from '../utils/promotionEngine.js';
import { buildAvailabilityContext, isAvailableAt } from './menuService.js';

/**
 * Storefront checkout core (Phase 5) — shared by the public checkout route.
 *
 * Everything is priced server-side from the database — the client never
 * sends prices or totals. Variant/add-on uplifts are computed on top of the
 * base product price; promotions apply to the base price (menu price), and
 * the uplift is added to the line afterwards (documented behaviour).
 */

export const ORDER_TYPES = ['pickup', 'delivery', 'scheduled_pickup', 'scheduled_delivery'];
export const DELIVERY_TYPES = ['delivery', 'scheduled_delivery'];

const round2 = (n) => Math.round(n * 100) / 100;

/** Scheduled orders must be 5+ minutes out and within the 7-day horizon. */
export function validateSchedule(scheduledAt, orderType) {
  if (!['scheduled_pickup', 'scheduled_delivery'].includes(orderType)) return null;
  const at = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (Number.isNaN(at.getTime())) {
    throw new AppError(400, 'INVALID_SCHEDULE', 'scheduled_at must be a valid date');
  }
  const now = Date.now();
  if (at.getTime() < now + 5 * 60 * 1000) {
    throw new AppError(400, 'INVALID_SCHEDULE', 'Scheduled time must be at least 5 minutes from now');
  }
  if (at.getTime() > now + 7 * 24 * 60 * 60 * 1000) {
    throw new AppError(400, 'INVALID_SCHEDULE', 'Scheduled time cannot be more than 7 days ahead');
  }
  return at;
}

/** Per-tenant delivery config: fee (default 0) + toggle (default enabled). */
export function deliveryConfig(tenant) {
  const delivery =
    tenant?.settings?.delivery && typeof tenant.settings.delivery === 'object'
      ? tenant.settings.delivery
      : {};
  return {
    enabled: delivery.enabled !== false,
    fee: Number.isFinite(Number(delivery.fee)) ? round2(Number(delivery.fee)) : 0,
  };
}

/**
 * Fetches the requested products (enabled, tenant-scoped) with their
 * variants/add-ons, validates each line (product exists + enabled, quantity
 * sane, variant/add-ons belong to the product), and returns the enriched
 * cart plus the pricing result:
 *   { items, subtotal, totalDiscount, deliveryFee, grandTotal }
 *
 * `items[i]` mirrors the order-item shape: { product, quantity, variant,
 * addons, unitPrice (incl. uplift), baseTotal, discount, lineTotal,
 * totalWeightGm, itemName }.
 */
export async function priceCart(tenant, rawItems, at = new Date()) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Order must contain at least one item');
  }

  // Availability at the effective instant (Phase 5): for scheduled orders
  // `at` is the scheduled date, so a restaurant-wide closure day, a
  // restaurant-wide weekday closure, a per-item weekday rule, or a
  // "closed that day" override rejects the order even when placed while the
  // base window is open. Fetched once per cart (tenant + date index).
  const ctx = await buildAvailabilityContext(tenant.id, at);

  const ids = [...new Set(rawItems.map((i) => i.product_id))];
  const products = await Product.findAll({
    where: { id: ids, tenant_id: tenant.id, enabled: true },
    include: [
      { model: ItemVariant, as: 'variants' },
      { model: ItemAddon, as: 'addons' },
    ],
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const lines = rawItems.map((raw) => {
    const product = productMap.get(raw.product_id);
    if (!product) {
      throw new AppError(400, 'PRODUCT_UNAVAILABLE', `Product ${raw.product_id} is unavailable`);
    }
    // Full availability resolution (restaurant closures, weekday rules,
    // per-day overrides, base window) — an item outside its effective
    // window is treated exactly like a disabled product.
    if (!isAvailableAt(product, ctx)) {
      throw new AppError(
        400,
        'AVAILABILITY_WINDOW',
        `${product.name} is not orderable at this time`
      );
    }
    const quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      throw new AppError(400, 'VALIDATION_ERROR', 'quantity must be an integer between 1 and 999');
    }

    const variant = raw.variant_id
      ? (product.variants || []).find((v) => v.id === Number(raw.variant_id))
      : null;
    if (raw.variant_id && !variant) {
      throw new AppError(400, 'INVALID_VARIANT', `Variant ${raw.variant_id} does not belong to this product`);
    }
    // Variant-level stock (Phase 4): a tracked variant (stock not NULL)
    // cannot be ordered beyond its quantity on hand.
    if (variant && variant.stock !== null && variant.stock !== undefined && quantity > variant.stock) {
      throw new AppError(
        400,
        'VARIANT_OUT_OF_STOCK',
        `Only ${variant.stock} × ${variant.name} left in stock`
      );
    }
    const addonIds = (raw.addon_ids || []).map(Number);
    const addons = addonIds.map((id) => (product.addons || []).find((a) => a.id === id));
    if (addons.some((a) => !a)) {
      throw new AppError(400, 'INVALID_ADDON', 'One or more add-ons do not belong to this product');
    }

    const upliftPerUnit = round2(
      (variant?.price_adjustment || 0) + addons.reduce((s, a) => s + Number(a.price || 0), 0)
    );
    const unitPrice = round2(Number(product.price) + upliftPerUnit);
    const baseTotal = round2(Number(product.price) * quantity);
    const nameParts = [product.name];
    if (variant) nameParts.push(`(${variant.name})`);
    if (addons.length > 0) nameParts.push(`+ ${addons.map((a) => a.name).join(', ')}`);

    return {
      product,
      quantity,
      variant,
      addons,
      unitPrice,
      baseTotal,
      uplift: round2(upliftPerUnit * quantity),
      itemName: nameParts.join(' '),
    };
  });

  // Promotions apply to the base (menu) price — the existing engine is
  // reused verbatim; the variant/add-on uplift is added afterwards.
  const promotions = await Promotion.findAll({
    where: { tenant_id: tenant.id },
    include: [{ model: PromotionSlab, as: 'slabs' }],
  });
  const { items: promoItems, totalDiscount } = applyPromotionsToCart(
    lines.map((l) => ({ product: l.product, quantity: l.quantity })),
    promotions
  );

  let subtotal = 0;
  const items = lines.map((l, idx) => {
    const discount = round2(promoItems[idx].discount);
    const lineTotal = round2(l.baseTotal + l.uplift - discount);
    subtotal += l.baseTotal + l.uplift;
    return {
      product: l.product,
      quantity: l.quantity,
      variant: l.variant,
      addons: l.addons,
      unitPrice: l.unitPrice,
      baseTotal: l.baseTotal,
      uplift: l.uplift,
      discount,
      lineTotal,
      totalWeightGm: round2(Number(l.product.weight_gm || 0) * l.quantity),
      itemName: l.itemName,
    };
  });

  return {
    items,
    subtotal: round2(subtotal),
    totalDiscount: round2(totalDiscount),
    grandTotal: round2(subtotal - Number(totalDiscount)),
  };
}
