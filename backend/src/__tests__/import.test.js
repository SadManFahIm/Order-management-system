import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant, Product, MenuCategory } from '../models/index.js';

/**
 * Bulk import suite (Phase 4) — CSV → products.
 * Partial success: valid rows import, bad rows are reported per-row.
 */

let tenantA;
let tenantB;
let ownerToken;
let cashierToken;

const CSV = (body, header = 'name,price,weight_gm,description,enabled,category,prep_minutes,image_url') =>
  Buffer.from(`${header}\n${body}`);

beforeAll(async () => {
  await resetTestDb();

  tenantA = await Tenant.create({ name: 'Import Cafe A', slug: 'import-a' });
  tenantB = await Tenant.create({ name: 'Import Cafe B', slug: 'import-b' });
  await MenuCategory.create({ tenant_id: tenantA.id, name: 'Burgers' });

  const owner = await User.create({
    name: 'Import Owner',
    email: 'importowner@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  const cashier = await User.create({
    name: 'Import Cashier',
    email: 'importcashier@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenantA.id, role: 'owner' });
  await UserTenant.create({ user_id: cashier.id, tenant_id: tenantA.id, role: 'cashier' });

  const login = async (email) =>
    (await request(app).post('/api/auth/login').send({ email, password: 'password123' })).body
      .accessToken;
  ownerToken = await login('importowner@example.com');
  cashierToken = await login('importcashier@example.com');
});

afterAll(async () => {
  await sequelize.close();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('POST /api/products/import', () => {
  it('imports a valid CSV (partial success, 0 errors)', async () => {
    const res = await request(app)
      .post('/api/products/import')
      .set(auth(ownerToken))
      .attach('file', CSV('Beef Kebab,320,250,Charcoal grilled,true,Burgers,12,\nZinger Burger,260,280,Crispy fillet,true,,8,'), {
        filename: 'menu.csv',
        contentType: 'text/csv',
      });

    expect(res.status).toBe(201);
    expect(res.body.total).toBe(2);
    expect(res.body.succeeded).toBe(2);
    expect(res.body.failed).toBe(0);
    expect(res.body.skipped).toBe(0);
    expect(res.body.errors).toEqual([]);
    expect(res.body.columns).toEqual(expect.arrayContaining(['name', 'price']));

    const products = await Product.findAll({ where: { tenant_id: tenantA.id } });
    expect(products).toHaveLength(2);
    expect(products.map((p) => p.name)).toContain('Zinger Burger');
    // Category matched by name; the "Other"-category-less burger got null.
    const kebab = products.find((p) => p.name === 'Beef Kebab');
    expect(kebab.category_id).toBe((await MenuCategory.findOne({ where: { tenant_id: tenantA.id, name: 'Burgers' } })).id);
  });

  it('reports per-row errors and still imports the valid rows (mixed success)', async () => {
    const res = await request(app)
      .post('/api/products/import')
      .set(auth(ownerToken))
      .attach('file', CSV('Good Item,150,200,ok,true,,5,\nBad Name,,300,missing price,true,,5,\nAlso Bad,100,abc,not a number,true,,5,'), {
        filename: 'menu.csv',
        contentType: 'text/csv',
      });

    expect(res.status).toBe(201);
    expect(res.body.total).toBe(3);
    expect(res.body.succeeded).toBe(1);
    expect(res.body.failed).toBe(2);
    expect(res.body.errors).toHaveLength(2);
    // Row numbers are 1-based + header line.
    expect(res.body.errors.map((e) => e.row)).toEqual([3, 4]);
    expect(res.body.errors[0].field).toBe('price');
  });

  it('skips duplicates within the file (same name, later rows skipped)', async () => {
    const res = await request(app)
      .post('/api/products/import')
      .set(auth(ownerToken))
      .attach('file', CSV('Dup Item,100,100,,true,,5,\nDup Item,200,200,,true,,5,\nUnique Item,300,300,,true,,5,'), {
        filename: 'menu.csv',
        contentType: 'text/csv',
      });

    expect(res.status).toBe(201);
    expect(res.body.succeeded).toBe(2);
    expect(res.body.skipped).toBe(1);
    expect(res.body.errors[0].message).toContain('Duplicate');
  });

  it('skips products that already exist in the tenant (DB duplicates)', async () => {
    await Product.create({ tenant_id: tenantA.id, name: 'Existing Item', price: 100, weight_gm: 200 });
    const res = await request(app)
      .post('/api/products/import')
      .set(auth(ownerToken))
      .attach('file', CSV('Existing Item,150,250,changed price,true,,5,\nNew Item,50,100,,true,,5,'), {
        filename: 'menu.csv',
        contentType: 'text/csv',
      });

    expect(res.status).toBe(201);
    expect(res.body.succeeded).toBe(1);
    expect(res.body.skipped).toBe(1);
  });

  it('duplicates=error fails the whole import with 409', async () => {
    const res = await request(app)
      .post('/api/products/import')
      .set(auth(ownerToken))
      .field('duplicates', 'error')
      .attach('file', CSV('Existing Item,150,250,,true,,5,'), {
        filename: 'menu.csv',
        contentType: 'text/csv',
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_PRODUCTS');
  });

  it('duplicates=update edits the existing row instead of inserting', async () => {
    const res = await request(app)
      .post('/api/products/import')
      .set(auth(ownerToken))
      .field('duplicates', 'update')
      .attach('file', CSV('Existing Item,999,250,updated via import,true,,5,'), {
        filename: 'menu.csv',
        contentType: 'text/csv',
      });
    expect(res.status).toBe(201);
    expect(res.body.succeeded).toBe(1);

    const updated = await Product.findOne({ where: { tenant_id: tenantA.id, name: 'Existing Item' } });
    expect(Number(updated.price)).toBe(999);
    expect(updated.description).toBe('updated via import');
    // No extra row inserted.
    const count = await Product.count({ where: { tenant_id: tenantA.id, name: 'Existing Item' } });
    expect(count).toBe(1);
  });

  it('re-import after soft delete: update resurrects, skip never duplicates', async () => {
    const p = await Product.create({
      tenant_id: tenantA.id,
      name: 'Soft Del Item',
      price: 100,
      weight_gm: 200,
    });
    await p.destroy(); // paranoid → sets deleted_at, row still occupies the name

    // duplicates=update resurrects the soft-deleted row (clears deleted_at)
    // instead of inserting a duplicate underneath it.
    const updateRes = await request(app)
      .post('/api/products/import')
      .set(auth(ownerToken))
      .field('duplicates', 'update')
      .attach('file', CSV('Soft Del Item,555,200,resurrected via import,true,,5,'), {
        filename: 'menu.csv',
        contentType: 'text/csv',
      });
    expect(updateRes.status).toBe(201);
    expect(updateRes.body.succeeded).toBe(1);

    const visible = await Product.findAll({
      where: { tenant_id: tenantA.id, name: 'Soft Del Item' },
    });
    expect(visible).toHaveLength(1);
    expect(visible[0].deletedAt).toBeNull();
    expect(Number(visible[0].price)).toBe(555);
    // No hidden duplicate left underneath.
    const all = await Product.findAll({
      where: { tenant_id: tenantA.id, name: 'Soft Del Item' },
      paranoid: false,
    });
    expect(all).toHaveLength(1);

    // duplicates=skip on a soft-deleted name must NOT create a phantom duplicate.
    await visible[0].destroy();
    const skipRes = await request(app)
      .post('/api/products/import')
      .set(auth(ownerToken))
      .attach('file', CSV('Soft Del Item,111,200,,true,,5,'), {
        filename: 'menu.csv',
        contentType: 'text/csv',
      });
    expect(skipRes.status).toBe(201);
    expect(skipRes.body.skipped).toBe(1);
    const after = await Product.findAll({
      where: { tenant_id: tenantA.id, name: 'Soft Del Item' },
      paranoid: false,
    });
    expect(after).toHaveLength(1);
    expect(after[0].deletedAt).not.toBeNull();
  });

  it('creates unknown categories automatically (idempotent)', async () => {
    const res = await request(app)
      .post('/api/products/import')
      .set(auth(ownerToken))
      .attach('file', CSV('Pizza One,400,300,,true,Italian,8,\nPizza Two,450,350,,true,Italian,10,'), {
        filename: 'menu.csv',
        contentType: 'text/csv',
      });
    expect(res.status).toBe(201);
    expect(res.body.createdCategories).toBe(1);

    const cats = await MenuCategory.findAll({ where: { tenant_id: tenantA.id, name: 'Italian' } });
    expect(cats).toHaveLength(1);
  });

  it('rejects malformed CSV', async () => {
    const res = await request(app)
      .post('/api/products/import')
      .set(auth(ownerToken))
      .attach('file', Buffer.from('not,a,valid,csv,"unclosed'), {
        filename: 'broken.csv',
        contentType: 'text/csv',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_CSV');
  });

  it('rejects unknown columns with a clear error (no silent shifting)', async () => {
    const res = await request(app)
      .post('/api/products/import')
      .set(auth(ownerToken))
      .attach('file', Buffer.from('name,price,weight_gm,prcie' + '\n' + 'X,1,1,1'), {
        filename: 'typo.csv',
        contentType: 'text/csv',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_COLUMNS');
    expect(res.body.error.message).toContain('prcie');
  });

  it('rejects column-count mismatches (values never shift fields)', async () => {
    const res = await request(app)
      .post('/api/products/import')
      .set(auth(ownerToken))
      .attach('file', Buffer.from('name,price,weight_gm,description,enabled,category,prep_minutes,image_url' + '\n' + 'A,1,1,,true,,5,ok,EXTRA'), {
        filename: 'mismatch.csv',
        contentType: 'text/csv',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_CSV');
  });

  it('rejects an empty file', async () => {
    const res = await request(app)
      .post('/api/products/import')
      .set(auth(ownerToken))
      .attach('file', Buffer.from('name,price,weight_gm\n'), {
        filename: 'empty.csv',
        contentType: 'text/csv',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMPTY_IMPORT');
  });

  it('requires a file field', async () => {
    const res = await request(app).post('/api/products/import').set(auth(ownerToken));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IMPORT_FILE_REQUIRED');
  });

  it('requires authentication and manage:menu', async () => {
    const anon = await request(app)
      .post('/api/products/import')
      .attach('file', CSV('X,1,1,,true,,1,'));
    expect(anon.status).toBe(401);

    const cashierRes = await request(app)
      .post('/api/products/import')
      .set(auth(cashierToken))
      .attach('file', CSV('Y,1,1,,true,,1,'));
    expect(cashierRes.status).toBe(403);
  });

  it('never leaks across tenants', async () => {
    const before = await Product.count({ where: { tenant_id: tenantB.id } });
    const res = await request(app)
      .post('/api/products/import')
      .set({ ...auth(ownerToken), 'X-Tenant': String(tenantB.id) })
      .attach('file', CSV('Tenant B Item,200,200,,true,,5,'));
    // owner is not a member of tenant B → 403.
    expect(res.status).toBe(403);
    expect(await Product.count({ where: { tenant_id: tenantB.id } })).toBe(before);
  });

  it('GET /api/products/import/template returns the CSV template', async () => {
    const res = await request(app)
      .get('/api/products/import/template')
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('name,price,weight_gm');
  });
});

/** Builds an XLSX workbook buffer from a header + data rows (like the CSV helper). */
const XLSX = async (rows, header = 'name,price,weight_gm,description,enabled,category,prep_minutes,image_url') => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Menu');
  sheet.addRow(header.split(','));
  for (const line of rows.split('\n')) {
    sheet.addRow(line.split(','));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

describe('POST /api/products/import — XLSX', () => {
  it('imports a valid XLSX workbook (same pipeline as CSV)', async () => {
    const res = await request(app)
      .post('/api/products/import')
      .set(auth(ownerToken))
      .attach('file', await XLSX('Xl Burger,340,260,Excel burger,true,Burgers,10,'), {
        filename: 'menu.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(201);
    expect(res.body.total).toBe(1);
    expect(res.body.succeeded).toBe(1);
    expect(res.body.failed).toBe(0);
    expect(res.body.errors).toEqual([]);

    const product = await Product.findOne({ where: { tenant_id: tenantA.id, name: 'Xl Burger' } });
    expect(product).not.toBeNull();
    expect(Number(product.price)).toBe(340);
    // Boolean cells arrive as real booleans from Excel — handled by the schema.
    expect(product.enabled).toBe(true);
  });

  it('reports bad XLSX rows per-row and still imports valid ones (mixed success)', async () => {
    const res = await request(app)
      .post('/api/products/import')
      .set(auth(ownerToken))
      .attach('file', await XLSX('Good Excel Item,180,220,ok,true,,5,\nBroken Excel,,300,missing price,true,,5,'), {
        filename: 'mixed.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(201);
    expect(res.body.succeeded).toBe(1);
    expect(res.body.failed).toBe(1);
    expect(res.body.errors[0].field).toBe('price');
  });

  it('handles duplicates=update for XLSX rows (bumps version)', async () => {
    await Product.create({ tenant_id: tenantA.id, name: 'Xl Dup', price: 10, weight_gm: 10 });
    const res = await request(app)
      .post('/api/products/import')
      .set(auth(ownerToken))
      .field('duplicates', 'update')
      .attach('file', await XLSX('Xl Dup,777,50,updated from excel,true,,5,'), {
        filename: 'dup.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    expect(res.status).toBe(201);
    expect(res.body.succeeded).toBe(1);

    const updated = await Product.findOne({ where: { tenant_id: tenantA.id, name: 'Xl Dup' } });
    expect(Number(updated.price)).toBe(777);
    expect(updated.version).toBe(2);
  });

  it('rejects a malformed XLSX buffer', async () => {
    const res = await request(app)
      .post('/api/products/import')
      .set(auth(ownerToken))
      .attach('file', Buffer.from('this is not a zip file'), {
        filename: 'broken.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_XLSX');
  });
});
