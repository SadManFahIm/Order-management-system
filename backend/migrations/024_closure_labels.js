import { DataTypes } from 'sequelize';

/**
 * 024 — Closure labels (Phase 4 follow-up round 7).
 *
 *   tenant_closure_dates.label  — optional human name for a restaurant-wide
 *     closure day ("Eid-ul-Fitr", "Private event", "Maintenance day"). Purely
 *     presentational: the merchant Settings list + month calendar can show
 *     WHY a day is closed. Availability resolution reads only `date`, so a
 *     label never changes behaviour. The bulk-import flow in Settings parses
 *     "YYYY-MM-DD Holiday name" lines into date + label.
 */
export const up = async (qi, transaction) => {
  const t = { transaction };
  await qi.addColumn('tenant_closure_dates', 'label', {
    type: DataTypes.STRING(120),
    allowNull: true,
    ...t,
  });
};

export const down = async (qi, transaction) => {
  await qi.removeColumn('tenant_closure_dates', 'label', { transaction });
};
