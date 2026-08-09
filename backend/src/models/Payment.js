import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Order from './Order.js';

/**
 * Payment record. Table `payments` (migration 008).
 *
 * Cash orders are paid the moment they are placed; bKash/Nagad/card orders
 * start `pending` and a cashier confirms them later (status → paid, with the
 * gateway transaction ID + paid_at). `method` is one of cash | bkash |
 * nagad | card | other — the dashboard aggregates revenue by this column.
 */
const Payment = sequelize.define(
  'Payment',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    // Multi-tenant scoping (Phase 3).
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      index: true,
    },
    order_id: { type: DataTypes.INTEGER, allowNull: false, index: true },
    method: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'cash',
    },
    amount: { type: DataTypes.FLOAT, allowNull: false },
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'pending',
    },
    // bKash/Nagad transaction ID (e.g. 8A7B6C5D4E) — recorded at confirmation.
    reference: { type: DataTypes.STRING(120) },
    paid_at: { type: DataTypes.DATE },
    notes: { type: DataTypes.STRING(255) },
  },
  {
    tableName: 'payments',
    underscored: true,
  }
);

Order.hasMany(Payment, { foreignKey: 'order_id', as: 'payments' });
Payment.belongsTo(Order, { foreignKey: 'order_id' });

export default Payment;
