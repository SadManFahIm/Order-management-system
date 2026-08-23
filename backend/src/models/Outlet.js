import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * Outlet (migration 028) — a physical location within a tenant.
 * Tenant = brand/organization (e.g. KFC Bangladesh); outlet = branch
 * (e.g. KFC Banani, KFC Gulshan). The legacy model where tenant == one
 * physical location is preserved by a default "Main Branch" outlet seeded
 * during migration for every existing tenant.
 */
const Outlet = sequelize.define(
  'Outlet',
  {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    tenant_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      index: true,
    },
    name: { type: DataTypes.STRING(120), allowNull: false },
    code: { type: DataTypes.STRING(32), allowNull: false },
    slug: { type: DataTypes.STRING(120), allowNull: false },
    address: { type: DataTypes.TEXT, allowNull: true },
    phone: { type: DataTypes.STRING(30), allowNull: true },
    email: { type: DataTypes.STRING(200), allowNull: true },
    timezone: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'Asia/Dhaka' },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active' },
    opening_hours: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  },
  {
    tableName: 'outlets',
    underscored: true,
    indexes: [
      { fields: ['tenant_id'] },
      { fields: ['tenant_id', 'code'], unique: true },
      { fields: ['tenant_id', 'slug'], unique: true },
      { fields: ['status'] },
    ],
  }
);

export default Outlet;
