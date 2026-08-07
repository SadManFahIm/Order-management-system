import { expect } from '@playwright/test';

export const E2E_ADMIN = { email: 'admin@oms.dev', password: 'Str0ngPass!42' };

/** Sign in through the real login form and wait for the Products landing page. */
export async function login(page, { email = E2E_ADMIN.email, password = E2E_ADMIN.password } = {}) {
  await page.goto('/login');
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/products/);
  // Wait for data to render before returning.
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
}
