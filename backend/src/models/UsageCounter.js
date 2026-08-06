import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Tenant from './Tenant.js';

/** Usage counters for plan-limit enforcement (orders, menu items, seats). */
const UsageCounter = sequelize.define(
  'UsageCounter',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenant_id: { type: DataTypes.INTEGER, allowNull: false },
    metric: { type: DataTypes.STRING(32), allowNull: false },
    period_start: { type: DataTypes.DATEONLY, allowNull: false },
    value: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
  },
  {
    indexes: [{ unique: true, fields: ['tenant_id', 'metric', 'period_start'] }],
  }
);

UsageCounter.belongsTo(Tenant, { foreignKey: 'tenant_id' });

export default UsageCounter;
