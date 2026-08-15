import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant, RefreshToken } from '../models/index.js';
import { MAX_LOGIN_ATTEMPTS, validatePassword } from '../services/authService.js';
import { hasPermission } from '../config/roles.js';

/**
 * Phase 2 hardening — failed-login lockout, login audit trail, forced
 * password change, per-user RBAC flags, and the refund permission gate.
 */

let tenant;
let managerToken;
let cashierUser;
let otherUser;

const PASSWORD = 'Str0ngPass!42';
const NEW_PASSWORD = 'NewStr0ngPass!42';

beforeAll(async () => {
  await resetTestDb();

  tenant = await Tenant.create({ name: 'Auth Diner', slug: 'auth-diner' });

  const mkUser = async (name, email, role) => {
    const user = await User.create({
      name,
      email,
      password: await bcrypt.hash(PASSWORD, 10),
      platform_role: 'member',
    });
    await UserTenant.create({ user_id: user.id, tenant_id: tenant.id, role });
    return user;
  };

  await mkUser('Manager', 'authmanager@example.com', 'manager');
  cashierUser = await mkUser('Cashier', 'authcashier@example.com', 'cashier');
  otherUser = await mkUser('Other', 'authother@example.com', 'cashier');

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'authmanager@example.com', password: PASSWORD });
  managerToken = login.body.accessToken;
});

afterAll(async () => {
  await sequelize.close();
});

const loginAs = (email, password = PASSWORD) =>
  request(app).post('/api/auth/login').send({ email, password });

describe('failed-login lockout', () => {
  it('locks the account after repeated failures and reports retry-after', async () => {
    const user = await User.create({
      name: 'Locked User',
      email: 'locked@example.com',
      password: await bcrypt.hash(PASSWORD, 10),
      platform_role: 'member',
    });

    for (let i = 1; i <= MAX_LOGIN_ATTEMPTS; i += 1) {
      const res = await loginAs('locked@example.com', 'WrongPass1');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }

    // The 6th attempt is refused with the lock window.
    const locked = await loginAs('locked@example.com', 'WrongPass1');
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(locked.body.error.details.retryAfterSeconds).toBeGreaterThan(0);

    // Even the correct password is refused while locked.
    const correctWhileLocked = await loginAs('locked@example.com', PASSWORD);
    expect(correctWhileLocked.status).toBe(423);

    await user.update({ failed_login_attempts: 0, locked_until: null });
  });

  it('resets the counter on a successful login', async () => {
    const user = await User.create({
      name: 'Reset User',
      email: 'resetcount@example.com',
      password: await bcrypt.hash(PASSWORD, 10),
      platform_role: 'member',
    });

    // Three failures, then a success resets the counter.
    for (let i = 0; i < 3; i += 1) {
      await loginAs('resetcount@example.com', 'WrongPass1');
    }
    const ok = await loginAs('resetcount@example.com', PASSWORD);
    expect(ok.status).toBe(200);

    // Five fresh failures after the reset still only reach 401 (not locked
    // after the first five — the sixth locks).
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i += 1) {
      const res = await loginAs('resetcount@example.com', 'WrongPass1');
      expect(res.status).toBe(401);
    }
    const locked = await loginAs('resetcount@example.com', 'WrongPass1');
    expect(locked.status).toBe(423);

    await user.update({ failed_login_attempts: 0, locked_until: null });
  });

  it('never locks for unknown emails (nothing to lock)', async () => {
    for (let i = 0; i < 8; i += 1) {
      const res = await loginAs('ghost@example.com', 'WrongPass1');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }
  });
});

describe('password policy', () => {
  it('requires uppercase, lowercase and a digit', () => {
    expect(() => validatePassword('lowercase1')).toThrow(/uppercase/i);
    expect(() => validatePassword('UPPERCASE1')).toThrow(/lowercase/i);
    expect(() => validatePassword('NoDigitsHere')).toThrow(/number/i);
    expect(() => validatePassword('short1A')).toThrow(/8 and 128/);
    expect(() => validatePassword('Passw0rd')).not.toThrow();
    expect(() => validatePassword('Str0ngPass!42')).not.toThrow();
  });
});

