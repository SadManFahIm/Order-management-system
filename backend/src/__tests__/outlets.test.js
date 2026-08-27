import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant, Outlet, OutletMembership, Product, OutletMenuOverride } from '../models/index.js';

/**
 * Outlet management + membership API (Phase 8) — CRUD, tenant isolation,
 * RBAC gating, and outlet membership lifecycle.
 */

let ownerToken;
let managerToken;
let cashierToken;
let omScopedToken;
let staffScopedToken;
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

  // Scoped outlet members (Sector 2): tenant role 'cashier' so neither has
  // 'manage:outlets'; their branch access comes only from OutletMembership.
  const omScoped = await User.create({
    name: 'Branch Manager',
    email: 'branchmanager@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: omScoped.id, tenant_id: tenantA.id, role: 'cashier' });

  const staffScoped = await User.create({
    name: 'Branch Staff',
    email: 'branchstaff@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: staffScoped.id, tenant_id: tenantA.id, role: 'cashier' });

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
  omScopedToken = await login('branchmanager@example.com');
  staffScopedToken = await login('branchstaff@example.com');
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

  it('a cashier with no outlet membership sees an empty scoped list', async () => {
    const res = await request(app)
      .get('/api/outlets')
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('X-Tenant', String(tenantA.id));
    // Role-scoped access: no manage:outlets and no outlet membership → the
    // cashier can open the page but only sees their (empty) outlet scope.
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
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

  it('updates the role for an existing membership (upsert)', async () => {
    const manager = await User.findOne({
      where: { email: 'outletmanager@example.com' },
    });
    // Manager already a member (from prior test) with outlet_manager role.
    const res = await request(app)
      .post(`/api/outlets/${outletId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ user_id: manager.id, role: 'staff' });
    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe(manager.id);
    expect(res.body.role).toBe('staff');
    const saved = await OutletMembership.findOne({
      where: { outlet_id: outletId, user_id: manager.id },
    });
    expect(saved.role).toBe('staff');
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
  it('lists members of an outlet with a flattened user shape', async () => {
    const outlet = await Outlet.findOne({
      where: { tenant_id: tenantA.id, code: 'KEEP' },
    });
    // Re-add the manager so the list is non-empty and has known user data.
    const manager = await User.findOne({
      where: { email: 'outletmanager@example.com' },
    });
    await OutletMembership.findOrCreate({
      where: { outlet_id: outlet.id, user_id: manager.id, tenant_id: tenantA.id },
      defaults: { role: 'outlet_manager' },
    });

    const res = await request(app)
      .get(`/api/outlets/${outlet.id}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    // Members are flattened: name/email at top level, no nested User.
    const member = res.body.find((m) => m.user_id === manager.id);
    expect(member).toBeDefined();
    expect(member.name).toBe('Outlet Manager');
    expect(member.email).toBe('outletmanager@example.com');
    expect(member.user_id).toBe(manager.id);
    expect(member.role).toBe('staff');
    // No raw association leaks through.
    expect(res.body[0].User).toBeUndefined();
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

describe('GET /api/outlets/:id/members/candidates', () => {
  it('returns tenant members not yet assigned to the outlet', async () => {
    const outlet = await Outlet.findOne({
      where: { tenant_id: tenantA.id, code: 'KEEP' },
    });
    const manager = await User.findOne({
      where: { email: 'outletmanager@example.com' },
    });
    const cashier = await User.findOne({
      where: { email: 'outletcashier@example.com' },
    });
    // Ensure manager is assigned (so excluded) and cashier is not (so included).
    await OutletMembership.findOrCreate({
      where: { outlet_id: outlet.id, user_id: manager.id, tenant_id: tenantA.id },
      defaults: { role: 'outlet_manager' },
    });
    await OutletMembership.destroy({
      where: { outlet_id: outlet.id, user_id: cashier.id },
    });

    const res = await request(app)
      .get(`/api/outlets/${outlet.id}/members/candidates`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(200);
    const ids = res.body.map((c) => c.id);
    // Assigned members are excluded.
    expect(ids).not.toContain(manager.id);
    // Available tenant members are included with a flattened shape.
    expect(ids).toContain(cashier.id);
    const c = res.body.find((c) => c.id === cashier.id);
    expect(c.name).toBe('Outlet Cashier');
    expect(c.email).toBe('outletcashier@example.com');
  });

  it('excludes users outside the tenant', async () => {
    const outlet = await Outlet.findOne({
      where: { tenant_id: tenantA.id, code: 'KEEP' },
    });
    const staffB = await User.findOne({
      where: { email: 'outletstaffb@example.com' },
    });
    const res = await request(app)
      .get(`/api/outlets/${outlet.id}/members/candidates`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    const ids = res.body.map((c) => c.id);
    expect(ids).not.toContain(staffB.id);
  });

  it('404s for outlets outside the workspace', async () => {
    const other = await Outlet.findOne({ where: { tenant_id: tenantB.id } });
    const res = await request(app)
      .get(`/api/outlets/${other.id}/members/candidates`)
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

// ── Outlet Menu Overrides (Sector: outlet menu overrides) ────────────────

describe('Outlet menu overrides', () => {
  let outletId;
  let itemId;
  let itemId2;

  beforeAll(async () => {
    const outlet = await Outlet.findOne({
      where: { tenant_id: tenantA.id, code: 'KEEP' },
    });
    outletId = outlet.id;

    const a = await Product.create({
      tenant_id: tenantA.id,
      name: 'Branch Pizza',
      price: 300,
      weight_gm: 400,
      enabled: true,
    });
    itemId = a.id;
    const b = await Product.create({
      tenant_id: tenantA.id,
      name: 'Branch Pasta',
      price: 180,
      weight_gm: 250,
      enabled: true,
    });
    itemId2 = b.id;
  });

  it('GET /:id/menu lists central items with empty overrides', async () => {
    const res = await request(app)
      .get(`/api/outlets/${outletId}/menu`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(200);
    expect(res.body.outlet.id).toBe(outletId);
    const item = res.body.items.find((i) => i.id === itemId);
    expect(item).toBeDefined();
    expect(item.effectivePrice).toBe(300);
    expect(item.effectiveAvailable).toBe(true);
    expect(item.override.priceOverride).toBeNull();
  });

  it('PUT /:id/menu/items/:itemId sets a price override', async () => {
    const res = await request(app)
      .put(`/api/outlets/${outletId}/menu/items/${itemId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ price_override: 350 }, {});
    expect(res.status).toBe(200);
    expect(Number(res.body.price_override)).toBe(350);
  });

  it('GET /:id/menu reflects the price override as the effective price', async () => {
    const res = await request(app)
      .get(`/api/outlets/${outletId}/menu`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    const item = res.body.items.find((i) => i.id === itemId);
    expect(Number(item.effectivePrice)).toBe(350);
    expect(item.override.priceOverride).toBe(350);
  });

  it('isolation: the override lives only in the table, not on the product', async () => {
    const p = await Product.findByPk(itemId);
    expect(Number(p.price)).toBe(300);
  });

  it('PUT sets availability + visibility override', async () => {
    const res = await request(app)
      .put(`/api/outlets/${outletId}/menu/items/${itemId2}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ is_available: false, visible: false });
    expect(res.status).toBe(200);
    expect(res.body.is_available).toBe(false);
    expect(res.body.visible).toBe(false);
  });

  it('DELETE /:id/menu/items/:itemId clears the override', async () => {
    const res = await request(app)
      .delete(`/api/outlets/${outletId}/menu/items/${itemId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(204);
    const gone = await OutletMenuOverride.findOne({
      where: { outlet_id: outletId, menu_item_id: itemId },
    });
    expect(gone).toBeNull();
  });

  it('DELETE with no override returns 404', async () => {
    const res = await request(app)
      .delete(`/api/outlets/${outletId}/menu/items/999999`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(404);
  });

  it('404s for outlets outside the workspace', async () => {
    const other = await Outlet.findOne({ where: { tenant_id: tenantB.id } });
    const res = await request(app)
      .get(`/api/outlets/${other.id}/menu`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(404);
  });
});

describe('Role-scoped outlet access (Sector 2)', () => {
  let outletId;
  let omUserId;
  let staffUserId;
  let om2Token;
  let om2UserId;
  let menuItemId;
  let freshUserId;

  beforeAll(async () => {
    const outlet = await Outlet.findOne({
      where: { tenant_id: tenantA.id, code: 'KEEP' },
    });
    outletId = outlet.id;

    const om = await User.findOne({ where: { email: 'branchmanager@example.com' } });
    const staff = await User.findOne({ where: { email: 'branchstaff@example.com' } });
    omUserId = om.id;
    staffUserId = staff.id;

    // A tenant member who is NOT yet an outlet member (for the "add staff" path).
    const fresh = await User.create({
      name: 'Fresh Staff',
      email: 'freshstaff@example.com',
      password: await bcrypt.hash('password123', 10),
      platform_role: 'member',
    });
    await UserTenant.create({ user_id: fresh.id, tenant_id: tenantA.id, role: 'cashier' });
    freshUserId = fresh.id;

    await OutletMembership.create({
      user_id: omUserId,
      outlet_id: outletId,
      tenant_id: tenantA.id,
      role: 'outlet_manager',
    });
    await OutletMembership.create({
      user_id: staffUserId,
      outlet_id: outletId,
      tenant_id: tenantA.id,
      role: 'staff',
    });

    // A second outlet_manager to test the "cannot modify another manager" guard.
    const om2 = await User.create({
      name: 'Branch Manager 2',
      email: 'branchmanager2@example.com',
      password: await bcrypt.hash('password123', 10),
      platform_role: 'member',
    });
    await UserTenant.create({ user_id: om2.id, tenant_id: tenantA.id, role: 'cashier' });
    await OutletMembership.create({
      user_id: om2.id,
      outlet_id: outletId,
      tenant_id: tenantA.id,
      role: 'outlet_manager',
    });
    om2UserId = om2.id;
    om2Token = await login('branchmanager2@example.com');

    const item = await Product.create({
      tenant_id: tenantA.id,
      name: 'Branch Scoped Item',
      price: 100,
      weight_gm: 100,
      enabled: true,
    });
    menuItemId = item.id;
  });

  const get = (token, path) =>
    request(app).get(`/api/outlets/${path}`).set('Authorization', `Bearer ${token}`).set('X-Tenant', String(tenantA.id));

  it('a scoped outlet_manager sees only their outlets with my_role', async () => {
    const res = await get(omScopedToken, '');
    expect(res.status).toBe(200);
    const mine = res.body.filter((o) => String(o.id) === String(outletId));
    expect(mine.length).toBe(1);
    expect(mine[0].my_role).toBe('outlet_manager');
    // Scoped users never see the tenant's other outlets.
    expect(res.body.some((o) => o.code === 'MAIN' || o.code === 'DHAN')).toBe(false);
  });

  it('a scoped outlet_manager can read their outlet and its menu', async () => {
    const one = await get(omScopedToken, outletId);
    expect(one.status).toBe(200);
    const menu = await get(omScopedToken, `${outletId}/menu`);
    expect(menu.status).toBe(200);
  });

  it('a scoped outlet_manager can manage menu overrides within their outlet', async () => {
    const put = await request(app)
      .put(`/api/outlets/${outletId}/menu/items/${menuItemId}`)
      .set('Authorization', `Bearer ${omScopedToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ price_override: 125 });
    expect(put.status).toBe(200);
    expect(Number(put.body.price_override)).toBe(125);
  });

  it('a scoped outlet_manager CANNOT create outlets', async () => {
    const res = await request(app)
      .post('/api/outlets')
      .set('Authorization', `Bearer ${omScopedToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ name: 'Nope', code: 'NOPE2', slug: 'nope2' });
    expect(res.status).toBe(403);
  });

  it('a scoped outlet_manager CANNOT edit or delete the outlet itself', async () => {
    const edit = await request(app)
      .put(`/api/outlets/${outletId}`)
      .set('Authorization', `Bearer ${omScopedToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ name: 'Renamed' });
    expect(edit.status).toBe(403);
    const del = await request(app)
      .delete(`/api/outlets/${outletId}`)
      .set('Authorization', `Bearer ${omScopedToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(del.status).toBe(403);
  });

  it('a scoped outlet_manager can add and manage staff but NOT another outlet_manager', async () => {
    // Add a fresh tenant member as staff (allowed).
    const add = await request(app)
      .post(`/api/outlets/${outletId}/members`)
      .set('Authorization', `Bearer ${omScopedToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ user_id: freshUserId, role: 'staff' });
    expect(add.status).toBe(201);

    // Cannot promote a staff member to outlet_manager.
    const promote = await request(app)
      .post(`/api/outlets/${outletId}/members`)
      .set('Authorization', `Bearer ${omScopedToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ user_id: freshUserId, role: 'outlet_manager' });
    expect(promote.status).toBe(403);

    // Cannot modify another outlet_manager's membership.
    const touchOm2 = await request(app)
      .post(`/api/outlets/${outletId}/members`)
      .set('Authorization', `Bearer ${omScopedToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ user_id: om2UserId, role: 'staff' });
    expect(touchOm2.status).toBe(403);

    // Cannot change their own membership.
    const self = await request(app)
      .post(`/api/outlets/${outletId}/members`)
      .set('Authorization', `Bearer ${omScopedToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ user_id: omUserId, role: 'staff' });
    expect(self.status).toBe(403);

    // Cannot remove another outlet_manager.
    const rmOm2 = await request(app)
      .delete(`/api/outlets/${outletId}/members/${om2UserId}`)
      .set('Authorization', `Bearer ${omScopedToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(rmOm2.status).toBe(403);

    // Cannot remove themselves.
    const rmSelf = await request(app)
      .delete(`/api/outlets/${outletId}/members/${omUserId}`)
      .set('Authorization', `Bearer ${omScopedToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(rmSelf.status).toBe(403);
  });

  it('a scoped staff member can read but NOT manage their outlet', async () => {
    const one = await get(staffScopedToken, outletId);
    expect(one.status).toBe(200);
    const menu = await get(staffScopedToken, `${outletId}/menu`);
    expect(menu.status).toBe(200);

    const put = await request(app)
      .put(`/api/outlets/${outletId}/menu/items/${menuItemId}`)
      .set('Authorization', `Bearer ${staffScopedToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ price_override: 999 });
    expect(put.status).toBe(403);

    const addMember = await request(app)
      .post(`/api/outlets/${outletId}/members`)
      .set('Authorization', `Bearer ${staffScopedToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ user_id: omUserId, role: 'staff' });
    expect(addMember.status).toBe(403);
  });

  it('a tenant member with no outlet membership is denied (403)', async () => {
    const one = await get(cashierToken, outletId);
    expect(one.status).toBe(403);
    const menu = await get(cashierToken, `${outletId}/menu`);
    expect(menu.status).toBe(403);
  });

  it('a manager (manage:outlets) still manages all outlets and sees my_role null', async () => {
    const res = await request(app)
      .get('/api/outlets')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(200);
    const keep = res.body.find((o) => String(o.id) === String(outletId));
    expect(keep).toBeDefined();
    expect(keep.my_role).toBeNull();
  });
});
