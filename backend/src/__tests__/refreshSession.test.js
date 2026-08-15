import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User } from '../models/index.js';

let agent;

beforeAll(async () => {
  await resetTestDb();

  await User.create({
    name: 'Session User',
    email: 'session@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });

  agent = request.agent(app);
  await agent.post('/api/auth/login').send({
    email: 'session@example.com',
    password: 'password123',
  });
});

afterAll(async () => {
  await sequelize.close();
});

describe('refresh token rotation', () => {
  it('issues a new access token and rotates the refresh cookie', async () => {
    const before = agent.jar?.getCookieString?.('') || '';
    const res = await agent.post('/api/auth/refresh');
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.headers['set-cookie']).toBeDefined();

    // The old cookie must no longer work (rotation invalidates it).
    const oldRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', before);
    expect(oldRes.status).toBe(401);
  });

  it('detects reuse of a rotated refresh token and revokes the whole family', async () => {
    // Capture the current cookie, rotate once, then replay the stale cookie.
    const loginAgent = request.agent(app);
    const login = await loginAgent
      .post('/api/auth/login')
      .send({ email: 'session@example.com', password: 'password123' });
    expect(login.status).toBe(200);

    const staleCookie = login.headers['set-cookie'][0].split(';')[0];

    const rotated = await loginAgent.post('/api/auth/refresh');
    expect(rotated.status).toBe(200);
    const newCookie = rotated.headers['set-cookie'][0].split(';')[0];

    // Replaying the stale (now revoked) token must fail…
    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', staleCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('SESSION_REVOKED');

    // …and the freshly rotated token of the same family must be revoked too.
    const afterReplay = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', newCookie);
    expect(afterReplay.status).toBe(401);
  });

  it('logs out and invalidates the session', async () => {
    const agent2 = request.agent(app);
    const login = await agent2
      .post('/api/auth/login')
      .send({ email: 'session@example.com', password: 'password123' });
    const cookie = login.headers['set-cookie'][0].split(';')[0];

    const logout = await agent2.post('/api/auth/logout');
    expect(logout.status).toBe(200);

    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refresh.status).toBe(401);
  });
});

describe('session management', () => {
  it('lists active sessions and revokes one', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'session@example.com', password: 'password123' });
    const token = login.body.accessToken;
    const cookie = login.headers['set-cookie'][0].split(';')[0];

    const list = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.sessions.length).toBeGreaterThanOrEqual(1);

    const sessionId = list.body.sessions[0].id;
    const revoke = await request(app)
      .delete(`/api/auth/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(revoke.status).toBe(200);

    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refresh.status).toBe(401);
  });
});

describe('password reset', () => {
  it('resets the password with a single-use token and revokes sessions', async () => {
    await User.create({
      name: 'Reset User',
      email: 'reset@example.com',
      password: await bcrypt.hash('oldpassword123', 10),
      platform_role: 'member',
    });

    // Sign in and capture the refresh cookie.
    const loginAgent = request.agent(app);
    const login = await loginAgent
      .post('/api/auth/login')
      .send({ email: 'reset@example.com', password: 'oldpassword123' });
    expect(login.status).toBe(200);

    // Request a reset.
    const forgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'reset@example.com' });
    expect(forgot.status).toBe(200);
    expect(forgot.body.devToken).toBeTruthy();

    // Reset with the token.
    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: forgot.body.devToken, password: 'Newpassword456' });
    expect(reset.status).toBe(200);

    // Old password fails; new password works.
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset@example.com', password: 'oldpassword123' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset@example.com', password: 'Newpassword456' });
    expect(newLogin.status).toBe(200);

    // Sessions issued before the reset are revoked.
    const staleRefresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', login.headers['set-cookie'][0].split(';')[0]);
    expect(staleRefresh.status).toBe(401);
  });
});
