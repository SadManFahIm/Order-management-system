import { DataTypes } from 'sequelize';

/**
 * 007 — Table-aware orders: `orders.table_no`.
 *
 * Dine-in orders created from a QR table menu carry the physical table they
 * belong to, so kitchen/delivery see it at a glance. The value is validated
 * against the workspace's `tables` (migration 006) at order creation, but
 * stored denormalised on the order (an order keeps its table even if the
 * table is later deleted/renamed — history stays intact).
 */
const t = (transaction) => ({ transaction });

export const up = async (qi, transaction) => {
  await qi.addColumn(
    'orders',
    'table_no',
    {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Physical table number for dine-in orders (QR table menu)',
    },
    t(transaction)
  );
  await qi.addIndex('orders', ['tenant_id', 'table_no'], {
    name: 'orders_tenant_table_no',
    ...t(transaction),
  });
};

export const down = async (qi, transaction) => {
  await qi.removeIndex('orders', 'orders_tenant_table_no', t(transaction));
  await qi.removeColumn('orders', 'table_no', t(transaction));
};