describe('forced password change', () => {
  it('flags login with mustChangePassword and clears it after change', async () => {
    const user = await User.create({
      name: 'Forced User',
      email: 'forced@example.com',
      password: await bcrypt.hash(PASSWORD, 10),
      platform_role: 'member',
      must_change_password: true,
    });

    const login = await loginAs('forced@example.com', PASSWORD);
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(true);

    const token = login.body.accessToken;
    const cookie = login.headers['set-cookie'][0].split(';')[0];

    // Wrong current password is refused.
    const bad = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookie)
      .send({ currentPassword: 'NopeNope1', newPassword: NEW_PASSWORD });
    expect(bad.status).toBe(401);

    // Weak new password is refused by the policy.
    const weak = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookie)
      .send({ currentPassword: PASSWORD, newPassword: 'weakpass' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('WEAK_PASSWORD');

    // Valid change works and clears the flag.
    const change = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookie)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(change.status).toBe(200);

    await user.reload();
    expect(user.must_change_password).toBe(false);

    // The old password no longer works; the new one does — and the flag is gone.
    const oldLogin = await loginAs('forced@example.com', PASSWORD);
    expect(oldLogin.status).toBe(401);

    const newLogin = await loginAs('forced@example.com', NEW_PASSWORD);
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.mustChangePassword).toBe(false);
  });
});

describe('active session management', () => {
  it('signs out every other device but keeps the current one', async () => {
    const agentA = request.agent(app);
    const agentB = request.agent(app);
    const loginA = await agentA.post('/api/auth/login').send({ email: 'authother@example.com', password: PASSWORD });
    const loginB = await agentB.post('/api/auth/login').send({ email: 'authother@example.com', password: PASSWORD });
    const cookieA = loginA.headers['set-cookie'][0].split(';')[0];
    const cookieB = loginB.headers['set-cookie'][0].split(';')[0];

    const revoke = await agentA
      .post('/api/auth/sessions/revoke-others')
      .set('Authorization', `Bearer ${loginA.body.accessToken}`);
    expect(revoke.status).toBe(200);
    expect(revoke.body.count).toBeGreaterThanOrEqual(1);

    // Device B's refresh token is dead…
    const refreshB = await request(app).post('/api/auth/refresh').set('Cookie', cookieB);
    expect(refreshB.status).toBe(401);

    // …while device A (the caller) still works.
    const refreshA = await request(app).post('/api/auth/refresh').set('Cookie', cookieA);
    expect(refreshA.status).toBe(200);
  });
});

describe('login audit trail', () => {
  it('records logins, failures and lockouts for the user', async () => {
    const user = await User.create({
      name: 'Audit User',
      email: 'auditme@example.com',
      password: await bcrypt.hash(PASSWORD, 10),
      platform_role: 'member',
    });

    await loginAs('auditme@example.com', 'WrongPass1');
    const ok = await loginAs('auditme@example.com', PASSWORD);
    expect(ok.status).toBe(200);

    const res = await request(app)
      .get('/api/auth/audit')
      .set('Authorization', `Bearer ${ok.body.accessToken}`);
    expect(res.status).toBe(200);

    const actions = res.body.events.map((e) => e.action);
    expect(actions).toContain('auth.login');
    expect(actions).toContain('auth.login_failed');
    expect(res.body.events[0].createdAt).toBeTruthy();

    await user.update({ failed_login_attempts: 0, locked_until: null });
  });
});

