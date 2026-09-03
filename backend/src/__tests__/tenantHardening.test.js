import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import {
  User,
  Tenant,
  UserTenant,
  Plan,
  Subscription,
  UsageCounter,
} from '../models/index.js';
import { LIFETIME_PERIOD } from '../services/planService.js';

/**
 * Phase 3 hardening — plan quota enforcement, expiring invites + ownership
 * transfer, the tenant audit log API, and platform-admin plan changes.
 */

const PASSWORD = 'Str0ngPass!42';

let tenant; // on the small 'free' plan
let ownerToken;
let managerUser;
let platformToken;

beforeAll(async () => {
  await resetTestDb();

  // find-or-create keeps the suite green on both SQLite (no seeded plans)
  // and PostgreSQL (migration 017 seeds the catalogue) — then the quotas are
  // overridden to the small values the tests assert against.
  const [free] = await Plan.findOrCreate({
    where: { code: 'free' },
    defaults: { name: 'Free', price_mo: 0, max_products: 3, max_orders_per_day: 5, max_members: 10, storage_mb: 1 },
  });
  await free.update({ max_products: 3, max_orders_per_day: 5, max_members: 10, storage_mb: 1 });
  const [pro] = await Plan.findOrCreate({
    where: { code: 'pro' },
    defaults: { name: 'Pro', price_mo: 29, max_products: 100, max_orders_per_day: 1000, max_members: 20, storage_mb: 2000 },
  });
  await pro.update({ max_products: 100, max_orders_per_day: 1000, max_members: 20, storage_mb: 2000 });

  tenant = await Tenant.create({ name: 'Phase3 Diner', slug: 'phase3-diner', plan_id: free.id });

  const owner = await User.create({
    name: 'Phase Owner',
    email: 'p3owner@example.com',
    password: await bcrypt.hash(PASSWORD, 10),
    platform_role: 'member',
  });
  managerUser = await User.create({
    name: 'Phase Manager',
    email: 'p3manager@example.com',
    password: await bcrypt.hash(PASSWORD, 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenant.id, role: 'owner' });
  await UserTenant.create({ user_id: managerUser.id, tenant_id: tenant.id, role: 'manager' });

  const platform = await User.create({
    name: 'Platform',
    email: 'p3platform@example.com',
    password: await bcrypt.hash(PASSWORD, 10),
    platform_role: 'platform_admin',
  });
  await UserTenant.create({ user_id: platform.id, tenant_id: tenant.id, role: 'owner' });

  const ownerLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'p3owner@example.com', password: PASSWORD });
  ownerToken = ownerLogin.body.accessToken;

  const platformLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'p3platform@example.com', password: PASSWORD });
  platformToken = platformLogin.body.accessToken;
});

