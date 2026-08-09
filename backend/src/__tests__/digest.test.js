import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import bcrypt from 'bcryptjs';

// Capture emails — the adapter is a stub anyway; the spy asserts the digest
// sections + attachments on the nightly email.
const emailSpy = vi.fn().mockResolvedValue({ messageId: 'stub-digest-1' });
vi.mock('../services/notifications/email.js', () => ({
  sendEmail: (...args) => emailSpy(...args),
}));

import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant, Product, InventoryItem } from '../models/index.js';
import { buildDigest, sendNightlyDigest } from '../services/reportsService.js';
import { sendDigestWebhook, digestToText } from '../services/whatsappService.js';

/**
 * Nightly merchant digest (Phase 6) — top sellers + low-stock inventory,
 * embedded in the nightly closeout email and pushed (signed) to the
 * workspace's WhatsApp webhook.
 */

let token;
let tenant;
let product;

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const todayDhaka = () => new Date(Date.now() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);

beforeAll(async () => {
  await resetTestDb();
  tenant = await Tenant.create({ name: 'Digest Diner', slug: 'digest-diner' });
  const manager = await User.create({
    name: 'Digest Manager',
    email: 'digestmanager@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: manager.id, tenant_id: tenant.id, role: 'manager' });
  token = (
    await request(app).post('/api/auth/login').send({ email: 'digestmanager@example.com', password: 'password123' })
  ).body.accessToken;

  product = await Product.create({
    tenant_id: tenant.id,
    name: 'Digest Burger',
    price: 250,
    weight_gm: 250,
    enabled: true,
  });

  await request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ customer_name: 'Digest One', items: [{ product_id: product.id, quantity: 2 }] });
  await request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ customer_name: 'Digest Two', items: [{ product_id: product.id, quantity: 1 }] });

  // One item running low — must surface in the digest.
  await InventoryItem.create({
    tenant_id: tenant.id,
    menu_item_id: product.id,
    name: product.name,
    stock_qty: 3,
    low_stock_at: 10,
    unit: 'pcs',
  });
  // One healthy item — must NOT appear.
  const other = await Product.create({
    tenant_id: tenant.id,
    name: 'Digest Pasta',
    price: 400,
    weight_gm: 350,
    enabled: true,
  });
  await InventoryItem.create({
    tenant_id: tenant.id,
    menu_item_id: other.id,
    name: other.name,
    stock_qty: 60,
    low_stock_at: 10,
    unit: 'pcs',
  });

  await tenant.update({
    settings: {
      reports: { closeoutEmail: 'owner@digest.test' },
      whatsapp: { enabled: true, webhookUrl: 'http://127.0.0.1:9/hook', secret: 'digest-secret' },
    },
  });
});

afterAll(async () => {
  await sequelize.close();
});

describe('buildDigest', () => {
  it('aggregates top sellers by quantity and flags low stock', async () => {
    const digest = await buildDigest(tenant.id, todayDhaka());
    expect(digest.date).toBe(todayDhaka());

    // 3 × Digest Burger sold across two orders.
    expect(digest.topSellers[0]).toMatchObject({
      itemName: 'Digest Burger',
      quantity: 3,
    });
    expect(digest.topSellers[0].revenue).toBe(750);

    // Only the low item is listed (3 ≤ threshold 10); the healthy one is not.
    expect(digest.lowStock).toHaveLength(1);
    expect(digest.lowStock[0]).toMatchObject({
      itemName: 'Digest Burger',
      stockQty: 3,
      lowStockAt: 10,
      unit: 'pcs',
    });
  });

  it('renders a WhatsApp-friendly text form', () => {
    const digest = { date: '2026-08-10', topSellers: [{ itemName: 'Burger', quantity: 3, revenue: 750 }], lowStock: [{ itemName: 'Pasta', stockQty: 2, lowStockAt: 10, unit: 'pcs' }] };
    const text = digestToText(digest);
    expect(text).toContain('Daily digest — 2026-08-10');
    expect(text).toContain('Burger ×3');
    expect(text).toContain('Pasta — 2/10 pcs');
  });
});

describe('sendDigestWebhook', () => {
  it('posts a signed digest.daily event to the configured webhook', async () => {
    const captured = {};
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        captured.body = body;
        captured.signature = req.headers['x-webhook-signature'];
        captured.auth = req.headers.authorization;
        res.writeHead(200);
        res.end('ok');
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    try {
      const digest = await buildDigest(tenant.id, todayDhaka());
      const ten = { id: tenant.id, slug: tenant.slug, settings: { whatsapp: { enabled: true, webhookUrl: `http://127.0.0.1:${port}/hook`, secret: 'digest-secret' } } };
      const result = await sendDigestWebhook(ten, digest);
      expect(result.sent).toBe(true);
      expect(result.signature).toBe(true);

      const payload = JSON.parse(captured.body);
      expect(payload.event).toBe('digest.daily');
      expect(payload.tenantId).toBe(tenant.id);
      expect(payload.tenantSlug).toBe(tenant.slug);
      expect(payload.topSellers).toHaveLength(1);
      expect(payload.lowStock).toHaveLength(1);
      expect(captured.auth).toBe('Bearer digest-secret');
      // HMAC-SHA256 of the exact body with the shared secret.
      expect(captured.signature).toBe(createHmac('sha256', 'digest-secret').update(captured.body).digest('hex'));
    } finally {
      server.close();
    }
  });

  it('is a no-op (never rejects) when WhatsApp is disabled', async () => {
    const result = await sendDigestWebhook({ id: 1, slug: 'x', settings: {} }, { date: '2026-08-10', topSellers: [], lowStock: [] });
    expect(result).toEqual({ sent: false, reason: 'disabled' });
  });
});

describe('sendNightlyDigest', () => {
  it('emails the closeout with digest sections + CSV attachment', async () => {
    emailSpy.mockClear();
    const result = await sendNightlyDigest({ tenant, date: todayDhaka() });
    expect(result.digest.topSellers).toHaveLength(1);
    expect(emailSpy).toHaveBeenCalledTimes(1);
    const call = emailSpy.mock.calls[0][0];
    expect(call.to).toBe('owner@digest.test');
    expect(call.subject).toContain('Daily digest');
    expect(call.html).toContain('Top sellers');
    expect(call.html).toContain('Low stock');
    expect(call.html).toContain('Digest Burger');
    expect(call.attachments).toHaveLength(1);
    expect(call.attachments[0].filename).toContain('closeout-');
  });
});
