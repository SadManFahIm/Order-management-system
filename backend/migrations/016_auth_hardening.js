import { DataTypes } from 'sequelize';

/**
 * 016 — Auth hardening (Phase 2): login lockout, forced password change,
 * and per-user permission flags.
 *
 * Adds to `users`:
 *   - failed_login_attempts  — running count of bad password attempts
 *                              (reset on success / unlock)
 *   - locked_until           — when set, login is refused until this time
 *   - must_change_password   — admin-forced reset: next login must set a
 *                              new password before the app can be used
 *
 * Adds to `user_tenants`:
 *   - permissions            — JSONB array of per-user permission flags
 *                              (e.g. ["refund:orders", "-manage:menu"]) that
 *                              override the role's base matrix. This is the
 *                              "flagging" layer on top of role-based access.
 * Purely additive: no existing column or behavior changes.
 */
export const up = async (qi, transaction) => {
  const t = { transaction };
  await qi.addColumn('users', 'failed_login_attempts', {
    type: 'INTEGER',
    allowNull: false,
    defaultValue: 0,
    ...t,
  });
  // DataTypes.DATE (not the raw 'DATE' string) — on PostgreSQL 'DATE' is
  // date-only and truncates the time to midnight, which would make a 15-min
  // lock expire instantly. DataTypes.DATE maps to TIMESTAMP WITH TIME ZONE
  // on PG and DATETIME on SQLite, matching the model.
  await qi.addColumn('users', 'locked_until', {
    type: DataTypes.DATE,
    allowNull: true,
    ...t,
  });
  await qi.addColumn('users', 'must_change_password', {
    type: 'BOOLEAN',
    allowNull: false,
    defaultValue: false,
    ...t,
  });
  await qi.addColumn('user_tenants', 'permissions', {
    type: 'JSONB',
    allowNull: true,
    ...t,
  });
};

export const down = async (qi, transaction) => {
  const t = { transaction };
  await qi.removeColumn('user_tenants', 'permissions', t);
  await qi.removeColumn('users', 'must_change_password', t);
  await qi.removeColumn('users', 'locked_until', t);
  await qi.removeColumn('users', 'failed_login_attempts', t);
};
