import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Tenant from './Tenant.js';

/**
 * Physical table in a workspace (QR table menu, Phase 5 starter).
 *
 * Table `tables` (migration 006): one row per tenant + table number
 * (unique index). `table_no` is what the storefront URL carries
 * (`/m/:slug?table=N`) and what QR codes encode. Hard delete — removing a
 * table removes it from the floor entirely.
 */
const Table = sequelize.define(
  'Table',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      index: true,
    },
    table_no: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: true },
    capacity: { type: DataTypes.INTEGER, allowNull: true },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  {
    tableName: 'tables',
    underscored: true,
    indexes: [{ fields: ['tenant_id', 'table_no'], unique: true }],
  }
);

Tenant.hasMany(Table, { foreignKey: 'tenant_id', as: 'tables' });
Table.belongsTo(Tenant, { foreignKey: 'tenant_id' });

export default Table;
