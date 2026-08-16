import { DataTypes } from 'sequelize';

/**
 * 021 — Variant-level low-stock threshold (Phase 4 follow-up).
 *
 *   item_variants.low_stock_at — per-variant alert threshold, mirroring the
 *     existing InventoryItem.low_stock_at semantics: when a tracked variant's
 *     `stock` (not NULL) drops to or below this value, the dashboard alert
 *     and the nightly merchant digest flag it. NULL = no alert for that
 *     variant.
 */
const t = (transaction) => ({ transaction });

export const up = async (qi, transaction) => {
  await qi.addColumn(
    'item_variants',
    'low_stock_at',
    { type: DataTypes.INTEGER, allowNull: true },
    t(transaction)
  );
};

export const down = async (qi, transaction) => {
  await qi.removeColumn('item_variants', 'low_stock_at', t(transaction));
};
