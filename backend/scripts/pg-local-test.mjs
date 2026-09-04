#!/usr/bin/env node
/**
 * PG-local test script — run the FULL backend suite against a real local
 * PostgreSQL, exactly like the CI "Backend — PostgreSQL 16" job, without
 * Docker.
 *
 *   npm run db:pg:test              # create scratch DB → migrate → vitest → drop
 *   npm run db:pg:test -- --keep    # keep the scratch DB after a failure
 *
 * Environment:
 *   PG_ADMIN_URL   admin connection for create/drop (default
 *                  postgres://postgres:postgres@localhost:5432/postgres —
 *                  override when your local superuser differs)
 *   PG_TEST_DB     scratch database name (default oms_local_test)
 *   JWT_SECRET     passed through to the suite (a stable local default is
 *                  used when unset)
 *
 * The scratch DB is created owned by the admin user, migrated with the real
 * runner, then the whole vitest suite runs against it (the suite resets
 * tables between files, so the run is deterministic), and the DB is dropped
 * afterwards. This catches PostgreSQL-only bugs that the default SQLite
 * suite cannot — e.g. migration 012's table-lock self-deadlock.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_URL = process.env.PG_ADMIN_URL || 'postgres://postgres:postgres@localhost:5432/postgres';
const SCRATCH_DB = process.env.PG_TEST_DB || 'oms_local_test';
const KEEP = process.argv.includes('--keep');

const started = Date.now();
const phase = (label) => console.log(`[pg-local] ${label} (${((Date.now() - started) / 1000).toFixed(1)}s)`);

// App connection = the admin URL with the database swapped to the scratch DB.
const admin = new URL(ADMIN_URL);
const appUrl = new URL(ADMIN_URL);
appUrl.pathname = `/${SCRATCH_DB}`;

const appEnv = {
  ...process.env,
  NODE_ENV: 'test',
  JWT_SECRET: process.env.JWT_SECRET || 'pg-local-test-secret-0123456789abcdef',
  DB_DIALECT: 'postgres',
  DATABASE_URL: appUrl.toString(),
};

let exitCode = 1;
const adminClient = new pg.Client({ connectionString: ADMIN_URL });

try {
  await adminClient.connect();
  phase(`admin connected (${admin.hostname}:${admin.port || 5432})`);

  // Fresh scratch database each run (idempotent, safe — it's scratch).
  await adminClient.query(`DROP DATABASE IF EXISTS ${scratchIdent(SCRATCH_DB)}`);
  await adminClient.query(`CREATE DATABASE ${scratchIdent(SCRATCH_DB)}`);
  phase(`scratch database "${SCRATCH_DB}" created`);

  // 1. Migrations through the real runner.
  phase('applying migrations…');
  const migrate = spawnSync(
    process.execPath,
    ['scripts/migrate.js', 'up'],
    { cwd: ROOT, env: appEnv, stdio: 'inherit' }
  );
  if (migrate.status !== 0) {
    console.error('[pg-local] migrations failed — aborting.');
  } else {
    phase('migrations applied');

    // 2. Full backend test suite against PostgreSQL (mirrors the CI job).
    phase('running full backend suite…');
    const test = spawnSync('npx', ['vitest', 'run'], { cwd: ROOT, env: appEnv, stdio: 'inherit', shell: process.platform === 'win32' });
    exitCode = test.status ?? 1;
    if (exitCode !== 0) {
      console.error(`[pg-local] test suite exited ${exitCode}.`);
    } else {
      phase('all tests passed against PostgreSQL');
    }
  }
} catch (error) {
  console.error('[pg-local] failed:', error.message);
} finally {
  if (!KEEP) {
    try {
      await adminClient.query(`DROP DATABASE IF EXISTS ${scratchIdent(SCRATCH_DB)} WITH (FORCE)`);
      phase(`scratch database dropped (${KEEP ? '' : 'not '}kept)`);
    } catch (error) {
      console.error('[pg-local] cleanup failed:', error.message);
    }
  }
  await adminClient.end().catch(() => {});
}

console.log(
  exitCode === 0
    ? `\n✅ PG-local suite passed in ${((Date.now() - started) / 1000).toFixed(1)}s`
    : `\n❌ PG-local suite failed (${exitCode})`
);
process.exit(exitCode);

/** Identifier quoting is defensive — the name is env-controlled anyway. */
function scratchIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}