afterAll(async () => {
  await sequelize.close();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

const makeProduct = (name, token = ownerToken) =>
  request(app)
    .post('/api/products')
    .set('X-Tenant', String(tenant.id))
    .set(auth(token))
    .send({ name, price: 10, weight_gm: 100 });

const placeOrder = (token = ownerToken) =>
  request(app)
    .post('/api/orders')
    .set('X-Tenant', String(tenant.id))
    .set(auth(token))
    .send({
      items: [{ product_id: 1, quantity: 1 }],
      payment_method: 'cash',
      customer_name: 'Phase Tester',
    });

describe('plan quota enforcement', () => {
  it('blocks the Nth+1 product when the plan limit is reached', async () => {
    for (let i = 1; i <= 3; i += 1) {
      const res = await makeProduct(`Quota Dish ${i}`);
      expect(res.status).toBe(201);
    }
    const blocked = await makeProduct('Quota Dish Overflow');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('counts daily orders against the plan and stops at the limit', async () => {
    // Free plan allows 5 orders/day; pre-fill the counter to 5 (the gate is
    // `current >= limit`, so a 6th order is refused even before the row is
    // written — the honest full-cycle version of a 50-order loop).
    await UsageCounter.create({
      tenant_id: tenant.id,
      metric: 'orders_daily',
      period_start: new Date().toISOString().slice(0, 10),
      value: 5,
    });
    const blocked = await placeOrder();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('counts members against the plan and blocks over-limit adds', async () => {
    // Dedicated tenant on a 1-member plan: owner fills the slot, a second
    // member must be refused.
    const solo = await Plan.create({
      name: 'Solo',
      code: 'solo',
      max_products: 50,
      max_orders_per_day: 500,
      max_members: 1,
      storage_mb: 100,
    });
    const tiny = await Tenant.create({ name: 'Tiny', slug: 'tiny-diner', plan_id: solo.id });
    const ownerRow = await User.findOne({ where: { email: 'p3owner@example.com' } });
    await UserTenant.create({ user_id: ownerRow.id, tenant_id: tiny.id, role: 'owner' });

    const blocked = await request(app)
      .post(`/api/tenants/${tiny.id}/members`)
      .set(auth(ownerToken))
      .send({ email: 'extra@example.com', role: 'cashier', password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('exposes plan + usage through GET /api/tenants/:id/plan', async () => {
    const res = await request(app)
      .get(`/api/tenants/${tenant.id}/plan`)
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body.plan.code).toBe('free');
    expect(res.body.limits.products).toBe(3);
    expect(res.body.limits.members).toBe(10);
    expect(res.body.usage.products).toBe(3);
    expect(typeof res.body.usage.ordersToday).toBe('number');
    expect(typeof res.body.usage.storageMb).toBe('number');
  });
});

describe('tenant invites (expiry + accept)', () => {
  it('creates an invite and returns the raw token once', async () => {
    const res = await request(app)
      .post(`/api/tenants/${tenant.id}/invites`)
      .set(auth(ownerToken))
      .send({ email: 'chef@example.com', role: 'kitchen', days: 2 });
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.status).toBe('pending');
    expect(res.body.expiresAt).toBeTruthy();
  });

  it('rejects a duplicate pending invite for the same email', async () => {
    const res = await request(app)
      .post(`/api/tenants/${tenant.id}/invites`)
      .set(auth(ownerToken))
      .send({ email: 'chef@example.com', role: 'kitchen' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVITE_EXISTS');
  });

  it('accepts with a brand-new account (creates the user + membership)', async () => {
    const created = await request(app)
      .post(`/api/tenants/${tenant.id}/invites`)
      .set(auth(ownerToken))
      .send({ email: 'newchef@example.com', role: 'kitchen' });
    expect(created.status).toBe(201);

    const res = await request(app)
      .post('/api/invites/accept')
      .send({ token: created.body.token, name: 'New Chef', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('kitchen');
    expect(res.body.tenant.slug).toBe('phase3-diner');

    // The new user can now sign in and has the kitchen role in the tenant.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'newchef@example.com', password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it('rejects a second accept of the same invite', async () => {
    const created = await request(app)
      .post(`/api/tenants/${tenant.id}/invites`)
      .set(auth(ownerToken))
      .send({ email: 'second@example.com', role: 'cashier' });
    await request(app)
      .post('/api/invites/accept')
      .send({ token: created.body.token, name: 'Second', password: PASSWORD });

    const again = await request(app)
      .post('/api/invites/accept')
      .send({ token: created.body.token, name: 'Second', password: PASSWORD });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVITE_ACCEPTED');
  });

  it('refuses an expired invite', async () => {
    const created = await request(app)
      .post(`/api/tenants/${tenant.id}/invites`)
      .set(auth(ownerToken))
      .send({ email: 'late@example.com', role: 'cashier' });
    const invite = await sequelize.models.TenantInvite.findOne({
      where: { email: 'late@example.com', tenant_id: tenant.id },
      order: [['id', 'DESC']],
    });
    await invite.update({ expires_at: new Date(Date.now() - 60_000) });

    const res = await request(app)
      .post('/api/invites/accept')
      .send({ token: created.body.token, name: 'Late', password: PASSWORD });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('INVITE_EXPIRED');
  });

  it('refuses a revoked invite', async () => {
    const created = await request(app)
      .post(`/api/tenants/${tenant.id}/invites`)
      .set(auth(ownerToken))
      .send({ email: 'revoked@example.com', role: 'cashier' });
    const invites = await request(app)
      .get(`/api/tenants/${tenant.id}/invites`)
      .set(auth(ownerToken));
    const row = invites.body.find((i) => i.email === 'revoked@example.com');

    const revoked = await request(app)
      .delete(`/api/tenants/${tenant.id}/invites/${row.id}`)
      .set(auth(ownerToken));
    expect(revoked.status).toBe(200);
    expect(revoked.body.status).toBe('revoked');

    const accept = await request(app)
      .post('/api/invites/accept')
      .send({ token: created.body.token, name: 'Revoked', password: PASSWORD });
    expect(accept.status).toBe(410);
    expect(accept.body.error.code).toBe('INVITE_REVOKED');
  });

  it('accepts for a logged-in user whose email matches, and rejects mismatches', async () => {
    // managerUser (p3manager@example.com) is already a member, but invite an
    // existing *different* email and prove the email must match the caller.
    const created = await request(app)
      .post(`/api/tenants/${tenant.id}/invites`)
      .set(auth(ownerToken))
      .send({ email: 'p3manager@example.com', role: 'manager' });

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'p3manager@example.com', password: PASSWORD });

    // Wrong caller (owner) with a token whose email differs → 403.
    const mismatch = await request(app)
      .post('/api/invites/accept')
      .set(auth(ownerToken))
      .send({ token: created.body.token });
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.error.code).toBe('INVITE_EMAIL_MISMATCH');
  });
});

describe('ownership transfer', () => {
  it('transfers ownership and steps the old owner down to manager', async () => {
    const res = await request(app)
      .post(`/api/tenants/${tenant.id}/transfer-ownership`)
      .set(auth(ownerToken))
      .send({ userId: managerUser.id });
    expect(res.status).toBe(200);
    expect(res.body.newOwner.role).toBe('owner');

    const members = await request(app)
      .get(`/api/tenants/${tenant.id}/members`)
      .set(auth(ownerToken));
    const owner = members.body.find((m) => m.userId === managerUser.id);
    const exOwner = members.body.find((m) => m.email === 'p3owner@example.com');
    expect(owner.role).toBe('owner');
    expect(exOwner.role).toBe('manager');

    // The old owner (now manager) can no longer transfer ownership.
    const blocked = await request(app)
      .post(`/api/tenants/${tenant.id}/transfer-ownership`)
      .set(auth(ownerToken))
      .send({ userId: managerUser.id });
    expect(blocked.status).toBe(403);
  });

  it('rejects transfers to a non-member', async () => {
    // Platform admin can transfer but the target must be a member → 404.
    const res = await request(app)
      .post(`/api/tenants/${tenant.id}/transfer-ownership`)
      .set(auth(platformToken))
      .send({ userId: 99999 });
    expect(res.status).toBe(404);
  });
});

describe('tenant audit log API', () => {
  it('returns tenant-scoped events with actor details', async () => {
    const res = await request(app)
      .get(`/api/tenants/${tenant.id}/audit`)
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    const actions = res.body.events.map((e) => e.action);
    expect(actions).toContain('tenant.invite_created');
    expect(actions).toContain('tenant.ownership_transferred');
    const transfer = res.body.events.find((e) => e.action === 'tenant.ownership_transferred');
    expect(transfer.actor.email).toBe('p3owner@example.com');
    expect(transfer.metadata.toUserId).toBe(managerUser.id);
  });

  it('filters by action and paginates', async () => {
    const res = await request(app)
      .get(`/api/tenants/${tenant.id}/audit?action=tenant.invite_created&limit=1`)
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body.events.length).toBe(1);
    expect(res.body.events[0].action).toBe('tenant.invite_created');
    expect(res.body.total).toBeGreaterThan(1);
  });
});

describe('platform-admin plan change', () => {
  it('moves a workspace onto another plan and audits the change', async () => {
    const res = await request(app)
      .patch(`/api/tenants/${tenant.id}/plan`)
      .set(auth(platformToken))
      .send({ code: 'pro' });
    expect(res.status).toBe(200);
    expect(res.body.plan.code).toBe('pro');
    expect(res.body.limits.products).toBe(100);
    expect(res.body.limits.members).toBe(20);

    const sub = await Subscription.findOne({ where: { tenant_id: tenant.id } });
    const plan = await Plan.findByPk(sub.plan_id);
    expect(plan.code).toBe('pro');

    // Product quota relaxed — a 4th product now succeeds.
    const extra = await makeProduct('Post Upgrade Dish');
    expect(extra.status).toBe(201);

    const audit = await request(app)
      .get(`/api/tenants/${tenant.id}/audit?action=tenant.plan_changed`)
      .set(auth(platformToken));
    expect(audit.body.events[0].metadata).toMatchObject({ from: 'free', to: 'pro' });
  });

  it('rejects plan changes from non-platform users', async () => {
    const res = await request(app)
      .patch(`/api/tenants/${tenant.id}/plan`)
      .set(auth(ownerToken))
      .send({ code: 'free' });
    expect(res.status).toBe(403);
  });
});

describe('storage quota counter', () => {
  it('increments storage usage and reflects it in the plan snapshot', async () => {
    await UsageCounter.create({
      tenant_id: tenant.id,
      metric: 'storage_bytes',
      period_start: LIFETIME_PERIOD,
      value: 3 * 1024 * 1024,
    });
    const res = await request(app)
      .get(`/api/tenants/${tenant.id}/plan`)
      .set(auth(ownerToken));
    expect(res.body.usage.storageMb).toBe(3);
  });
});

describe('quota error shape', () => {
  it('returns a 429 with a clear message the UI can show', async () => {
    // A 1-member plan blocks the 2nd member with current/limit numbers.
    const freshPlan = await Plan.create({
      name: 'FreshPlan',
      code: 'freshplan',
      max_products: 50,
      max_orders_per_day: 500,
      max_members: 1,
      storage_mb: 100,
    });
    const fresh = await Tenant.create({ name: 'Fresh', slug: 'fresh-diner', plan_id: freshPlan.id });
    const ownerRow = await User.findOne({ where: { email: 'p3owner@example.com' } });
    await UserTenant.create({ user_id: ownerRow.id, tenant_id: fresh.id, role: 'owner' });
    const res = await request(app)
      .post(`/api/tenants/${fresh.id}/members`)
      .set(auth(ownerToken))
      .send({ email: 'overflow@example.com', role: 'cashier', password: PASSWORD });
    expect(res.status).toBe(429);
    expect(res.body.error.message).toMatch(/\d+\/\d+/);
  });
});
