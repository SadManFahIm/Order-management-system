import { test, expect } from '@playwright/test';

/**
 * Public storefront menu (Phase 4) — no login required. The e2e backend
 * seeds the default-restaurant workspace with two products (Beef Kebab
 * 250gm, Zinger Burger), so the storefront page and the raw public API must
 * both render them.
 */
test('public menu page renders seeded items without logging in', async ({ page }) => {
  await page.goto('/m/default-restaurant');
  // The seeded merchant products render via the public API — no auth needed.
  await expect(page.getByText('Beef Kebab 250gm')).toBeVisible();
  await expect(page.getByText('Zinger Burger')).toBeVisible();
  // Beef Kebab's price is stable (no other e2e test edits it); Zinger's
  // price IS edited by products.spec.js, so we don't assert it here.
  await expect(page.getByText('৳ 320.00')).toBeVisible();
});

test('public menu API returns whitelisted fields without auth', async ({ request }) => {
  const res = await request.get('/api/public/restaurants/default-restaurant/menu');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.restaurant.slug).toBe('default-restaurant');
  const allItems = body.categories.flatMap((c) => c.items);
  const names = allItems.map((i) => i.name);
  expect(names).toContain('Beef Kebab 250gm');
  expect(names).toContain('Zinger Burger');
  // Whitelist only — no internal fields leak.
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain('tenant_id');
  expect(serialized).not.toContain('password');
  expect(serialized).not.toContain('settings');
});

test('public menu API 404s for unknown restaurants', async ({ request }) => {
  const res = await request.get('/api/public/restaurants/does-not-exist/menu');
  expect(res.status()).toBe(404);
});
