import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import User from '../models/User.js';

beforeAll(async () => {
  await resetTestDb();
});

afterAll(async () => {
  await sequelize.close();
});

describe('POST /api/auth/login', () => {
  it('returns a token for valid credentials', async () => {
    await User.create({
      name: 'Admin',
      email: 'admin@example.com',
      password: await bcrypt.hash('supersecret1', 10),
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'supersecret1' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.headers['set-cookie']).toBeDefined(); // refresh token cookie
    expect(res.body.user.email).toBe('admin@example.com');
  });

  it('rejects invalid credentials with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects malformed payloads with 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/auth/me', () => {
  it('returns the current user for a valid token', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'supersecret1' });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('admin@example.com');
  });

  it('rejects missing tokens with 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('security regressions', () => {
  it('the unauthenticated seed-admin endpoint no longer exists', async () => {
    const res = await request(app)
      .post('/api/auth/seed-admin')
      .send({ name: 'Hacker', email: 'hacker@example.com', password: 'hacked' });

    expect(res.status).toBe(404);
  });

  it('protected routes reject requests without a token', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(401);
  });

  it('unknown routes return the 404 envelope', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
