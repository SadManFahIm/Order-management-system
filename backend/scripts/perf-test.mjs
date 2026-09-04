/**
 * perf:test — benchmark GET /api/dashboard against the perf:seed dataset
 * (Phase 7, roadmap acceptance: <2s p95 on a 6-month dataset).
 *
 *   npm run perf:seed && npm run perf:test
 *   PERF_DB=perf2.sqlite npm run perf:test
 *
 * Measures the live 7/30-day paths AND the rollup path
 * (?source=rollup, the nightly pre-aggregation). Exits 1 when any p95
 * is >= 2000ms. Uses X-Tenant so the request targets the first seeded
 * workspace deterministically.
 */
process.env.DB_STORAGE = process.env.PERF_DB || 'perf.sqlite';
process.env.DB_DIALECT = 'sqlite';
process.env.NODE_ENV = 'test';

const { default: app } = await import('../src/app.js');
const { default: sequelize } = await import('../src/config/db.js');
const { migrateUp } = await import('./migrate.js');
const { ensureBootstrapData } = await import('../src/config/schemaSync.js');
const { default: request } = await import('supertest');
const { UserTenant } = await import('../src/models/index.js');
const { backfillRollup } = await import('../src/services/rollupService.js');

await migrateUp(sequelize);
await ensureBootstrapData();

const login = await request(app)
  .post('/api/auth/login')
  .send({ email: 'perf@oms.dev', password: 'password123' });
if (login.status !== 200) {
  console.error(`Login failed (${login.status}) — run npm run perf:seed first.`);
  process.exit(1);
}
const token = login.body.accessToken;
const memberships = await UserTenant.findAll({
  where: { user_id: login.body.user.id },
  attributes: ['tenant_id'],
  order: [['tenant_id', 'ASC']],
  limit: 1,
});
const tenantId = memberships[0]?.tenant_id || 1;

// Pre-aggregate the rollup window so the ?source=rollup path is measured
// against real daily_stats rows (same job the nightly scheduler runs).
await backfillRollup({ tenantId, fromDays: 30 });

const time = async (path) => {
  const t0 = performance.now();
  const res = await request(app)
    .get(path)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant', String(tenantId));
  return { ms: performance.now() - t0, status: res.status };
};

const run = async (path, n) => {
  const results = [];
  for (let i = 0; i < n; i += 1) {
    const r = await time(path);
    if (r.status !== 200) throw new Error(`${path} → HTTP ${r.status}`);
    results.push(r.ms);
  }
  results.sort((a, b) => a - b);
  return {
    p50: results[Math.floor(results.length * 0.5)],
    p95: results[Math.floor(results.length * 0.95)],
    max: results[results.length - 1],
    samples: results.length,
  };
};

const report = (label, { p50, p95, max, samples }) => {
  const line = `  ${label.padEnd(36)} p50 ${String(p50.toFixed(0)).padStart(5)}ms  p95 ${String(
    p95.toFixed(0)
  ).padStart(5)}ms  max ${String(max.toFixed(0)).padStart(5)}ms  (${samples} samples)`;
  console.log(line);
  return p95;
};

try {
  const live7 = await run('/api/dashboard?days=7', 15);
  report('dashboard?days=7 (live)', live7);
  const live30 = await run('/api/dashboard?days=30', 15);
  report('dashboard?days=30 (live)', live30);
  const rollup30 = await run('/api/dashboard?days=30&source=rollup', 10);
  report('dashboard?days=30&source=rollup', rollup30);

  const worst = Math.max(live7.p95, live30.p95, rollup30.p95);
  console.log(
    `\n${worst < 2000 ? '✅ PASS' : '❌ FAIL'} worst p95 = ${worst.toFixed(0)}ms (target < 2000ms)`
  );
  await sequelize.close();
  process.exit(worst < 2000 ? 0 : 1);
} catch (err) {
  console.error('Perf test failed:', err.message);
  await sequelize.close().catch(() => {});
  process.exit(1);
}
