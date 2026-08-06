import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { generate } from 'otplib';
import app from '../app.js';
import sequelize from '../config/db.js';
import { User } from '../models/index.js';

let agent;

beforeAll(async () => {
  await sequelize.sync({ force: true });

  await User.create({
    name: '2FA User',
    email: '2fa@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });

  agent = request.agent(app);
  const login = await agent
    .post('/api/auth/login')
    .send({ email: '2fa@example.com', password: 'password123' });
  // The agent persists cookies; the access token must be attached manually.
  agent.set('Authorization', `Bearer ${login.body.accessToken}`);
});

afterAll(async () => {
  await sequelize.close();
});

describe('TOTP two-factor authentication', () => {
  it('setup returns a secret and QR code', async () => {
    const res = await agent.post('/api/auth/2fa/setup');
    expect(res.status).toBe(200);
    expect(res.body.secret).toBeTruthy();
    expect(res.body.otpauthUrl).toContain('otpauth://totp/');
    expect(res.body.qrDataUrl).toContain('data:image/png;base64,');
  });

  it('rejects confirming with an invalid code', async () => {
    const res = await agent.post('/api/auth/2fa/confirm').send({ code: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TWO_FACTOR_INVALID');
  });

  it('enables 2FA after confirming with a valid code', async () => {
    const setup = await agent.post('/api/auth/2fa/setup');
    const code = await generate({ secret: setup.body.secret });

    const res = await agent.post('/api/auth/2fa/confirm').send({ code });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('enabled');
  });

  it('requires a second step on login once 2FA is enabled', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: '2fa@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.requiresTwoFactor).toBe(true);
    expect(res.body.twoFactorToken).toBeTruthy();
    expect(res.body.accessToken).toBeUndefined();
  });

  it('completes login with a valid 2FA code', async () => {
    const user = await User.findOne({ where: { email: '2fa@example.com' } });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: '2fa@example.com', password: 'password123' });

    const res = await request(app)
      .post('/api/auth/2fa/verify-login')
      .send({
        twoFactorToken: login.body.twoFactorToken,
        code: await generate({ secret: user.two_factor_secret }),
      });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('rejects an invalid 2FA code', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: '2fa@example.com', password: 'password123' });

    const res = await request(app)
      .post('/api/auth/2fa/verify-login')
      .send({ twoFactorToken: login.body.twoFactorToken, code: '123456' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TWO_FACTOR_INVALID');
  });

  it('disables 2FA with a valid code', async () => {
    const user = await User.findOne({ where: { email: '2fa@example.com' } });

    const res = await agent.post('/api/auth/2fa/disable').send({
      code: await generate({ secret: user.two_factor_secret }),
    });
    expect(res.status).toBe(200);

    // Login no longer requires the second step.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: '2fa@example.com', password: 'password123' });
    expect(login.body.requiresTwoFactor).toBe(false);
    expect(login.body.accessToken).toBeTruthy();
  });
});
