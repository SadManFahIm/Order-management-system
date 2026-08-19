import sequelize from '../config/db.js';
import { AppError } from '../middleware/errorHandler.js';
import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import Product from '../models/Product.js';
import ItemVariant from '../models/ItemVariant.js';
import Payment from '../models/Payment.js';
import Tenant from '../models/Tenant.js';
import OrderEditRequest from '../models/OrderEditRequest.js';
import { priceCart, deliveryConfig } from './checkoutService.js';
import { recomputeOrderPaymentStatus } from './paymentsService.js';
import { decrementVariantStock } from './menuService.js';
import { publishOrderEvent } from './realtime.js';

/**
 * Order editing after placement (Phase 5 follow-up) — approval flow.
 *
 * A placed order is immutable. Customers/staff submit an *edit request* (a
 * JSON snapshot of the desired line items); a manager approves or rejects it.
 * Only on approval is the live order rewritten — re-priced server-side via
 * `priceCart`, order_items replaced, money + payment_status recomputed, and
 * variant/inventory stock adjusted for the added/removed quantities. All of
 * that happens inside one transaction so an approved edit can never leave a
 * half-applied order.
 */

/** Statuses an order must be in to accept an edit request. */
export const EDITABLE_STATUSES = ['placed', 'accepted', 'preparing'];

/** True when a requested line list is non-empty and well-formed. */
export function normalizeRequestedItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Edit request must contain at least one item');
  }
  return items.map((i) => ({
    product_id: Number(i.product_id),
    quantity: Number(i.quantity),
  }));
}

/** Loads an order scoped to the tenant (404 on miss). */
async function loadOrder(orderId, tenantId) {
  const order = await Order.findOne({ where: { id: orderId, tenant_id: tenantId } });
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found');
  return order;
}

/** Blocks a second pending edit request on the same order (409). */
async function assertNoPendingEdit(tenantId, orderId) {
  const existing = await OrderEditRequest.findOne({
    where: { tenant_id: tenantId, order_id: orderId, status: 'pending' },
  });
  if (existing) {
    throw new AppError(
      409,
      'EDIT_REQUEST_PENDING',
      'An edit request is already pending for this order'
    );
  }
}

/**
 * Creates a pending edit request. `actor` is optional (public customer path
 * passes `{ orderNo, phone }`); the staff path passes the req.user.
 */
export async function createEditRequest({
  tenant,
  orderId,
  items,
  reason,
  actor,
  orderNo,
  phone,
}) {
  // The customer/public path authenticates by order-no + phone instead of a
  // JWT — find the order by both and require a match.
  const where = { id: orderId, tenant_id: tenant.id };
  if (orderNo) where.order_no = orderNo;
  const order = await Order.findOne({ where });
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found');
  if (orderNo && phone && String(order.customer_phone || '') !== String(phone)) {
    throw new AppError(403, 'FORBIDDEN', 'Order not found for this phone number');
  }
  if (!EDITABLE_STATUSES.includes(order.status)) {
    throw new AppError(
      409,
      'INVALID_STATUS_TRANSITION',
      `Orders in "${order.status}" cannot be edited`
    );
  }

  // Server-side availability check on the REQUESTED list (products exist +
  // enabled in this tenant). Full pricing happens at approval; here we just
  // guard against requesting unknown/disabled products.
  const ids = [...new Set(items.map((i) => i.product_id))];
  const found = await Product.findAll({
    where: { id: ids, tenant_id: tenant.id, enabled: true },
  });
  const byId = new Set(found.map((p) => p.id));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new AppError(
      400,
      'PRODUCT_UNAVAILABLE',
      `Product(s) unavailable: ${missing.join(', ')}`
    );
  }

  await assertNoPendingEdit(tenant.id, order.id);

  const req = await OrderEditRequest.create({
    tenant_id: tenant.id,
    order_id: order.id,
    requested_by: actor?.id ?? null,
    customer_phone: phone || (actor ? order.customer_phone : null),
    status: 'pending',
    reason: reason?.trim() ? reason.trim().slice(0, 255) : null,
    requested_items: normalizeRequestedItems(items),
  });

  publishOrderEvent(tenant.id, 'order.edit_requested', order);
  return req;
}

/**
 * Approves a pending edit request and rewrites the live order atomically.
 * `orderId`/`reqId` are tenant-scoped. Returns the updated order.
 */
