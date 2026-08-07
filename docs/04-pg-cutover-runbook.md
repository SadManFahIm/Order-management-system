# PostgreSQL Cutover Runbook — v1 SQLite → V2 PostgreSQL

**Goal:** move a running v1-era deployment from SQLite (`backend/data.sqlite`) to PostgreSQL 16 with **zero data loss**, **blocking verification**, and a **one-env-change rollback**. This is the operational companion to the schema in [`03-database-schema.md`](./03-database-schema.md) (§8) and the tooling it ships: the migration runner (`npm run db:migrate`) and the v1→v2 data copy (`npm run db:migrate:v1`).

- Companion docs: [`01-codebase-audit.md`](./01-codebase-audit.md) · [`02-v2-roadmap.md`](./02-v2-roadmap.md) · [`03-database-schema.md`](./03-database-schema.md)
- Status: **ready.** The exact commands below were exercised end-to-end in CI against a real `postgres:16` (migrate → copy → verify → production-mode boot smoke) and locally against SQLite dry-runs.

---

## 1. When to Use This Runbook

- You are on SQLite in production/dev and want the V2 production database.
- You need PostgreSQL for: multi-tenant SaaS features (plans, subscriptions), the storefront, payments, or the full-text/inventory roadmap.
- The schema and copy tooling are already shipped — this is **execution**, not development.

> Time budget: ~30–60 min total for a typical dataset (thousands of orders). The data copy is **transactional**: a failure rolls back, the target is never half-populated.

---

## 2. Preflight Checklist

| # | Check | Command | Pass criteria |
|---|---|---|---|
| 1 | Backend healthy on SQLite | `curl http://localhost:4000/health` | `{"status":"ok","database":"ok"}` |
| 2 | SQLite file exists & non-trivial | `ls -la backend/data.sqlite` | File present; note size + a `PRAGMA integrity_check;` result (`ok`) |
| 3 | Migration runner works | `cd backend && npm run db:migrate:status` | Lists 001–005 as `pending` or `applied` without errors |
| 4 | PostgreSQL 16 reachable | `docker compose up -d db && docker compose exec db pg_isready -U oms` | `accepting connections` |
| 5 | `pg` driver installed | `cd backend && node -e "require('pg')"` | No error |
| 6 | Backups staged | copy of `data.sqlite` + `pg_dump` of target | Both on disk, read-only |
| 7 | Maintenance window agreed | — | Writes frozen during step 4 (see §4) |

**Env reference** (backend `.env` / platform config):

| Variable | SQLite (now) | PostgreSQL (target) |
|---|---|---|
| `DB_DIALECT` | `sqlite` (unset) | `postgres` |
| `DATABASE_URL` | — | `postgres://oms:oms@localhost:5432/oms` |
| `DB_STORAGE` | `./data.sqlite` | unused (remove) |
| `DB_SSL` | — | `1` for managed providers (Neon, RDS) |

---

## 3. Provision the Target Database

Local dev stack (Docker):

```bash
docker compose up -d db
docker compose exec db pg_isready -U oms -d oms
```

Managed provider (Neon / RDS / Supabase): create the database, then **pre-create extensions the app may rely on** (the scaffold DDL does not require `citext` yet — this becomes mandatory when the PG-tuned migration set lands):

```sql
CREATE EXTENSION IF NOT EXISTS citext;
```

> The migration runner creates everything else (`schema_migrations` included) on first `db:migrate`.

---

## 4. Maintenance Procedure (write-freeze)

The API writes to SQLite during the copy. To avoid losing writes that happen mid-migration:

1. Put the API in read-only/maintenance mode or stop it: `docker compose stop api` (or `kill` the backend process).
2. Keep the frontend up if you want a "maintenance" screen — all writes will fail-fast because the API is down.
3. **Do not delete `data.sqlite`.** It is the rollback point and the source of truth until verification passes.

---

## 5. Step-by-Step Cutover

### 5.1 Backup (always)

```bash
cd backend
cp data.sqlite "data.sqlite.pre-cutover-$(date +%Y%m%d-%H%M)"
pg_dump "postgres://oms:oms@localhost:5432/oms" > oms-pg-baseline.sql   # empty/new target
```

### 5.2 Dry run against a scratch SQLite (validates the copy + verification logic)

```bash
cd backend
# Migrate a throwaway SQLite DB (mirrors what PG will get), then copy v1 → it.
DB_STORAGE=./data.dryrun.sqlite npm run db:migrate
DB_STORAGE=./data.dryrun.sqlite npm run db:migrate:v1 -- --source ./data.sqlite --force
rm -f data.dryrun.sqlite
```

Expected tail: `[v1→v2] verification passed ✔` and a summary of users / menu items / orders copied.

### 5.3 Apply the schema to PostgreSQL

```bash
cd backend
DB_DIALECT=postgres DATABASE_URL=postgres://oms:oms@localhost:5432/oms npm run db:migrate
DB_DIALECT=postgres DATABASE_URL=postgres://oms:oms@localhost:5432/oms npm run db:migrate:status
```

