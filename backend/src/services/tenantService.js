import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { AppError } from '../middleware/errorHandler.js';
import {
  User,
  Tenant,
  UserTenant,
  Plan,
  Subscription,
  TenantInvite,
  AuditLog,
} from '../models/index.js';
import { hasPermission } from '../config/roles.js';
import { audit } from './auditService.js';
import { publicUser, validatePassword } from './authService.js';
import { sendTestAlert } from './whatsappService.js';
import { assertQuota, notifyQuotaIfCrossed } from './planService.js';
import { getPlanForTenant, getPlanUsage } from './planService.js';
import TenantSamlConfig from '../models/TenantSamlConfig.js';

/** True if the user is a platform admin (bypasses membership checks). */
const isPlatformAdmin = (user) => user?.platform_role === 'platform_admin';

/**
 * Loads a tenant and asserts the acting user may operate on it.
 * - platform_admin: any tenant
 * - others: must be a member and hold `permission` in their tenant role
 */
export async function assertTenantAccess(user, tenantId, permission) {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new AppError(404, 'TENANT_NOT_FOUND', 'Workspace not found');

  if (isPlatformAdmin(user)) return { tenant, role: 'platform_admin' };

  const membership = await UserTenant.findOne({
    where: { user_id: user.id, tenant_id: tenantId },
  });
  if (!membership) throw new AppError(403, 'FORBIDDEN', 'You are not a member of this workspace');

  const effective = { ...user, tenant_role: membership.role };
  if (permission && !hasPermission(effective, permission)) {
    throw new AppError(403, 'FORBIDDEN', `Requires permission: ${permission}`);
  }
  return { tenant, role: membership.role };
}

export function serializeTenant(tenant) {
  const settings =
    tenant.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    logoUrl: tenant.logo_url,
    status: tenant.status,
    planId: tenant.plan_id,
    settings,
    brand: settings.brand || null,
  };
}

/** Workspaces the user belongs to (platform admin sees all). */
export async function listMyTenants(user, { includeAll = false } = {}) {
  if (isPlatformAdmin(user) && includeAll) {
    const tenants = await Tenant.findAll({ order: [['id', 'ASC']] });
    return tenants.map(serializeTenant);
  }
  const memberships = await UserTenant.findAll({
    where: { user_id: user.id },
    include: [{ model: Tenant }],
    order: [['id', 'ASC']],
  });
  return memberships.map((m) => ({
    ...serializeTenant(m.Tenant),
    role: m.role,
  }));
}

/** Create a workspace; creator becomes owner (platform_admin exempt). */
export async function createTenant(user, { name, slug, settings }, req) {
  const baseSlug =
    slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let finalSlug = baseSlug;
  let n = 2;
  while (await Tenant.findOne({ where: { slug: finalSlug } })) {
    finalSlug = `${baseSlug}-${n++}`;
  }

  const starter = await Plan.findOne({ where: { code: 'starter' } });
  const tenant = await Tenant.create({
    name,
    slug: finalSlug,
    settings: settings || {},
    plan_id: starter?.id ?? null,
  });

  const now = new Date();
  const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await Subscription.findOrCreate({
    where: { tenant_id: tenant.id },
    defaults: {
      plan_id: starter?.id ?? null,
      status: 'trialing',
      trial_ends_at: end,
      current_period_start: now,
      current_period_end: end,
    },
  });

  // Creator gets owner membership (unless they're the platform admin who owns
  // everything already — still useful for testing/ownership).
  await UserTenant.findOrCreate({
    where: { user_id: user.id, tenant_id: tenant.id },
    defaults: { role: 'owner' },
  });

  await audit({
    action: 'tenant.created',
    actorId: user.id,
    tenantId: tenant.id,
    entityType: 'Tenant',
    entityId: tenant.id,
    metadata: { name, slug: finalSlug },
    req,
  });

  return serializeTenant(tenant);
}

