import { DataTypes } from 'sequelize';
import sequelize from './db.js';

/**
 * Lightweight, idempotent schema evolution for EXISTING tables.
 *
 * `sequelize.sync()` only creates missing tables — it never adds columns to
 * tables that already exist, and `sync({ alter: true })` is unsafe on SQLite
 * (it recreates tables in a loop and can corrupt data). Until the full
 * migration system ships with the PostgreSQL migration (Phase 1 follow-up),
 * new columns on pre-existing tables are declared here and added only when
 * missing.
 */
const TABLE_COLUMNS = {
  Users: [
    {
      name: 'platform_role',
      definition: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'member' },
    },
    {
      name: 'email_verified_at',
      definition: { type: DataTypes.DATE, allowNull: true },
    },
    {
      name: 'two_factor_enabled',
      definition: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      name: 'two_factor_secret',
      definition: { type: DataTypes.STRING(255), allowNull: true },
    },
  ],
};

export async function ensureSchemaColumns() {
  const qi = sequelize.getQueryInterface();

  for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
    let existing;
    try {
      existing = await qi.describeTable(table);
    } catch {
      // Table does not exist yet — sync() will create it with the full shape.
      continue;
    }

    for (const column of columns) {
      if (!existing[column.name]) {
        console.log(`[schema] adding column ${table}.${column.name}`);
        await qi.addColumn(table, column.name, column.definition);
      }
    }
  }
}
