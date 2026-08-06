import app from './app.js';
import sequelize from './config/db.js';
import { env } from './config/env.js';
import { ensureSchemaColumns, ensureBootstrapData } from './config/schemaSync.js';

async function start() {
  try {
    // Create missing tables (safe: no alter). Columns added to pre-existing
    // tables are handled idempotently by ensureSchemaColumns.
    await sequelize.sync();
    await ensureSchemaColumns();
    // Plans, default tenant, and legacy-user memberships (idempotent).
    await ensureBootstrapData();

    const server = app.listen(env.PORT, () => {
      console.log(`Backend listening on port ${env.PORT} (${env.NODE_ENV})`);
    });

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
