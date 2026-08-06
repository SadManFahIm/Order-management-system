import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { User, Tenant, UserTenant } from '../models/index.js';

beforeAll(async () => {
  await sequelize.sync({ force: true });
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

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows legacy member accounts full access (backward compatibility)', async () => {
    const member = await createUser({ platform_role: 'member' });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: member.email, password: 'password123' });

    const res = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(res.status).toBe(200);
  });

  it('allows platform admins everything', async () => {
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

    const orderRes = await request(app).post('/api/orders').set(auth).send({
      customer_name: 'Walk-in',
      items: [{ product_id: 1, quantity: 1 }],
    });
    expect(orderRes.status).toBe(201);
  });
});
