import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant } from '../models/index.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';

let ownerUser;
let ownerToken;
let tenantA;
let tenantB;

beforeAll(async () => {
  await resetTestDb();

  tenantA = await Tenant.create({ name: 'Cafe A', slug: 'cafe-a' });
  tenantB = await Tenant.create({ name: 'Cafe B', slug: 'cafe-b' });

  ownerUser = await User.create({
    name: 'Owner',
    email: 'owner@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: ownerUser.id, tenant_id: tenantA.id, role: 'owner' });

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'owner@example.com', password: 'password123' });
  ownerToken = login.body.accessToken;
});

afterAll(async () => {
  await sequelize.close();
});

describe('resolveTenant middleware', () => {
  const makeReq = () => ({
    user: { id: ownerUser.id, tenant_id: tenantA.id, tenant_role: 'owner' },
    headers: {},
    query: {},
  });

  it('resolves the tenant from claims', async () => {
    const req = makeReq();
    const res = { status: () => ({ json: () => {} }) };
    let nextCalled = false;
    await resolveTenant(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(req.tenant.id).toBe(tenantA.id);
    expect(req.tenant.role).toBe('owner');
  });

  it('prefers the X-Tenant header over claims', async () => {
    const req = makeReq();
    req.headers['x-tenant'] = String(tenantA.id);
    req.user.tenant_id = null;
    await resolveTenant(req, { status: () => ({ json: () => {} }) }, () => {});
    expect(req.tenant.id).toBe(tenantA.id);
  });

  it('rejects a tenant the user does not belong to with 403', async () => {
    const req = makeReq();
    req.headers['x-tenant'] = String(tenantB.id);
    let statusCode = null;
    let body = null;
    await resolveTenant(
      req,
      { status: (s) => ({ json: (b) => { statusCode = s; body = b; } }) },
      () => {}
    );
    expect(statusCode).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
  });
});

describe('requireTenant middleware', () => {
  it('passes when a tenant is resolved', () => {
    let passed = false;
    requireTenant({ tenant: { id: 1 } }, {}, () => { passed = true; });
    expect(passed).toBe(true);
  });

  it('rejects when no tenant context exists', () => {
    let statusCode = null;
    requireTenant(
      { tenant: null },
      { status: (s) => ({ json: (_b) => { statusCode = s; } }) },
      () => {}
    );
    expect(statusCode).toBe(403);
  });
});

describe('tenant-aware API', () => {
  it('GET /api/auth/me reflects the active tenant', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.tenantId).toBe(tenantA.id);
    expect(res.body.user.tenantRole).toBe('owner');
  });

  it('GET /api/auth/tenants lists memberships', async () => {
    const res = await request(app)
      .get('/api/auth/tenants')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].role).toBe('owner');
    expect(res.body[0].slug).toBe('cafe-a');
  });
});
