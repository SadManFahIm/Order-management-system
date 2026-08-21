import { DataTypes } from 'sequelize';

/**
 * 027 — Analytics maturity (Phase 7).
 *
 *   orders.channel          — sales channel taxonomy: 'pos' (staff-placed,
 *     internal /api/orders) | 'storefront' (public guest checkout). The
 *     analytics channel filter uses this column; existing rows default to
 *     'pos' which matches reality (the storefront launched in Phase 5).
 *   orders.analytics_session — anonymous storefront session id captured at
 *     checkout, tying a paid order back to its Browse → Cart → Checkout
 *     journey so the funnel measures ONE entity (distinct sessions) end to
 *     end. NULL for POS orders and legacy storefront orders.
 *   analytics_events        — minimal funnel event stream (menu_view /
 *     add_to_cart / checkout_start) recorded by the public storefront.
 *     Distinct sessions per stage are counted, so duplicate events never
 *     double-count a session.
 *
 * Indexes follow the actual query patterns: every analytics query filters by
 * tenant + a created_at range (+ optionally channel/type), and the funnel
 * groups by (tenant, event_type, created_at) or walks one session.
 */
export const up = async (qi, transaction) => {
  const t = { transaction };

  await qi.addColumn('orders', 'channel', {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'pos',
    ...t,
  });
  await qi.addColumn('orders', 'analytics_session', {
    type: DataTypes.STRING(64),
    allowNull: true,
    ...t,
  });
  await qi.addIndex('orders', ['tenant_id', 'channel'], {
    ...t,
    name: 'ix_orders_tenant_channel',
  });

  await qi.createTable(
    'analytics_events',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      // Anonymous browser session id (minted client-side per restaurant).
      session_id: { type: DataTypes.STRING(64), allowNull: false },
      // menu_view | add_to_cart | checkout_start
      event_type: { type: DataTypes.STRING(24), allowNull: false },
      product_id: { type: DataTypes.BIGINT, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      ...t,
      indexes: [
        { fields: ['tenant_id', 'event_type', 'created_at'] },
        { fields: ['tenant_id', 'session_id'] },
      ],
    }
  );
};

export const down = async (qi, transaction) => {
  const t = { transaction };
  await qi.dropTable('analytics_events', t);
  await qi.removeIndex('orders', 'ix_orders_tenant_channel', t);
  await qi.removeColumn('orders', 'analytics_session', t);
  await qi.removeColumn('orders', 'channel', t);
};
