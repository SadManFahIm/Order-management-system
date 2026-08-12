import { test, expect } from '@playwright/test';

/**
 * Dine-in split billing e2e — the cashier's real journey:
 * dine-in order → Split Bill → 3 diners → item assignment → reconcile →
 * apply → per-diner parts + receipt links → diner receipt → dashboard
 * split-billing analytics.
 *
 * Setup runs through the REAL API as the seeded admin (table + cashier
 * member + the dine-in order), then the browser drives the UI as the
 * cashier. Totals are read from the menu API (never hardcoded) so the spec
 * is immune to other specs editing prices.
 */
const ADMIN = { email: 'admin@oms.dev', password: 'Str0ngPass!42' };
const CASHIER = { email: 'cashier@oms.dev', password: 'Cashier!42' };
const CUSTOMER = 'Split E2E Guest';

test('cashier splits a dine-in order, prints a receipt, dashboard reflects it', async ({ page, request }) => {
  // ── 1. API setup (admin) ─────────────────────────────────────────────
  const loginRes = await request.post('/api/auth/login', {
    data: { email: ADMIN.email, password: ADMIN.password },
  });
  expect(loginRes.ok()).toBeTruthy();
  const { accessToken } = await loginRes.json();
  const auth = { Authorization: `Bearer ${accessToken}` };

  const tenants = await (await request.get('/api/tenants', { headers: auth })).json();
  const tenantId = tenants[0].id;

  await request.post('/api/tables', {
    headers: auth,
    data: { table_no: 9, name: 'Split Table', capacity: 4 },
  });

  const member = await request.post(`/api/tenants/${tenantId}/members`, {
    headers: auth,
    data: {
      email: CASHIER.email,
      name: 'Split Cashier',
      password: CASHIER.password,
      role: 'cashier',
    },
  });
  expect(member.status()).toBe(201);

  const products = await (await request.get('/api/products', { headers: auth })).json();
  const zinger = products.find((p) => p.name === 'Zinger Burger');
  const kebab = products.find((p) => p.name === 'Beef Kebab 250gm');
  const expectedTotal =
    Number(zinger.price) * 2 + Number(kebab.price); // 2× Zinger + 1× Kebab

  const orderRes = await request.post('/api/orders', {
    headers: auth,
    data: {
      customer_name: CUSTOMER,
      table_no: 9,
      payment_method: 'cash',
      items: [
        { product_id: zinger.id, quantity: 2 },
        { product_id: kebab.id, quantity: 1 },
      ],
    },
  });
  expect(orderRes.status()).toBe(201);
  const order = await orderRes.json();
  expect(Number(order.grand_total)).toBeCloseTo(expectedTotal, 2);

  // ── 2. Login as the cashier ──────────────────────────────────────────
  await page.goto('/login');
  await page.fill('#login-email', CASHIER.email);
  await page.fill('#login-password', CASHIER.password);
  await page.click('button[type="submit"]');
  await page.getByRole('link', { name: 'Orders' }).click();
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();

  // ── 3. Open the split bill panel ─────────────────────────────────────
  const row = page.locator('tr', { hasText: CUSTOMER });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /Split bill/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('TOTAL ORDER')).toBeVisible();

  // Validation first: fewer than 2 diners is rejected.
  await dialog.getByRole('button', { name: 'Apply split' }).click();
  await expect(dialog.getByText('A split needs at least 2 diners')).toBeVisible();

  // Three diners.
  await dialog.getByRole('button', { name: 'Add diner' }).click();
  await dialog.getByRole('button', { name: 'Add diner' }).click();
  await dialog.getByRole('button', { name: 'Add diner' }).click();

  // Assign items: Diner 1 → 1× Zinger, Diner 2 → 1× Zinger, Diner 3 → 1× Kebab.
  await dialog.getByRole('button', { name: `Diner 1 · ${zinger.name} · +` }).click();
  await dialog.getByRole('button', { name: `Diner 2 · ${zinger.name} · +` }).click();
  await dialog.getByRole('button', { name: `Diner 3 · ${kebab.name} · +` }).click();

  // ── 4. Reconcile: TOTAL ORDER == SUM OF SPLITS ───────────────────────
  const fmtTotal = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 2,
  }).format(expectedTotal);
  await expect(dialog.getByText('TOTAL ORDER')).toBeVisible();
  await expect(dialog.getByText(`SUM OF SPLITS ৳ ${fmtTotal}`)).toBeVisible();

  // ── 5. Apply ─────────────────────────────────────────────────────────
  await dialog.getByRole('button', { name: 'Apply split' }).click();
  await expect(page.getByText('Split applied')).toBeVisible();
  await expect(dialog).not.toBeVisible();

  // ── 6. Parts + receipt links on the order row ────────────────────────
  await expect(row.getByText('Diner 1', { exact: false }).first()).toBeVisible();
  const receiptButtons = row.getByRole('link', { name: 'Receipt' });
  await expect(receiptButtons).toHaveCount(3);

  // ── 7. Per-diner receipt ─────────────────────────────────────────────
  await receiptButtons.first().click();
  await expect(page.getByRole('heading', { name: 'Diner receipt' })).toBeVisible();
  await expect(page.getByText('Diner 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Payable')).toBeVisible();
  await expect(page.getByRole('button', { name: /Print \/ PDF/ })).toBeVisible();
  await page.goBack();

  // ── 8. Dashboard split-billing analytics ─────────────────────────────
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Split billing').first()).toBeVisible();
  // Donut legend row (the SVG <title> tooltip is hidden — match the legend row).
  await expect(
    page.locator('.oms-donut__row').filter({ hasText: 'Item split' }).first()
  ).toBeVisible();
});
