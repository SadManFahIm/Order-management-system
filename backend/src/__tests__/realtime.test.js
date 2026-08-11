import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import WebSocket from 'ws';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import UserTenant from '../models/UserTenant.js';
import Product from '../models/Product.js';
import { attachRealtime, publishOrderEvent } from '../services/realtime.js';

/**
 * Real-time kitchen/delivery queue (Phase 5) — WebSocket.
 *
 * Boots the real app on an ephemeral port, attaches the hub, and proves:
 * JWT auth, role gating, tenant-room isolation, event delivery (including the
 * real order.created flow), and rejection of unauthenticated connections.
 */

let server;
let baseUrl;
let kitchenToken;
let tenantAId;
let tenantBId;
let productId;

/** Connect a WS client, resolving on the first message or close. */
function connect(token, tenantId) {
  // ?tenant= mirrors the REST X-Tenant header — the ACTIVE workspace outranks
  // the tenant baked into the token at login (browsers can't set headers on
  // WebSockets, so the explicit switch rides as a query param instead).
  const url = `${baseUrl}/ws?token=${token}&tenant=${tenantId}`;
  const ws = new WebSocket(url);
  const messages = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS connect timeout')), 3000);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve({ ws, messages });
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

const waitFor = (messages, predicate, timeout = 3000) =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      const found = messages.find(predicate);
      if (found) {
        clearInterval(iv);
        resolve(found);
      } else if (Date.now() > start + timeout) {
        clearInterval(iv);
        reject(new Error('event timeout'));
      }
    }, 25);
    iv.unref();
  });

