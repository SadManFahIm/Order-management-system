import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QueryTypes, Sequelize } from 'sequelize';
import sequelize from '../src/config/db.js';
import { migrateUp } from './migrate.js';

/**
 * v1 → v2 data migration (schema doc §8).
 *
 * Copies the legacy SQLite database (v1 model tables) into the migrated V2
 * schema under a single default tenant ("Your Restaurant"). Works against any
 * target the backend can connect to (PostgreSQL for the real cutover; SQLite
 * for tests/dry-runs), because all DML here is portable.
 *
 * Usage:
 *   npm run db:migrate:v1 -- --source ./data.sqlite [--force]
 *
 * The target is the configured backend database (DB_DIALECT + DATABASE_URL, or
 * DB_STORAGE). The script refuses to run when the target already holds data
 * unless --force is passed, and refuses a source that equals the target file.
 * The whole data copy runs inside ONE transaction — a failure rolls everything
 * back, so the target is never left half-populated.
 *
 * Mapping (doc §8.2): users→users (+password_hash rename, admins get an owner
 * membership), products→menu_items under a "General" category, promotions +
 * promotion_slabs (remapped), orders→orders (status 'placed', payment_status
 * 'unpaid', money → DECIMAL), order_items→order_items (menu_item_id remap,
 * item_name snapshot). IDs are preserved 1:1 so remap tables are implicit.
 */

const DEFAULT_TENANT = { name: 'Your Restaurant', slug: 'default' };
const GENERAL_CATEGORY = 'General';

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const now = () => new Date();

function parseArgs(argv) {
  const flag = (key) => {
    const i = argv.indexOf(key);
    return i !== -1 ? argv[i + 1] : null;
  };
  return {
    source: flag('--source'),
    force: argv.includes('--force'),
  };
}

/** Pick the source columns that exist, so both true v1 and evolved dev DBs work. */
async function pickColumns(source, table, required, optional = []) {
  const existing = await source.getQueryInterface().describeTable(table);
  const wanted = [...required, ...optional];
  const present = wanted.filter((col) => col in existing);
  const missing = required.filter((col) => !(col in existing));
  if (missing.length > 0) {
    throw new Error(`v1 source table "${table}" is missing required column(s): ${missing.join(', ')}`);
  }
  return present.map((col) => `"${col}"`).join(', ');
}

async function insertOne(target, sql, replacements, transaction) {
  await target.query(sql, { replacements, type: QueryTypes.INSERT, transaction });
}

