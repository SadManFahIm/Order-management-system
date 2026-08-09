import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant, Product, Table } from '../models/index.js';
import { buildWhatsAppLink, orderWhatsAppText } from '../services/whatsappService.js';

/**
 * WhatsApp order alerts (Phase 5) — merchant settings + webhook delivery.
 *
 * A local HTTP receiver stands in for a WhatsApp gateway (Twilio/WATI/etc.).
 * Order alerts are fire-and-forget, so tests poll the receiver briefly.
 */

let token;
let tenant;
let product;

/** Tiny HTTP receiver that records JSON POST bodies. */
function startReceiver() {
  const bodies = [];
  const headers = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      bodies.push(raw ? JSON.parse(raw) : null);
      headers.push(req.headers);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        bodies,
        headers,
      });
    });
  });
}

/** Polls until the receiver has a body (fire-and-forget delivery is async). */
async function waitForBodies(receiver, count = 1, timeoutMs = 2500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (receiver.bodies.length >= count) return receiver.bodies.slice(0, count);
    await new Promise((r) => setTimeout(r, 40));
  }
  return receiver.bodies.slice(0, count);
}

/** Polls until the receiver has a body with the given event name. */
async function waitForEvent(receiver, event, timeoutMs = 2500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = receiver.bodies.find((b) => b?.event === event);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 40));
  }
  return null;
}

