import { DataTypes } from 'sequelize';

/**
 * 002 — Tenancy & SaaS: plans, subscriptions, feature_flags, usage_counters,
 * and the forward `tenants.plan_id` FK (schema doc §4.2).
 *
 * `tenants` was created without plan_id in 001; this migration adds the column
 * now that `plans` exists, exactly as the schema doc prescribes.
 */
const t = (transaction) => ({ transaction });

export const up = async (qi, transaction) => {
  await qi.createTable(
    'plans',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      code: { type: DataTypes.STRING(32), allowNull: false, unique: true },
      price_mo: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    t(transaction)
  );

  await qi.createTable(
    'subscriptions',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      plan_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'plans', key: 'id' },
      },
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'trialing' },
      trial_ends_at: { type: DataTypes.DATE, allowNull: true },
      current_period_start: { type: DataTypes.DATE, allowNull: false },
      current_period_end: { type: DataTypes.DATE, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { ...t(transaction), indexes: [{ fields: ['tenant_id', 'status'] }] }
  );

  await qi.createTable(
    'feature_flags',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      name: { type: DataTypes.STRING(80), allowNull: false },
      // NULL plan_id = global flag; NULL tenant_id = plan default (schema doc).
      plan_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'plans', key: 'id' },
      },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'tenants', key: 'id' },
      },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    t(transaction)
  );

  await qi.createTable(
    'usage_counters',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      metric: { type: DataTypes.STRING(32), allowNull: false },
      period_start: { type: DataTypes.DATEONLY, allowNull: false },
      value: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    },
    { ...t(transaction), indexes: [{ fields: ['tenant_id', 'metric', 'period_start'], unique: true }] }
  );

  // tenants.plan_id — added now that plans exists (schema doc §4.2 note).
  await qi.addColumn(
    'tenants',
    'plan_id',
    {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: 'plans', key: 'id' },
    },
    t(transaction)
  );
  await qi.addIndex('tenants', ['plan_id'], { ...t(transaction), name: 'ix_tenants_plan' });
};

export const down = async (qi, transaction) => {
  await qi.removeColumn('tenants', 'plan_id', { transaction });
  for (const table of ['usage_counters', 'feature_flags', 'subscriptions', 'plans']) {
    await qi.dropTable(table, { transaction });
  }
};