describe('admin account controls (manager+)', () => {
  const auth = () => ({ Authorization: `Bearer ${managerToken}`, 'X-Tenant': String(tenant.id) });

  it('force-password-reset flags the member and kills their sessions', async () => {
    // Give the cashier a live session first.
    const login = await loginAs('authcashier@example.com', PASSWORD);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const before = await RefreshToken.count({
      where: { user_id: cashierUser.id, revoked_at: null },
    });
    expect(before).toBeGreaterThanOrEqual(1);

    const res = await request(app)
      .post(`/api/auth/users/${cashierUser.id}/force-password-reset`)
      .set(auth());
    expect(res.status).toBe(200);

    await cashierUser.reload();
    expect(cashierUser.must_change_password).toBe(true);

    const after = await RefreshToken.count({
      where: { user_id: cashierUser.id, revoked_at: null },
    });
    expect(after).toBe(0);

    // Their refresh cookie no longer rotates.
    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refresh.status).toBe(401);

    // And the next sign-in is forced through change-password.
    const relogin = await loginAs('authcashier@example.com', PASSWORD);
    expect(relogin.body.mustChangePassword).toBe(true);

    await cashierUser.update({ must_change_password: false });
  });

  it('unlocks a locked account', async () => {
    await cashierUser.update({ failed_login_attempts: 5, locked_until: new Date(Date.now() + 600000) });

    const res = await request(app)
      .post(`/api/auth/users/${cashierUser.id}/unlock`)
      .set(auth());
    expect(res.status).toBe(200);

    await cashierUser.reload();
    expect(cashierUser.failed_login_attempts).toBe(0);
    expect(cashierUser.locked_until).toBeNull();

    const ok = await loginAs('authcashier@example.com', PASSWORD);
    expect(ok.status).toBe(200);
  });

  it('sets per-user permission flags on a membership', async () => {
    const res = await request(app)
      .patch(`/api/auth/users/${otherUser.id}/permissions`)
      .set(auth())
      .send({ tenantId: tenant.id, permissions: ['refund:orders', '-view:reports'] });
    expect(res.status).toBe(200);
    expect(res.body.permissions).toEqual(['refund:orders', '-view:reports']);

    const membership = await UserTenant.findOne({
      where: { user_id: otherUser.id, tenant_id: tenant.id },
    });
    expect(membership.permissions).toEqual(['refund:orders', '-view:reports']);
  });

  it('rejects unknown permission flags and platform-admin targets', async () => {
    const bad = await request(app)
      .patch(`/api/auth/users/${otherUser.id}/permissions`)
      .set(auth())
      .send({ tenantId: tenant.id, permissions: ['bogus:perm'] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_PERMISSIONS');

    const admin = await User.create({
      name: 'Platform Admin',
      email: 'authadmin@example.com',
      password: await bcrypt.hash(PASSWORD, 10),
      platform_role: 'platform_admin',
    });
    const adminFlag = await request(app)
      .patch(`/api/auth/users/${admin.id}/permissions`)
      .set(auth())
      .send({ tenantId: tenant.id, permissions: ['refund:orders'] });
    expect(adminFlag.status).toBe(400);
  });

  it('a cashier cannot use admin controls (manage:users is manager+)', async () => {
    const cashierLogin = await loginAs('authcashier@example.com', PASSWORD);
    const res = await request(app)
      .post(`/api/auth/users/${otherUser.id}/force-password-reset`)
      .set('Authorization', `Bearer ${cashierLogin.body.accessToken}`)
      .set('X-Tenant', String(tenant.id));
    expect(res.status).toBe(403);
  });
});

describe('permission flags override the role matrix (hasPermission)', () => {
  const base = { platform_role: 'member', tenant_role: 'cashier' };

  it('grants a flag the role lacks', () => {
    expect(hasPermission({ ...base, permissions: ['refund:orders'] }, 'refund:orders')).toBe(true);
  });

  it('denies a negated flag the role would grant', () => {
    expect(hasPermission({ ...base, permissions: ['-view:orders'] }, 'view:orders')).toBe(false);
  });

  it('does not widen platform admins', () => {
    expect(hasPermission({ platform_role: 'platform_admin' }, 'refund:orders')).toBe(true);
    expect(
      hasPermission({ platform_role: 'platform_admin', permissions: ['-refund:orders'] }, 'refund:orders')
    ).toBe(true);
  });

  it('manager still holds refund:orders by role', () => {
    expect(hasPermission({ platform_role: 'member', tenant_role: 'manager' }, 'refund:orders')).toBe(true);
    expect(hasPermission({ platform_role: 'member', tenant_role: 'cashier' }, 'refund:orders')).toBe(false);
  });
});
