/**
 * Drop everything and re-apply migrations — returns the database to the pure
 * migration schema.
 *
 * Why this exists: the test suite uses `sequelize.sync({ force: true })`,
 * which recreates the model tables with the MODEL's column subset (migration
 * columns the models don't declare — locale, created_by, nutrition, etc. —
 * are lost, and `schema_migrations` survives so `db:migrate` no-ops). CI
 * therefore resets between the test suite and the v1→v2 copy / smoke steps so
 * those run against the true migration schema.
 *
 * Usage: npm run db:reset   (honors DB_DIALECT / DATABASE_URL / DB_STORAGE)
 */
import { QueryTypes } from 'sequelize';
import sequelize from '../src/config/db.js';
import { migrateUp } from './migrate.js';

async function listTables() {
  if (sequelize.getDialect() === 'postgres') {
    const rows = await sequelize.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
      { type: QueryTypes.SELECT }
    );
    return rows.map((r) => r.tablename);
  }
  const rows = await sequelize.query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    { type: QueryTypes.SELECT }
  );
  return rows.map((r) => r.name);
}

async function main() {
  const tables = await listTables();
  const qi = sequelize.getQueryInterface();

  if (sequelize.getDialect() === 'postgres') {
    // CASCADE drops FKs along with the tables.
    await qi.dropAllTables({ cascade: true });
  } else {
    // SQLite has no DROP TABLE … CASCADE — disable FK enforcement for the
    // drop phase, then restore it.
    await sequelize.query('PRAGMA foreign_keys = OFF');
    for (const table of tables) {
      await qi.dropTable(table);
    }
    await sequelize.query('PRAGMA foreign_keys = ON');
  }
  console.log(`[db:reset] dropped ${tables.length} table(s)`);

  const applied = await migrateUp(sequelize);
  console.log(`[db:reset] migrations re-applied (${applied} new)`);
  await sequelize.close();
}

main().catch(async (error) => {
  console.error('db:reset failed:', error.message);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
