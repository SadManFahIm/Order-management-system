import { DataTypes } from 'sequelize';

/**
 * 009 — VAT compliance (Bangladesh NBR-ready).
 *
 * Each menu item carries its own VAT rate (percent, VAT-inclusive pricing —
 * the norm in BD restaurants): 5% reduced rate for most food, 15% standard
 * for others. The per-item rate is what the VAT report uses to split every
 * line's amount into VAT + net; workspaces can override the default via
 * `tenant.settings.vat.defaultRate`.
 */
const t = (transaction) => ({ transaction });

export const up = async (qi, transaction) => {
  await qi.addColumn(
    'menu_items',
    'vat_rate',
    {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 5,
      comment: 'VAT rate percent (VAT-inclusive pricing), default 5%',
    },
    t(transaction)
  );
  await qi.addIndex('menu_items', ['tenant_id', 'vat_rate'], {
    name: 'menu_items_tenant_vat_rate',
    ...t(transaction),
  });
};

export const down = async (qi, transaction) => {
  await qi.removeIndex('menu_items', 'menu_items_tenant_vat_rate', t(transaction));
  await qi.removeColumn('menu_items', 'vat_rate', t(transaction));
};
