/**
 * Playwright e2e backend — boots the REAL API on a scratch database with
 * deterministic seed data, so the browser suite exercises the genuine stack
 * (routes, middleware, tenant scoping, promotion engine) — not mocks.
 *
 * Started by frontend/playwright.config.js (webServer) on port 4100 with
 * DB_STORAGE=./data.e2e.sqlite (isolated from the dev database). The Vite
 * dev server proxies /api to it via VITE_API_TARGET. The scratch DB is wiped
 * on every boot, so repeated runs are deterministic.
 *
 * NOTE: env vars must be set BEFORE the config module is imported (ESM
 * imports hoist), hence the dynamic imports below.
 */
process.env.NODE_ENV = 'development';
process.env.PORT = '4100';
process.env.DB_STORAGE = './data.e2e.sqlite';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e-only-secret-0123456789abcdef';

import fs from 'node:fs';
import bcrypt from 'bcryptjs';

const { default: sequelize } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');
const { migrateUp } = await import('./migrate.js');
const { ensureBootstrapData } = await import('../src/config/schemaSync.js');
const { User, Tenant, UserTenant, Product } = await import('../src/models/index.js');

const PORT = 4100;

try {
  sequelize.options.logging = false;
  fs.rmSync('./data.e2e.sqlite', { force: true });

  await migrateUp(sequelize);
  await ensureBootstrapData(); // plans + default tenant + default subscription

  const tenant = await Tenant.findOne({ where: { slug: 'default-restaurant' } });
  const admin = await User.create({
    name: 'E2E Admin',
    email: 'admin@oms.dev',
    password: await bcrypt.hash('Str0ngPass!42', 10),
    platform_role: 'platform_admin',
  });
  await UserTenant.findOrCreate({
    where: { user_id: admin.id, tenant_id: tenant.id },
    defaults: { role: 'owner' },
  });

  // Deterministic menu for the default workspace.
  await Product.create({
    tenant_id: tenant.id,
    name: 'Beef Kebab 250gm',
    description: 'Charcoal-grilled beef kebab',
    price: 320,
    weight_gm: 250,
    enabled: true,
    prep_minutes: 12,
  });
  await Product.create({
    tenant_id: tenant.id,
    name: 'Zinger Burger',
    description: 'Crispy chicken fillet burger',
    price: 260,
    weight_gm: 280,
    enabled: true,
    prep_minutes: 8,
  });

  app.listen(PORT, () => {
    console.log(`[e2e] backend ready on :${PORT} (scratch DB data.e2e.sqlite)`);
  });
} catch (error) {
  console.error('[e2e] boot failed:', error);
  process.exit(1);
}