/** Update workspace name / logo / settings. */
export async function updateTenant(user, tenantId, fields, req) {
  const { tenant } = await assertTenantAccess(user, tenantId, 'manage:settings');
  const allowed = {};
  if (fields.name !== undefined) allowed.name = fields.name;
  if (fields.logoUrl !== undefined) allowed.logo_url = fields.logoUrl;
  if (fields.settings !== undefined) allowed.settings = fields.settings;
  if (fields.brand !== undefined) {
    // Merge the brand theme into settings (never clobber the rest of it).
    const current =
      tenant.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
    allowed.settings = { ...current, brand: fields.brand };
  }
  if (fields.whatsapp !== undefined) {
    // WhatsApp alerts config lives in settings too — merge like brand.
    const current =
      tenant.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
    allowed.settings = { ...current, whatsapp: fields.whatsapp };
  }
  if (fields.paymentMethods !== undefined) {
    // Accepted payment methods (cash/bKash/Nagad/card) — merge like brand.
    const current =
      tenant.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
    allowed.settings = { ...current, paymentMethods: fields.paymentMethods };
  }
  if (fields.reports !== undefined) {
    // Daily closeout email config — merge like brand/whatsapp.
    const current =
      tenant.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
    allowed.settings = { ...current, reports: fields.reports };
  }
  if (fields.vat !== undefined) {
    // VAT defaults — merge like brand/whatsapp.
    const current =
      tenant.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
    allowed.settings = { ...current, vat: fields.vat };
  }
  if (fields.timezone !== undefined) {
    // Wall-clock availability resolution — merge like brand/whatsapp.
    const current =
      tenant.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
    allowed.settings = { ...current, timezone: fields.timezone };
  }
  if (fields.delivery !== undefined) {
    // Delivery fee/enabled (Phase 6) — merge like brand/whatsapp.
    const current =
      tenant.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
    allowed.settings = { ...current, delivery: fields.delivery };
  }
  await tenant.update(allowed);
  await audit({
    action: 'tenant.updated',
    actorId: user.id,
    tenantId: tenant.id,
    entityType: 'Tenant',
    entityId: tenant.id,
    req,
  });
  return serializeTenant(tenant);
}

/** Send a test WhatsApp alert to the workspace's configured webhook. */
export async function sendWhatsAppTest(user, tenantId, req) {
  const { tenant } = await assertTenantAccess(user, tenantId, 'manage:settings');
  const result = await sendTestAlert(tenant);
  await audit({
    action: 'tenant.whatsapp_test_sent',
    actorId: user.id,
    tenantId: tenant.id,
    entityType: 'Tenant',
    entityId: tenant.id,
    req,
  });
  return result;
}

/** Platform-admin only: activate / suspend / archive a workspace. */
export async function setTenantStatus(user, tenantId, status, req) {
  if (!isPlatformAdmin(user)) {
    throw new AppError(403, 'FORBIDDEN', 'Only platform administrators can change workspace status');
  }
  if (!['active', 'trial', 'suspended', 'archived'].includes(status)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid status');
  }
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new AppError(404, 'TENANT_NOT_FOUND', 'Workspace not found');
  await tenant.update({ status });
  await audit({
    action: 'tenant.status_changed',
    actorId: user.id,
    tenantId: tenant.id,
    entityType: 'Tenant',
    entityId: tenant.id,
    metadata: { status },
    req,
  });
  return serializeTenant(tenant);
}

/** List workspace members (join users + roles). */
export async function listMembers(user, tenantId) {
  const { tenant } = await assertTenantAccess(user, tenantId, 'manage:members');
  const memberships = await UserTenant.findAll({
    where: { tenant_id: tenant.id },
    include: [
      {
        model: User,
        attributes: [
          'id',
          'name',
          'email',
          'platform_role',
          'failed_login_attempts',
          'locked_until',
          'must_change_password',
        ],
      },
    ],
    order: [['id', 'ASC']],
  });
  return memberships.map((m) => {
    const locked = m.User?.locked_until && new Date(m.User.locked_until).getTime() > Date.now();
    return {
      id: m.id,
      userId: m.user_id,
      name: m.User?.name,
      email: m.User?.email,
      role: m.role,
      // Per-user RBAC flags (migration 016) — [] when none set.
      permissions: Array.isArray(m.permissions) ? m.permissions : [],
      // Account-state flags for the Team & access panel.
      locked: Boolean(locked),
      lockedUntil: locked ? m.User.locked_until : null,
      mustChangePassword: Boolean(m.User?.must_change_password),
      platformRole: m.User?.platform_role || 'member',
    };
  });
}

