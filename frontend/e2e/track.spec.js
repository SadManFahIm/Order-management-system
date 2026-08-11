import { test, expect } from '@playwright/test';

/**
 * Track-page prefill regression (PR #48 fix).
 *
 * The storefront checkout confirmation links to /track?orderNo=…&phone=…
 * (backend sets body.trackUrl). Before the fix, TrackOrderPage only read the
 * route param + an empty phone input, so that link landed on an empty form
 * and the customer had to re-type everything. This spec places a real order
 * through the public API, opens the exact confirmation link, and asserts the
 * form is pre-filled AND the status auto-loads without a single click.
 */
const SLUG = 'default-restaurant';

test('confirmation track link pre-fills the form and auto-loads live status', async ({ page, request }) => {
  // 1. Place a real guest order via the public API.
  const menu = await request.get(`/api/public/restaurants/${SLUG}/menu`);
  expect(menu.status()).toBe(200);
  const { categories } = await menu.json();
  const item = categories.flatMap((c) => c.items).find((i) => i.name === 'Beef Kebab 250gm');
  expect(item).toBeTruthy();

  const placed = await request.post(`/api/public/restaurants/${SLUG}/checkout`, {
    headers: { 'Idempotency-Key': 'e2e-track-prefill-1' },
    data: {
      customer_name: 'Prefill Guest',
      customer_phone: '01712345680',
      order_type: 'pickup',
      payment_method: 'cash',
      items: [{ product_id: item.id, quantity: 1 }],
    },
  });
  expect(placed.status()).toBe(201);
  const body = await placed.json();
  expect(body.trackUrl).toContain('/track?orderNo=');

  // 2. Open the confirmation link exactly as the customer would.
  await page.goto(body.trackUrl);

  // 3. Both fields come pre-filled from the query params (regression: the
  //    inputs used to start empty because only the route param was read).
  const inputs = page.locator('input');
  await expect(inputs).toHaveCount(2);
  await expect(inputs.nth(0)).toHaveValue(body.order_no);
  await expect(inputs.nth(1)).toHaveValue('01712345680');

  // 4. …and the lookup happens automatically (no form submit click).
  //    Live status renders the order number + the 4-step Placed stepper.
  await expect(page.getByText(body.order_no)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Placed/).first()).toBeVisible();
  await expect(page.getByText('৳').first()).toBeVisible(); // total row rendered
  await expect(page.getByText(/Paid/).first()).toBeVisible(); // cash → paid badge
});