`status` must show all 5 migrations `applied`.

### 5.4 Copy the data

```bash
DB_DIALECT=postgres DATABASE_URL=postgres://oms:oms@localhost:5432/oms \
  npm run db:migrate:v1 -- --source ./data.sqlite --force
```

What it does (see `backend/scripts/migrate-v1-to-v2.js`):
- Runs inside **one transaction** — any failure rolls everything back.
- Creates the default tenant (`Your Restaurant`, slug `default`) and a `General` menu category.
- Copies `users` (`password` → `password_hash`), grants the platform admin an `owner` membership, products → `menu_items` (money rounded to 2dp), promotions + slabs, orders (`placed`/`unpaid`), order items (line snapshots + `menu_item_id` remap).
- Preserves IDs 1:1, then fixes PG sequences so new inserts never collide.
- Runs **blocking verification** (§8 of the schema doc): row-count parity per table, per-order money invariants, line-item reconciliation, FK integrity. Failures abort with a non-zero exit.

> **Note:** after the copy, the boot-time `ensureBootstrapData()` also provisions its own `default-restaurant` tenant (plans + legacy-user backfill home) alongside the copy's `default` ("Your Restaurant") tenant. Both are functional; if you prefer a single default workspace, rename/merge them in SQL after cutover (`UPDATE tenants SET slug='default' WHERE slug='default-restaurant'` only when no collisions).

### 5.5 Verify on the target before switching traffic

```bash
DB_DIALECT=postgres DATABASE_URL=postgres://oms:oms@localhost:5432/oms \
  node scripts/smoke-pg.js
```

`smoke-pg.js` boots the app in production mode (migrations no-op), checks `/health`, and logs in as the seeded admin. Independent spot checks you can run by hand:

```sql
-- row parity vs SQLite
SELECT (SELECT count(*) FROM users)       AS users,
       (SELECT count(*) FROM menu_items)  AS menu_items,
       (SELECT count(*) FROM orders)      AS orders;

-- money invariants (must return 0 rows)
SELECT o.id FROM orders o
WHERE o.subtotal_amount - o.discount_amount != o.total_amount;

-- FK integrity (must return 0)
SELECT count(*) FROM order_items oi
LEFT JOIN orders o ON oi.order_id = o.id WHERE o.id IS NULL;
```

### 5.6 Switch traffic (the flip)

1. Update the backend env: `DB_DIALECT=postgres`, `DATABASE_URL=…`, remove `DB_STORAGE`. Add `DB_SSL=1` for managed providers.
2. Restart the API. Boot runs migrations (idempotent) and `ensureBootstrapData()` (plans, default tenant, legacy-user backfill) automatically.
3. Run the e2e smoke suite against the new stack:

```bash
cd frontend && npx playwright test   # CI job `e2e` runs the same suite
```

4. Watch logs for errors and check `/health` reports `database: ok`.

---

## 6. Rollback Plan

The flip is **one env change**, so rollback is equally simple:

```bash
# 1. Stop the API
# 2. Restore the old env: DB_DIALECT=sqlite (or unset), DB_STORAGE=./data.sqlite
# 3. Start the API — it boots straight off the untouched SQLite file
```

- The SQLite file was never modified by the copy (the script only *reads* it), so rollback is lossless.
- Keep `data.sqlite` archived for **90 days** before deletion.
- PG writes made between cutover and rollback would be lost on flip-back — that is the one risk window; it closes once you delete the SQLite file after the 90-day soak.

---

## 7. Post-Cutover Hygiene

| Task | Command / Note |
|---|---|
| Daily PG backups | `pg_dump -Fc` via cron; test restores monthly |
| Read replica (optional) | `docker compose` or provider console |
| Vacuum / analyze | `VACUUM (ANALYZE);` after the import (stats drive the planner) |
| Retention jobs | audit/login trimming per schema doc §5 |
| Delete the SQLite file | only after 90-day soak + confirmed backups |
| Team knowledge | update the runbook with your real env values |

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Target "users" table is not empty — refusing to overwrite` | Target already has data | Use a fresh DB, or pass `--force` **only** when you are certain the target is disposable |
| `Cannot open v1 source database` | Wrong `--source` path | Pass an absolute path or run from `backend/` |
| Copy fails mid-way | Dialect mismatch (booleans, smallint, identifiers) | The failure is transactional — fix, re-run; see the CI `backend-postgres` job for the known traps |
| Boot fails on PG with `relation "X" does not exist` | Models vs migrations drift | Models are aligned to migrations 001–005; if you added a model column, ship a migration — never rely on `sync()` on PG |
| `password_hash` missing on login | Old data copied with wrong column | Never happens via the shipped script (it renames `password` → `password_hash`); check you didn't hand-craft an INSERT |
| Sequence collision after insert | Sequence not advanced | `SELECT setval(pg_get_serial_sequence('orders','id'), COALESCE(MAX(id),1)) FROM orders;` (the script does this automatically) |

---

*Runbook is a living document — update §5.6/§7 with your real env values after the first successful cutover.*
