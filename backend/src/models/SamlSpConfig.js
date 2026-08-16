import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * The SP's own SAML identity (migration 019) — a singleton row (id = 1)
 * holding the service-provider entity ID and the signing key/certificate
 * pair used to sign LogoutRequests and advertised in the SP metadata.
 * Generated once at first use; the private key never leaves the server.
 */
const SamlSpConfig = sequelize.define(
  'SamlSpConfig',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
    entity_id: { type: DataTypes.STRING(255), allowNull: false },
    cert: { type: DataTypes.TEXT, allowNull: false },
    private_key: { type: DataTypes.TEXT, allowNull: false },
  },
  {
    tableName: 'saml_sp_config',
    underscored: true,
    timestamps: true,
  }
);

export default SamlSpConfig;
