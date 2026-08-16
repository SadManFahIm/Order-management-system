import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Op } from 'sequelize';
import { generateSecret, verify, generateURI } from 'otplib';
import QRCode from 'qrcode';

import { env } from '../config/env.js';
import { isPermissionFlag } from '../config/roles.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  User,
  RefreshToken,
  AuthToken,
  UserTenant,
  Tenant,
} from '../models/index.js';
import AuditLog from '../models/AuditLog.js';
import { audit } from './auditService.js';
import { sendEmail } from './notifications/email.js';

// Precomputed bcrypt hash used when an account does not exist so login timing
// does not reveal whether an email is registered (timing-based enumeration).
const DUMMY_PASSWORD_HASH = '$2a$10$RRKPx6ammuFaDceeFdeChu2aqLAiNhVERRXpzAMM48lwz4wYCk/K.';

export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Brute-force lockout policy (Phase 2): after MAX_LOGIN_ATTEMPTS failed
// password tries the account locks for LOCKOUT_MS; the counter resets on a
// successful login or an admin unlock.
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

export const refreshCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
  path: '/',
  maxAge: REFRESH_TOKEN_TTL_MS,
};

export const REFRESH_COOKIE_NAME = 'refresh_token';

// ── Token helpers ──────────────────────────────────────────────────────────

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const generateRawToken = () => randomBytes(48).toString('hex');

export function publicUser(user, tenant = null) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    platformRole: user.platform_role,
    emailVerified: Boolean(user.email_verified_at),
    twoFactorEnabled: user.two_factor_enabled,
    // `tenant` here is a UserTenant membership row (id = membership id);
    // the workspace id lives on `tenant_id`.
    tenantId: tenant ? tenant.tenant_id : null,
    tenantRole: tenant ? tenant.role : null,
  };
}

export async function activeTenantFor(userId) {
  return UserTenant.findOne({
    where: { user_id: userId },
    include: [{ model: Tenant }],
    order: [['id', 'ASC']],
  });
}

// ── Session / token issuance ───────────────────────────────────────────────

async function createRefreshToken(user, req) {
  const raw = generateRawToken();
  await RefreshToken.create({
    token_hash: sha256(raw),
    family_id: randomUUID(),
    user_id: user.id,
    expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    created_by_ip: req?.ip || null,
    user_agent: req?.headers?.['user-agent']?.slice(0, 255) || null,
  });
  return raw;
}

export async function issueSession(user, req) {
  const tenant = await activeTenantFor(user.id);
  const accessToken = jwt.sign(
    {
      id: user.id,
      email: user.email,
      platform_role: user.platform_role,
      tenant_id: tenant ? tenant.tenant_id : null,
      tenant_role: tenant ? tenant.role : null,
    },
    env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
  const refreshToken = await createRefreshToken(user, req);
  return { accessToken, refreshToken, user: publicUser(user, tenant) };
}

function setRefreshCookie(res, rawToken) {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, refreshCookieOptions);
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions, maxAge: 0 });
}

// ── Registration & verification ────────────────────────────────────────────

/**
 * Password policy (Phase 2 hardening): 8–128 chars, and at least one
 * uppercase letter, one lowercase letter and one digit. A moderate bar —
 * enough to reject the obvious weak passwords without punishing real users.
 */
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new AppError(
      400,
      'WEAK_PASSWORD',
      'Password must be between 8 and 128 characters'
    );
  }
  const checks = [
    [/[A-Z]/, 'an uppercase letter'],
    [/[a-z]/, 'a lowercase letter'],
    [/\d/, 'a number'],
  ];
  const missing = checks.filter(([re]) => !re.test(password)).map(([, label]) => label);
  if (missing.length) {
    throw new AppError(
      400,
      'WEAK_PASSWORD',
      `Password must contain ${missing.join(', ')}`
    );
  }
}

async function createAuthToken(userId, type, ttlMs) {
  const raw = generateRawToken();
  await AuthToken.create({
    type,
    token_hash: sha256(raw),
    user_id: userId,
    expires_at: new Date(Date.now() + ttlMs),
  });
  return raw;
}

async function consumeAuthToken(raw, type) {
  const record = await AuthToken.findOne({ where: { token_hash: sha256(raw), type } });
  if (!record) throw new AppError(400, 'INVALID_TOKEN', 'Invalid or unknown token');
  if (record.used_at) throw new AppError(400, 'TOKEN_USED', 'Token has already been used');
  if (record.expires_at < new Date()) throw new AppError(400, 'TOKEN_EXPIRED', 'Token has expired');
  await record.update({ used_at: new Date() });
  return record.user_id;
}

