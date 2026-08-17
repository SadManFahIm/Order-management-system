import { DataTypes, Op } from 'sequelize';

/**
 * 023 — Restaurant-wide closures + recurring weekday rules (Phase 4 follow-up).
 *
 *   tenant_closure_dates        — one-off restaurant-wide closed days
 *     (holidays, private events): when a tenant has a row for a date, the
 *     WHOLE storefront is closed that day (hidden menu + checkout rejected
 *     with RESTAURANT_CLOSED). Unique per (tenant, date).
 *
 *   availability_weekday_rules  — recurring availability patterns:
 *     - menu_item_id NULL      → restaurant-wide weekday closure
 *       ("closed every Friday"); the service enforces that restaurant-wide
 *       rows carry NULL bounds (closure-only).
 *     - menu_item_id NOT NULL  → per-item weekday rule that replaces the
 *       base window for that weekday (weekend hours, "closed Mondays").
 *       Both bounds NULL = closed every that-weekday.
 *     weekday                  → 0=Sunday … 6=Saturday (JavaScript getDay).
 *
 *     Resolution order at a given date/time (storefront + checkout):
 *       tenant closure date → per-item weekday rule → per-day override →
 *       base window.
 */
const t = (transaction) => ({ transaction });

export const up = async (qi, transaction) => {
  await qi.createTable(
    'tenant_closure_dates',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      date: { type: DataTypes.DATEONLY, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      ...t(transaction),
      indexes: [{ fields: ['tenant_id', 'date'], unique: true }],
    }
  );

  await qi.createTable(
    'availability_weekday_rules',
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
        allowNull: true,
        references: { model: 'menu_items', key: 'id' },
        onDelete: 'CASCADE',
      },
      // 0=Sunday … 6=Saturday (matches JavaScript Date#getDay).
      weekday: { type: DataTypes.INTEGER, allowNull: false },
      available_from: { type: DataTypes.STRING(5), allowNull: true },
      available_to: { type: DataTypes.STRING(5), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      ...t(transaction),
      indexes: [
        // One per-item rule per weekday (NULL menu_item_id excluded so the
        // restaurant-wide rows get their own uniqueness below).
        {
          name: 'uq_weekday_rule_item',
          unique: true,
          fields: ['tenant_id', 'menu_item_id', 'weekday'],
          where: { menu_item_id: { [Op.ne]: null } },
        },
        // One restaurant-wide rule per weekday.
        {
          name: 'uq_weekday_rule_tenant',
          unique: true,
          fields: ['tenant_id', 'weekday'],
          where: { menu_item_id: null },
        },
        // Fast "today's weekday rules" lookup for a whole workspace.
        { fields: ['tenant_id', 'weekday'] },
      ],
    }
  );
};

export const down = async (qi, transaction) => {
  await qi.dropTable('availability_weekday_rules', { transaction });
  await qi.dropTable('tenant_closure_dates', { transaction });
};
