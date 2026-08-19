import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * Order edit request (migration 025) — a pending change to a placed order
 * (add/remove items) that a manager approves or rejects before it touches the
 * live order. The live order stays immutable until approval; this row holds
 * the requested line items as a JSON snapshot.
 */
const OrderEditRequest = sequelize.define(
  'OrderEditRequest',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      index: true,
    },
    order_id: { type: DataTypes.INTEGER, allowNull: false },
    // Staff actor id; NULL for a customer-initiated request (order-no + phone).
    requested_by: { type: DataTypes.INTEGER, allowNull: true },
    customer_phone: { type: DataTypes.STRING(30), allowNull: true },
    // pending | approved | rejected
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'pending',
    },
    reason: { type: DataTypes.STRING(255), allowNull: true },
    // Requested lines: [{ product_id, quantity }].
    requested_items: { type: DataTypes.JSON, allowNull: false },
    decided_by: { type: DataTypes.INTEGER, allowNull: true },
    decision_note: { type: DataTypes.STRING(255), allowNull: true },
    decided_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: 'order_edit_requests',
    underscored: true,
  }
);

export default OrderEditRequest;