/** Invite a member by email (creates the user if needed) or update their role. */
export async function addMember(user, tenantId, { email, name, password, role }, req) {
  const { tenant } = await assertTenantAccess(user, tenantId, 'manage:members');
  if (!['owner', 'manager', 'cashier', 'kitchen', 'delivery', 'staff'].includes(role)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid role');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  let member = await User.findOne({ where: { email: normalizedEmail } });
  if (!member) {
    if (!password) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A temporary password is required for new members');
    }
    const hashed = await bcrypt.hash(password, 10);
    member = await User.create({
      name: name || normalizedEmail.split('@')[0],
      email: normalizedEmail,
      password: hashed,
      platform_role: 'member',
    });
  }

  // Plan quota gate (Phase 3) — team size is limited per plan. Only new
  // memberships consume quota; a role change on an existing member doesn't.
  const existing = await UserTenant.findOne({
    where: { user_id: member.id, tenant_id: tenant.id },
  });
  if (existing) {
    await existing.update({ role });
    await audit({
      action: 'tenant.member_updated',
      actorId: user.id,
      tenantId: tenant.id,
      entityType: 'User',
      entityId: member.id,
      metadata: { role },
      req,
    });
    return {
      id: existing.id,
      userId: member.id,
      name: member.name,
      email: member.email,
      role: existing.role,
    };
  }

  await assertQuota(tenant.id, 'members', { adding: 1 });
  const membership = await UserTenant.create({
    user_id: member.id,
    tenant_id: tenant.id,
    role,
  });
  void notifyQuotaIfCrossed(tenant.id);

  await audit({
    action: 'tenant.member_added',
    actorId: user.id,
    tenantId: tenant.id,
    entityType: 'User',
    entityId: member.id,
    metadata: { role },
    req,
  });

  return {
    id: membership.id,
    userId: member.id,
    name: member.name,
    email: member.email,
    role: membership.role,
  };
}

/** Remove a member from a workspace. */
export async function removeMember(user, tenantId, userId, req) {
  const { tenant } = await assertTenantAccess(user, tenantId, 'manage:members');
  const membership = await UserTenant.findOne({
    where: { user_id: userId, tenant_id: tenant.id },
  });
  if (!membership) throw new AppError(404, 'MEMBER_NOT_FOUND', 'Member not found');
  await membership.destroy();
  await audit({
    action: 'tenant.member_removed',
    actorId: user.id,
    tenantId: tenant.id,
    entityType: 'User',
    entityId: userId,
    req,
  });
  return { message: 'Member removed' };
}

// ── Phase 3: invites, ownership, audit, plans ──────────────────────────────

/** Default invite lifetime, in days. */
export const INVITE_DEFAULT_DAYS = 7;
export const INVITE_MAX_DAYS = 30;

const sha256 = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function inviteStatus(invite) {
  if (invite.accepted_at) return 'accepted';
  if (invite.revoked_at) return 'revoked';
  if (new Date(invite.expires_at).getTime() < Date.now()) return 'expired';
  return 'pending';
}

export function serializeInvite(invite) {
  return {
    id: invite.id,
    tenantId: invite.tenant_id,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expires_at,
    acceptedAt: invite.accepted_at ?? null,
    invitedBy: invite.invited_by ?? null,
    invitedByName: invite.inviter?.name ?? null,
    status: inviteStatus(invite),
    createdAt: invite.created_at,
  };
}

