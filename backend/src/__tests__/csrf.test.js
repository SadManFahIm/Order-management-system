import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant } from '../models/index.js';

const ALLOWED_ORIGIN = 'http://localhost:5173';
const EVIL_ORIGIN = 'http://evil.example.com';

/**
 * CSRF protection tests for cookie-authenticated endpoints (the httpOnly
 * refresh-token flow). Verifies the Origin / Sec-Fetch-Site guard.
 */

let accessToken;

beforeAll(async () => {
  await resetTestDb();
  const tenant = await Tenant.create({ name: 'Csrf Diner', slug: 'csrf-diner' });
  const user = await User.create({
    name: 'Csrf User',
    email: 'csrf@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: user.id, tenant_id: tenant.id, role: 'owner' });

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'csrf@example.com', password: 'password123' });
  expect(login.status).toBe(200);
  accessToken = login.body.accessToken;
});

/** Fresh session cookie per test — refresh tokens rotate and are single-use. */
async function freshCookie() {
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'csrf@example.com', password: 'password123' });
  const setCookie = login.headers['set-cookie'];
  expect(setCookie).toBeTruthy();
  return Array.isArray(setCookie) ? setCookie[0].split(';')[0] : setCookie;
}

afterAll(async () => {
  await sequelize.close();
});

describe('refresh endpoint (cookie-authenticated)', () => {
  it('rejects a cross-origin request carrying the session cookie', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', await freshCookie())
      .set('Origin', EVIL_ORIGIN);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });

  it('rejects a request flagged cross-site via Sec-Fetch-Site', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', await freshCookie())
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Sec-Fetch-Mode', 'no-cors');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });

  it('accepts a same-origin request with the cookie', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', await freshCookie())
      .set('Origin', ALLOWED_ORIGIN);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('accepts a non-browser client (no Origin, no Sec-Fetch-Site)', async () => {
    const res = await request(app).post('/api/auth/refresh').set('Cookie', await freshCookie());
    expect(res.status).toBe(200);
  });
});

describe('state-changing authed endpoints', () => {
  it('blocks cross-origin product creation even with a valid Bearer token + cookie', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', await freshCookie())
      .set('Origin', EVIL_ORIGIN)
      .send({ name: 'X', price: 1, weight_gm: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });

  it('allows the same request from a same-origin context', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', await freshCookie())
      .set('Origin', ALLOWED_ORIGIN)
      .send({ name: 'Legit Product', price: 150, weight_gm: 300 });
    expect(res.status).toBe(201);
  });

  it('safe methods (GET) are never blocked', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', await freshCookie())
      .set('Origin', EVIL_ORIGIN);
    expect(res.status).not.toBe(403);
  });
});
