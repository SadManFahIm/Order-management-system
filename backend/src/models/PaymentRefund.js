import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Payment from './Payment.js';
import Order from './Order.js';

/**
 * Payment refund ledger. Table `payment_refunds` (migration 026).
 *
 * A refund is a row here, not just a flag on the payment. This makes multiple
 * partial refunds auditable and lets the refund service check the running
 * total INSIDE a transaction so two concurrent refunds can never over-refund.
 * The legacy `payments.refunded_*` columns stay as the denormalised summary
 * (refunded_amount = total refunded so far) for backward compatibility with
 * the closeout/dashboard/reports queries.
 */
const PaymentRefund = sequelize.define(
  'PaymentRefund',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    // Multi-tenant scoping (Phase 3).
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      index: true,
    },
    payment_id: { type: DataTypes.INTEGER, allowNull: false, index: true },
    order_id: { type: DataTypes.INTEGER, allowNull: false },
    amount: { type: DataTypes.FLOAT, allowNull: false },
    reason: { type: DataTypes.STRING(255), allowNull: true },
    // processed | failed
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'processed',
    },
    created_by: { type: DataTypes.INTEGER, allowNull: true },
    processed_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: 'payment_refunds',
    underscored: true,
    // The table has `created_at` (DB default NOW) + `processed_at` but no
    // `updated_at` — a refund ledger row is append-only and immutable.
    timestamps: false,
  }
);

Payment.hasMany(PaymentRefund, { foreignKey: 'payment_id', as: 'refunds' });
PaymentRefund.belongsTo(Payment, { foreignKey: 'payment_id' });
Order.hasMany(PaymentRefund, { foreignKey: 'order_id', as: 'paymentRefunds' });

export default PaymentRefund;