beforeAll(async () => {
  await resetTestDb();
  tenant = await Tenant.create({ name: 'Wa Diner', slug: 'wa-diner' });
  const owner = await User.create({
    name: 'Wa Owner',
    email: 'waowner@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenant.id, role: 'owner' });
  token = (
    await request(app).post('/api/auth/login').send({ email: 'waowner@example.com', password: 'password123' })
  ).body.accessToken;

  product = await Product.create({
    tenant_id: tenant.id,
    name: 'Whatsapp Burger',
    price: 250,
    weight_gm: 400,
    enabled: true,
  });

  // A physical table so dine-in orders can reference table 3.
  await Table.create({ tenant_id: tenant.id, table_no: 3, name: 'Wa Window', capacity: 4 });
});

afterAll(async () => {
  await sequelize.close();
});

describe('buildWhatsAppLink', () => {
  it('builds a wa.me deep link with encoded text', () => {
    const link = buildWhatsAppLink('+8801712345678', 'Hello Dhaka!');
    expect(link).toBe('https://wa.me/8801712345678?text=Hello%20Dhaka!');
  });

  it('returns null for an empty number', () => {
    expect(buildWhatsAppLink('', 'hi')).toBeNull();
    expect(buildWhatsAppLink(null, 'hi')).toBeNull();
  });
});

describe('orderWhatsAppText', () => {
  it('builds a readable multi-line alert', () => {
    const text = orderWhatsAppText(
      { order_no: 'ORD-1-ABC', table_no: 4, customer_name: 'Rahim', grand_total: 520, status: 'placed' },
      [{ item_name: 'Burger', quantity: 2 }]
    );
    expect(text).toContain('ORD-1-ABC');
    expect(text).toContain('Table 4');
    expect(text).toContain('Burger ×2');
    expect(text).toContain('520.00 BDT');
  });
});

describe('PATCH /api/tenants/:id — whatsapp settings', () => {
  it('accepts and persists the whatsapp config in settings', async () => {
    const res = await request(app)
      .patch(`/api/tenants/${tenant.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        whatsapp: { enabled: true, number: '+8801712345678', webhookUrl: 'https://gateway.example.com/hook', secret: 's3cret' },
      });
    expect(res.status).toBe(200);
    expect(res.body.settings.whatsapp).toMatchObject({
      enabled: true,
      number: '+8801712345678',
      webhookUrl: 'https://gateway.example.com/hook',
    });
  });

  it('rejects a malformed phone number', async () => {
    const res = await request(app)
      .patch(`/api/tenants/${tenant.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ whatsapp: { number: 'not-a-phone' } });
    expect(res.status).toBe(400);
  });

  it('rejects a non-URL webhook', async () => {
    const res = await request(app)
      .patch(`/api/tenants/${tenant.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ whatsapp: { webhookUrl: 'nope' } });
    expect(res.status).toBe(400);
  });
});

describe('order → WhatsApp webhook delivery', () => {
  it('POSTs the order to the configured webhook with the auth secret', async () => {
    const receiver = await startReceiver();
    try {
      const webhookUrl = `http://127.0.0.1:${receiver.port}/hook`;
      await request(app)
        .patch(`/api/tenants/${tenant.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ whatsapp: { enabled: true, number: '+8801712345678', webhookUrl, secret: 's3cret' } });

      const res = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customer_name: 'Wa Guest',
          table_no: 3,
          items: [{ product_id: product.id, quantity: 2 }],
        });
      expect(res.status).toBe(201);

      const [payload] = await waitForBodies(receiver);
      expect(payload).toMatchObject({
        event: 'order.created',
        tenantSlug: 'wa-diner',
        tableNo: 3,
        customerName: 'Wa Guest',
        status: 'placed',
        currency: 'BDT',
      });
      expect(payload.orderNo).toBeTruthy();
      expect(payload.total).toBe(500);
      expect(payload.items).toHaveLength(1);
      expect(payload.items[0].name).toBe('Whatsapp Burger');
      // The configured secret rides as a Bearer token.
      expect(receiver.headers[0].authorization).toBe('Bearer s3cret');
    } finally {
      receiver.server.close();
    }
  });

  it('sends nothing when whatsapp is disabled', async () => {
    const receiver = await startReceiver();
    try {
      await request(app)
        .patch(`/api/tenants/${tenant.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ whatsapp: { enabled: false } });

      const res = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ customer_name: 'Silent Guest', items: [{ product_id: product.id, quantity: 1 }] });
      expect(res.status).toBe(201);

      await new Promise((r) => setTimeout(r, 300));
      expect(receiver.bodies).toHaveLength(0);
    } finally {
      receiver.server.close();
    }
  });

  it('never breaks order creation when the webhook is down', async () => {
    await request(app)
      .patch(`/api/tenants/${tenant.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ whatsapp: { enabled: true, webhookUrl: 'http://127.0.0.1:1/dead' } });

    const start = Date.now();
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ customer_name: 'Resilient Guest', items: [{ product_id: product.id, quantity: 1 }] });
    expect(res.status).toBe(201);
    // The fire-and-forget alert must not add meaningful latency — an awaited
    // webhook would take >= the 2500ms timeout on top of the create.
    expect(Date.now() - start).toBeLessThan(2500);
  });
});

describe('order status → customer notification (whatsapp.notifyCustomer)', () => {
  it('POSTs a bilingual status_changed event with the customer phone', async () => {
    const receiver = await startReceiver();
    try {
      await request(app)
        .patch(`/api/tenants/${tenant.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          whatsapp: {
            enabled: true,
            number: '+8801712345678',
            webhookUrl: `http://127.0.0.1:${receiver.port}/hook`,
            notifyCustomer: true,
          },
        });

      const placed = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customer_name: 'Status Guest',
          customer_phone: '01712345678',
          items: [{ product_id: product.id, quantity: 1 }],
        });
      expect(placed.status).toBe(201);

      const res = await request(app)
        .patch(`/api/orders/${placed.body.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'preparing' });
      expect(res.status).toBe(200);

      const payload = await waitForEvent(receiver, 'order.status_changed');
      expect(payload).toMatchObject({
        event: 'order.status_changed',
        tenantSlug: 'wa-diner',
        status: 'preparing',
        customerName: 'Status Guest',
        customerPhone: '01712345678',
        orderNo: placed.body.order_no,
      });
      expect(payload.message).toContain('being prepared');
      expect(payload.messageBn).toContain('তৈরি হচ্ছে');
    } finally {
      receiver.server.close();
    }
  });

  it('sends nothing when notifyCustomer is off (order.created still arrives)', async () => {
    const receiver = await startReceiver();
    try {
      await request(app)
        .patch(`/api/tenants/${tenant.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          whatsapp: {
            enabled: true,
            number: '+8801712345678',
            webhookUrl: `http://127.0.0.1:${receiver.port}/hook`,
            notifyCustomer: false,
          },
        });

      const placed = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customer_name: 'Silent Status Guest',
          customer_phone: '01712345678',
          items: [{ product_id: product.id, quantity: 1 }],
        });
      expect(placed.status).toBe(201);

      await request(app)
        .patch(`/api/orders/${placed.body.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'preparing' });

      // The merchant alert should arrive…
      expect(await waitForEvent(receiver, 'order.created')).toBeTruthy();
      // …but the customer notification must not.
      await new Promise((r) => setTimeout(r, 300));
      expect(receiver.bodies.some((b) => b?.event === 'order.status_changed')).toBe(false);
    } finally {
      receiver.server.close();
    }
  });

  it('sends nothing when the order has no customer phone', async () => {
    const receiver = await startReceiver();
    try {
      await request(app)
        .patch(`/api/tenants/${tenant.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          whatsapp: {
            enabled: true,
            number: '+8801712345678',
            webhookUrl: `http://127.0.0.1:${receiver.port}/hook`,
            notifyCustomer: true,
          },
        });

      const placed = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ customer_name: 'No Phone Guest', items: [{ product_id: product.id, quantity: 1 }] });
      expect(placed.status).toBe(201);

      await request(app)
        .patch(`/api/orders/${placed.body.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'preparing' });

      await new Promise((r) => setTimeout(r, 300));
      expect(receiver.bodies.some((b) => b?.event === 'order.status_changed')).toBe(false);
    } finally {
      receiver.server.close();
    }
  });
});

describe('POST /api/tenants/:id/whatsapp/test', () => {
  it('sends a test alert to the webhook and returns a wa.me fallback link', async () => {
    const receiver = await startReceiver();
    try {
      await request(app)
        .patch(`/api/tenants/${tenant.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          whatsapp: {
            enabled: true,
            number: '+8801712345678',
            webhookUrl: `http://127.0.0.1:${receiver.port}/hook`,
          },
        });

      const res = await request(app)
        .post(`/api/tenants/${tenant.id}/whatsapp/test`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.sent).toBe(true);

      const [payload] = await waitForBodies(receiver);
      expect(payload.event).toBe('order.test');
      expect(payload.message).toContain('ORD-TEST');
      // Manual fallback link always included.
      expect(res.body.waLink).toContain('wa.me/8801712345678');
    } finally {
      receiver.server.close();
    }
  });

  it('requires manage:settings (cashier is rejected)', async () => {
    const cashier = await User.create({
      name: 'Wa Cashier',
      email: 'wacashier@example.com',
      password: await bcrypt.hash('password123', 10),
      platform_role: 'member',
    });
    await UserTenant.create({ user_id: cashier.id, tenant_id: tenant.id, role: 'cashier' });
    const cashierToken = (
      await request(app).post('/api/auth/login').send({ email: 'wacashier@example.com', password: 'password123' })
    ).body.accessToken;

    const res = await request(app)
      .post(`/api/tenants/${tenant.id}/whatsapp/test`)
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(res.status).toBe(403);
  });
});
