import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { generateSecret, verify, generateURI } from 'otplib';
import QRCode from 'qrcode';

import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  User,
  RefreshToken,
  AuthToken,
  UserTenant,
  Tenant,
} from '../models/index.js';
import { audit } from './auditService.js';
import { sendEmail } from './notifications/email.js';

// Precomputed bcrypt hash used when an account does not exist so login timing
// does not reveal whether an email is registered (timing-based enumeration).
const DUMMY_PASSWORD_HASH = '$2a$10$RRKPx6ammuFaDceeFdeChu2aqLAiNhVERRXpzAMM48lwz4wYCk/K.';

export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

async function issueSession(user, req) {
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

/** Password policy: 8–128 chars with at least one letter and one digit. */
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new AppError(
      400,
      'WEAK_PASSWORD',
      'Password must be between 8 and 128 characters'
    );
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new AppError(
      400,
      'WEAK_PASSWORD',
      'Password must contain at least one letter and one number'
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

export async function login({ email, password }, req) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await User.findOne({ where: { email: normalizedEmail } });

  // Always compare (dummy hash for missing accounts) to prevent timing leaks.
  const ok = await bcrypt.compare(password, user ? user.password : DUMMY_PASSWORD_HASH);
  if (!user || !ok) {
    await audit({ action: 'auth.login_failed', actorId: user?.id || null, entityType: 'User', entityId: user?.id, metadata: { email: normalizedEmail }, req });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }

  await audit({ action: 'auth.login', actorId: user.id, entityType: 'User', entityId: user.id, req });

  if (user.two_factor_enabled) {
    const twoFactorToken = jwt.sign({ id: user.id, purpose: '2fa' }, env.JWT_SECRET, {
      expiresIn: '5m',
    });
    return { requiresTwoFactor: true, twoFactorToken, user: publicUser(user) };
  }

  const session = await issueSession(user, req);
  return { requiresTwoFactor: false, ...session };
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

  await audit({ action: 'auth.2fa_verified', actorId: user.id, entityType: 'User', entityId: user.id, req });
  const session = await issueSession(user, req);
  return session;
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
    order: [['createdAt', 'DESC']],
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
  return { message: 'Session revoked' };
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
