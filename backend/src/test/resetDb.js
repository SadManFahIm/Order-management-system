import sequelize from '../config/db.js';
import { migrateUp } from '../../scripts/migrate.js';

/**
 * Reset the shared test database before a suite.
 *
 * - PostgreSQL: migration-aware — drops every table (schema_migrations
 *   included) and rebuilds the schema from the versioned migrations, so the
 *   suite genuinely exercises the production DDL instead of `sync()`-derived
 *   tables (which only carry the model's column subset).
 * - SQLite: fast full reset via `sync({ force: true })`. The models are
 *   aligned to the migration DDL (`tableName`/`field`), so sync() produces the
 *   same table names; the drift suite (`__tests__/drift.test.js`) guarantees
 *   the two never diverge.
 */
export async function resetTestDb() {
  if (sequelize.getDialect() === 'postgres') {
    await sequelize.getQueryInterface().dropAllTables({ cascade: true });
    await migrateUp(sequelize);
  } else {
    await sequelize.sync({ force: true });
  }
}