export async function register({ name, email, password }, req) {
  validatePassword(password);
  const normalizedEmail = String(email).trim().toLowerCase();

  const existing = await User.findOne({ where: { email: normalizedEmail } });
  if (existing) {
    throw new AppError(409, 'EMAIL_IN_USE', 'An account with this email already exists');
  }

  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    email: normalizedEmail,
    password: hashed,
    platform_role: 'customer',
  });

  const rawToken = await createAuthToken(user.id, 'email_verification', 24 * 60 * 60 * 1000);
  const verificationUrl = `${env.APP_BASE_URL}/verify-email?token=${rawToken}`;
  await sendEmail({
    to: user.email,
    subject: 'Verify your email',
    html: `<p>Welcome! Confirm your email: <a href="${verificationUrl}">${verificationUrl}</a></p>`,
  });

  await audit({ action: 'user.registered', actorId: user.id, entityType: 'User', entityId: user.id, req });
  return {
    user: publicUser(user),
    // Development convenience: expose the token so flows are usable without a
    // real email provider. Never returned in production.
    devToken: env.NODE_ENV === 'production' ? undefined : rawToken,
  };
}

export async function verifyEmail(raw, req) {
  const userId = await consumeAuthToken(raw, 'email_verification');
  await User.update({ email_verified_at: new Date() }, { where: { id: userId } });
  await audit({ action: 'user.email_verified', actorId: userId, entityType: 'User', entityId: userId, req });
  return { message: 'Email verified' };
}

// ── Login ──────────────────────────────────────────────────────────────────

/**
 * Records a failed password attempt. Locks the account once the threshold
 * is hit. Only existing accounts can lock (nothing to lock for unknown
 * emails). Never throws — auditing must not break the login response.
 */
async function recordFailedLogin(user, req) {
  if (!user) return;
  const attempts = Number(user.failed_login_attempts || 0) + 1;
  const willLock = attempts >= MAX_LOGIN_ATTEMPTS;
  await user.update({
    failed_login_attempts: attempts,
    locked_until: willLock ? new Date(Date.now() + LOCKOUT_MS) : user.locked_until,
  });
  await audit({
    action: willLock ? 'auth.account_locked' : 'auth.login_failed',
    actorId: user.id,
    entityType: 'User',
    entityId: user.id,
    metadata: { email: user.email, attempts },
    req,
  });
}

/** Returns seconds remaining in a lock, or null when not locked. */
export function lockoutRemainingSeconds(user) {
  if (!user?.locked_until) return null;
  const remaining = new Date(user.locked_until).getTime() - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : null;
}

export async function login({ email, password }, req) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await User.findOne({ where: { email: normalizedEmail } });

  // Locked accounts are refused before any password work (timing-safe).
  const lockedSeconds = lockoutRemainingSeconds(user);
  if (lockedSeconds !== null) {
    throw new AppError(
      423,
      'ACCOUNT_LOCKED',
      'Too many failed attempts. Try again later.',
      { retryAfterSeconds: lockedSeconds }
    );
  }

  // Always compare (dummy hash for missing accounts) to prevent timing leaks.
  const ok = await bcrypt.compare(password, user ? user.password : DUMMY_PASSWORD_HASH);
  if (!user || !ok) {
    await recordFailedLogin(user, req);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }

  // Success clears the failure counter.
  if (user.failed_login_attempts || user.locked_until) {
    await user.update({ failed_login_attempts: 0, locked_until: null });
  }
  await audit({ action: 'auth.login', actorId: user.id, entityType: 'User', entityId: user.id, req });

  if (user.two_factor_enabled) {
    const twoFactorToken = jwt.sign({ id: user.id, purpose: '2fa' }, env.JWT_SECRET, {
      expiresIn: '5m',
    });
    return { requiresTwoFactor: true, twoFactorToken, user: publicUser(user) };
  }

  const session = await issueSession(user, req);
  return {
    requiresTwoFactor: false,
    mustChangePassword: Boolean(user.must_change_password),
    ...session,
  };
}

