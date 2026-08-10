/**
 * db:rollup — backfill the daily analytics rollup (Phase 7).
 *
 *   npm run db:rollup                  # last 30 Dhaka days, all tenants
 *   npm run db:rollup -- --days 90     # longer window
 *   npm run db:rollup -- --tenant 3    # a single workspace
 *
 * Idempotent — each (tenant, day) row is upserted, so re-running only
 * refreshes. The nightly scheduler (src/index.js) keeps it current after
 * this initial backfill; the dashboard reads it with ?source=rollup.
 */
import { parseArgs } from 'node:util';
import sequelize from '../src/config/db.js';
import { migrateUp } from './migrate.js';
import { ensureBootstrapData } from '../src/config/schemaSync.js';
import '../src/models/index.js';
import { backfillRollup } from '../src/services/rollupService.js';

const { values } = parseArgs({
  options: { days: { type: 'string' }, tenant: { type: 'string' } },
});

try {
  await migrateUp(sequelize);
  await ensureBootstrapData();
  const fromDays = Number.parseInt(values.days, 10) || 30;
  const tenantId = values.tenant ? Number(values.tenant) : null;
  const built = await backfillRollup({ tenantId, fromDays });
  console.log(`✅ Rollup backfilled: ${built} daily-stat rows (${fromDays} days)`);
  await sequelize.close();
} catch (err) {
  console.error('Failed to backfill rollup:', err.message);
  if (process.env.SEED_DEBUG) console.error(err);
  await sequelize.close().catch(() => {});
  process.exit(1);
}