export async function approveEditRequest({ tenant, orderId, reqId, actorId }) {
  const order = await loadOrder(orderId, tenant.id);
  const edit = await OrderEditRequest.findOne({
    where: { id: reqId, tenant_id: tenant.id, order_id: order.id },
  });
  if (!edit) throw new AppError(404, 'NOT_FOUND', 'Edit request not found');
  if (edit.status !== 'pending') {
    throw new AppError(409, 'EDIT_ALREADY_DECIDED', `Edit request is already ${edit.status}`);
  }

  const result = await sequelize.transaction(async (transaction) => {
    // Fresh tenant (settings drive the delivery fee + availability timezone).
    const tenantRow = await Tenant.findByPk(tenant.id, { transaction });
    // Re-price the requested cart from the DB (never trust stored totals).
    const pricing = await priceCart(tenantRow || tenant, edit.requested_items, order.scheduled_at || new Date());
    const deliveryFee = ['delivery', 'scheduled_delivery'].includes(order.type)
      ? deliveryConfig(tenantRow || tenant).fee
      : 0;
    const grandTotal = pricing.grandTotal + deliveryFee;

    // Item delta for stock accounting: what we currently hold vs the new list.
    const oldLines = await OrderItem.findAll({
      where: { order_id: order.id },
      transaction,
    });
    const oldByProduct = new Map();
    for (const l of oldLines) oldByProduct.set(Number(l.product_id), Number(l.quantity) || 0);
    const newByProduct = new Map();
    for (const i of pricing.items) newByProduct.set(Number(i.product.id), i.quantity);

    // Delete old lines and write the new priced ones.
    await OrderItem.destroy({ where: { order_id: order.id }, transaction });
    await OrderItem.bulkCreate(
      pricing.items.map((i) => ({
        tenant_id: tenant.id,
        order_id: order.id,
        product_id: i.product.id,
        item_name: i.itemName,
        quantity: i.quantity,
        unit_price: i.unitPrice,
        weight_per_unit_gm: i.product.weight_gm,
        total_weight_gm: i.totalWeightGm,
        discount: i.discount,
        line_total: i.lineTotal,
      })),
      { transaction }
    );

    order.subtotal = pricing.subtotal;
    order.total_discount = pricing.totalDiscount;
    order.grand_total = grandTotal;
    await order.save({ transaction });

    // Recompute payment_status from the (possibly changed) total.
    await recomputeOrderPaymentStatus(order, { transaction });

    // Variant stock accounting: release stock for removed qty, decrement for
    // added qty (best-effort, floored at zero, never fails the approve).
    const variantAdjustments = [];
    for (const i of pricing.items) {
      if (i.variant) {
        const diff = i.quantity - (oldByProduct.get(Number(i.product.id)) || 0);
        variantAdjustments.push({ variant: i.variant, quantity: diff });
      }
    }
    // Negative diff = release; decrementVariantStock only decrements, so call
    // it for added quantities and manually release removed ones.
    const toDecrement = variantAdjustments.filter((a) => a.quantity > 0);
    await decrementVariantStock(toDecrement);
    for (const a of variantAdjustments.filter((x) => x.quantity < 0)) {
      const { variant, quantity } = a;
      if (!variant || !variant.id) continue;
      const current = await ItemVariant.findByPk(variant.id);
      if (current && current.stock !== null && current.stock !== undefined) {
        const next = Math.max(0, Number(current.stock) + Math.abs(quantity));
        await current.update({ stock: next }, { transaction });
      }
    }

    edit.status = 'approved';
    edit.decided_by = actorId ?? null;
    edit.decided_at = new Date();
    await edit.save({ transaction });

    return order;
  });

  publishOrderEvent(tenant.id, 'order.edit_approved', order);
  return order;
}

/** Rejects a pending edit request (the live order stays untouched). */
export async function rejectEditRequest({ tenant, orderId, reqId, actorId, note }) {
  const order = await loadOrder(orderId, tenant.id);
  const edit = await OrderEditRequest.findOne({
    where: { id: reqId, tenant_id: tenant.id, order_id: order.id },
  });
  if (!edit) throw new AppError(404, 'NOT_FOUND', 'Edit request not found');
  if (edit.status !== 'pending') {
    throw new AppError(409, 'EDIT_ALREADY_DECIDED', `Edit request is already ${edit.status}`);
  }
  edit.status = 'rejected';
  edit.decided_by = actorId ?? null;
  edit.decided_at = new Date();
  edit.decision_note = note?.trim() ? note.trim().slice(0, 255) : null;
  await edit.save();

  publishOrderEvent(tenant.id, 'order.edit_rejected', order);
  return edit;
}

/** Lists edit requests for an order (newest first), tenant-scoped. */
export async function listEditRequests(orderId, tenantId) {
  const order = await loadOrder(orderId, tenantId);
  return OrderEditRequest.findAll({
    where: { order_id: order.id },
    order: [['id', 'DESC']],
  });
}