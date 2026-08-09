import bcrypt from 'bcryptjs';
import { AppError } from '../middleware/errorHandler.js';
import {
  User,
  Tenant,
  UserTenant,
  Plan,
  Subscription,
} from '../models/index.js';
import { hasPermission } from '../config/roles.js';
import { audit } from './auditService.js';
import { publicUser } from './authService.js';
import { sendTestAlert } from './whatsappService.js';

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
    include: [{ model: User, attributes: ['id', 'name', 'email'] }],
    order: [['id', 'ASC']],
  });
  return memberships.map((m) => ({
    id: m.id,
    userId: m.user_id,
    name: m.User?.name,
    email: m.User?.email,
    role: m.role,
  }));
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

  const [membership, created] = await UserTenant.findOrCreate({
    where: { user_id: member.id, tenant_id: tenant.id },
    defaults: { role },
  });
  if (!created) {
    await membership.update({ role });
  }

  await audit({
    action: created ? 'tenant.member_added' : 'tenant.member_updated',
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

export { publicUser };