export async function runV1ToV2Migration({
  sourcePath,
  target = sequelize,
  force = false,
  logger = console,
} = {}) {
  if (!sourcePath) throw new Error('--source <v1 sqlite path> is required');
  if (!path.isAbsolute(sourcePath)) sourcePath = path.resolve(sourcePath);

  const source = new Sequelize({ dialect: 'sqlite', storage: sourcePath, logging: false });
  try {
    await source.authenticate();
  } catch (error) {
    throw new Error(`Cannot open v1 source database "${sourcePath}": ${error.message}`);
  }

  // Refuse to copy a database onto itself.
  if (target.getDialect() === 'sqlite') {
    const targetStorage = path.resolve(String(target.options.storage || ''));
    if (targetStorage === sourcePath) {
      throw new Error('Source and target are the same file — refusing to copy onto itself.');
    }
  }

  const prevLogging = target.options.logging;
  target.options.logging = false; // the script reports its own progress
  try {
    // 0. Ensure the target schema exists (no-op when already migrated).
    await migrateUp(target);

    // 1. Refuse a non-empty target unless forced.
    const targetUsersRows = await target.query('SELECT COUNT(*) AS n FROM users', {
      type: QueryTypes.SELECT,
    });
    const targetUsers = Number(targetUsersRows[0]?.n ?? 0);
    if (targetUsers > 0 && !force) {
      throw new Error(
        'Target "users" table is not empty — refusing to overwrite. ' +
          'Use --force only with a fresh/scratch target (the copy is transactional; ' +
          'a failed run leaves nothing behind).'
      );
    }

    // ── Data copy: single transaction, atomic ──────────────────────────────
    let v1UsersCount = 0;
    let v1ProductsCount = 0;
    let v1OrdersCount = 0;
    await target.transaction(async (t) => {
      // 2. Default tenant.
      const findTenant = async () => {
        const rows = await target.query('SELECT id FROM tenants WHERE slug = :slug', {
          replacements: { slug: DEFAULT_TENANT.slug },
          type: QueryTypes.SELECT,
          transaction: t,
        });
        return rows[0] ?? null;
      };
      let tenant = await findTenant();
      if (!tenant) {
        await insertOne(
          target,
          `INSERT INTO tenants (name, slug, status, settings, created_at, updated_at)
           VALUES (:name, :slug, 'active', '{}', :now, :now)`,
          { ...DEFAULT_TENANT, now: now() },
          t
        );
        tenant = await findTenant();
      }
      const tenantId = tenant.id;
      logger.log(`[v1→v2] default tenant #${tenantId} (${DEFAULT_TENANT.name})`);

      // 3. Users → users (password → password_hash; platform admins get owner membership).
      const userCols = await pickColumns(source, 'Users', ['id', 'name', 'email', 'password'], [
        'platform_role',
        'email_verified_at',
        'two_factor_enabled',
        'two_factor_secret',
      ]);
      const v1Users = await source.query(`SELECT ${userCols} FROM Users`, {
        type: QueryTypes.SELECT,
      });
      for (const u of v1Users) {
        const role = u.platform_role ?? 'member';
        await insertOne(
          target,
          `INSERT INTO users (id, name, email, password_hash, platform_role, email_verified_at,
                              two_factor_enabled, two_factor_secret, locale, created_at, updated_at)
           VALUES (:id, :name, :email, :password_hash, :role, :email_verified_at,
                   :two_factor_enabled, :two_factor_secret, 'en', :now, :now)`,
          {
            id: u.id,
            name: u.name,
            email: u.email,
            password_hash: u.password,
            role,
            email_verified_at: u.email_verified_at ?? null,
            two_factor_enabled: u.two_factor_enabled ? 1 : 0,
            two_factor_secret: u.two_factor_secret ?? null,
            now: now(),
          },
          t
        );
        if (role === 'platform_admin') {
          await insertOne(
            target,
            `INSERT INTO user_tenants (user_id, tenant_id, role, created_at)
             VALUES (:user_id, :tenant_id, 'owner', :now)`,
            { user_id: u.id, tenant_id: tenantId, now: now() },
            t
          );
        }
      }
      v1UsersCount = v1Users.length;
      logger.log(`[v1→v2] users: ${v1Users.length}`);

      // 4. "General" menu category + products → menu_items (base_price → DECIMAL).
      await insertOne(
        target,
        `INSERT INTO menu_categories (tenant_id, name, sort_order, is_active, created_at, updated_at)
         VALUES (:tenant_id, :name, 0, 1, :now, :now)`,
        { tenant_id: tenantId, name: GENERAL_CATEGORY, now: now() },
        t
      );
      const categoryRows = await target.query(
        'SELECT id FROM menu_categories WHERE tenant_id = :tenant_id AND name = :name',
        {
          replacements: { tenant_id: tenantId, name: GENERAL_CATEGORY },
          type: QueryTypes.SELECT,
          transaction: t,
        }
      );
      const category = categoryRows[0];

      const productCols = await pickColumns(
        source,
        'Products',
        ['id', 'name', 'price', 'enabled'],
        ['description', 'prep_minutes', 'image_url']
      );
      const v1Products = await source.query(`SELECT ${productCols} FROM Products`, {
        type: QueryTypes.SELECT,
      });
      for (const p of v1Products) {
        await insertOne(
          target,
          `INSERT INTO menu_items (id, tenant_id, category_id, name, description, image_url,
                                   base_price, prep_minutes, nutrition, ingredients, is_available,
                                   availability, version, created_at, updated_at)
           VALUES (:id, :tenant_id, :category_id, :name, :description, :image_url,
                   :base_price, :prep_minutes, '{}', '[]', :is_available,
                   '{}', 1, :now, :now)`,
          {
            id: p.id,
            tenant_id: tenantId,
            category_id: category.id,
            name: p.name,
            description: p.description ?? null,
            image_url: p.image_url ?? null,
            base_price: round2(p.price),
            prep_minutes: p.prep_minutes ?? null,
            is_available: p.enabled == null || Number(p.enabled) === 1 ? 1 : 0,
            now: now(),
          },
          t
        );
      }
      v1ProductsCount = v1Products.length;
      logger.log(`[v1→v2] menu_items: ${v1Products.length} (category "${GENERAL_CATEGORY}")`);

      // 5. Promotions → promotions (is_enabled), promotion_slabs remapped by id.
      const promoCols = await pickColumns(
        source,
        'Promotions',
        ['id', 'title', 'type', 'start_date', 'end_date', 'enabled'],
        ['percentage_value', 'fixed_value']
      );
      const v1Promotions = await source.query(`SELECT ${promoCols} FROM Promotions`, {
        type: QueryTypes.SELECT,
      });
      for (const promo of v1Promotions) {
        await insertOne(
          target,
          `INSERT INTO promotions (id, tenant_id, title, type, percentage_value, fixed_value,
                                   start_date, end_date, is_enabled, created_at, updated_at)
           VALUES (:id, :tenant_id, :title, :type, :percentage_value, :fixed_value,
                   :start_date, :end_date, :is_enabled, :now, :now)`,
          {
            id: promo.id,
            tenant_id: tenantId,
            title: promo.title,
            type: promo.type ?? 'percentage',
            percentage_value: promo.percentage_value != null ? round2(promo.percentage_value) : null,
            fixed_value: promo.fixed_value != null ? round2(promo.fixed_value) : null,
            start_date: promo.start_date,
            end_date: promo.end_date,
            is_enabled: promo.enabled == null || Number(promo.enabled) === 1 ? 1 : 0,
            now: now(),
          },
          t
        );
      }

      // PromotionSlabs is optional in a minimal v1 DB — treat a missing table as empty.
      let v1Slabs = [];
      try {
        const slabCols = await pickColumns(source, 'PromotionSlabs', [
          'id',
          'promotion_id',
          'min_weight_gm',
          'max_weight_gm',
          'discount_per_500gm',
        ]);
        v1Slabs = await source.query(`SELECT ${slabCols} FROM PromotionSlabs`, {
          type: QueryTypes.SELECT,
        });
      } catch (error) {
        logger.log(`[v1→v2] PromotionSlabs absent in source (${error.message}); copying 0`);
      }
      for (const slab of v1Slabs) {
        await insertOne(
          target,
          `INSERT INTO promotion_slabs (id, promotion_id, min_weight_gm, max_weight_gm, discount_per_500gm)
           VALUES (:id, :promotion_id, :min_weight_gm, :max_weight_gm, :discount_per_500gm)`,
          {
            id: slab.id,
            promotion_id: slab.promotion_id,
            min_weight_gm: slab.min_weight_gm,
            max_weight_gm: slab.max_weight_gm,
            discount_per_500gm: round2(slab.discount_per_500gm),
          },
          t
        );
      }
      logger.log(`[v1→v2] promotions: ${v1Promotions.length}, slabs: ${v1Slabs.length}`);

      // 6. Orders → orders (status 'placed', payment_status 'unpaid', money → DECIMAL).
      const orderCols = await pickColumns(
        source,
        'Orders',
        ['id', 'customer_name', 'subtotal', 'total_discount', 'grand_total'],
        ['customer_phone', 'customer_address']
      );
      const v1Orders = await source.query(`SELECT ${orderCols} FROM Orders`, {
        type: QueryTypes.SELECT,
      });
      for (const order of v1Orders) {
        await insertOne(
          target,
          `INSERT INTO orders (id, tenant_id, order_no, status, type, delivery_address, notes,
                               delivery_fee, subtotal_amount, discount_amount, tax_amount,
                               total_amount, currency, payment_status, created_at, updated_at)
           VALUES (:id, :tenant_id, :order_no, 'placed', 'pickup', :delivery_address, :notes,
                   0, :subtotal_amount, :discount_amount, 0,
                   :total_amount, 'BDT', 'unpaid', :now, :now)`,
          {
            id: order.id,
            tenant_id: tenantId,
            order_no: `V1-${String(order.id).padStart(8, '0')}`,
            delivery_address: order.customer_address ?? null,
            notes: [order.customer_name, order.customer_phone].filter(Boolean).join(' · ') || null,
            subtotal_amount: round2(order.subtotal),
            discount_amount: round2(order.total_discount ?? 0),
            total_amount: round2(order.grand_total),
            now: now(),
          },
          t
        );
      }

      // 7. Order items → order_items (menu_item_id remap + item_name snapshot).
      await pickColumns(source, 'OrderItems', [
        'id',
        'order_id',
        'product_id',
        'quantity',
        'unit_price',
        'line_total',
      ], ['discount']);
      const itemHasDiscount =
        (await source.getQueryInterface().describeTable('OrderItems')).discount != null;
      const v1Items = await source.query(
        `SELECT oi.id, oi.order_id, oi.product_id, oi.quantity, oi.unit_price, oi.line_total,
                ${itemHasDiscount ? 'oi.discount' : '0 AS discount'},
                p.name AS product_name
         FROM OrderItems oi LEFT JOIN Products p ON p.id = oi.product_id`,
        { type: QueryTypes.SELECT }
      );
      for (const item of v1Items) {
        await insertOne(
          target,
          `INSERT INTO order_items (id, tenant_id, order_id, menu_item_id, item_name, quantity,
                                    unit_amount, discount_amount, line_amount, version)
           VALUES (:id, :tenant_id, :order_id, :menu_item_id, :item_name, :quantity,
                   :unit_amount, :discount_amount, :line_amount, 1)`,
          {
            id: item.id,
            tenant_id: tenantId,
            order_id: item.order_id,
            menu_item_id: item.product_id ?? null,
            item_name: item.product_name ?? `Item #${item.product_id ?? item.id}`,
            quantity: item.quantity,
            unit_amount: round2(item.unit_price),
            discount_amount: round2(item.discount ?? 0),
            line_amount: round2(item.line_total),
          },
          t
        );
      }
      v1OrdersCount = v1Orders.length;
      logger.log(`[v1→v2] orders: ${v1Orders.length}, order_items: ${v1Items.length}`);
    });

    // 8. Fix PG sequences so future inserts never collide with migrated IDs.
    if (target.getDialect() === 'postgres') {
      const tables = [
        'users',
        'tenants',
        'menu_categories',
        'menu_items',
        'promotions',
        'promotion_slabs',
        'orders',
        'order_items',
      ];
      for (const table of tables) {
        await target.query(
          `SELECT setval(pg_get_serial_sequence(:table, 'id'),
                         COALESCE((SELECT MAX(id) FROM "${table}"), 1))`,
          { replacements: { table } }
        );
      }
      logger.log('[v1→v2] PG sequences advanced past migrated IDs');
    }

    // 9. Verification (blocking checks).
    const issues = await verifyCopy(source, target, logger);
    if (issues.length > 0) {
      throw new Error(`[v1→v2] verification FAILED (${issues.length} issue(s)):\n- ${issues.join('\n- ')}`);
    }
    logger.log('[v1→v2] verification passed ✔');
    logger.log(
      '[v1→v2] done. Cutover: point the backend at the target DB (DATABASE_URL), run npm run db:migrate, boot, and smoke-test.'
    );
    return { users: v1UsersCount, menuItems: v1ProductsCount, orders: v1OrdersCount };
  } finally {
    target.options.logging = prevLogging;
    await source.close();
  }
}

