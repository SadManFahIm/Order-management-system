import { DataTypes } from 'sequelize';

/**
 * 006 — QR table menus: `tables`.
 *
 * Physical tables per workspace, used by the QR table-menu flow: every table
 * encodes a storefront URL (`/m/:slug?table=N`) in a QR code the merchant can
 * print and stick on the table. Table numbers are unique within a workspace.
 *
 * Hard delete (no soft delete): a removed table is gone from the floor.
 */
const t = (transaction) => ({ transaction });

export const up = async (qi, transaction) => {
  await qi.createTable(
    'tables',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      table_no: { type: DataTypes.INTEGER, allowNull: false },
      name: { type: DataTypes.STRING(80), allowNull: true },
      capacity: { type: DataTypes.INTEGER, allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      ...t(transaction),
      indexes: [
        { fields: ['tenant_id', 'table_no'], unique: true },
        { fields: ['tenant_id'] },
      ],
    }
  );
};

export const down = async (qi, transaction) => {
  await qi.dropTable('tables', { transaction });
};
