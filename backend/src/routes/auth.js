import express from 'express';
import bcrypt from 'bcryptjs';

import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { resolveTenant } from '../middleware/tenant.js';
import { authLimiter, apiLimiter } from '../middleware/rateLimiter.js';
import { AppError } from '../middleware/errorHandler.js';
import { audit } from '../services/auditService.js';
import * as authService from '../services/authService.js';
import { User, UserTenant, Tenant } from '../models/index.js';
import {
  loginSchema,
  registerSchema,
  verifyEmailSchema,
  twoFactorLoginSchema,
  twoFactorCodeSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  provisionStaffSchema,
} from '../validators/auth.js';

const router = express.Router();

/** POST /api/auth/register — create a customer account with email verification. */
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const result = await authService.register(registerSchema.parse(req.body), req);
    res.status(201).json(result);
  })
);

/** POST /api/auth/verify-email */
router.post(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const result = await authService.verifyEmail(verifyEmailSchema.parse(req.body).token, req);
    res.json(result);
  })
);

/** POST /api/auth/login — may require a second step when 2FA is enabled. */
router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const session = await authService.login(loginSchema.parse(req.body), req);
    if (session.requiresTwoFactor) {
      return res.json({
        requiresTwoFactor: true,
        twoFactorToken: session.twoFactorToken,
        user: session.user,
      });
    }
    authService.setRefreshCookie(res, session.refreshToken);
    res.json({
      accessToken: session.accessToken,
      user: session.user,
      requiresTwoFactor: false,
    });
  })
);

/** POST /api/auth/2fa/verify-login — complete a 2FA-protected login. */
router.post(
  '/2fa/verify-login',
  asyncHandler(async (req, res) => {
    const session = await authService.verifyLoginTwoFactor(twoFactorLoginSchema.parse(req.body), req);
    authService.setRefreshCookie(res, session.refreshToken);
    res.json({ accessToken: session.accessToken, user: session.user });
  })
);

/** POST /api/auth/refresh — rotate the refresh token, return a new access token. */
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const session = await authService.refreshSession(req.cookies?.[authService.REFRESH_COOKIE_NAME] || null, req);
    authService.setRefreshCookie(res, session.refreshToken);
    res.json({ accessToken: session.accessToken, user: session.user });
  })
);

/** POST /api/auth/logout — revoke the current refresh token. */
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await authService.logout(req.cookies?.[authService.REFRESH_COOKIE_NAME] || null, req);
    authService.clearRefreshCookie(res);
    res.json({ message: 'Logged out' });
  })
);

/** POST /api/auth/forgot-password — email a single-use reset link. */
router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const result = await authService.forgotPassword(forgotPasswordSchema.parse(req.body), req);
    res.json(result);
  })
);

/** POST /api/auth/reset-password — set a new password with a reset token. */
router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const result = await authService.resetPassword(resetPasswordSchema.parse(req.body), req);
    res.json(result);
  })
);

// ── Authenticated routes ───────────────────────────────────────────────────

/** GET /api/auth/me — current user with roles and tenant memberships. */
router.get(
  '/me',
  apiLimiter,
  authMiddleware,
  resolveTenant,
  asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.user.id);
    if (!user) throw new AppError(401, 'USER_NOT_FOUND', 'User no longer exists');
    const tenant = await authService.activeTenantFor(user.id);
    res.json({ user: authService.publicUser(user, tenant) });
  })
);

/** GET /api/auth/tenants — workspaces the user belongs to.
 * Platform admins see every workspace (marked with their global role).
 */
router.get(
  '/tenants',
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (req.user.platform_role === 'platform_admin') {
      const all = await Tenant.findAll({ order: [['id', 'ASC']] });
      return res.json(all.map((t) => slimTenant(t, 'platform_admin')));
    }
    const memberships = await UserTenant.findAll({
      where: { user_id: req.user.id },
      include: [{ model: Tenant }],
      order: [['id', 'ASC']],
    });
    res.json(
      memberships.map((m) => slimTenant(m.Tenant, m.role))
    );
  })
);

/** Slim tenant row for /api/auth/tenants — includes just enough for the
 * switcher + the WhatsApp-alert affordance, never the full settings. */
function slimTenant(t, role) {
  if (!t) return null;
  const wa = t.settings?.whatsapp;
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    role,
    // Whitelist only — the webhook secret never leaves the server here.
    whatsapp: wa ? { enabled: Boolean(wa.enabled), number: wa.number || null } : null,
  };
}

/** POST /api/auth/staff — provision a staff member into a tenant. */
router.post(
  '/staff',
  authMiddleware,
  requirePermission('manage:users'),
  asyncHandler(async (req, res) => {
    const { name, email, password, tenantId, role } = provisionStaffSchema.parse(req.body);

    const tenant = await Tenant.findByPk(tenantId);
    if (!tenant) throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant not found');

    const normalizedEmail = String(email).trim().toLowerCase();
    let user = await User.findOne({ where: { email: normalizedEmail } });
    if (!user) {
      const hashed = await bcrypt.hash(password, 10);
      user = await User.create({
        name,
        email: normalizedEmail,
        password: hashed,
        platform_role: 'member',
      });
    }

    const [, created] = await UserTenant.findOrCreate({
      where: { user_id: user.id, tenant_id: tenantId },
      defaults: { role },
    });
    if (!created) {
      await UserTenant.update({ role }, { where: { user_id: user.id, tenant_id: tenantId } });
    }

    await audit({ action: 'user.staff_provisioned', actorId: req.user.id, tenantId, entityType: 'User', entityId: user.id, req });
    res.status(201).json({ user: authService.publicUser(user), tenant: { id: tenant.id, name: tenant.name, role } });
  })
);

/** GET /api/auth/sessions — active sessions for the current user. */
router.get(
  '/sessions',
  authMiddleware,
  asyncHandler(async (req, res) => {
    res.json({ sessions: await authService.listSessions(req.user.id) });
  })
);

/** DELETE /api/auth/sessions/:id — revoke a specific session. */
router.delete(
  '/sessions/:id',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const result = await authService.revokeSession(req.user.id, Number(req.params.id));
    res.json(result);
  })
);

// ── TOTP two-factor authentication ─────────────────────────────────────────

/** POST /api/auth/2fa/setup — generate a TOTP secret + QR code. */
router.post(
  '/2fa/setup',
  authMiddleware,
  asyncHandler(async (req, res) => {
    res.json(await authService.setupTwoFactor(req.user.id));
  })
);

/** POST /api/auth/2fa/confirm — enable 2FA after verifying a code. */
router.post(
  '/2fa/confirm',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const result = await authService.confirmTwoFactor(req.user.id, twoFactorCodeSchema.parse(req.body).code, req);
    res.json(result);
  })
);

/** POST /api/auth/2fa/disable — disable 2FA after verifying a code. */
router.post(
  '/2fa/disable',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const result = await authService.disableTwoFactor(req.user.id, twoFactorCodeSchema.parse(req.body).code, req);
    res.json(result);
  })
);

export default router;
