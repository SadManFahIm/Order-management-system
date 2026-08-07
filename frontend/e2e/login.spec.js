import { test, expect } from '@playwright/test';
import { login, E2E_ADMIN } from './helpers';

test('renders the sign-in form', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.locator('#login-email')).toBeVisible();
  await expect(page.locator('#login-password')).toBeVisible();
});

test('logs in with valid credentials and lands on Products with seeded data', async ({ page }) => {
  await login(page);
  // Workspace-scoped data from the e2e seed is visible.
  await expect(page.getByText('Beef Kebab 250gm')).toBeVisible();
  await expect(page.getByText('Zinger Burger')).toBeVisible();
});

test('rejects invalid credentials', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#login-email', E2E_ADMIN.email);
  await page.fill('#login-password', 'wrong-password-1');
  await page.click('button[type="submit"]');
  await expect(page.getByText('Invalid email or password')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
