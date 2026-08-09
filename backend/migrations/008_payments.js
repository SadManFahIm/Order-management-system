import { DataTypes } from 'sequelize';

/**
 * 008 — Payment records (bKash/Nagad/cash) + `orders.payment_method`.
 *
 * Every order carries the payment method it was placed with (denormalised,
 * so history survives later config changes), and a `payments` table records
 * the money movement: cash orders are marked paid immediately, while
 * bKash/Nagad/card orders start `pending` and are confirmed by a cashier
 * (transaction ID + paid_at) — the foundation for per-method revenue
 * analytics on the dashboard.
 */
const t = (transaction) => ({ transaction });

export const up = async (qi, transaction) => {
  await qi.addColumn(
    'orders',
    'payment_method',
    {
      type: DataTypes.STRING(16),
      allowNull: true,
      comment: 'Payment method for this order (cash, bkash, nagad, card, other)',
    },
    t(transaction)
  );
  await qi.addIndex('orders', ['tenant_id', 'payment_method'], {
    name: 'orders_tenant_payment_method',
    ...t(transaction),
  });

  await qi.createTable(
    'payments',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      order_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onDelete: 'CASCADE',
      },
      method: { type: DataTypes.STRING(16), allowNull: false },
      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      status: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'pending',
      },
      reference: { type: DataTypes.STRING(120), allowNull: true },
      paid_at: { type: DataTypes.DATE, allowNull: true },
      notes: { type: DataTypes.STRING(255), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      created_by: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
    },
    {
      ...t(transaction),
      indexes: [
        { fields: ['tenant_id', 'method'] },
        { fields: ['tenant_id', 'status'] },
        { fields: ['order_id'] },
      ],
    }
  );
};

export const down = async (qi, transaction) => {
  await qi.dropTable('payments', { transaction });
  await qi.removeIndex('orders', 'orders_tenant_payment_method', t(transaction));
  await qi.removeColumn('orders', 'payment_method', t(transaction));
};
