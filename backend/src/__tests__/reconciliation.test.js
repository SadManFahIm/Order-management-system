import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { Tenant, Order, Payment } from '../models/index.js';
import { runPaymentReconciliation, RECONCILIATION_TTL_MS } from '../services/paymentReconciliation.js';

/**
 * Payment reconciliation (Phase 6) — stale online payment intents auto-expire.
 *
 * Hosted-checkout payments get an `expires_at` window at creation; if the
 * customer never completes the checkout, the reconciliation tick flips them
 * to `expired` and re-syncs the order's payment_status (→ unpaid). Manual
 * wallet payments (cashier-confirmed) are deliberately out of scope.
 */

let tenant;

beforeAll(async () => {
  await resetTestDb();
  tenant = await Tenant.create({ name: 'Recon Diner', slug: 'recon-diner' });
});

afterAll(async () => {
  await sequelize.close();
});

const makeOrder = async (paymentMethod, paymentStatus) =>
  Order.create({
    tenant_id: tenant.id,
    order_no: `ORD-RECON-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    customer_name: 'Recon Guest',
    payment_method: paymentMethod,
    payment_status: paymentStatus,
    subtotal: 300,
    total_discount: 0,
    grand_total: 300,
    status: 'placed',
  });

describe('runPaymentReconciliation', () => {
  it('expires a stale online intent and flips the order to unpaid', async () => {
    const order = await makeOrder('online', 'pending');
    await Payment.create({
      tenant_id: tenant.id,
      order_id: order.id,
      method: 'online',
      amount: 300,
      status: 'pending',
      expires_at: new Date(Date.now() - 1000), // past its window
    });

    expect(await runPaymentReconciliation()).toBe(1);

    const payment = await Payment.findOne({ where: { order_id: order.id } });
    expect(payment.status).toBe('expired');
    expect(payment.notes).toContain('Auto-expired');

    const fresh = await Order.findByPk(order.id);
    expect(fresh.payment_status).toBe('unpaid');
  });

  it('leaves in-window online payments alone', async () => {
    const order = await makeOrder('online', 'pending');
    await Payment.create({
      tenant_id: tenant.id,
      order_id: order.id,
      method: 'online',
      amount: 300,
      status: 'pending',
      expires_at: new Date(Date.now() + RECONCILIATION_TTL_MS), // still valid
    });

    expect(await runPaymentReconciliation()).toBe(0);
    const payment = await Payment.findOne({ where: { order_id: order.id } });
    expect(payment.status).toBe('pending');
  });

  it('never touches manual wallet payments (cashier-confirmed flow)', async () => {
    const order = await makeOrder('bkash', 'pending');
    await Payment.create({
      tenant_id: tenant.id,
      order_id: order.id,
      method: 'bkash',
      amount: 300,
      status: 'pending',
      expires_at: new Date(Date.now() - 60_000), // long past — still manual
    });

    expect(await runPaymentReconciliation()).toBe(0);
    const payment = await Payment.findOne({ where: { order_id: order.id } });
    expect(payment.status).toBe('pending');
  });

  it('is idempotent — already-expired payments are not re-counted', async () => {
    const order = await makeOrder('online', 'unpaid');
    await Payment.create({
      tenant_id: tenant.id,
      order_id: order.id,
      method: 'online',
      amount: 300,
      status: 'expired',
      expires_at: new Date(Date.now() - 60_000),
    });

    expect(await runPaymentReconciliation()).toBe(0);
  });
});