/** Create an expiring invite; returns the raw token exactly once (for the link). */
export async function createInvite(user, tenantId, { email, role, days }, req) {
  const { tenant } = await assertTenantAccess(user, tenantId, 'manage:members');
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!normalizedEmail.includes('@')) {
    throw new AppError(400, 'VALIDATION_ERROR', 'A valid email is required');
  }
  if (!['owner', 'manager', 'cashier', 'kitchen', 'delivery', 'staff'].includes(role)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid role');
  }

  // One invite per pending email — a duplicate is a no-op with its own link.
  const existing = await TenantInvite.findOne({
    where: {
      tenant_id: tenant.id,
      email: normalizedEmail,
      accepted_at: null,
      revoked_at: null,
    },
  });
  if (existing) {
    throw new AppError(409, 'INVITE_EXISTS', 'A pending invite already exists for this email');
  }

  // Plan quota gate (Phase 3): an accepted invite adds a member, so pending
  // invites count toward the team limit too.
  await assertQuota(tenant.id, 'members', { adding: 1 });

  const token = crypto.randomBytes(32).toString('hex');
  const inviteDays = Number.isInteger(days) ? Math.min(Math.max(days, 1), INVITE_MAX_DAYS) : INVITE_DEFAULT_DAYS;
  const invite = await TenantInvite.create({
    tenant_id: tenant.id,
    email: normalizedEmail,
    role,
    token_hash: sha256(token),
    invited_by: user.id,
    expires_at: new Date(Date.now() + inviteDays * 24 * 60 * 60 * 1000),
  });

  await audit({
    action: 'tenant.invite_created',
    actorId: user.id,
    tenantId: tenant.id,
    entityType: 'User',
    entityId: user.id,
    metadata: { email: normalizedEmail, role, expiresInDays: inviteDays },
    req,
  });

  return { ...serializeInvite(invite), token };
}

/** List invites for a workspace (any status), newest first. */
export async function listInvites(user, tenantId) {
  const { tenant } = await assertTenantAccess(user, tenantId, 'manage:members');
  const invites = await TenantInvite.findAll({
    where: { tenant_id: tenant.id },
    include: [{ model: User, as: 'inviter', attributes: ['id', 'name', 'email'] }],
    order: [['id', 'DESC']],
  });
  return invites.map(serializeInvite);
}

/** Revoke a pending invite (no-op once accepted). */
export async function revokeInvite(user, tenantId, inviteId, req) {
  const { tenant } = await assertTenantAccess(user, tenantId, 'manage:members');
  const invite = await TenantInvite.findOne({
    where: { id: inviteId, tenant_id: tenant.id },
  });
  if (!invite) throw new AppError(404, 'INVITE_NOT_FOUND', 'Invite not found');
  if (invite.accepted_at) {
    throw new AppError(409, 'INVITE_ACCEPTED', 'This invite has already been accepted');
  }
  invite.revoked_at = new Date();
  await invite.save();
  await audit({
    action: 'tenant.invite_revoked',
    actorId: user.id,
    tenantId: tenant.id,
    entityType: 'User',
    entityId: user.id,
    metadata: { email: invite.email, role: invite.role },
    req,
  });
  return serializeInvite(invite);
}

/**
 * Public-safe preview for an invite link: only the email, role, tenant name
 * and expiry — never the token or any internal ids the invitee doesn't need.
 */
export async function getInviteInfo(token) {
  if (!token || typeof token !== 'string' || token.length < 32) {
    throw new AppError(400, 'INVALID_INVITE', 'Invite link is invalid');
  }
  const invite = await TenantInvite.findOne({ where: { token_hash: sha256(token.trim()) } });
  if (!invite) throw new AppError(404, 'INVITE_NOT_FOUND', 'Invite not found');
  if (invite.revoked_at) throw new AppError(410, 'INVITE_REVOKED', 'This invite was revoked');
  if (invite.accepted_at) throw new AppError(409, 'INVITE_ACCEPTED', 'This invite was already used');
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    throw new AppError(410, 'INVITE_EXPIRED', 'This invite has expired');
  }
  const tenant = await Tenant.findByPk(invite.tenant_id);
  if (!tenant) throw new AppError(404, 'TENANT_NOT_FOUND', 'Workspace not found');
  return {
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expires_at,
    tenant: { name: tenant.name, slug: tenant.slug },
  };
}

