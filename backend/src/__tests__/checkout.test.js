import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import Tenant from '../models/Tenant.js';
import Product from '../models/Product.js';
import ItemVariant from '../models/ItemVariant.js';
import ItemAddon from '../models/ItemAddon.js';
import Order from '../models/Order.js';

/**
 * Public storefront checkout (Phase 5) — guest order placement.
 *
 * Every request is unauthenticated (the customer journey). All prices and
 * totals are computed server-side; the suite proves the client cannot
 * manipulate them, unavailable products are rejected, scheduled orders are
 * validated, and the Idempotency-Key never creates a duplicate order.
 */

let tenant; // active, with delivery fee 60 + bKash enabled
let tenantNoDelivery;
let productId;
let disabledProductId;
let variantId;
let addonId;

const base = (over = {}) => ({
  customer_name: 'Rahim',
  customer_phone: '01712345678',
  payment_method: 'cash',
  items: [{ product_id: productId, quantity: 1 }],
  ...over,
});

beforeAll(async () => {
  await resetTestDb();

  tenant = await Tenant.create({
    name: 'Checkout Diner',
    slug: 'checkout-diner',
    settings: {
      delivery: { enabled: true, fee: 60 },
      paymentMethods: {
        cash: { enabled: true },
        bkash: { enabled: true, number: '01711111111' },
        nagad: { enabled: true, number: '01722222222' },
        card: { enabled: true },
      },
    },
  });
  tenantNoDelivery = await Tenant.create({
    name: 'No Delivery',
    slug: 'no-delivery',
    settings: { delivery: { enabled: false, fee: 0 } },
  });

  const burger = await Product.create({
    tenant_id: tenant.id,
    name: 'Zinger Burger',
    description: 'Crispy chicken burger',
    price: 250,
    weight_gm: 300,
    enabled: true,
  });
  productId = burger.id;
  const fries = await Product.create({
    tenant_id: tenant.id,
    name: 'Fries',
    price: 100,
    weight_gm: 150,
    enabled: true,
  });
  await Product.create({
    tenant_id: tenant.id,
    name: 'Hidden item',
    price: 50,
    weight_gm: 100,
    enabled: false,
  }).then((p) => (disabledProductId = p.id));
  await Product.create({
    tenant_id: tenantNoDelivery.id,
    name: 'Pickup only burger',
    price: 200,
    weight_gm: 200,
    enabled: true,
  });

  variantId = (await ItemVariant.create({
    tenant_id: tenant.id,
    product_id: productId,
    name: 'Large',
    price_adjustment: 50,
  })).id;
  addonId = (await ItemAddon.create({
    tenant_id: tenant.id,
    product_id: productId,
    name: 'Extra cheese',
    price: 30,
  })).id;

  // A second product so multi-line orders are possible.
  await Product.update({ id: fries.id }, { where: { id: fries.id } });
  await fries.reload();
});

afterAll(async () => {
  await sequelize.close();
});

