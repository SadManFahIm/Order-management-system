import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataTypes, QueryTypes } from 'sequelize';
import sequelize from '../src/config/db.js';

/**
 * Versioned migration runner (schema doc §7).
 *
 *   npm run db:migrate            # apply all pending migrations
 *   npm run db:migrate:down       # roll back the most recent migration
 *   npm run db:migrate:down -- --name 002_tenancy_saas
 *   npm run db:migrate:status     # list applied / pending
 *
 * Migration contract: each file in backend/migrations/ exports
 *   export const up   = async (qi, transaction) => { … }   // qi = QueryInterface
 *   export const down = async (qi, transaction) => { … }
 * Every migration runs inside a transaction; completion is recorded in the
 * `schema_migrations` table (name, applied_at). Works on SQLite (dev) and
 * PostgreSQL (V2 target).
 */

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations'
);
const MIGRATIONS_TABLE = 'schema_migrations';
const MIGRATION_FILE_RE = /^\d{3}_[a-z0-9_]+\.js$/;

/** Migrations are plain files — keep them linted & unit-testable. */
export function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => MIGRATION_FILE_RE.test(file))
    .sort();
}

async function ensureMigrationsTable(seq) {
  const qi = seq.getQueryInterface();
  if (await qi.tableExists(MIGRATIONS_TABLE)) return;
  await qi.createTable(MIGRATIONS_TABLE, {
    name: { type: DataTypes.STRING(255), primaryKey: true },
    applied_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
}

async function getAppliedNames(seq) {
  const rows = await seq.query(`SELECT name FROM ${MIGRATIONS_TABLE}`, {
    type: QueryTypes.SELECT,
  });
  return new Set(rows.map((row) => row.name));
}

async function loadMigration(name) {
  const file = path.join(MIGRATIONS_DIR, `${name}.js`);
  if (!fs.existsSync(file)) throw new Error(`Unknown migration "${name}"`);
  return import(pathToFileURL(file));
}

/**
 * Apply all pending migrations in order. With `to` set, stops after that
 * migration (inclusive). Returns the number applied.
 */
export async function migrateUp(seq = sequelize, { to = null } = {}) {
  await ensureMigrationsTable(seq);
  const applied = await getAppliedNames(seq);
  let count = 0;

  for (const file of listMigrationFiles()) {
    const name = file.replace(/\.js$/, '');
    if (applied.has(name)) continue;

    const migration = await loadMigration(name);
    await seq.transaction(async (t) => {
      await migration.up(seq.getQueryInterface(), t);
      await seq.query(`INSERT INTO ${MIGRATIONS_TABLE} (name, applied_at) VALUES (:name, :now)`, {
        replacements: { name, now: new Date() },
        type: QueryTypes.INSERT,
        transaction: t,
      });
    });
    console.log(`  ✔ ${name}`);
    count += 1;
    if (to && name === to) break;
  }
  return count;
}

/**
 * Roll back the most recent applied migration, or the one given via `name`
 * (which must be the most recent — the runner refuses mid-chain rollbacks).
 * Returns the number rolled back (0 or 1).
 */
export async function migrateDown(seq = sequelize, name = null) {
  await ensureMigrationsTable(seq);
  // Reject unknown names before anything else — a typo should say "unknown",
  // not "you can only roll back the most recent".
  const known = new Set(listMigrationFiles().map((file) => file.replace(/\.js$/, '')));
  const target = name ?? null;
  if (target && !known.has(target)) {
    throw new Error(`Unknown migration "${target}"`);
  }

  const applied = await getAppliedNames(seq);
  const appliedFiles = listMigrationFiles().filter((file) =>
    applied.has(file.replace(/\.js$/, ''))
  );
  if (appliedFiles.length === 0) return 0;

  const last = appliedFiles[appliedFiles.length - 1].replace(/\.js$/, '');
  const resolved = target ?? last;
  if (target && resolved !== last) {
    throw new Error(
      `Cannot roll back "${resolved}" — only the most recent applied migration can be rolled back (last applied: ${last}).`
    );
  }

  const migration = await loadMigration(resolved);
  if (typeof migration.down !== 'function') {
    throw new Error(`Migration "${resolved}" does not export a down().`);
  }
  await seq.transaction(async (t) => {
    await migration.down(seq.getQueryInterface(), t);
    await seq.query(`DELETE FROM ${MIGRATIONS_TABLE} WHERE name = :name`, {
      replacements: { name: resolved },
      type: QueryTypes.DELETE,
      transaction: t,
    });
  });
  console.log(`  ↩ ${resolved}`);
  return 1;
}

/** List every migration with its state. Returns [{ name, state }]. */
export async function migrationStatus(seq = sequelize) {
  await ensureMigrationsTable(seq);
  const applied = await getAppliedNames(seq);
  const rows = listMigrationFiles().map((file) => {
    const name = file.replace(/\.js$/, '');
    return { name, state: applied.has(name) ? 'applied' : 'pending' };
  });
  const width = Math.max(...rows.map((row) => row.name.length), 1);
  for (const row of rows) {
    console.log(`  ${row.state === 'applied' ? '✔' : '○'}  ${row.name.padEnd(width)}  ${row.state}`);
  }
  const appliedCount = rows.filter((row) => row.state === 'applied').length;
  console.log(`\n${appliedCount} applied · ${rows.length - appliedCount} pending`);
  return rows;
}

function usage() {
  console.log(
    [
      'Usage: node scripts/migrate.js <up|down|status> [options]',
      '',
      '  up                        apply all pending migrations',
      '  up --to 002_tenancy_saas  apply up to (and including) a migration',
      '  down                      roll back the most recent migration',
      '  down --name 002_tenancy_saas  roll back a specific migration',
      '  status                    list applied / pending migrations',
    ].join('\n')
  );
}

function parseArgs(argv) {
  const [command] = argv;
  const flag = (key) => {
    const i = argv.indexOf(key);
    return i !== -1 ? argv[i + 1] : null;
  };
  return { command, to: flag('--to'), name: flag('--name') };
}

async function main() {
  const { command, to, name } = parseArgs(process.argv.slice(2));
  const prevLogging = sequelize.options.logging;
  sequelize.options.logging = false; // migrations report their own progress

  try {
    switch (command) {
      case 'up': {
        console.log(`Applying pending migrations (${sequelize.getDialect()})…`);
        const n = await migrateUp(sequelize, { to });
        console.log(n === 0 ? 'Already up to date.' : `Applied ${n} migration(s).`);
        break;
      }
      case 'down': {
        const n = await migrateDown(sequelize, name);
        console.log(n === 0 ? 'Nothing to roll back.' : `Rolled back ${n} migration(s).`);
        break;
      }
      case 'status':
        await migrationStatus(sequelize);
        break;
      default:
        usage();
        process.exitCode = 1;
    }
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    sequelize.options.logging = prevLogging;
    await sequelize.close();
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}

// Re-export the shared instance so callers (tests, src/index.js boot) can pass
// it explicitly instead of relying on the default-parameter fallback.
export { sequelize };
