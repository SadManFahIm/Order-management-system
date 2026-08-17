import { DataTypes } from 'sequelize';

/**
 * 022 — Per-day availability overrides (Phase 4 follow-up).
 *
 *   availability_overrides — date-specific windows that override an item's
 *     repeating availability schedule (menu_items.available_from / to) for a
 *     single calendar date: a merchant can close an item for a holiday,
 *     extend hours for an event night, or open early for a special order.
 *
 *     date             — the calendar date (restaurant-local day, YYYY-MM-DD).
 *     available_from   — 'HH:MM' override window start (NULL = from midnight).
 *     available_to     — 'HH:MM' override window end (NULL = until midnight).
 *     Both NULL        — an explicit "closed all day" override for that date.
 *
 *     Enforced exactly like the base window: hidden from the storefront and
 *     rejected at checkout (AVAILABILITY_WINDOW) outside the effective
 *     window, overnight windows wrap midnight, and scheduled orders are
 *     validated against the scheduled date's override.
 *
 *     One override per (tenant, item, date) — unique index.
 */
const t = (transaction) => ({ transaction });

export const up = async (qi, transaction) => {
  await qi.createTable(
    'availability_overrides',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      menu_item_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'menu_items', key: 'id' },
        onDelete: 'CASCADE',
      },
      date: { type: DataTypes.DATEONLY, allowNull: false },
      available_from: { type: DataTypes.STRING(5), allowNull: true },
      available_to: { type: DataTypes.STRING(5), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      ...t(transaction),
      indexes: [
        // One override per item per day.
        { fields: ['tenant_id', 'menu_item_id', 'date'], unique: true },
        // Fast lookup of "today's overrides" for a whole workspace (the
        // public menu + checkout query by tenant + date).
        { fields: ['tenant_id', 'date'] },
      ],
    }
  );
};

export const down = async (qi, transaction) => {
  await qi.dropTable('availability_overrides', { transaction });
};