describe('realtime hub', () => {
  beforeAll(async () => {
    await resetTestDb();

    const tenantA = await Tenant.create({ name: 'Realtime A', slug: 'realtime-a' });
    tenantAId = tenantA.id;
    const tenantB = await Tenant.create({ name: 'Realtime B', slug: 'realtime-b' });
    tenantBId = tenantB.id;

    const kitchen = await User.create({
      name: 'Kitchen',
      email: 'kitchen@rt.test',
      password: await bcrypt.hash('supersecret1', 10),
    });
    await UserTenant.create({ user_id: kitchen.id, tenant_id: tenantA.id, role: 'kitchen' });
    kitchenToken = (
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'kitchen@rt.test', password: 'supersecret1' })
    ).body.accessToken;

    productId = (
      await Product.create({ tenant_id: tenantA.id, name: 'RT Burger', price: 200, weight_gm: 200, enabled: true })
    ).id;

    server = createServer(app);
    attachRealtime(server);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await sequelize.close();
  });

  it('authenticates a kitchen token and greets with the role', async () => {
    const { ws, messages } = await connect(kitchenToken);
    try {
      const hello = await waitFor(messages, (m) => m.event === 'hello');
      expect(hello.role).toBe('kitchen');
      expect(hello.tenantId).toBe(tenantAId);
    } finally {
      ws.close();
    }
  });

  it('rejects unauthenticated connections', async () => {
    const ws = new WebSocket(`${baseUrl}/ws`);
    const code = await new Promise((resolve) => {
      ws.on('close', (c) => resolve(c));
      ws.on('error', () => {});
    });
    expect(code).toBe(4401);
  });

  it('rejects a token without a tenant context', async () => {
    // A tampered payload (signed with the wrong secret) must be rejected.
    const bad = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(
      JSON.stringify({ id: 999999, tenant_id: null, platform_role: 'customer' })
    ).toString('base64url')}.xxxx`;
    const ws = new WebSocket(`${baseUrl}/ws?token=${bad}`);
    const code = await new Promise((resolve) => {
      ws.on('close', (c) => resolve(c));
      ws.on('error', () => {});
    });
    expect([4401, 1006]).toContain(code);
  });

  it('delivers order events only to the owning tenant room', async () => {
    const { ws: kitchenA, messages: kitchenAMessages } = await connect(kitchenToken);

    // Another tenant's client (a kitchen member of tenant B).
    const kitchenB = await User.create({
      name: 'Kitchen B',
      email: 'kitchenb@rt.test',
      password: await bcrypt.hash('supersecret1', 10),
    });
    await UserTenant.create({ user_id: kitchenB.id, tenant_id: tenantBId, role: 'kitchen' });
    const tokenB = (
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'kitchenb@rt.test', password: 'supersecret1' })
    ).body.accessToken;
    const { ws: kitchenBW, messages: kitchenBWMessages } = await connect(tokenB, tenantBId);

    try {
      const dummyOrder = {
        id: 999,
        order_no: 'ORD-RT-1',
        status: 'placed',
        type: 'pickup',
        table_no: null,
        scheduled_at: null,
        delivery_fee: 0,
        payment_status: 'paid',
        payment_method: 'cash',
        grand_total: 200,
        customer_name: 'RT Guest',
        assigned_to: null,
        items: [{ name: 'RT Burger', quantity: 1 }],
      };

      publishOrderEvent(tenantAId, 'order.created', dummyOrder);
      const received = await waitFor(kitchenAMessages, (m) => m.event === 'order.created');
      expect(received.order.order_no).toBe('ORD-RT-1');
      // Whitelist: no phone/address on the wire.
      expect(received.order.customer_phone).toBeUndefined();
      expect(received.order.customer_address).toBeUndefined();

      // Tenant B never receives tenant A's event.
      await new Promise((r) => setTimeout(r, 300));
      expect(kitchenBWMessages.filter((m) => m.event === 'order.created')).toHaveLength(0);
    } finally {
      kitchenA.close();
      kitchenBW.close();
    }
  });

  it('broadcasts order.created when a GUEST places a storefront checkout order', async () => {
    const { ws: kitchenW, messages } = await connect(kitchenToken);
    try {
      const res = await request(app)
        .post(`/api/public/restaurants/realtime-a/checkout`)
        .set('Idempotency-Key', 'rt-guest-1')
        .send({
          customer_name: 'Guest Order',
          customer_phone: '01710000000',
          order_type: 'pickup',
          items: [{ product_id: productId, quantity: 1 }],
          payment_method: 'cash',
        });
      expect(res.status).toBe(201);

      const event = await waitFor(messages, (m) => m.event === 'order.created');
      expect(event.order.id).toBe(res.body.id);
      expect(event.order.order_no).toBe(res.body.order_no);
      // Whitelist holds on the guest path too — no phone/address on the wire.
      expect(event.order.customer_phone).toBeUndefined();
      expect(event.order.customer_address).toBeUndefined();
    } finally {
      kitchenW.close();
    }
  });

  it('subscribes to the ACTIVE workspace, not the token default (tenant switch)', async () => {
    // A user who is a member of BOTH workspaces — their token was minted with
    // tenant A baked in (login-time default), but they switch to tenant B in
    // the UI. The socket must join tenant B's room.
    const multi = await User.create({
      name: 'Multi Tenant',
      email: 'multi@rt.test',
      password: await bcrypt.hash('supersecret1', 10),
    });
    await UserTenant.create({ user_id: multi.id, tenant_id: tenantAId, role: 'manager' });
    await UserTenant.create({ user_id: multi.id, tenant_id: tenantBId, role: 'kitchen' });
    const token = (
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'multi@rt.test', password: 'supersecret1' })
    ).body.accessToken;

    // Without ?tenant= the token's baked-in tenant (A) wins.
    const { ws: wsA, messages: msgsA } = await connect(token);
    try {
      const helloA = await waitFor(msgsA, (m) => m.event === 'hello');
      expect(helloA.tenantId).toBe(tenantAId);
      expect(helloA.role).toBe('manager');
    } finally {
      wsA.close();
    }

    // With ?tenant=B the explicit switch wins — same user, tenant B's room.
    const { ws: wsB, messages: msgsB } = await connect(token, tenantBId);
    try {
      const helloB = await waitFor(msgsB, (m) => m.event === 'hello');
      expect(helloB.tenantId).toBe(tenantBId);
      expect(helloB.role).toBe('kitchen');

      // Events for tenant A must NOT reach the B-subscribed socket.
      publishOrderEvent(tenantAId, 'order.created', {
        id: 1001,
        order_no: 'ORD-A-ONLY',
        status: 'placed',
        type: 'pickup',
        table_no: null,
        scheduled_at: null,
        delivery_fee: 0,
        payment_status: 'paid',
        payment_method: 'cash',
        grand_total: 100,
        customer_name: 'A Guest',
        assigned_to: null,
        items: [],
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(msgsB.filter((m) => m.event === 'order.created')).toHaveLength(0);

      // …while tenant B's room hears B's events.
      publishOrderEvent(tenantBId, 'order.created', {
        id: 1002,
        order_no: 'ORD-B-ONLY',
        status: 'placed',
        type: 'pickup',
        table_no: null,
        scheduled_at: null,
        delivery_fee: 0,
        payment_status: 'paid',
        payment_method: 'cash',
        grand_total: 100,
        customer_name: 'B Guest',
        assigned_to: null,
        items: [],
      });
      const ev = await waitFor(msgsB, (m) => m.event === 'order.created');
      expect(ev.order.order_no).toBe('ORD-B-ONLY');
    } finally {
      wsB.close();
    }
  });

  it('broadcasts a real order.created when a cashier places an order', async () => {
    const { ws: kitchenW, messages } = await connect(kitchenToken);
    try {
      const cashier = await User.create({
        name: 'Cashier',
        email: 'cashier@rt.test',
        password: await bcrypt.hash('supersecret1', 10),
      });
      await UserTenant.create({ user_id: cashier.id, tenant_id: tenantAId, role: 'cashier' });
      const cashierToken = (
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'cashier@rt.test', password: 'supersecret1' })
      ).body.accessToken;

      const res = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ customer_name: 'RT Flow', items: [{ product_id: productId, quantity: 1 }] });
      expect(res.status).toBe(201);

      const event = await waitFor(messages, (m) => m.event === 'order.created');
      expect(event.order.id).toBe(res.body.id);
      expect(event.order.status).toBe('placed');
    } finally {
      kitchenW.close();
    }
  });
});
