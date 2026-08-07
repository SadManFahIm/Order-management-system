import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('adds a product and it appears in the table', async ({ page }) => {
  await login(page);

  await page.fill('input[name="name"]', 'E2E Test Item');
  await page.fill('textarea[name="description"]', 'Created by Playwright');
  await page.fill('input[name="price"]', '199.50');
  await page.fill('input[name="weight_gm"]', '400');
  await page.click('button:has-text("Add product")');

  await expect(page.getByText('E2E Test Item')).toBeVisible();
  await expect(page.getByText('৳ 199.50')).toBeVisible();
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
