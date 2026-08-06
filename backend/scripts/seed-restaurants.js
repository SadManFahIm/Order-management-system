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
import '../src/models/index.js';
import { Tenant, Product, Plan, Subscription } from '../src/models/index.js';
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
  await sequelize.sync();

  const starter = await Plan.findOne({ where: { code: 'starter' } });
  let created = 0;
  let updated = 0;
  let items = 0;

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

    for (const item of seed.items) {
      const existing = await Product.findOne({
        where: { tenant_id: tenant.id, name: item.name },
      });
      if (existing) continue;
      await Product.create({
        tenant_id: tenant.id,
        name: item.name,
        description: item.description,
        price: item.price,
        weight_gm: item.weight_gm,
        enabled: true,
      });
      items += 1;
    }
  }

  console.log(`✅ Restaurants: ${created} created, ${updated} updated (${seeds.length} total)`);
  console.log(`✅ Menu items added: ${items}`);
  await sequelize.close();
} catch (err) {
  console.error('Failed to seed restaurants:', err.message);
  await sequelize.close().catch(() => {});
  process.exit(1);
}
