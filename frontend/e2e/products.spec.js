import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('adds a product and it appears in the table', async ({ page }) => {
  await login(page);

  // Unique name per run: the e2e backend is reused across local invocations,
  // so a fixed name would accumulate duplicate rows and strict-mode assertions
  // would fail. Scoping to the created row keeps the test idempotent.
  const name = `E2E Test Item ${Date.now()}`;
  await page.fill('input[name="name"]', name);
  await page.fill('textarea[name="description"]', 'Created by Playwright');
  await page.fill('input[name="price"]', '199.50');
  await page.fill('input[name="weight_gm"]', '400');
  await page.click('button:has-text("Add product")');

  const row = page.locator('tr', { hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByText('৳ 199.50')).toBeVisible();
});

test('edits an existing product', async ({ page }) => {
  await login(page);

  // Seed product → Edit → change price → Save.
  const row = page.locator('tr', { hasText: 'Zinger Burger' }).first();
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.fill('input[name="price"]', '275');
  await page.click('button:has-text("Save changes")');

  await expect(page.getByText('৳ 275.00')).toBeVisible();
});
