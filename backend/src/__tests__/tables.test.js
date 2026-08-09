import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant, Table } from '../models/index.js';

/**
 * QR table menu suite (Phase 5 starter) — merchant table CRUD + QR codes.
 *
 * Covers: permission gating (view vs manage), tenant isolation, duplicate
 * table numbers, and that the QR endpoint returns scannable SVG data URIs
 * pointing at the storefront URL for each active table.
 */

let ownerToken;
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

  tenantA = await Tenant.create({ name: 'QR Cafe A', slug: 'qr-cafe-a' });
  tenantB = await Tenant.create({ name: 'QR Cafe B', slug: 'qr-cafe-b' });

  const owner = await User.create({
    name: 'QR Owner',
    email: 'qrowner@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenantA.id, role: 'owner' });

  const cashier = await User.create({
    name: 'QR Cashier',
    email: 'qrcashier@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: cashier.id, tenant_id: tenantA.id, role: 'cashier' });

  ownerToken = await login('qrowner@example.com');
  cashierToken = await login('qrcashier@example.com');
});

afterAll(async () => {
  await sequelize.close();
});

describe('POST /api/tables', () => {
  it('creates a table in the active workspace', async () => {
    const res = await request(app)
      .post('/api/tables')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ table_no: 1, name: 'Window 1', capacity: 2 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      tenant_id: tenantA.id,
      table_no: 1,
      name: 'Window 1',
      capacity: 2,
      is_active: true,
    });
  });

  it('rejects duplicate table numbers in the same workspace with 409', async () => {
    const res = await request(app)
      .post('/api/tables')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ table_no: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TABLE_NO_TAKEN');
  });

  it('rejects invalid table numbers with 400', async () => {
    const res = await request(app)
      .post('/api/tables')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ table_no: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a cashier (no manage:menu) with 403', async () => {
    const res = await request(app)
      .post('/api/tables')
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ table_no: 99 });
    expect(res.status).toBe(403);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/tables').send({ table_no: 1 });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/tables', () => {
  it('lists only the active workspace tables', async () => {
    await Table.create({ tenant_id: tenantB.id, table_no: 1, name: 'Beta Table', capacity: 4 });
    await Table.create({ tenant_id: tenantA.id, table_no: 2, name: 'Window 2', capacity: 4 });

    const res = await request(app)
      .get('/api/tables')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(200);
    const numbers = res.body.map((t) => t.table_no);
    expect(numbers).toEqual([1, 2]);
    // Other tenant's table never leaks.
    expect(res.body.some((t) => t.name === 'Beta Table')).toBe(false);
  });

  it('a cashier can view tables (view:menu)', async () => {
    const res = await request(app)
      .get('/api/tables')
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });
});

describe('GET /api/tables/qr', () => {
  it('returns scannable SVG QR data URIs pointing at the storefront', async () => {
    const res = await request(app)
      .get('/api/tables/qr')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('qr-cafe-a');

    const table1 = res.body.qrs.find((q) => q.tableNo === 1);
    expect(table1).toBeDefined();
    // URL must target the public storefront with the table param.
    expect(table1.url).toMatch(/\/m\/qr-cafe-a\?table=1$/);
    // SVG data URI, no binary PNG — easy to render and download in the UI.
    expect(table1.svg.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(table1.svg.length).toBeGreaterThan(200);
  });

  it('excludes inactive tables from QR output', async () => {
    await Table.create({ tenant_id: tenantA.id, table_no: 7, name: 'Reserved', capacity: 6, is_active: false });
    const res = await request(app)
      .get('/api/tables/qr')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.body.qrs.some((q) => q.tableNo === 7)).toBe(false);
    // But the inactive table still shows in the full list.
    const list = await request(app)
      .get('/api/tables')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(list.body.some((t) => t.table_no === 7)).toBe(true);
  });
});

describe('PATCH /api/tables/:id', () => {
  it('renames and toggles a table', async () => {
    const table = await Table.findOne({ where: { tenant_id: tenantA.id, table_no: 2 } });
    const res = await request(app)
      .patch(`/api/tables/${table.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ name: 'Corner 2', capacity: 6, is_active: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Corner 2', capacity: 6, is_active: false });
  });

  it('409s when renaming onto an existing table number', async () => {
    const table = await Table.findOne({ where: { tenant_id: tenantA.id, table_no: 1 } });
    const res = await request(app)
      .patch(`/api/tables/${table.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ table_no: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TABLE_NO_TAKEN');
  });

  it('404s for tables outside the workspace', async () => {
    const beta = await Table.findOne({ where: { tenant_id: tenantB.id } });
    const res = await request(app)
      .patch(`/api/tables/${beta.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id))
      .send({ name: 'Hijack' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tables/:id', () => {
  it('removes a table from the workspace', async () => {
    const table = await Table.create({ tenant_id: tenantA.id, table_no: 5, name: 'Temporary' });
    const res = await request(app)
      .delete(`/api/tables/${table.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(await Table.findByPk(table.id)).toBeNull();
  });

  it('404s for missing tables', async () => {
    const res = await request(app)
      .delete('/api/tables/999999')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenantA.id));
    expect(res.status).toBe(404);
  });
});
