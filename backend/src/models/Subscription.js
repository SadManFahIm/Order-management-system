import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Tenant from './Tenant.js';
import Plan from './Plan.js';

/** A tenant's current subscription (period + cycle). */
const Subscription = sequelize.define('Subscription', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  tenant_id: { type: DataTypes.INTEGER, allowNull: false },
  plan_id: { type: DataTypes.INTEGER, allowNull: false },
  status: {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: 'trialing',
  },
  trial_ends_at: { type: DataTypes.DATE, allowNull: true },
  current_period_start: { type: DataTypes.DATE, allowNull: false },
  current_period_end: { type: DataTypes.DATE, allowNull: false },
});

Subscription.belongsTo(Tenant, { foreignKey: 'tenant_id' });
Subscription.belongsTo(Plan, { foreignKey: 'plan_id' });

export default Subscription;