/** Row-count parity + money invariants + FK integrity. Returns a list of issues. */
export async function verifyCopy(source, target, logger = console) {
  const issues = [];

  const checks = [
    ['Users', 'users'],
    ['Products', 'menu_items'],
    ['Promotions', 'promotions'],
    ['PromotionSlabs', 'promotion_slabs'],
    ['Orders', 'orders'],
    ['OrderItems', 'order_items'],
  ];
  for (const [sourceTable, targetTable] of checks) {
    const srcRows = await source.query(`SELECT COUNT(*) AS n FROM "${sourceTable}"`, {
      type: QueryTypes.SELECT,
    });
    const tgtRows = await target.query(`SELECT COUNT(*) AS n FROM "${targetTable}"`, {
      type: QueryTypes.SELECT,
    });
    const srcN = Number(srcRows[0]?.n ?? 0);
    const tgtN = Number(tgtRows[0]?.n ?? 0);
    if (srcN !== tgtN) {
      issues.push(`${sourceTable} → ${targetTable}: ${srcN} vs ${tgtN}`);
    } else {
      logger.log(`  ✓ ${sourceTable} → ${targetTable}: ${srcN}`);
    }
  }

  // Money invariants per order: subtotal - discount == total, and line-item
  // sums must reconcile with the order total (doc §8.3).
  const orders = await target.query(
    `SELECT id, subtotal_amount, discount_amount, total_amount,
            (SELECT COALESCE(SUM(line_amount), 0) FROM order_items oi WHERE oi.order_id = o.id) AS items_sum
     FROM orders o`,
    { type: QueryTypes.SELECT }
  );
  let moneyMismatches = 0;
  for (const o of orders) {
    const expected = round2(Number(o.subtotal_amount) - Number(o.discount_amount));
    if (Math.abs(expected - Number(o.total_amount)) > 0.01) {
      moneyMismatches += 1;
      issues.push(
        `order #${o.id}: subtotal(${o.subtotal_amount}) - discount(${o.discount_amount}) != total(${o.total_amount})`
      );
    }
    if (Math.abs(Number(o.items_sum) - Number(o.total_amount)) > 0.01) {
      moneyMismatches += 1;
      issues.push(`order #${o.id}: line items sum (${o.items_sum}) != total (${o.total_amount})`);
    }
  }
  if (moneyMismatches === 0) logger.log(`  ✓ money invariants held for ${orders.length} orders`);
  else issues.push(`${moneyMismatches} order(s) broke the money invariants`);

  // FK integrity: no orphan order_items.
  const orphanRows = await target.query(
    'SELECT COUNT(*) AS n FROM order_items oi LEFT JOIN orders o ON oi.order_id = o.id WHERE o.id IS NULL',
    { type: QueryTypes.SELECT }
  );
  const orphans = Number(orphanRows[0]?.n ?? 0);
  if (orphans > 0) issues.push(`${orphans} order_items reference missing orders`);
  else logger.log('  ✓ no orphan order_items');

  return issues;
}

async function main() {
  const { source, force } = parseArgs(process.argv.slice(2));
  try {
    const result = await runV1ToV2Migration({ sourcePath: source, force });
    console.log(
      `[v1→v2] copied ${result.users} users, ${result.menuItems} menu items, ${result.orders} orders`
    );
  } catch (error) {
    console.error('v1→v2 migration failed:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
