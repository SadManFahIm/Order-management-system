/**
 * CLI seed script for the Dhaka restaurant catalog (Phase 3).
 *
 * Usage:
 *   npm run seed:restaurants
 *   npm run seed:restaurants -- --slug kfc-dhaka   # seed a single brand
 *
 * Idempotent: restaurants are upserted by slug; re-running never duplicates
 * items. Menu items are created only when missing. No users are created —
 * ownership is assigned later via the team-members API.
 */
import { parseArgs } from 'node:util';
import sequelize from '../src/config/db.js';
import { ensureBootstrapData } from '../src/config/schemaSync.js';
import '../src/models/index.js';
import {
  Tenant,
  Product,
  Plan,
  Subscription,
  MenuCategory,
  ItemVariant,
  ItemAddon,
} from '../src/models/index.js';
import { RESTAURANT_SEEDS } from './data/restaurants.js';

const { values } = parseArgs({
  options: { slug: { type: 'string' } },
});

const targetSlug = values.slug;
const seeds = targetSlug
  ? RESTAURANT_SEEDS.filter((r) => r.slug === targetSlug)
  : RESTAURANT_SEEDS;

if (seeds.length === 0) {
  console.error(`No restaurant found with slug "${targetSlug}".`);
  process.exit(1);
}

try {
  // Schema is migration-managed (models are aligned to the migration DDL);
  // sync() is a no-op on a migrated database and a fallback on fresh ones.
  await sequelize.sync();
  // Plans + default tenant (idempotent) — restaurants attach to the Starter plan.
  await ensureBootstrapData();

  const starter = await Plan.findOne({ where: { code: 'starter' } });
  let created = 0;
  let updated = 0;
  let items = 0;
  let categories = 0;
  let variants = 0;
  let addons = 0;

  for (const seed of seeds) {
    let tenant = await Tenant.findOne({ where: { slug: seed.slug } });
    if (!tenant) {
      tenant = await Tenant.create({
        name: seed.name,
        slug: seed.slug,
        status: 'active',
        plan_id: starter?.id ?? null,
        settings: { description: seed.description, cuisine: seed.cuisine ?? null },
      });
      const now = new Date();
      await Subscription.findOrCreate({
        where: { tenant_id: tenant.id },
        defaults: {
          plan_id: starter?.id ?? null,
          status: 'trialing',
          current_period_start: now,
          current_period_end: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      created += 1;
    } else {
      await tenant.update({
        name: seed.name,
        settings: { description: seed.description, cuisine: seed.cuisine ?? null },
      });
      updated += 1;
    }

    // Categories (Phase 4): seed.categoryDefaults, e.g. [{ name: 'Burgers' }]
    const categoryIds = {};
    for (const cat of seed.categoryDefaults || []) {
      const existing = await MenuCategory.findOne({
        where: { tenant_id: tenant.id, name: cat.name },
      });
      if (existing) {
        categoryIds[cat.name] = existing.id;
        continue;
      }
      const row = await MenuCategory.create({
        tenant_id: tenant.id,
        name: cat.name,
        sort_order: cat.sort_order ?? 0,
      });
      categoryIds[cat.name] = row.id;
      categories += 1;
    }

    for (const item of seed.items) {
      let product = await Product.findOne({
        where: { tenant_id: tenant.id, name: item.name },
      });
      if (!product) {
        product = await Product.create({
          tenant_id: tenant.id,
          name: item.name,
          description: item.description,
          price: item.price,
          weight_gm: item.weight_gm,
          enabled: true,
          category_id: item.category ? categoryIds[item.category] ?? null : null,
          prep_minutes: item.prep_minutes ?? null,
        });
        items += 1;
      } else {
        // Existing product: assign category / prep time if not yet set.
        const categoryId = item.category ? categoryIds[item.category] ?? null : null;
        const updates = {};
        if (categoryId !== null && product.category_id === null) updates.category_id = categoryId;
        if (item.prep_minutes != null && product.prep_minutes === null) updates.prep_minutes = item.prep_minutes;
        if (Object.keys(updates).length > 0) await product.update(updates);
      }

      // Backfill variants/add-ons idempotently (by product + name) so
      // re-running the seed on an existing catalog still enriches it.
      for (const v of item.variants || []) {
        const has = await ItemVariant.findOne({
          where: { tenant_id: tenant.id, product_id: product.id, name: v.name },
        });
        if (has) continue;
        await ItemVariant.create({
          tenant_id: tenant.id,
          product_id: product.id,
          name: v.name,
          price_adjustment: v.price_adjustment ?? 0,
          sort_order: v.sort_order ?? 0,
        });
        variants += 1;
      }
      for (const a of item.addons || []) {
        const has = await ItemAddon.findOne({
          where: { tenant_id: tenant.id, product_id: product.id, name: a.name },
        });
        if (has) continue;
        await ItemAddon.create({
          tenant_id: tenant.id,
          product_id: product.id,
          name: a.name,
          price: a.price ?? 0,
          sort_order: a.sort_order ?? 0,
        });
        addons += 1;
      }
    }
  }

  console.log(`✅ Restaurants: ${created} created, ${updated} updated (${seeds.length} total)`);
  console.log(`✅ Menu items added: ${items}`);
  console.log(`✅ Categories added: ${categories}`);
  console.log(`✅ Variants added: ${variants}`);
  console.log(`✅ Add-ons added: ${addons}`);
  await sequelize.close();
} catch (err) {
  const details = (err.errors || []).map((e) => `${e.path}: ${e.message}`).join('; ');
  console.error('Failed to seed restaurants:', err.message, details);
  if (process.env.SEED_DEBUG) console.error(err);
  await sequelize.close().catch(() => {});
  process.exit(1);
}
