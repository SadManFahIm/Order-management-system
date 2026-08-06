import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Plan from './Plan.js';
import Tenant from './Tenant.js';

/**
 * Feature flags: per-plan or per-tenant capability toggles.
 * NULL plan_id = global flag; NULL tenant_id = plan default.
 */
const FeatureFlag = sequelize.define('FeatureFlag', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(64), allowNull: false },
  plan_id: { type: DataTypes.INTEGER, allowNull: true },
  tenant_id: { type: DataTypes.INTEGER, allowNull: true },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
});

FeatureFlag.belongsTo(Plan, { foreignKey: 'plan_id' });
FeatureFlag.belongsTo(Tenant, { foreignKey: 'tenant_id' });

export default FeatureFlag;
