import { Op } from 'sequelize';
import Order from '../models/Order.js';
import UserTenant from '../models/UserTenant.js';
import User from '../models/User.js';
import { DELIVERY_TYPES } from './checkoutService.js';
import { publishOrderEvent } from './realtime.js';

/**
 * Delivery auto-assignment (Phase 5 follow-up) — zone + rider load.
 *
 * For a delivery order, pick the least-loaded rider whose zone coverage
 * includes the order's zone (or any rider when the order has no zone / the
 * rider covers all zones). "Load" = the number of active orders currently
 * assigned to a rider (placed → out_for_delivery). Returns the assigned
 * rider id, or null when no rider is eligible — callers treat null as a no-op
 * (manual assignment stays available).
 */

const ACTIVE_ASSIGNED_STATUSES = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'];

/** Returns true when a delivery member covers the given order zone. */
function coversZone(member, zone) {
  if (!zone) return true; // order has no zone — anyone can take it
  const zones = Array.isArray(member?.delivery_zones) ? member.delivery_zones : [];
  if (!zones || zones.length === 0) return true; // empty coverage = all zones
  return zones.includes(zone);
}

/**
 * Picks a least-loaded rider for `order` and assigns them. Idempotent: if the
 * order already has a rider, returns the existing assignment (no-op). Never
 * overwrites a manual assignment. Returns the rider user id or null.
 */
export async function autoAssign(tenantId, order) {
  if (!order || !DELIVERY_TYPES.includes(order.type)) return null;
  if (order.assigned_to) return order.assigned_to;
  if (['delivered', 'canceled', 'rejected'].includes(order.status)) return null;

  const members = await UserTenant.findAll({
    where: { tenant_id: tenantId, role: 'delivery' },
  });
  const eligible = members.filter((m) => coversZone(m, order.delivery_zone));
  if (eligible.length === 0) return null;

  const riderIds = eligible.map((m) => m.user_id);
  // Load = count of active orders assigned to each rider.
  const rows = await Order.findAll({
    where: {
      tenant_id: tenantId,
      assigned_to: { [Op.in]: riderIds },
      status: { [Op.in]: ACTIVE_ASSIGNED_STATUSES },
    },
    attributes: ['assigned_to'],
  });
  const load = new Map();
  for (const rider of riderIds) load.set(rider, 0);
  for (const r of rows) {
    const id = Number(r.assigned_to);
    if (load.has(id)) load.set(id, load.get(id) + 1);
  }

  // Least-loaded, then lowest id for determinism.
  eligible.sort((a, b) => {
    const diff = load.get(a.user_id) - load.get(b.user_id);
    return diff !== 0 ? diff : a.user_id - b.user_id;
  });
  const pick = eligible[0];
  order.assigned_to = pick.user_id;
  await order.save();

  publishOrderEvent(tenantId, 'order.assigned', order);
  return pick.user_id;
}

/**
 * Tenant-wide sweep: auto-assign every eligible, unassigned active delivery
 * order. Returns the count of orders assigned. Safe to run any time — it
 * never touches already-assigned or non-delivery orders.
 */
export async function autoAssignTenant(tenantId) {
  const orders = await Order.findAll({
    where: {
      tenant_id: tenantId,
      type: { [Op.in]: DELIVERY_TYPES },
      assigned_to: null,
      status: { [Op.in]: ACTIVE_ASSIGNED_STATUSES },
    },
  });
  let count = 0;
  for (const order of orders) {
    if ((await autoAssign(tenantId, order)) != null) count += 1;
  }
  return count;
}

/** Members with the delivery role (for the assign dropdown / auto-assign UI). */
export async function deliveryMembers(tenantId) {
  return UserTenant.findAll({
    where: { tenant_id: tenantId, role: 'delivery' },
    include: [{ model: User }],
  });
}