import { Sequelize, DataTypes } from 'sequelize';
import pg from 'pg';
import { env } from './env.js';

/**
 * PG returns BIGINT (int8) and NUMERIC/DECIMAL as *strings* to avoid precision
 * loss — but the whole app (zod `z.number()` validators, === comparisons,
 * object-key lookups, API JSON) expects plain JS numbers, exactly like SQLite
 * returns them. Registering per-OID parsers keeps both dialects type-identical.
 *
 * Safe here: ids are small auto-increment BIGINTs (well within
 * Number.MAX_SAFE_INTEGER) and money uses NUMERIC(12,2) — two decimals.
 *
 * Note: for NUMERIC we must ALSO override the dialect's DECIMAL.parse —
 * Sequelize keeps its own per-connection parser map (consulted before the
 * driver's) and re-registers it after OIDs load on first connect.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => (value === null ? null : Number(value)));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => (value === null ? null : parseFloat(value)));
DataTypes.postgres.DECIMAL.parse = (value) => (value === null ? null : parseFloat(value));

/**
 * Sequelize instance — dialect selected by environment:
 *
 *  - sqlite (default): zero-config local dev; storage = DB_STORAGE. This is
 *    the Phase 1–2 bridge: `sync()` + `ensureSchemaColumns()` manage schema.
 *  - postgres (V2 target): connected via DATABASE_URL, or the discrete
 *    DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD variables. Schema is managed
 *    exclusively by the migration runner (`npm run db:migrate`) — see
 *    docs/03-database-schema.md §7.
 *
 * Fails fast at boot if the required env is missing/malformed (env.js).
 */
function buildSequelize() {
  const logging = env.NODE_ENV === 'development' ? console.log : false;

  if (env.DB_DIALECT === 'postgres') {
    const options = {
      dialect: 'postgres',
      logging,
      // Optional TLS for managed providers (e.g. Neon, RDS with SSL).
      dialectOptions: env.DB_SSL
        ? { ssl: { require: true, rejectUnauthorized: false } }
        : undefined,
    };
    if (env.DATABASE_URL) {
      return new Sequelize(env.DATABASE_URL, options);
    }
    return new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD, {
      ...options,
      host: env.DB_HOST,
      port: env.DB_PORT,
    });
  }

  return new Sequelize({
    dialect: 'sqlite',
    storage: env.DB_STORAGE,
    logging,
  });
}

const sequelize = buildSequelize();

export default sequelize;
