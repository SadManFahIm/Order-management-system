import app from './app.js';
import sequelize from './config/db.js';
import { env } from './config/env.js';

async function start() {
  try {
    // Creates tables if they are missing.
    // NOTE: `sync` is a development convenience — production schema changes
    // must be managed with migrations (Phase 1 follow-up).
    await sequelize.sync();

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
