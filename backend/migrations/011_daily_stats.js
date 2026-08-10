import { DataTypes } from 'sequelize';

/**
 * 011 — Daily analytics rollup (Phase 7).
 *
 * Nightly pre-aggregated stats per tenant + Dhaka day, so the dashboard's
 * historical trend (closeout trend, peak-hours heatmap) can be served from
 * a bounded read instead of scanning raw orders/payments on every load —
 * the query-cost mitigation from the roadmap (<2s p95 on 6-month data).
 *
 *   - revenue / orders       — paid revenue + order volume for the day
 *   - method_mix             — { cash, bkash, nagad, card, online, other }
 *   - peak_hours             — sparse { "<dayOfWeek>": { "<hour>": { orders,
 *                              revenue } } } (Sun-first days, Dhaka hours)
 *   - category_mix           — reserved for a future nightly category rollup
 *
 * One row per (tenant, date) — the nightly job upserts yesterday's row and
 * the CLI (`npm run db:rollup`) backfills the last N days.
 */
export const up = async (qi, transaction) => {
  const t = { transaction };
  await qi.createTable(
    'daily_stats',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      tenant_id: { type: DataTypes.INTEGER, allowNull: false },
      stat_date: { type: DataTypes.DATEONLY, allowNull: false },
      revenue: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        comment: 'Paid revenue for the Dhaka day',
      },
      orders: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Order volume for the Dhaka day',
      },
      method_mix: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: 'Paid revenue by payment method',
      },
      peak_hours: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: 'Sparse day×hour orders/revenue map (Dhaka time)',
      },
      category_mix: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: 'Reserved — nightly category revenue rollup',
      },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    },
    t
  );
  await qi.addIndex('daily_stats', ['tenant_id', 'stat_date'], {
    name: 'daily_stats_tenant_date',
    unique: true,
    ...t,
  });
  await qi.addIndex('daily_stats', ['stat_date'], {
    name: 'daily_stats_date',
    ...t,
  });
};

export const down = async (qi, transaction) => {
  const t = { transaction };
  await qi.removeIndex('daily_stats', 'daily_stats_date', t);
  await qi.removeIndex('daily_stats', 'daily_stats_tenant_date', t);
  await qi.dropTable('daily_stats', t);
};
