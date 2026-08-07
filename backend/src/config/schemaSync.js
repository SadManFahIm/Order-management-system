import { DataTypes } from 'sequelize';
import sequelize from './db.js';
import { User, Tenant, UserTenant, Plan, Subscription } from '../models/index.js';

/**
 * Lightweight, idempotent schema evolution for EXISTING tables.
 *
 * `sequelize.sync()` only creates missing tables — it never adds columns to
 * tables that already exist, and `sync({ alter: true })` is unsafe on SQLite
 * (it recreates tables in a loop and can corrupt data). Until the full
 * migration system ships with the PostgreSQL migration (Phase 1 follow-up),
 * new columns on pre-existing tables are declared here and added only when
 * missing.
 */
const TABLE_COLUMNS = {
  Users: [
    {
      name: 'platform_role',
      definition: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'member' },
    },
    {
      name: 'email_verified_at',
      definition: { type: DataTypes.DATE, allowNull: true },
    },
    {
      name: 'two_factor_enabled',
      definition: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      name: 'two_factor_secret',
      definition: { type: DataTypes.STRING(255), allowNull: true },
    },
  ],
  Tenants: [
    {
      name: 'logo_url',
      definition: { type: DataTypes.STRING(500), allowNull: true },
    },
    {
      name: 'plan_id',
      definition: { type: DataTypes.INTEGER, allowNull: true },
    },
  ],
  Products: [
    {
      name: 'tenant_id',
      definition: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    },
    {
      name: 'category_id',
      definition: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      name: 'prep_minutes',
      definition: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      name: 'image_url',
      definition: { type: DataTypes.STRING(500), allowNull: true },
    },
  ],
  Promotions: [
    {
      name: 'tenant_id',
      definition: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    },
  ],
  Orders: [
    {
      name: 'tenant_id',
      definition: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    },
  ],
  OrderItems: [
    {
      name: 'tenant_id',
      definition: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    },
  ],
};

export async function ensureSchemaColumns() {
  const qi = sequelize.getQueryInterface();

  for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
    let existing;
    try {
      existing = await qi.describeTable(table);
    } catch {
      // Table does not exist yet — sync() will create it with the full shape.
      continue;
    }

    for (const column of columns) {
      if (!existing[column.name]) {
        console.log(`[schema] adding column ${table}.${column.name}`);
        await qi.addColumn(table, column.name, column.definition);
      }
    }
  }
}

const DEFAULT_TENANT = { name: 'Default Restaurant', slug: 'default-restaurant' };

/**
 * Idempotent bootstrap data (runs on every boot):
 *  - ensure the subscription plans exist
 *  - ensure the default tenant exists (legacy data home)
 *  - give every user WITHOUT a membership access to the default tenant as
 *    legacy 'staff' (full-access wildcard role) so pre-Phase-3 accounts keep
 *    working after tenant scoping is enforced.
 */
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
