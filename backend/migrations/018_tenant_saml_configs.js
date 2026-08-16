import { DataTypes } from 'sequelize';

/**
 * 018 — Per-tenant SAML SSO configuration (enterprise auth).
 *
 * One optional row per workspace: the IdP's entity ID, SSO endpoint,
 * signing certificate, the attributes that carry email/name in assertions,
 * and the role new SSO users land in. Nothing here is a secret to the IdP
 * operator — the certificate is public — but the row is still gated to
 * platform admins (and readable by owners) because it silently grants
 * workspace access to anyone who can authenticate at the IdP.
 */
const t = (transaction) => ({ transaction });

export const up = async (qi, transaction) => {
  await qi.createTable(
    'tenant_saml_configs',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        unique: true,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      idp_entity_id: { type: DataTypes.STRING(255), allowNull: false },
      idp_sso_url: { type: DataTypes.STRING(500), allowNull: false },
      idp_cert: { type: DataTypes.TEXT, allowNull: false },
      attribute_email: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'nameid' },
      attribute_name: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'displayname' },
      default_role: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'cashier' },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { ...t(transaction), indexes: [{ fields: ['tenant_id'] }] }
  );
};

export const down = async (qi, transaction) => {
  await qi.dropTable('tenant_saml_configs', { transaction });
};
