import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant, Outlet, OutletMembership } from '../models/index.js';

/**
 * Outlet management + membership API (Phase 8) — CRUD, tenant isolation,
 * RBAC gating, and outlet membership lifecycle.
 */

let ownerToken;
let managerToken;
let cashierToken;
let tenantA;
let tenantB;

const login = async (email) => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'password123' });
  return res.body.accessToken;
};

beforeAll(async () => {
  await resetTestDb();

  tenantA = await Tenant.create({ name: 'Outlet Cafe A', slug: 'outlet-cafe-a' });
  tenantB = await Tenant.create({ name: 'Outlet Cafe B', slug: 'outlet-cafe-b' });

  const owner = await User.create({
    name: 'Outlet Owner',
    email: 'outletowner@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenantA.id, role: 'owner' });

  const manager = await User.create({
    name: 'Outlet Manager',
    email: 'outletmanager@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: manager.id, tenant_id: tenantA.id, role: 'manager' });

  const cashier = await User.create({
    name: 'Outlet Cashier',
    email: 'outletcashier@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: cashier.id, tenant_id: tenantA.id, role: 'cashier' });

  // Seed a second user on tenant B for isolation tests.
  const ownerB = await User.create({
    name: 'Outlet Owner B',
    email: 'outletownerb@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: ownerB.id, tenant_id: tenantB.id, role: 'owner' });

  // A user on tenant B to test cross-tenant membership.
  await User.create({
    name: 'Outlet Staff B',
    email: 'outletstaffb@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });

  ownerToken = await login('outletowner@example.com');
  managerToken = await login('outletmanager@example.com');
  cashierToken = await login('outletcashier@example.com');
});

afterAll(async () => {
  await sequelize.close();
});

// ── Outlet CRUD ─────────────────────────────────────────────────────

describe('POST /api/outlets', () => {
  it('creates an outlet in the active workspace', async () => {
    const res = await request(app)
      .post('/api/outlets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ name: 'Main Branch', code: 'MAIN', slug: 'main' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      tenant_id: tenantA.id,
      name: 'Main Branch',
      code: 'MAIN',
      slug: 'main',
      status: 'active',
      timezone: 'Asia/Dhaka',
    });
  });

  it('rejects duplicate code in the same workspace with 409', async () => {
    const res = await request(app)
      .post('/api/outlets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ name: 'Second Main', code: 'MAIN', slug: 'second-main' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE');
  });

  it('rejects duplicate slug in the same workspace with 409', async () => {
    const res = await request(app)
      .post('/api/outlets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ name: 'Slug Dup', code: 'SLUG', slug: 'main' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE');
  });

  it('rejects missing required fields with 400', async () => {
    const res = await request(app)
      .post('/api/outlets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ name: 'No Code' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a cashier (no manage:outlets) with 403', async () => {
    const res = await request(app)
      .post('/api/outlets')
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ name: 'Blocked', code: 'NOPE', slug: 'blocked' });
    expect(res.status).toBe(403);
  });

  it('manager can create outlets', async () => {
    const res = await request(app)
      .post('/api/outlets')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ name: 'Dhanmondi Branch', code: 'DHAN', slug: 'dhanmondi' });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe('DHAN');
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/outlets')
      .send({ name: 'Unauth', code: 'UNAUTH', slug: 'unauth' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/outlets', () => {
  it('lists only the active workspace outlets', async () => {
    // Create an outlet in tenant B (should not leak).
    await Outlet.create({
      tenant_id: tenantB.id,
      name: 'Tenant B Outlet',
      code: 'TENB',
      slug: 'tenant-b',
    });

    const res = await request(app)
      .get('/api/outlets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    // Tenant B's outlet never leaks.
    expect(res.body.some((o) => o.code === 'TENB')).toBe(false);
  });

  it('a cashier cannot list outlets (no manage:outlets)', async () => {
    const res = await request(app)
      .get('/api/outlets')
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/outlets/:id', () => {
  it('returns a single outlet', async () => {
    const outlet = await Outlet.findOne({
      where: { tenant_id: tenantA.id, code: 'MAIN' },
    });
    const res = await request(app)
      .get(`/api/outlets/${outlet.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(200);
    expect(res.body.code).toBe('MAIN');
  });

  it('404s for outlets outside the workspace', async () => {
    const other = await Outlet.findOne({
      where: { tenant_id: tenantB.id },
    });
    const res = await request(app)
      .get(`/api/outlets/${other.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(404);
  });

  it('404s for missing outlet', async () => {
    const res = await request(app)
      .get('/api/outlets/999999')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/outlets/:id', () => {
  it('updates an outlet', async () => {
    const outlet = await Outlet.findOne({
      where: { tenant_id: tenantA.id, code: 'MAIN' },
    });
    const res = await request(app)
      .put(`/api/outlets/${outlet.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ name: 'Main HQ', status: 'inactive' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Main HQ');
    expect(res.body.status).toBe('inactive');
  });

  it('rejects attempts to change code or slug', async () => {
    const outlet = await Outlet.findOne({
      where: { tenant_id: tenantA.id, code: 'DHAN' },
    });
    const res = await request(app)
      .put(`/api/outlets/${outlet.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ code: 'NEWCODE' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404s for outlets outside the workspace', async () => {
    const other = await Outlet.findOne({ where: { tenant_id: tenantB.id } });
    const res = await request(app)
      .put(`/api/outlets/${other.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ name: 'Hijack' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/outlets/:id', () => {
  it('cannot delete the last outlet', async () => {
    // Remove all but one outlet in tenant A.
    const allOutlets = await Outlet.findAll({ where: { tenant_id: tenantA.id } });
    for (let i = 1; i < allOutlets.length; i++) {
      await OutletMembership.destroy({ where: { outlet_id: allOutlets[i].id } });
      await allOutlets[i].destroy();
    }
    const lastOutlet = allOutlets[0];
    const res = await request(app)
      .delete(`/api/outlets/${lastOutlet.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LAST_OUTLET');
  });

  it('deletes a non-last outlet', async () => {
    const keep = await Outlet.create({
      tenant_id: tenantA.id,
      name: 'Keep Branch',
      code: 'KEEP',
      slug: 'keep',
    });
    const target = await Outlet.create({
      tenant_id: tenantA.id,
      name: 'Delete Me',
      code: 'DELE',
      slug: 'delete-me',
    });
    const res = await request(app)
      .delete(`/api/outlets/${target.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(204);
    expect(await Outlet.findByPk(target.id)).toBeNull();
    expect(await Outlet.findByPk(keep.id)).not.toBeNull();
  });

  it('404s for outlets outside the workspace', async () => {
    const other = await Outlet.findOne({ where: { tenant_id: tenantB.id } });
    const res = await request(app)
      .delete(`/api/outlets/${other.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(404);
  });
});

// ── Outlet Memberships ──────────────────────────────────────────────

describe('POST /api/outlets/:id/members', () => {
  let outletId;

  beforeAll(async () => {
    const outlet = await Outlet.findOne({
      where: { tenant_id: tenantA.id, code: 'KEEP' },
    });
    outletId = outlet.id;
  });

  it('adds a user to an outlet', async () => {
    const manager = await User.findOne({
      where: { email: 'outletmanager@example.com' },
    });
    const res = await request(app)
      .post(`/api/outlets/${outletId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ user_id: manager.id, role: 'outlet_manager' });
    expect(res.status).toBe(201);
    expect(res.body.user_id).toBe(manager.id);
    expect(res.body.outlet_id).toBe(outletId);
    expect(res.body.role).toBe('outlet_manager');
  });

  it('rejects duplicate membership with 409', async () => {
    const manager = await User.findOne({
      where: { email: 'outletmanager@example.com' },
    });
    const res = await request(app)
      .post(`/api/outlets/${outletId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ user_id: manager.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE');
  });

  it('rejects a user not in this tenant with 400', async () => {
    const staffB = await User.findOne({
      where: { email: 'outletstaffb@example.com' },
    });
    const res = await request(app)
      .post(`/api/outlets/${outletId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ user_id: staffB.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_USER');
  });

  it('404s for outlets outside the workspace', async () => {
    const other = await Outlet.findOne({ where: { tenant_id: tenantB.id } });
    const res = await request(app)
      .post(`/api/outlets/${other.id}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ user_id: 1 });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/outlets/:id/members', () => {
  it('lists members of an outlet', async () => {
    const outlet = await Outlet.findOne({
      where: { tenant_id: tenantA.id, code: 'KEEP' },
    });
    const res = await request(app)
      .get(`/api/outlets/${outlet.id}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    // Should include user data from the eager-loaded association.
    expect(res.body[0].User).toBeDefined();
    expect(res.body[0].User.name).toBeDefined();
  });

  it('404s for outlets outside the workspace', async () => {
    const other = await Outlet.findOne({ where: { tenant_id: tenantB.id } });
    const res = await request(app)
      .get(`/api/outlets/${other.id}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/outlets/:id/members/:userId', () => {
  it('removes a member from an outlet', async () => {
    const outlet = await Outlet.findOne({
      where: { tenant_id: tenantA.id, code: 'KEEP' },
    });
    const manager = await User.findOne({
      where: { email: 'outletmanager@example.com' },
    });
    const res = await request(app)
      .delete(`/api/outlets/${outlet.id}/members/${manager.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(204);
    const gone = await OutletMembership.findOne({
      where: { outlet_id: outlet.id, user_id: manager.id },
    });
    expect(gone).toBeNull();
  });

  it('404s for non-existent membership', async () => {
    const outlet = await Outlet.findOne({
      where: { tenant_id: tenantA.id, code: 'KEEP' },
    });
    const res = await request(app)
      .delete(`/api/outlets/${outlet.id}/members/999999`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(404);
  });

  it('404s for outlets outside the workspace', async () => {
    const other = await Outlet.findOne({ where: { tenant_id: tenantB.id } });
    const res = await request(app)
      .delete(`/api/outlets/${other.id}/members/1`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(404);
  });
});
