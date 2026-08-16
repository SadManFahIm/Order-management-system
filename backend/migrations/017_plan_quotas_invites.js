import { DataTypes, QueryTypes } from 'sequelize';

/**
 * 017 — Plan quotas & tenant invites (Phase 3 hardening).
 *
 * Adds enforceable quota columns to `plans` (products, orders/day, members,
 * storage), creates the `tenant_invites` table (token-based invites with
 * expiry, replacing the old "create user with a temp password" flow), seeds
 * the SaaS plan catalogue, and backfills tenants whose plan_id was NULL onto
 * the free plan so quota enforcement always has limits to work with.
 */
const t = (transaction) => ({ transaction });

const PLAN_SEEDS = [
  // code, name, price_mo, max_products, max_orders_per_day, max_members, storage_mb
  ['free', 'Free', 0, 20, 50, 2, 100],
  ['starter', 'Starter', 12, 100, 300, 5, 500],
  ['pro', 'Pro', 29, 500, 1000, 15, 2000],
  ['growth', 'Growth', 79, 2000, 5000, 50, 10000],
];

export const up = async (qi, transaction) => {
  // 1. Quota columns on plans.
  await qi.addColumn(
    'plans',
    'max_products',
    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 20 },
    t(transaction)
  );
  await qi.addColumn(
    'plans',
    'max_orders_per_day',
    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50 },
    t(transaction)
  );
  await qi.addColumn(
    'plans',
    'max_members',
    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 2 },
    t(transaction)
  );
  await qi.addColumn(
    'plans',
    'storage_mb',
    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
    t(transaction)
  );

  // 2. Tenant invites — token_hash is the SHA-256 of the raw invite token
  //    (the token itself is only ever returned once, at creation time).
  await qi.createTable(
    'tenant_invites',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      email: { type: DataTypes.STRING(254), allowNull: false },
      role: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'cashier' },
      token_hash: { type: DataTypes.STRING(64), allowNull: false },
      invited_by: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      accepted_at: { type: DataTypes.DATE, allowNull: true },
      revoked_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      ...t(transaction),
      indexes: [
        { fields: ['tenant_id'] },
        { fields: ['token_hash'], unique: true },
        { fields: ['email', 'tenant_id'] },
      ],
    }
  );

  // 3. Seed the plan catalogue (idempotent — INSERT ... SELECT WHERE NOT
  //    EXISTS works on both SQLite and PostgreSQL). created_at is supplied
  //    explicitly because older databases created plans without a column
  //    default; CURRENT_TIMESTAMP is valid on both dialects.
  for (const [code, name, priceMo, maxProducts, maxOrders, maxMembers, storageMb] of PLAN_SEEDS) {
    await qi.sequelize.query(
      `INSERT INTO plans
         (name, code, price_mo, max_products, max_orders_per_day, max_members, storage_mb, created_at)
       SELECT :name, :code, :priceMo, :maxProducts, :maxOrders, :maxMembers, :storageMb, CURRENT_TIMESTAMP
       WHERE NOT EXISTS (SELECT 1 FROM plans WHERE code = :code)`,
      {
        replacements: { name, code, priceMo, maxProducts, maxOrders, maxMembers, storageMb },
        type: QueryTypes.INSERT,
        transaction,
      }
    );
    // Self-heal existing rows (pre-017 plans carry the column defaults).
    await qi.sequelize.query(
      `UPDATE plans
       SET max_products = :maxProducts, max_orders_per_day = :maxOrders,
           max_members = :maxMembers, storage_mb = :storageMb
       WHERE code = :code`,
      {
        replacements: { code, maxProducts, maxOrders, maxMembers, storageMb },
        type: QueryTypes.UPDATE,
        transaction,
      }
    );
  }

  // 4. Backfill tenants without a plan onto Free so quota checks always have
  //    limits (pre-existing workspaces keep full data, just gain the quota).
  await qi.sequelize.query(
    `UPDATE tenants
     SET plan_id = (SELECT id FROM plans WHERE code = 'free')
     WHERE plan_id IS NULL`,
    { type: QueryTypes.UPDATE, transaction }
  );
};

export const down = async (qi, transaction) => {
  await qi.dropTable('tenant_invites', { transaction });
  for (const column of ['max_products', 'max_orders_per_day', 'max_members', 'storage_mb']) {
    await qi.removeColumn('plans', column, { transaction });
  }
};
