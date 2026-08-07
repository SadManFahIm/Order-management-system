import { DataTypes } from 'sequelize';

/**
 * 001 — Identity, auth & audit + tenants (without plan_id).
 *
 * Mirrors schema doc §4.1 / §4.2 / §4.8 (schema_migrations is created by the
 * runner itself). This is the portable scaffold DDL — it runs on SQLite (dev)
 * and PostgreSQL (V2 target). PG refinements (citext email, inet IPs, partial
 * unique indexes, IDENTITY keys, updated_at trigger) are applied by the
 * PG-tuned migration set; docs/03-database-schema.md §4 is the authoritative DDL.
 *
 * Known dialect quirk: Sequelize's SQLite createTable drops `DataTypes.NOW`
 * column defaults (created_at/updated_at get no DEFAULT on SQLite). On
 * PostgreSQL it emits `DEFAULT now()` correctly, and the app's models always
 * supply timestamps in JS — so raw SQL inserts on a migrated SQLite DB must
 * pass timestamps explicitly.
 */
const t = (transaction) => ({ transaction });

export const up = async (qi, transaction) => {
  await qi.createTable(
    'users',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      // v1 column was `password`; renamed here (schema doc §8.2 mapping).
      password_hash: { type: DataTypes.STRING(255), allowNull: false },
      platform_role: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'member',
      },
      email_verified_at: { type: DataTypes.DATE, allowNull: true },
      two_factor_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      two_factor_secret: { type: DataTypes.STRING(255), allowNull: true },
      locale: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'en' },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
      created_by: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
    },
    t(transaction)
  );

  await qi.createTable(
    'tenants',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      slug: { type: DataTypes.STRING(120), allowNull: false, unique: true },
      logo_url: { type: DataTypes.STRING(500), allowNull: true },
      status: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'active',
      },
      settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
      created_by: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
    },
    t(transaction)
  );

  await qi.createTable(
    'user_tenants',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      user_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      role: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'staff' },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { ...t(transaction), uniqueKeys: { uq_user_tenants_membership: { fields: ['user_id', 'tenant_id'] } } }
  );

  await qi.createTable(
    'refresh_tokens',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      // SHA-256 hex of the raw token — never store raw.
      token_hash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      family_id: { type: DataTypes.UUID, allowNull: false },
      user_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'tenants', key: 'id' },
      },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      revoked_at: { type: DataTypes.DATE, allowNull: true },
      replaced_by_token_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'refresh_tokens', key: 'id' },
      },
      created_by_ip: { type: DataTypes.STRING(45), allowNull: true },
      user_agent: { type: DataTypes.STRING(500), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { ...t(transaction), indexes: [{ fields: ['family_id'] }, { fields: ['user_id'] }] }
  );

  await qi.createTable(
    'auth_tokens',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      type: { type: DataTypes.STRING(32), allowNull: false },
      token_hash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      user_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      used_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    t(transaction)
  );

  await qi.createTable(
    'login_attempts',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      user_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      identifier: { type: DataTypes.STRING(255), allowNull: false },
      success: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      ip: { type: DataTypes.STRING(45), allowNull: true },
      user_agent: { type: DataTypes.STRING(500), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { ...t(transaction), indexes: [{ fields: ['identifier', 'created_at'] }] }
  );

  await qi.createTable(
    'audit_logs',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      actor_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'SET NULL',
      },
      action: { type: DataTypes.STRING(120), allowNull: false },
      entity_type: { type: DataTypes.STRING(80), allowNull: true },
      entity_id: { type: DataTypes.STRING(64), allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      ip: { type: DataTypes.STRING(45), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { ...t(transaction), indexes: [{ fields: ['tenant_id', 'created_at'] }, { fields: ['action', 'created_at'] }] }
  );
};

export const down = async (qi, transaction) => {
  for (const table of [
    'audit_logs',
    'login_attempts',
    'auth_tokens',
    'refresh_tokens',
    'user_tenants',
    'tenants',
    'users',
  ]) {
    await qi.dropTable(table, { transaction });
  }
};
