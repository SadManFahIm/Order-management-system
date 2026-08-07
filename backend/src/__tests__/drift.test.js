import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Models ↔ migrations drift gate.
 *
 * The app runs against a *migrations-only* database (both SQLite and
 * PostgreSQL), so the Sequelize models MUST stay a subset of the migration
 * DDL: every table a model maps to must exist, and every column it writes
 * (field-mapped) must exist. This test fails the moment a model declares a
 * column the migrations never created — the exact class of bug that broke
 * boot earlier (order_no, item_name, group_name, weight_gm, customer_*,
 * audit metadata).
 *
 * Runs on a dedicated scratch SQLite DB (the shared test DB is sync()-shaped;
 * this needs the true migration shape). The PostgreSQL CI job additionally
 * exercises the real thing via the migration-aware test reset.
 */
const SCRATCH_DB = './data.drift-test.sqlite';
process.env.DB_STORAGE = SCRATCH_DB;
process.env.DB_DIALECT = 'sqlite';

const { default: sequelize } = await import('../config/db.js');
const models = await import('../models/index.js');
const { migrateUp } = await import('../../scripts/migrate.js');

describe('models ↔ migrations alignment (drift gate)', () => {
  beforeAll(async () => {
    await migrateUp(sequelize);
  });

  afterAll(async () => {
    await sequelize.close();
    fs.rmSync(path.join(process.cwd(), SCRATCH_DB), { force: true });
  });

  it('every model table exists in the migration schema', async () => {
    const qi = sequelize.getQueryInterface();
    const missingTables = [];
    for (const [name, model] of Object.entries(models)) {
      if (typeof model?.getTableName !== 'function') continue;
      const table = model.getTableName();
      if (!(await qi.tableExists(table))) missingTables.push(`${name} → ${table}`);
    }
    expect(missingTables).toEqual([]);
  });

  it('every model column (field-mapped) exists in the migration schema', async () => {
    const qi = sequelize.getQueryInterface();
    const missing = [];
    for (const [name, model] of Object.entries(models)) {
      if (typeof model?.getTableName !== 'function') continue;
      const table = model.getTableName();
      const columns = await qi.describeTable(table);
      for (const [attribute, definition] of Object.entries(model.getAttributes())) {
        const column = definition.field ?? attribute;
        if (!(column in columns)) {
          missing.push(`${name}.${attribute} → ${table}.${column}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
