import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant, Product } from '../models/index.js';

beforeAll(async () => {
  await resetTestDb();
});

afterAll(async () => {
  await sequelize.close();
});

async function createUser(overrides = {}) {
  return User.create({
    name: 'Someone',
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: await bcrypt.hash('password123', 10),
    platform_role: 'customer',
    ...overrides,
  });
}

describe('registration & email verification', () => {
  it('registers a customer account and returns a dev verification token', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'New Customer',
      email: 'customer1@example.com',
      password: 'password123',
    });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('customer1@example.com');
    expect(res.body.user.platformRole).toBe('customer');
    expect(res.body.devToken).toBeTruthy();
  });

  it('rejects duplicate emails with 409', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Duplicate',
      email: 'customer1@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('rejects weak passwords', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Weak',
      email: 'weak@example.com',
      password: 'short',
    });
    expect(res.status).toBe(400);
  });

  it('verifies email with the issued token', async () => {
    const register = await request(app).post('/api/auth/register').send({
      name: 'Verify Me',
      email: 'verify@example.com',
      password: 'password123',
    });

    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: register.body.devToken });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Email verified');

    const user = await User.findOne({ where: { email: 'verify@example.com' } });
    expect(user.email_verified_at).toBeTruthy();
  });

  it('rejects a reused verification token', async () => {
    const register = await request(app).post('/api/auth/register').send({
      name: 'Reuse Me',
      email: 'reuse@example.com',
      password: 'password123',
    });
    const token = register.body.devToken;
    await request(app).post('/api/auth/verify-email').send({ token });
    const second = await request(app).post('/api/auth/verify-email').send({ token });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('TOKEN_USED');
  });
});

describe('login', () => {
  it('returns an access token and user for valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'customer1@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.email).toBe('customer1@example.com');
    expect(res.headers['set-cookie']).toBeDefined(); // refresh token cookie
  });

  it('rejects invalid credentials with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'customer1@example.com', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('RBAC guards', () => {
  it('blocks a customer from merchant endpoints with 403', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'customer1@example.com', password: 'password123' });

    const res = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    // Customers hold no workspace context → tenant scoping rejects them.
    expect(res.status).toBe(403);
    expect(['FORBIDDEN', 'TENANT_REQUIRED']).toContain(res.body.error.code);
  });

  it('allows legacy member accounts full access (backward compatibility)', async () => {
    // Boot-time bootstrap grants legacy accounts a default-workspace 'staff'
    // membership (full access). Mirror that here.
    const tenant = await Tenant.create({ name: 'Legacy Diner', slug: 'legacy-diner' });
    const member = await createUser({ platform_role: 'member' });
    await UserTenant.create({ user_id: member.id, tenant_id: tenant.id, role: 'staff' });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: member.email, password: 'password123' });

    const res = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(res.status).toBe(200);
  });

  it('allows platform admins everything', async () => {
    await Tenant.create({ name: 'Admin Diner', slug: 'admin-diner' });
    const admin = await createUser({ platform_role: 'platform_admin' });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'password123' });

    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ name: 'New Item', price: 100, weight_gm: 500 });

    expect(res.status).toBe(201);
  });

  it('does not leak account existence through /forgot-password', async () => {
    const existing = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'customer1@example.com' });
    const missing = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    expect(existing.body.message).toBe(missing.body.message);
  });

  it('provisions staff members into a tenant via /auth/staff', async () => {
    const tenant = await Tenant.create({ name: 'Test Cafe', slug: 'test-cafe' });
    const admin = await createUser({ platform_role: 'platform_admin' });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'password123' });

    const res = await request(app)
      .post('/api/auth/staff')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ name: 'Cashier One', email: 'cashier1@example.com', password: 'password123', tenantId: tenant.id, role: 'cashier' });

    expect(res.status).toBe(201);
    const membership = await UserTenant.findOne({ where: { user_id: res.body.user.id, tenant_id: tenant.id } });
    expect(membership.role).toBe('cashier');
  });

  it('cashier can place orders but cannot manage the menu', async () => {
    const cashierLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cashier1@example.com', password: 'password123' });
    const auth = { Authorization: `Bearer ${cashierLogin.body.accessToken}` };

    const menuRes = await request(app).post('/api/products').set(auth).send({ name: 'Hack', price: 1, weight_gm: 1 });
    expect(menuRes.status).toBe(403);

    // The cashier was provisioned into 'test-cafe' by the /auth/staff test;
    // give that workspace a product so the order can be placed.
    const cafe = await Tenant.findOne({ where: { slug: 'test-cafe' } });
    const product = await Product.create({
      tenant_id: cafe.id,
      name: 'Walk-in Burger',
      price: 150,
      weight_gm: 300,
      enabled: true,
    });

    const orderRes = await request(app).post('/api/orders').set(auth).send({
      customer_name: 'Walk-in',
      items: [{ product_id: product.id, quantity: 1 }],
    });
    expect(orderRes.status).toBe(201);
  });

  it('a customer-registered account granted a cashier membership gets its tenant role', async () => {
    // Register through the public /auth/register path (platform_role: customer),
    // then attach the account to a workspace as cashier — the membership role
    // must outrank the account-level customer role.
    const reg = await request(app).post('/api/auth/register').send({
      name: 'Invited Cashier',
      email: 'invited-cashier@example.com',
      password: 'password123',
    });
    expect(reg.status).toBe(201);
    const userId = reg.body.user.id;

    const cafe = await Tenant.findOne({ where: { slug: 'test-cafe' } });
    await UserTenant.create({ user_id: userId, tenant_id: cafe.id, role: 'cashier' });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'invited-cashier@example.com', password: 'password123' });
    const auth = { Authorization: `Bearer ${login.body.accessToken}`, 'X-Tenant': String(cafe.id) };

    // view:menu — can list products (was 403 before the effectiveRole fix).
    const listRes = await request(app).get('/api/products').set(auth);
    expect(listRes.status).toBe(200);

    // place:orders — can create an order in the workspace.
    const product = await Product.findOne({ where: { tenant_id: cafe.id, name: 'Walk-in Burger' } });
    const orderRes = await request(app).post('/api/orders').set(auth).send({
      customer_name: 'Invited Walk-in',
      items: [{ product_id: product.id, quantity: 1 }],
    });
    expect(orderRes.status).toBe(201);

    // manage:menu — still denied.
    const manageRes = await request(app).post('/api/products').set(auth).send({ name: 'Hack 2', price: 1, weight_gm: 1 });
    expect(manageRes.status).toBe(403);
  });
});
