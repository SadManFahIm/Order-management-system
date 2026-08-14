import { DataTypes } from 'sequelize';

/**
 * 014 — Customer email on orders (ticket-styled order confirmation email).
 *
 * The storefront checkout collects the customer's phone for tracking; this
 * migration adds an OPTIONAL email so the platform can send the customer a
 * ticket-styled order confirmation (Phase 5 storefront). Purely additive:
 * guest orders placed without an email simply keep NULL and no email is
 * sent, so every existing checkout flow works untouched.
 */
export const up = async (qi, transaction) => {
  const t = { transaction };
  const cols = await qi.describeTable('orders', t);
  if (!('customer_email' in cols)) {
    await qi.addColumn(
      'orders',
      'customer_email',
      {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'Optional customer email for order confirmation email',
      },
      t
    );
  }
};

export const down = async (qi, transaction) => {
  const t = { transaction };
  const cols = await qi.describeTable('orders', t);
  if ('customer_email' in cols) {
    await qi.removeColumn('orders', 'customer_email', t);
  }
};