export async function verifyLoginTwoFactor({ twoFactorToken, code }, req) {
  let payload;
  try {
    payload = jwt.verify(twoFactorToken, env.JWT_SECRET);
  } catch {
    throw new AppError(401, 'TWO_FACTOR_TOKEN_INVALID', 'Two-factor session expired, please sign in again');
  }
  if (payload.purpose !== '2fa') {
    throw new AppError(401, 'TWO_FACTOR_TOKEN_INVALID', 'Invalid two-factor token');
  }

  const user = await User.findByPk(payload.id);
  if (!user || !user.two_factor_enabled || !user.two_factor_secret) {
    throw new AppError(401, 'TWO_FACTOR_INVALID', 'Two-factor authentication is not enabled');
  }

  const result = await verify({ token: code, secret: user.two_factor_secret });
  if (!result.valid) {
    await audit({ action: 'auth.2fa_failed', actorId: user.id, entityType: 'User', entityId: user.id, req });
    throw new AppError(401, 'TWO_FACTOR_INVALID', 'Invalid two-factor code');
  }

  // Success clears the failure counter.
  if (user.failed_login_attempts || user.locked_until) {
    await user.update({ failed_login_attempts: 0, locked_until: null });
  }
  await audit({ action: 'auth.2fa_verified', actorId: user.id, entityType: 'User', entityId: user.id, req });
  const session = await issueSession(user, req);
  return { ...session, mustChangePassword: Boolean(user.must_change_password) };
}

// ── Refresh rotation & logout ──────────────────────────────────────────────

export async function refreshSession(rawToken, req) {
  if (!rawToken) throw new AppError(401, 'NO_REFRESH_TOKEN', 'Missing refresh token');

  const record = await RefreshToken.findOne({ where: { token_hash: sha256(rawToken) } });
  if (!record) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');

  if (record.revoked_at) {
    // Reuse of a rotated/revoked token is a theft signal: revoke the family.
    await RefreshToken.update(
      { revoked_at: new Date() },
      { where: { family_id: record.family_id, revoked_at: null } }
    );
    await audit({
      action: 'auth.refresh_reuse_detected',
      actorId: record.user_id,
      entityType: 'RefreshToken',
      entityId: record.id,
      req,
    });
    throw new AppError(401, 'SESSION_REVOKED', 'Session has been revoked');
  }

  if (record.expires_at < new Date()) {
    await record.update({ revoked_at: new Date() });
    throw new AppError(401, 'SESSION_EXPIRED', 'Session has expired');
  }

  const user = await User.findByPk(record.user_id);
  if (!user) throw new AppError(401, 'USER_NOT_FOUND', 'User no longer exists');

  // Rotate: revoke the current token and issue a new one in the same family.
  await record.update({ revoked_at: new Date() });

  const raw = generateRawToken();
  const next = await RefreshToken.create({
    token_hash: sha256(raw),
    family_id: record.family_id,
    user_id: user.id,
    expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    created_by_ip: req?.ip || null,
    user_agent: req?.headers?.['user-agent']?.slice(0, 255) || null,
  });
  await record.update({ replaced_by_token_id: next.id });

  const tenant = await activeTenantFor(user.id);
  const accessToken = jwt.sign(
    {
      id: user.id,
      email: user.email,
      platform_role: user.platform_role,
      tenant_id: tenant ? tenant.tenant_id : null,
      tenant_role: tenant ? tenant.role : null,
    },
    env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );

  await audit({ action: 'auth.refresh', actorId: user.id, entityType: 'RefreshToken', entityId: next.id, req });
  return { accessToken, refreshToken: raw, user: publicUser(user, tenant) };
}

export async function logout(rawToken, req) {
  if (!rawToken) return;
  const record = await RefreshToken.findOne({ where: { token_hash: sha256(rawToken) } });
  if (record && !record.revoked_at) {
    await record.update({ revoked_at: new Date() });
    await audit({ action: 'auth.logout', actorId: record.user_id, entityType: 'RefreshToken', entityId: record.id, req });
  }
}

// ── Session management ─────────────────────────────────────────────────────

export async function listSessions(userId) {
  const rows = await RefreshToken.findAll({
    where: { user_id: userId, revoked_at: null },
    // Order by the physical column (custom-named timestamp attrs are emitted
    // as the attribute name in ORDER BY, which breaks the mapped column).
    order: [['created_at', 'DESC']],
    limit: 20,
  });
  return rows
    .filter((r) => r.expires_at > new Date())
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      expiresAt: r.expires_at,
      ip: r.created_by_ip,
      userAgent: r.user_agent,
      current: !r.replaced_by_token_id && r.expires_at > new Date(),
    }));
}

export async function revokeSession(userId, sessionId) {
  const record = await RefreshToken.findOne({
    where: { id: sessionId, user_id: userId, revoked_at: null },
  });
  if (!record) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found');
  await record.update({ revoked_at: new Date() });
  await audit({
    action: 'auth.session_revoked',
    actorId: userId,
    entityType: 'RefreshToken',
    entityId: record.id,
    req: null,
  });
  return { message: 'Session revoked' };
}