describe('POST /api/public/restaurants/:slug/checkout', () => {
  it('places a pickup order with server-side totals (cash → paid)', async () => {
    const res = await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .send(base());
    expect(res.status).toBe(201);
    expect(res.body.order_no).toMatch(/^ORD-/);
    expect(res.body.type).toBe('pickup');
    expect(res.body.subtotal).toBe(250);
    expect(res.body.total_discount).toBe(0);
    expect(res.body.delivery_fee).toBe(0);
    expect(res.body.grand_total).toBe(250);
    expect(res.body.payment_status).toBe('paid');
    expect(res.body.trackUrl).toContain('/track?orderNo=');
  });

  it('prices variants and add-ons server-side', async () => {
    const res = await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .send(
        base({
          items: [
            {
              product_id: productId,
              quantity: 2,
              variant_id: variantId,
              addon_ids: [addonId],
            },
          ],
        })
      );
    expect(res.status).toBe(201);
    // 2 × (250 + 50 + 30) = 660
    expect(res.body.subtotal).toBe(660);
    expect(res.body.grand_total).toBe(660);
    expect(res.body.items[0].item_name).toContain('Large');
    expect(res.body.items[0].item_name).toContain('Extra cheese');
  });

  it('adds the delivery fee for delivery orders and requires an address', async () => {
    const res = await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .send(
        base({
          order_type: 'delivery',
          customer_address: 'Dhanmondi 27, Dhaka',
        })
      );
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('delivery');
    expect(res.body.delivery_fee).toBe(60);
    expect(res.body.grand_total).toBe(250 + 60);
  });

  it('rejects delivery orders without an address', async () => {
    const res = await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .send(base({ order_type: 'delivery' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects delivery orders when the restaurant has delivery off', async () => {
    const res = await request(app)
      .post('/api/public/restaurants/no-delivery/checkout')
      .send({
        customer_name: 'Karim',
        customer_phone: '01712345678',
        order_type: 'delivery',
        customer_address: 'Gulshan, Dhaka',
        items: [{ product_id: 99999, quantity: 1 }],
      });
    // Delivery-unavailable check runs before product lookup → 400 DELIVERY_UNAVAILABLE.
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DELIVERY_UNAVAILABLE');
  });

  it('accepts scheduled pickup with a future time and stamps scheduled_at', async () => {
    const future = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .send(base({ order_type: 'scheduled_pickup', scheduled_at: future }));
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('scheduled_pickup');
    expect(new Date(res.body.scheduled_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects a scheduled time in the past', async () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    const res = await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .send(base({ order_type: 'scheduled_pickup', scheduled_at: past }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SCHEDULE');
  });

  it('rejects scheduled orders without a scheduled_at', async () => {
    const res = await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .send(base({ order_type: 'scheduled_delivery', customer_address: 'Banani, Dhaka' }));
    expect(res.status).toBe(400);
  });

  it('rejects an empty cart', async () => {
    const res = await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .send(base({ items: [] }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unknown products with PRODUCT_UNAVAILABLE', async () => {
    const res = await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .send(base({ items: [{ product_id: 99999, quantity: 1 }] }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PRODUCT_UNAVAILABLE');
  });

  it('rejects disabled (unavailable) products', async () => {
    const res = await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .send(base({ items: [{ product_id: disabledProductId, quantity: 1 }] }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PRODUCT_UNAVAILABLE');
  });

  it('rejects invalid quantities', async () => {
    for (const qty of [0, -1, 1.5, 1000]) {
      const res = await request(app)
        .post('/api/public/restaurants/checkout-diner/checkout')
        .send(base({ items: [{ product_id: productId, quantity: qty }] }));
      expect(res.status).toBe(400);
    }
  });

  it('ignores client-submitted prices (never trusts the client)', async () => {
    const res = await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .send(
        base({
          items: [
            {
              product_id: productId,
              quantity: 1,
              price: 1, // attempt to pay 1 taka — must be ignored
              unit_price: 1,
              line_total: 1,
            },
          ],
        })
      );
    expect(res.status).toBe(201);
    expect(res.body.subtotal).toBe(250); // DB price, not the client's 1
    expect(res.body.grand_total).toBe(250);
  });

  it('rejects an invalid payment method without creating an order', async () => {
    const before = await Order.count();
    const res = await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .send(base({ payment_method: 'credit' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PAYMENT_METHOD');
    expect(await Order.count()).toBe(before);
  });

  it('returns 404 for an unknown or hidden restaurant slug', async () => {
    const res = await request(app)
      .post('/api/public/restaurants/nope/checkout')
      .send(base());
    expect(res.status).toBe(404);
  });

  it('creates a pending wallet payment for bkash and validates the method set', async () => {
    const res = await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .send(
        base({
          payment_method: 'bkash',
          payment_reference: '8A7B6C5D4E',
        })
      );
    expect(res.status).toBe(201);
    expect(res.body.payment_method).toBe('bkash');
    expect(res.body.payment_status).toBe('pending');
    expect(res.body.payments[0].status).toBe('pending');
    expect(res.body.payments[0].reference).toBe('8A7B6C5D4E');
  });

  it('same Idempotency-Key twice creates exactly one order (replay)', async () => {
    const before = await Order.count();
    const first = await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .set('Idempotency-Key', 'dup-key-1')
      .send(base());
    const second = await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .set('Idempotency-Key', 'dup-key-1')
      .send(base());
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.order_no).toBe(first.body.order_no);
    expect(await Order.count()).toBe(before + 1);
  });

  it('different keys create independent orders', async () => {
    const before = await Order.count();
    await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .set('Idempotency-Key', 'key-a')
      .send(base());
    await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .set('Idempotency-Key', 'key-b')
      .send(base());
    expect(await Order.count()).toBe(before + 2);
  });

  it('a failed request with a key is retryable with the same key', async () => {
    const before = await Order.count();
    const bad = await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .set('Idempotency-Key', 'retry-key-1')
      .send(base({ items: [{ product_id: 99999, quantity: 1 }] }));
    expect(bad.status).toBe(400);

    const good = await request(app)
      .post('/api/public/restaurants/checkout-diner/checkout')
      .set('Idempotency-Key', 'retry-key-1')
      .send(base());
    expect(good.status).toBe(201);
    expect(await Order.count()).toBe(before + 1);
  });
});
