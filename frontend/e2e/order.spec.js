import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('creates an order through the UI with server-side pricing', async ({ page }) => {
  await login(page);

  await page.getByRole('link', { name: 'New order' }).click();
  await expect(page.getByRole('heading', { name: 'New order' })).toBeVisible();

  // Add the first menu item to the cart.
  await page.locator('.oms-product-picker button', { hasText: 'Add' }).first().click();
  await expect(page.getByText('Your cart is empty')).not.toBeVisible();

  await page.fill('input[name="customer_name"]', 'E2E Customer');
  await page.fill('input[name="customer_phone"]', '01700000000');
  await page.click('button:has-text("Create order")');

  // Server-side totals render in the summary + a success toast confirms the id.
  await expect(page.getByText('Grand total')).toBeVisible();
  await expect(page.getByText(/Order #\d+ created/)).toBeVisible();
});

test('blocks checkout without a customer name', async ({ page }) => {
  await login(page);

  await page.getByRole('link', { name: 'New order' }).click();
  await page.locator('.oms-product-picker button', { hasText: 'Add' }).first().click();

  const create = page.getByRole('button', { name: 'Create order' });
  await expect(create).toBeDisabled();
});