/**
 * Accept an invite. When `user` is provided (logged-in) their email must
 * match the invite; otherwise a new account is created with `name`/`password`.
 * Idempotent for the same invitee: a second accept returns the membership.
 */
export async function acceptInvite({ token, user = null, name, password }, req) {
  if (!token || typeof token !== 'string' || token.length < 32) {
    throw new AppError(400, 'INVALID_INVITE', 'Invite link is invalid');
  }
  const invite = await TenantInvite.findOne({ where: { token_hash: sha256(token.trim()) } });
  if (!invite) throw new AppError(404, 'INVITE_NOT_FOUND', 'Invite not found');

  if (invite.revoked_at) throw new AppError(410, 'INVITE_REVOKED', 'This invite was revoked');
  if (invite.accepted_at) throw new AppError(409, 'INVITE_ACCEPTED', 'This invite was already used');
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    throw new AppError(410, 'INVITE_EXPIRED', 'This invite has expired');
  }

  // Quota is checked again at accept-time: the plan may have changed since
  // the invite was created, or other members may have joined in between.
  await assertQuota(invite.tenant_id, 'members', { adding: 1 });

  const tenant = await Tenant.findByPk(invite.tenant_id);
  if (!tenant) throw new AppError(404, 'TENANT_NOT_FOUND', 'Workspace not found');

  let member = user ? await User.findByPk(user.id) : null;
  if (user && !member) throw new AppError(401, 'UNAUTHORIZED', 'Account not found');
  if (user && String(member.email).toLowerCase() !== String(invite.email).toLowerCase()) {
    throw new AppError(403, 'INVITE_EMAIL_MISMATCH', 'This invite is for a different email address');
  }

  if (!member) {
    // validatePassword throws AppError (400 WEAK_PASSWORD) on failure.
    validatePassword(password || '');
    member = await User.create({
      name: name || invite.email.split('@')[0],
      email: invite.email,
      password: await bcrypt.hash(password, 10),
      platform_role: 'member',
    });
  }

  const [membership] = await UserTenant.findOrCreate({
    where: { user_id: member.id, tenant_id: tenant.id },
    defaults: { role: invite.role },
  });
  if (membership.role !== invite.role && !user) {
    membership.role = invite.role;
    await membership.save();
  }

  invite.accepted_at = new Date();
  await invite.save();
  void notifyQuotaIfCrossed(tenant.id);

  await audit({
    action: 'tenant.invite_accepted',
    actorId: member.id,
    tenantId: tenant.id,
    entityType: 'User',
    entityId: member.id,
    metadata: { email: invite.email, role: membership.role },
    req,
  });

  return {
    tenant: serializeTenant(tenant),
    role: membership.role,
    user: publicUser(member),
  };
}

/** Transfer workspace ownership to another member (owner or platform admin). */
export async function transferOwnership(user, tenantId, targetUserId, req) {
  const { tenant, role } = await assertTenantAccess(user, tenantId);
  if (role !== 'owner' && !isPlatformAdmin(user)) {
    throw new AppError(403, 'FORBIDDEN', 'Only the workspace owner can transfer ownership');
  }

  const target = await UserTenant.findOne({
    where: { user_id: targetUserId, tenant_id: tenant.id },
  });
  if (!target) throw new AppError(404, 'MEMBER_NOT_FOUND', 'Target member not found');
  if (target.role === 'owner') {
    throw new AppError(409, 'ALREADY_OWNER', 'That member is already the owner');
  }

  // The current owner (unless acting as platform admin) steps down to manager.
  const current = await UserTenant.findOne({
    where: { user_id: user.id, tenant_id: tenant.id, role: 'owner' },
  });
  if (current) {
    current.role = 'manager';
    await current.save();
  }

  target.role = 'owner';
  await target.save();

  await audit({
    action: 'tenant.ownership_transferred',
    actorId: user.id,
    tenantId: tenant.id,
    entityType: 'User',
    entityId: targetUserId,
    metadata: { fromUserId: current?.user_id ?? user.id, toUserId: targetUserId },
    req,
  });

  return {
    message: 'Ownership transferred',
    newOwner: { userId: targetUserId, role: 'owner' },
  };
}

