import sequelize from './db.js';
import { User, Tenant, UserTenant, Plan, Subscription } from '../models/index.js';

/**
 * Idempotent bootstrap data (runs on every boot):
 *  - ensure the subscription plans exist
 *  - ensure the default tenant exists (legacy data home)
 *  - give every user WITHOUT a membership access to the default tenant as
 *    legacy 'staff' (full-access wildcard role) so pre-Phase-3 accounts keep
 *    working after tenant scoping is enforced.
 *
 * Schema is managed exclusively by the migration runner
 * (`npm run db:migrate` / boot-time `migrateUp`) on both dialects — the old
 * `ensureSchemaColumns` bridge was removed when the models were aligned to
 * the migration DDL (they now define the same table/column names).
 */
const DEFAULT_TENANT = { name: 'Default Restaurant', slug: 'default-restaurant' };

export async function ensureBootstrapData() {
  const plans = [
    { name: 'Starter', code: 'starter', price_mo: 0 },
    { name: 'Growth', code: 'growth', price_mo: 1490 },
    { name: 'Pro', code: 'pro', price_mo: 3490 },
  ];
  for (const p of plans) {
    await Plan.findOrCreate({ where: { code: p.code }, defaults: p });
  }
  const starter = await Plan.findOne({ where: { code: 'starter' } });

  let tenant = await Tenant.findOne({ where: { slug: DEFAULT_TENANT.slug } });
  if (!tenant) {
    tenant = await Tenant.create({ ...DEFAULT_TENANT, plan_id: starter?.id ?? null });
    await createDefaultSubscription(tenant.id, starter?.id ?? null);
  } else if (starter && !tenant.plan_id) {
    await tenant.update({ plan_id: starter.id });
  }

  // Backfill legacy users: no memberships → default tenant as 'staff'.
  // Table names come from the models and are quoted — SQLite matches
  // identifiers case-insensitively, but PostgreSQL folds unquoted identifiers
  // to lowercase, so hardcoding 'Users'/'UserTenants' breaks on PG.
  const usersTable = User.getTableName();
  const membershipsTable = UserTenant.getTableName();
  const users = await sequelize.query(
    `SELECT id FROM "${usersTable}" u WHERE NOT EXISTS
       (SELECT 1 FROM "${membershipsTable}" ut WHERE ut.user_id = u.id)`,
    { type: 'SELECT' }
  );
  for (const { id } of users) {
    await UserTenant.findOrCreate({
      where: { user_id: id, tenant_id: tenant.id },
      defaults: { role: 'staff' },
    });
  }
  if (users.length > 0) {
    console.log(`[bootstrap] granted ${users.length} legacy user(s) default-workspace access`);
  }
}

async function createDefaultSubscription(tenantId, planId) {
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await Subscription.findOrCreate({
    where: { tenant_id: tenantId },
    defaults: {
      plan_id: planId,
      status: 'trialing',
      current_period_start: now,
      current_period_end: end,
    },
  });
}
