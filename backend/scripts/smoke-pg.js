import app from '../src/app.js';
import sequelize from '../src/config/db.js';
import { migrateUp } from './migrate.js';
import { ensureBootstrapData } from '../src/config/schemaSync.js';

/**
 * PostgreSQL smoke test for CI (backend-postgres job).
 *
 * Mirrors a production boot: pending migrations first, bootstrap data, then the
 * HTTP surface — /health and a real login. Exits nonzero on any failure.
 *
 *   NODE_ENV=production DB_DIALECT=postgres DATABASE_URL=postgres://… \
 *     node scripts/smoke-pg.js
 *
 * Expects a seeded admin (scripts/seed-admin.js) — env ADMIN_EMAIL/ADMIN_PASSWORD
 * default to the CI credentials.
 */

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'ci@oms.dev';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'CiStr0ngPass!42';
const PORT = Number(process.env.SMOKE_PORT || 0); // 0 = ephemeral port

async function main() {
  // Production-like boot: migrations only, then bootstrap data.
  const applied = await migrateUp(sequelize);
  await ensureBootstrapData();
  console.log(`[smoke] migrations checked (${applied} applied), bootstrap ok`);

  const server = app.listen(PORT, async () => {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    try {
      const health = await fetch(`${base}/health`);
      const healthOk = health.ok;

      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      });
      const loginBody = await login.json().catch(() => ({}));
      const loginOk = login.ok && Boolean(loginBody?.accessToken || loginBody?.data?.accessToken);

      console.log(
        `[smoke] health:${health.status} login:${login.status} token:${loginOk ? 'yes' : 'no'}`
      );
      if (!healthOk || !loginOk) {
        console.error('[smoke] FAILED');
        process.exitCode = 1;
      } else {
        console.log('[smoke] OK');
      }
    } catch (error) {
      console.error('[smoke] FAILED:', error.message);
      process.exitCode = 1;
    } finally {
      server.close(async () => {
        await sequelize.close();
        process.exit(process.exitCode || 0);
      });
    }
  });
}

main().catch((error) => {
  console.error('[smoke] boot failed:', error.message);
  process.exit(1);
});