/**
 * Signs out every device except the caller's current one (the refresh-token
 * family in the cookie). Used by the "Sign out other devices" button.
 */
export async function revokeOtherSessions(req) {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!rawToken) throw new AppError(401, 'NO_REFRESH_TOKEN', 'Missing refresh token');
  const current = await RefreshToken.findOne({ where: { token_hash: sha256(rawToken) } });
  if (!current) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');

  // Model.update resolves to [affectedCount, rows] — take the count.
  const [affected] = await RefreshToken.update(
    { revoked_at: new Date() },
    {
      where: {
        user_id: req.user.id,
        revoked_at: null,
        family_id: { [Op.ne]: current.family_id },
      },
    }
  );
  await audit({
    action: 'auth.sessions_revoked_others',
    actorId: req.user.id,
    entityType: 'User',
    entityId: req.user.id,
    metadata: { count: affected },
    req,
  });
  return { message: 'Other sessions signed out', count: affected };
}

// ── Password reset ─────────────────────────────────────────────────────────

export async function forgotPassword({ email }, req) {
  const user = await User.findOne({ where: { email: String(email).trim().toLowerCase() } });
  // Always produce the same response to avoid revealing account existence.
  if (!user) return { message: 'If that email exists, a reset link has been sent.' };

  const raw = await createAuthToken(user.id, 'password_reset', 60 * 60 * 1000);
  const resetUrl = `${env.APP_BASE_URL}/reset-password?token=${raw}`;
  await sendEmail({
    to: user.email,
    subject: 'Reset your password',
    html: `<p>Reset your password: <a href="${resetUrl}">${resetUrl}</a></p>`,
  });

  await audit({ action: 'auth.password_reset_requested', actorId: user.id, entityType: 'User', entityId: user.id, req });
  return {
    message: 'If that email exists, a reset link has been sent.',
    devToken: env.NODE_ENV === 'production' ? undefined : raw,
  };
}

export async function resetPassword({ token, password }, req) {
  validatePassword(password);
  const userId = await consumeAuthToken(token, 'password_reset');
  const hashed = await bcrypt.hash(password, 10);
  await User.update({ password: hashed }, { where: { id: userId } });

  // Invalidate every existing session after a password change.
  await RefreshToken.update({ revoked_at: new Date() }, { where: { user_id: userId, revoked_at: null } });

  await audit({ action: 'auth.password_reset', actorId: userId, entityType: 'User', entityId: userId, req });
  return { message: 'Password has been reset. Please sign in.' };
}

/**
 * Authenticated password change (Settings → Security). Verifies the current
 * password, enforces the policy, then revokes every session except the
 * current device's family (the one that just changed it).
 */
export async function changePassword({ currentPassword, newPassword }, req) {
  const user = await User.findByPk(req.user.id);
  if (!user) throw new AppError(401, 'USER_NOT_FOUND', 'User no longer exists');

  const ok = await bcrypt.compare(currentPassword, user.password);
  if (!ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');

  validatePassword(newPassword);

  const hashed = await bcrypt.hash(newPassword, 10);
  await user.update({ password: hashed, must_change_password: false });

  // Revoke all sessions except the current family.
  const where = { user_id: user.id, revoked_at: null };
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (rawToken) {
    const current = await RefreshToken.findOne({ where: { token_hash: sha256(rawToken) } });
    if (current) where.family_id = { [Op.ne]: current.family_id };
  }
  await RefreshToken.update({ revoked_at: new Date() }, { where });

  await audit({
    action: 'auth.password_changed',
    actorId: user.id,
    entityType: 'User',
    entityId: user.id,
    metadata: { sessionCount: 1 },
    req,
  });
  return { message: 'Password updated' };
}

/**
 * Admin force password reset: flags the target account so its next sign-in
 * is forced through the change-password flow, and kills all of its sessions.
 */
export async function forcePasswordReset(actorUser, targetUserId, req) {
  const user = await User.findByPk(targetUserId);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  if (user.platform_role === 'platform_admin' && actorUser.id !== user.id) {
    throw new AppError(403, 'FORBIDDEN', 'Platform admins cannot be reset by other users');
  }
  await user.update({ must_change_password: true });
  await RefreshToken.update(
    { revoked_at: new Date() },
    { where: { user_id: user.id, revoked_at: null } }
  );
  await audit({
    action: 'user.password_force_reset',
    actorId: actorUser.id,
    entityType: 'User',
    entityId: user.id,
    req,
  });
  return { message: 'Password reset requested. The member must set a new password on next sign-in.' };
}

/** Admin unlock: clears the failed-attempt counter and lock window. */
export async function unlockAccount(actorUser, targetUserId, req) {
  const user = await User.findByPk(targetUserId);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  await user.update({ failed_login_attempts: 0, locked_until: null });
  await audit({
    action: 'auth.account_unlocked',
    actorId: actorUser.id,
    entityType: 'User',
    entityId: user.id,
    req,
  });
  return { message: 'Account unlocked' };
}

/**
 * Sets per-user permission flags for a workspace membership — the RBAC
 * "flagging" layer on top of the role matrix (e.g. ['refund:orders'] or
 * ['-manage:menu']). Validates every flag against the catalogue.
 */
export async function setMemberPermissions(actorUser, tenantId, targetUserId, permissions, req) {
  const target = await User.findByPk(targetUserId);
  if (target?.platform_role === 'platform_admin') {
    throw new AppError(400, 'INVALID_PERMISSIONS', 'Platform admins already have full access');
  }

  const membership = await UserTenant.findOne({
    where: { user_id: targetUserId, tenant_id: tenantId },
  });
  if (!membership) {
    throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'User is not a member of this workspace');
  }

  const flags = Array.isArray(permissions) ? permissions : [];
  if (!flags.every(isPermissionFlag)) {
    throw new AppError(400, 'INVALID_PERMISSIONS', 'Invalid permission flags');
  }

  await membership.update({ permissions: flags.length ? flags : null });
  await audit({
    action: 'user.permissions_updated',
    actorId: actorUser.id,
    tenantId,
    entityType: 'UserTenant',
    entityId: membership.id,
    metadata: { permissions: flags },
    req,
  });
  return { permissions: flags };
}

