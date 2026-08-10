import app from './app.js';
import sequelize from './config/db.js';
import { env } from './config/env.js';
import { migrateUp } from '../scripts/migrate.js';
import { ensureBootstrapData } from './config/schemaSync.js';
import { startCloseoutScheduler } from './services/reportsScheduler.js';
import { startReconciliationScheduler } from './services/paymentReconciliation.js';

async function start() {
  try {
    // Schema is managed by the versioned migration runner on BOTH dialects
    // (SQLite dev and PostgreSQL production). The models are aligned to the
    // migration DDL, so `sync()` is no longer needed anywhere — migrations
    // are the single source of truth for the schema.
    const applied = await migrateUp(sequelize);
    console.log(`[boot] migrations checked (${applied} applied)`);

    // Plans, default tenant, and legacy-user memberships (idempotent).
    await ensureBootstrapData();

    const server = app.listen(env.PORT, () => {
      console.log(`Backend listening on port ${env.PORT} (${env.NODE_ENV})`);
    });

    // Nightly closeout emails (per-tenant, Dhaka hour, once/day).
    startCloseoutScheduler();
    // Stale online payment intents → expired (reconciliation).
    startReconciliationScheduler();

    const shutdown = async () => {
      console.log('Shutting down gracefully…');
      server.close(async () => {
        await sequelize.close();
        process.exit(0);
      });
      // Force-exit if close takes too long
      setTimeout(() => process.exit(1), 10_000).unref();
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (e) {
    console.error('Failed to start backend:', e);
    process.exit(1);
  }
}

start();
