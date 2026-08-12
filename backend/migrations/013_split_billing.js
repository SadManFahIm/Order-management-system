import { DataTypes } from 'sequelize';

/**
 * 013 — Dine-in split billing (per-diner receipts, cashier split panel,
 * split-method analytics).
 *
 * The split-payment foundation (Phase 6) stores each part as a `payments`
 * row — one row per diner/method — with the diner label on `notes`. This
 * migration extends that model with the metadata per-diner receipts and
 * analytics need, and adds the table that records WHICH items each diner
 * is responsible for:
 *
 *   - payments.split_method  — 'equal' | 'item' | 'custom' (how the order
 *                              was split; drives the dashboard's
 *                              split-method analytics chart)
 *   - payments.diner_index   — 1-based position of this part within the
 *                              split (receipt/panel ordering)
 *   - order_split_items      — a snapshot of the item allocation per part
 *                              (item_name/unit/discount/line/vat_rate are
 *                              denormalised so receipts survive product
 *                              edits and soft-deletes, exactly like
 *                              order_items)
 *
 * Purely additive: existing payment rows are untouched; old databases
 * simply have no split metadata until an order is (re)split.
 */
export const up = async (qi, transaction) => {
  const t = { transaction };

  // IMPORTANT: introspection must run INSIDE the migration transaction
  // (PostgreSQL self-deadlock — see migration 012's note).
  const payCols = await qi.describeTable('payments', t);
  const addCol = async (name, def) => {
    if (!(name in payCols)) await qi.addColumn('payments', name, def, t);
  };
  await addCol('split_method', {
    type: DataTypes.STRING(16),
    allowNull: true,
    comment: 'Split method: equal | item | custom',
  });
  await addCol('diner_index', {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '1-based position of this part within the order split',
  });

  const payIdx = await qi.showIndex('payments', t);
  const hasIndex = (name) => payIdx.some((i) => i.name === name);
  if (!hasIndex('payments_split_method')) {
    await qi.addIndex('payments', ['split_method'], {
      name: 'payments_split_method',
      ...t,
    });
  }
  if (!hasIndex('payments_tenant_split')) {
    await qi.addIndex('payments', ['tenant_id', 'split_method'], {
      name: 'payments_tenant_split',
      ...t,
    });
  }

  if (!(await qi.tableExists('order_split_items', t))) {
    await qi.createTable(
      'order_split_items',
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
        // The payment row this diner part maps to — cascade removes the
        // allocation whenever its part is deleted.
        payment_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
          references: { model: 'payments', key: 'id' },
          onDelete: 'CASCADE',
        },
        // Snapshot fields — never re-joined to live menu data so receipts
        // stay stable (mirrors order_items). menu_item_id is nullable for
        // item-less parts (equal/custom splits have no allocation rows).
        menu_item_id: { type: DataTypes.BIGINT, allowNull: true },
        item_name: { type: DataTypes.STRING(255), allowNull: false },
        quantity: { type: DataTypes.INTEGER, allowNull: false },
        unit_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        discount_amount: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: false,
          defaultValue: 0,
        },
        line_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        vat_rate: {
          type: DataTypes.DECIMAL(5, 2),
          allowNull: false,
          defaultValue: 0,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        created_by: {
          type: DataTypes.BIGINT,
          allowNull: true,
          references: { model: 'users', key: 'id' },
        },
      },
      {
        ...t,
        indexes: [
          { fields: ['tenant_id', 'order_id'] },
          { fields: ['tenant_id', 'payment_id'] },
          { fields: ['order_id'] },
          { fields: ['payment_id'] },
        ],
      }
    );
  }
};

export const down = async (qi, transaction) => {
  const t = { transaction };
  if (await qi.tableExists('order_split_items', t)) {
    await qi.dropTable('order_split_items', t);
  }
  const payIdx = await qi.showIndex('payments', t);
  for (const name of ['payments_tenant_split', 'payments_split_method']) {
    if (payIdx.some((i) => i.name === name)) {
      await qi.removeIndex('payments', name, t);
    }
  }
  const payCols = await qi.describeTable('payments', t);
  for (const col of ['diner_index', 'split_method']) {
    if (col in payCols) await qi.removeColumn('payments', col, t);
  }
};