/**
 * Recent security events for the current user (the login audit trail):
 * logins, failures, lockouts, logouts, refreshes, password changes and
 * 2FA activity.
 */
export async function listAuthAudit(userId, limit = 25) {
  const rows = await AuditLog.findAll({
    where: {
      actor_id: userId,
      action: {
        [Op.or]: [
          { [Op.like]: 'auth.%' },
          { [Op.like]: 'user.password%' },
          { [Op.like]: 'user.two_factor%' },
        ],
      },
    },
    order: [['created_at', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 25, 1), 100),
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    createdAt: r.created_at,
    ip: r.ip,
    metadata: r.metadata || {},
  }));
}

// ── TOTP two-factor authentication ─────────────────────────────────────────

export async function setupTwoFactor(userId) {
  const user = await User.findByPk(userId);
  if (user.two_factor_enabled) {
    throw new AppError(400, 'TWO_FACTOR_ENABLED', 'Two-factor authentication is already enabled');
  }
  const secret = generateSecret();
  const otpauthUrl = generateURI({
    issuer: 'Order Management System',
    label: user.email,
    secret,
  });

  // Store as "pending" until a valid code confirms it (confirmTwoFactor).
  await user.update({ two_factor_secret: secret });

  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
  return { secret, otpauthUrl, qrDataUrl };
}

export async function confirmTwoFactor(userId, code, req) {
  const user = await User.findByPk(userId);
  if (!user.two_factor_secret) {
    throw new AppError(400, 'TWO_FACTOR_NOT_SETUP', 'Run 2FA setup first');
  }
  const result = await verify({ token: code, secret: user.two_factor_secret });
  if (!result.valid) {
    throw new AppError(400, 'TWO_FACTOR_INVALID', 'Invalid two-factor code');
  }
  await user.update({ two_factor_enabled: true });
  await audit({ action: 'user.two_factor_enabled', actorId: userId, entityType: 'User', entityId: userId, req });
  return { message: 'Two-factor authentication enabled' };
}

export async function disableTwoFactor(userId, code, req) {
  const user = await User.findByPk(userId);
  if (!user.two_factor_secret || !user.two_factor_enabled) {
    throw new AppError(400, 'TWO_FACTOR_NOT_ENABLED', 'Two-factor authentication is not enabled');
  }
  const result = await verify({ token: code, secret: user.two_factor_secret });
  if (!result.valid) {
    throw new AppError(400, 'TWO_FACTOR_INVALID', 'Invalid two-factor code');
  }
  await user.update({ two_factor_enabled: false, two_factor_secret: null });
  await audit({ action: 'user.two_factor_disabled', actorId: userId, entityType: 'User', entityId: userId, req });
  return { message: 'Two-factor authentication disabled' };
}

export { sha256, DUMMY_PASSWORD_HASH, setRefreshCookie };
