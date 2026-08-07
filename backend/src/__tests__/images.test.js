import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';

/**
 * Image pipeline suite (Phase 4).
 * Uploads go through the local storage driver — real sharp processing, real
 * files on disk. No external infrastructure required.
 */

// Storage config is read at module load — point uploads at a scratch dir
// BEFORE importing the app (same pattern as the drift suite).
const UPLOAD_ROOT = path.resolve(process.cwd(), './uploads-test');
process.env.UPLOAD_DIR = './uploads-test';

const { default: app } = await import('../app.js');
const { default: sequelize } = await import('../config/db.js');
const { resetTestDb } = await import('../test/resetDb.js');
const { User, Tenant, UserTenant } = await import('../models/index.js');

let tenant;
let ownerToken;
let cashierToken;

beforeAll(async () => {
  await resetTestDb();

  tenant = await Tenant.create({ name: 'Pic Cafe', slug: 'pic-cafe' });
  const owner = await User.create({
    name: 'Pic Owner',
    email: 'picowner@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  const cashier = await User.create({
    name: 'Pic Cashier',
    email: 'piccashier@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenant.id, role: 'owner' });
  await UserTenant.create({ user_id: cashier.id, tenant_id: tenant.id, role: 'cashier' });

  const login = async (email) =>
    (await request(app).post('/api/auth/login').send({ email, password: 'password123' })).body
      .accessToken;
  ownerToken = await login('picowner@example.com');
  cashierToken = await login('piccashier@example.com');
});

afterAll(async () => {
  // Windows can hold file handles briefly after the last request — retry.
  for (let i = 0; i < 5; i += 1) {
    try {
      fs.rmSync(UPLOAD_ROOT, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  await sequelize.close();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

const tinyPng = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 220, g: 40, b: 40 } } })
    .png()
    .toBuffer();

describe('POST /api/uploads/images', () => {
  it('uploads a valid PNG, returns processed WebP URLs, and writes files locally', async () => {
    const res = await request(app)
      .post('/api/uploads/images')
      .set(auth(ownerToken))
      .attach('image', await tinyPng(), { filename: 'burger.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/\/uploads\/tenants\/\d+\/images\/.*\.webp$/);
    expect(res.body.thumbUrl).toMatch(/thumb/);
    expect(res.body.key).toMatch(new RegExp(`^tenants/${tenant.id}/images/`));

    // Local driver wrote the standard + thumb files.
    const standardPath = path.join(UPLOAD_ROOT, res.body.key);
    const thumbPath = path.join(UPLOAD_ROOT, res.body.thumbKey);
    expect(fs.existsSync(standardPath)).toBe(true);
    expect(fs.existsSync(thumbPath)).toBe(true);

    const meta = await sharp(standardPath).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBeLessThanOrEqual(1600);
  });

  it('rejects a non-image file type (mimetype sniff + filter)', async () => {
    const res = await request(app)
      .post('/api/uploads/images')
      .set(auth(ownerToken))
      .attach('image', Buffer.from('plain text, definitely not an image'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_IMAGE_TYPE');
  });

  it('rejects a spoofed mimetype whose content is not an image', async () => {
    const res = await request(app)
      .post('/api/uploads/images')
      .set(auth(ownerToken))
      .attach('image', Buffer.from('this is not a real png'), {
        filename: 'fake.png',
        contentType: 'image/png',
      });
    expect(res.status).toBe(400);
    expect(['INVALID_IMAGE', 'IMAGE_PROCESSING_FAILED']).toContain(res.body.error.code);
  });

  it('rejects oversized uploads with IMAGE_TOO_LARGE', async () => {
    // Random noise (incompressible) at 1600×1600×3 → well over the 5 MB cap.
    // A solid-colour PNG compresses to a few KB, which would NOT trip the
    // limit — noise guarantees a genuinely large payload.
    const { width, height, channels } = { width: 1600, height: 1600, channels: 3 };
    const raw = Buffer.alloc(width * height * channels);
    for (let i = 0; i < raw.length; i += 4) raw[i] = (i * 7) % 256;
    const big = await sharp(raw, { raw: { width, height, channels } })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(big.length).toBeGreaterThan(5 * 1024 * 1024);

    const res = await request(app)
      .post('/api/uploads/images')
      .set(auth(ownerToken))
      .attach('image', big, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IMAGE_TOO_LARGE');
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/uploads/images')
      .attach('image', await tinyPng(), { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
  });

  it('blocks non-menu roles (RBAC manage:menu)', async () => {
    const res = await request(app)
      .post('/api/uploads/images')
      .set(auth(cashierToken))
      .attach('image', await tinyPng(), { filename: 'b.png', contentType: 'image/png' });
    expect(res.status).toBe(403);
  });

  it('cleans up no files when processing fails mid-way', async () => {
    const before = fs.existsSync(UPLOAD_ROOT)
      ? fs.readdirSync(path.join(UPLOAD_ROOT, 'tenants', String(tenant.id), 'images')).length
      : 0;
    // A JPEG header with truncated body — sharp fails, nothing persisted.
    const corruptJpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from('garbage data that is not a valid jpeg at all'),
    ]);
    const res = await request(app)
      .post('/api/uploads/images')
      .set(auth(ownerToken))
      .attach('image', corruptJpeg, { filename: 'broken.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IMAGE_PROCESSING_FAILED');

    const after = fs.existsSync(UPLOAD_ROOT)
      ? fs.readdirSync(path.join(UPLOAD_ROOT, 'tenants', String(tenant.id), 'images')).length
      : 0;
    expect(after).toBe(before);
  });

  it('DELETE removes the stored object', async () => {
    const uploaded = await request(app)
      .post('/api/uploads/images')
      .set(auth(ownerToken))
      .attach('image', await tinyPng(), { filename: 'del.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(201);

    const key = uploaded.body.key.replace(`tenants/${tenant.id}/images/`, '');
    const del = await request(app)
      .delete(`/api/uploads/images/${key}`)
      .set(auth(ownerToken));
    expect(del.status).toBe(200);

    expect(fs.existsSync(path.join(UPLOAD_ROOT, uploaded.body.key))).toBe(false);
  });

  it('rejects path-traversal keys on DELETE (security)', async () => {
    // URL-encoded `..` segments must NOT reach the storage driver.
    const traversal = await request(app)
      .delete('/api/uploads/images/..%2F..%2F..%2F..%2Fdata.sqlite')
      .set(auth(ownerToken));
    expect(traversal.status).toBe(400);
    expect(traversal.body.error.code).toBe('INVALID_IMAGE_KEY');

    const plainTraversal = await request(app)
      .delete('/api/uploads/images/..%2F..%2F..%2Fdata.sqlite')
      .set(auth(ownerToken));
    expect(plainTraversal.status).toBe(400);

    // Nothing outside uploads was touched — the suite's own DB file survives.
    const dbPath = path.join(process.cwd(), process.env.DB_STORAGE || './data.sqlite');
    expect(fs.existsSync(dbPath)).toBe(true);
  });
});
