import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Tenant from './Tenant.js';

/**
 * Per-tenant SAML 2.0 IdP configuration (migration 018, enterprise SSO).
 * One optional row per workspace; `enabled` toggles the IdP-initiated and
 * SP-initiated flows without losing the config.
 */
const TenantSamlConfig = sequelize.define(
  'TenantSamlConfig',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenant_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    idp_entity_id: { type: DataTypes.STRING(255), allowNull: false },
    idp_sso_url: { type: DataTypes.STRING(500), allowNull: false },
    idp_slo_url: { type: DataTypes.STRING(500), allowNull: true },
    idp_cert: { type: DataTypes.TEXT, allowNull: false },
    attribute_email: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'nameid' },
    attribute_name: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'displayname' },
    default_role: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'cashier' },
  },
  {
    tableName: 'tenant_saml_configs',
    underscored: true,
  }
);

TenantSamlConfig.belongsTo(Tenant, { foreignKey: 'tenant_id' });

export default TenantSamlConfig;
