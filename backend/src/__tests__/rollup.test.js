import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant, Product, DailyStat } from '../models/index.js';
import { buildDailyStat, runRollupScheduler, dhakaDayBounds } from '../services/rollupService.js';

/**
 * Daily analytics rollup (Phase 7) — the pre-aggregation layer that serves
 * the dashboard's historical trend via ?source=rollup, and the nightly
 * scheduler that keeps it current.
 */

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const todayDhaka = () =>
  new Date(Date.now() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);

let tenant;
let token;

beforeAll(async () => {
  await resetTestDb();

  tenant = await Tenant.create({ name: 'Rollup Cafe', slug: 'rollup-cafe' });
  const manager = await User.create({
    name: 'Rollup Manager',
    email: 'rollup@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: manager.id, tenant_id: tenant.id, role: 'manager' });
  token = (
    await request(app).post('/api/auth/login').send({ email: 'rollup@example.com', password: 'password123' })
  ).body.accessToken;

  const burger = await Product.create({
    tenant_id: tenant.id,
    name: 'Rollup Burger',
    price: 200,
    weight_gm: 250,
    enabled: true,
  });
  // 2 orders today: 2×Burger (400) then 1×Burger (200) — cash → paid on the spot.
  for (const qty of [2, 1]) {
    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Rollup Customer',
        items: [{ product_id: burger.id, quantity: qty }],
      });
  }
});

afterAll(async () => {
  await sequelize.close();
});

describe('rollup service', () => {
  it('maps a Dhaka day to its UTC bounds (UTC+6, no DST)', () => {
    const { startUtc, endUtc } = dhakaDayBounds('2026-08-10');
    expect(startUtc.toISOString()).toBe('2026-08-09T18:00:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-08-10T18:00:00.000Z');
  });

  it('aggregates a day into revenue / orders / method mix', async () => {
    const row = await buildDailyStat(tenant.id, todayDhaka());
    expect(row.orders).toBe(2);
    expect(row.revenue).toBe(600);
    expect(row.method_mix).toMatchObject({ cash: 600, bkash: 0, nagad: 0 });
    expect(row.peak_hours).toBeDefined();
    // Both orders fell in the same Dhaka hour → one populated cell with 2.
    const cells = Object.values(row.peak_hours)
      .flatMap((hours) => Object.values(hours));
    expect(cells.reduce((s, c) => s + c.orders, 0)).toBe(2);
    expect(cells.reduce((s, c) => s + c.revenue, 0)).toBe(600);
  });

  it('upserts idempotently — one row per (tenant, day)', async () => {
    await buildDailyStat(tenant.id, todayDhaka());
    await buildDailyStat(tenant.id, todayDhaka());
    const count = await DailyStat.count({
      where: { tenant_id: tenant.id, stat_date: todayDhaka() },
    });
    expect(count).toBe(1);
  });

  it('nightly scheduler builds yesterday for every active tenant', async () => {
    const built = await runRollupScheduler();
    expect(built).toBeGreaterThanOrEqual(1);
    const yesterday = new Date(Date.now() + DHAKA_OFFSET_MS - 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const row = await DailyStat.findOne({
      where: { tenant_id: tenant.id, stat_date: yesterday },
    });
    expect(row).toBeDefined();
    expect(row.orders).toBe(0); // no orders yesterday — still a row
  });
});

describe('GET /api/dashboard?source=rollup', () => {
  it('serves the closeout trend from daily_stats when rows exist', async () => {
    const live = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`);
    const rollup = await request(app)
      .get('/api/dashboard?source=rollup')
      .set('Authorization', `Bearer ${token}`);

    expect(live.status).toBe(200);
    expect(rollup.status).toBe(200);

    // Rollup trend has the same shape and the same last-day totals as live.
    expect(rollup.body.closeoutTrend).toHaveLength(live.body.closeoutTrend.length);
    const lt = live.body.closeoutTrend[6];
    const rt = rollup.body.closeoutTrend[6];
    expect(rt.revenue).toBe(lt.revenue); // 600
    expect(rt.orders).toBe(lt.orders); // 2
    expect(rt.methodMix.cash).toBe(lt.methodMix.cash);

    // Peak-hours grid reconciles too.
    const gridOrders = rollup.body.peakHours.grid.flat().reduce((s, c) => s + c.orders, 0);
    expect(gridOrders).toBe(2);
    expect(rollup.body.peakHours.busiest.orders).toBe(2);
  });

  it('falls back to live computation when no rollup rows cover the window', async () => {
    // A brand-new tenant has no rollup rows → ?source=rollup still 200 with
    // the live-computed trend.
    const fresh = await Tenant.create({ name: 'Fresh Cafe', slug: 'fresh-cafe' });
    const owner = await User.create({
      name: 'Fresh Owner',
      email: 'fresh@example.com',
      password: await bcrypt.hash('password123', 10),
      platform_role: 'member',
    });
    await UserTenant.create({ user_id: owner.id, tenant_id: fresh.id, role: 'owner' });
    const freshToken = (
      await request(app).post('/api/auth/login').send({ email: 'fresh@example.com', password: 'password123' })
    ).body.accessToken;

    const res = await request(app)
      .get('/api/dashboard?source=rollup')
      .set('Authorization', `Bearer ${freshToken}`);
    expect(res.status).toBe(200);
    expect(res.body.closeoutTrend).toHaveLength(7);
    expect(res.body.closeoutTrend[6].orders).toBe(0);
  });
});
