import { DataTypes } from 'sequelize';

/**
 * 020 — Menu & media enhancements (Phase 4).
 *
 *   menu_items.available_from / available_to — time-of-day window during
 *     which an item is orderable (local clock, 'HH:MM' strings; NULL = any
 *     time). Enforced on the storefront (hidden when outside the window)
 *     and at staff order placement (rejected with AVAILABILITY_WINDOW).
 *   menu_items.tags           — JSON array of dietary/merchandising tags:
 *     'veg' | 'spicy' | 'new' | 'bestseller' (storefront badges).
 *   menu_items.sort_order     — per-item display order within its category
 *     (drag-and-drop sorting; falls back to id order).
 *   item_variants.stock       — per-variant quantity on hand; NULL means
 *     "unlimited / inherits the product" (variant-level stock control).
 */
const t = (transaction) => ({ transaction });

export const up = async (qi, transaction) => {
  await qi.addColumn(
    'menu_items',
    'available_from',
    { type: DataTypes.STRING(5), allowNull: true },
    t(transaction)
  );
  await qi.addColumn(
    'menu_items',
    'available_to',
    { type: DataTypes.STRING(5), allowNull: true },
    t(transaction)
  );
  await qi.addColumn(
    'menu_items',
    'tags',
    {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    t(transaction)
  );
  await qi.addColumn(
    'menu_items',
    'sort_order',
    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    t(transaction)
  );
  await qi.addColumn(
    'item_variants',
    'stock',
    { type: DataTypes.INTEGER, allowNull: true },
    t(transaction)
  );
};

export const down = async (qi, transaction) => {
  await qi.removeColumn('item_variants', 'stock', t(transaction));
  await qi.removeColumn('menu_items', 'sort_order', t(transaction));
  await qi.removeColumn('menu_items', 'tags', t(transaction));
  await qi.removeColumn('menu_items', 'available_to', t(transaction));
  await qi.removeColumn('menu_items', 'available_from', t(transaction));
};