/** Tenant-scoped audit trail (who changed what in this workspace). */
export async function listTenantAudit(user, tenantId, { limit = 50, offset = 0, action } = {}) {
  const { tenant } = await assertTenantAccess(user, tenantId, 'manage:settings');
  const where = { tenant_id: tenant.id };
  if (action && typeof action === 'string') where.action = action;

  const { rows, count } = await AuditLog.findAndCountAll({
    where,
    include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'email'] }],
    order: [['id', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
    offset: Math.max(Number(offset) || 0, 0),
  });

  return {
    total: count,
    events: rows.map((e) => ({
      id: e.id,
      action: e.action,
      entityType: e.entity_type,
      entityId: e.entity_id,
      metadata: e.metadata,
      ip: e.ip,
      createdAt: e.created_at,
      actor: e.actor
        ? { id: e.actor.id, name: e.actor.name, email: e.actor.email }
        : null,
    })),
  };
}

/**
 * Set the workspace's SAML SSO config (owner or platform admin).
 * The certificate is the trust anchor for ACS verification.
 */
export async function setSamlConfig(user, tenantId, body, req) {
  const { tenant, role } = await assertTenantAccess(user, tenantId);
  if (role !== 'owner' && !isPlatformAdmin(user)) {
    throw new AppError(403, 'FORBIDDEN', 'Only the workspace owner can configure SSO');
  }

  const [config] = await TenantSamlConfig.findOrCreate({
    where: { tenant_id: tenant.id },
    defaults: {
      tenant_id: tenant.id,
      enabled: body.enabled,
      idp_entity_id: body.idpEntityId,
      idp_sso_url: body.idpSsoUrl,
      idp_slo_url: body.idpSloUrl || null,
      idp_cert: body.idpCert,
      attribute_email: body.attributeEmail,
      attribute_name: body.attributeName,
      default_role: body.defaultRole,
    },
  });
  await config.update({
    enabled: body.enabled,
    idp_entity_id: body.idpEntityId,
    idp_sso_url: body.idpSsoUrl,
    idp_slo_url: body.idpSloUrl || null,
    idp_cert: body.idpCert,
    attribute_email: body.attributeEmail,
    attribute_name: body.attributeName,
    default_role: body.defaultRole,
  });

  await audit({
    action: 'tenant.saml_configured',
    actorId: user.id,
    tenantId: tenant.id,
    entityType: 'Tenant',
    entityId: tenant.id,
    metadata: { enabled: body.enabled, idpEntityId: body.idpEntityId, defaultRole: body.defaultRole },
    req,
  });
  return config;
}

/** Change a workspace's plan (platform admin only). */
export async function changeTenantPlan(user, tenantId, planCode, req) {
  if (!isPlatformAdmin(user)) {
    throw new AppError(403, 'FORBIDDEN', 'Only platform administrators can change plans');
  }
  const plan = await Plan.findOne({ where: { code: planCode, is_active: true } });
  if (!plan) throw new AppError(404, 'PLAN_NOT_FOUND', 'Plan not found');

  const { tenant, subscription } = await getPlanForTenant(tenantId);
  const fromCode = tenant.plan?.code ?? null;
  tenant.plan_id = plan.id;
  await tenant.save();

  const now = new Date();
  if (subscription) {
    await subscription.update({
      plan_id: plan.id,
      status: subscription.status === 'trialing' ? 'trialing' : 'active',
      current_period_end: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
  } else {
    await Subscription.create({
      tenant_id: tenant.id,
      plan_id: plan.id,
      status: 'active',
      current_period_start: now,
      current_period_end: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
  }

  await audit({
    action: 'tenant.plan_changed',
    actorId: user.id,
    tenantId: tenant.id,
    entityType: 'Tenant',
    entityId: tenant.id,
    metadata: { from: fromCode, to: plan.code },
    req,
  });

  return getPlanUsageShape(tenant.id);
}

function getPlanUsageShape(tenantId) {
  return getPlanUsage(tenantId);
}

export { publicUser };
