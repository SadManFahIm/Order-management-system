import { test, expect } from '@playwright/test';
import { E2E_ADMIN } from './helpers.js';

/**
 * Storefront checkout journey (Phase 5) — public, no login. The e2e backend
 * seeds the default-restaurant workspace with two products (Beef Kebab
 * 250gm @ 320, Zinger Burger @ 260) and cash enabled by default, so a guest
 * can complete the full flow: browse → add to cart → checkout → order →
 * confirmation → tracking. The API tests prove server-side pricing and
 * Idempotency-Key retry safety (double-submit can never create two orders).
 */
const SLUG = 'default-restaurant';
const CART_KEY = `oms.cart.${SLUG}`;
const BEEF_KEBAB_PRICE = 320;

/** Fetch a seeded item's id from the public menu API (ids are not stable). */
async function menuItemId(request, name) {
  const res = await request.get(`/api/public/restaurants/${SLUG}/menu`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  const item = body.categories.flatMap((c) => c.items).find((i) => i.name === name);
  expect(item, `seeded item "${name}" should exist`).toBeTruthy();
  return item.id;
}

/** Seed a guest cart in localStorage, then land on checkout. */
async function checkoutWithCart(page, lines) {
  await page.addInitScript(
    ([key, cart]) => {
      localStorage.setItem(key, JSON.stringify(cart));
    },
    [CART_KEY, lines]
  );
  await page.goto(`/m/${SLUG}/checkout`);
  await expect(page.getByRole('heading', { name: /Checkout/ })).toBeVisible();
}

/**
 * Enable bKash for the e2e tenant (cash is on by default; the split editor
 * only appears once >= 2 non-online methods are enabled). Settings replace
 * the whole paymentMethods key, so the full object is sent.
 */
async function enableBkash(request) {
  const login = await request.post('/api/auth/login', {
    data: { email: E2E_ADMIN.email, password: E2E_ADMIN.password },
  });
  expect(login.status()).toBe(200);
  const { accessToken } = await login.json();
  const tenants = await request.get('/api/auth/tenants', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const tenant = (await tenants.json()).find((t) => t.slug === SLUG);
  expect(tenant, 'default-restaurant tenant should exist').toBeTruthy();
  const patch = await request.patch(`/api/tenants/${tenant.id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {
      settings: {
        paymentMethods: {
          cash: { enabled: true },
          bkash: { enabled: true, number: '01711111111' },
        },
      },
    },
  });
  expect(patch.status()).toBe(200);
}

test('guest places a pickup order end-to-end and tracks it', async ({ page }) => {
  // 1. Browse the real menu page and add an item.
  await page.goto(`/m/${SLUG}`);
  await expect(page.getByText('Beef Kebab 250gm')).toBeVisible();
  await page.getByRole('button', { name: /Add/ }).first().click();
  await expect(page.getByRole('button', { name: /Checkout/ })).toBeVisible();

  // 2. Checkout — cart carries the item.
  await page.getByRole('button', { name: /Checkout/ }).click();
  await expect(page.getByRole('heading', { name: /Checkout/ })).toBeVisible();
  await expect(page.getByText('Beef Kebab 250gm')).toBeVisible();

  // 3. Fill customer info and place the order.
  await page.getByPlaceholder('Rahim Uddin').fill('E2E Guest');
  await page.getByPlaceholder('017XXXXXXXX').fill('01712345678');
  await page.getByRole('button', { name: /Place order/ }).click();

  // 4. Confirmation with the order number.
  await expect(page.getByText('Order placed! 🎉')).toBeVisible();
  const orderNo = (await page.getByText(/^ORD-/).first().textContent()).trim();
  expect(orderNo).toMatch(/^ORD-\d+-[A-Z0-9]+-\d+$/);

  // 5. Tracking link pre-fills the form and shows live status.
  await page.getByRole('link', { name: /Track your order/ }).click();
  await expect(page.getByText(orderNo)).toBeVisible();
  await expect(page.getByText(/Placed/).first()).toBeVisible();
});

test('delivery orders require an address', async ({ page, request }) => {
  const beefId = await menuItemId(request, 'Beef Kebab 250gm');
  await checkoutWithCart(page, [
    { product_id: beefId, quantity: 1, variant_id: null, addon_ids: [], name: 'Beef Kebab 250gm', unit_price: BEEF_KEBAB_PRICE, options: [] },
  ]);

  // Pick delivery, fill only name + phone → address is required.
  await page.getByRole('button', { name: /🛵/ }).click();
  await page.getByPlaceholder('Rahim Uddin').fill('Delivery Guest');
  await page.getByPlaceholder('017XXXXXXXX').fill('01712345679');
  await page.getByRole('button', { name: /Place order/ }).click();
  await expect(page.getByText(/Required: Delivery address/)).toBeVisible();

  // Provide the address → order goes through.
  await page.getByPlaceholder(/House, road, area, city/).fill('House 12, Road 7, Dhanmondi, Dhaka');
  await page.getByRole('button', { name: /Place order/ }).click();
  await expect(page.getByText('Order placed! 🎉')).toBeVisible();
});

test('empty cart shows the empty state, never an order form', async ({ page }) => {
  await page.goto(`/m/${SLUG}/checkout`);
  await expect(page.getByText('Your cart is empty')).toBeVisible();
});

test('scheduled pickup validates the schedule before submitting', async ({ page, request }) => {
  const beefId = await menuItemId(request, 'Beef Kebab 250gm');
  await checkoutWithCart(page, [
    { product_id: beefId, quantity: 1, variant_id: null, addon_ids: [], name: 'Beef Kebab 250gm', unit_price: BEEF_KEBAB_PRICE, options: [] },
  ]);

  await page.getByRole('button', { name: /📅/ }).click();
  await page.getByPlaceholder('Rahim Uddin').fill('Scheduled Guest');
  await page.getByPlaceholder('017XXXXXXXX').fill('01712345670');

  // No schedule → blocked.
  await page.getByRole('button', { name: /Place order/ }).click();
  await expect(page.getByText(/Required: Pick a time/)).toBeVisible();

  // Past schedule → blocked with a validation message.
  const past = new Date(Date.now() - 60 * 60 * 1000);
  const pastLocal = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}T${String(past.getHours()).padStart(2, '0')}:${String(past.getMinutes()).padStart(2, '0')}`;
  await page.locator('input[type="datetime-local"]').fill(pastLocal);
  await page.getByRole('button', { name: /Place order/ }).click();
  await expect(page.getByText(/future time/i)).toBeVisible();

  // Future schedule → succeeds.
  const future = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const futureLocal = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}T${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
  await page.locator('input[type="datetime-local"]').fill(futureLocal);
  await page.getByRole('button', { name: /Place order/ }).click();
  await expect(page.getByText('Order placed! 🎉')).toBeVisible();
});

test('checkout API: server-side pricing ignores client claims', async ({ request }) => {
  const beefId = await menuItemId(request, 'Beef Kebab 250gm');
  // The client "claims" a discounted unit price and 2 items — the API must
  // re-price from the DB: 2 × 320 = 640, never 2 × 200 = 400.
  const res = await request.post(`/api/public/restaurants/${SLUG}/checkout`, {
    headers: { 'Idempotency-Key': 'e2e-server-pricing-1' },
    data: {
      customer_name: 'Pricing Guest',
      customer_phone: '01712345671',
      order_type: 'pickup',
      payment_method: 'cash',
      items: [{ product_id: beefId, quantity: 2, unit_price: 200 }],
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.subtotal).toBe(2 * BEEF_KEBAB_PRICE);
  expect(body.grand_total).toBe(2 * BEEF_KEBAB_PRICE);
  expect(body.items).toHaveLength(1);
  expect(body.items[0].quantity).toBe(2);
});

test('checkout API: same Idempotency-Key never duplicates an order', async ({ request }) => {
  const beefId = await menuItemId(request, 'Beef Kebab 250gm');
  const payload = {
    customer_name: 'Idem Guest',
    customer_phone: '01712345672',
    order_type: 'pickup',
    payment_method: 'cash',
    items: [{ product_id: beefId, quantity: 1 }],
  };
  const headers = { 'Idempotency-Key': 'e2e-idem-key-1' };

  const first = await request.post(`/api/public/restaurants/${SLUG}/checkout`, { headers, data: payload });
  expect(first.status()).toBe(201);
  const firstBody = await first.json();

  // Same key + same payload → same order, replayed, no duplicate.
  const replay = await request.post(`/api/public/restaurants/${SLUG}/checkout`, { headers, data: payload });
  expect(replay.status()).toBe(201);
  const replayBody = await replay.json();
  expect(replayBody.id).toBe(firstBody.id);
  expect(replayBody.order_no).toBe(firstBody.order_no);

  // Different key → an independent order.
  const other = await request.post(`/api/public/restaurants/${SLUG}/checkout`, {
    headers: { 'Idempotency-Key': 'e2e-idem-key-2' },
    data: payload,
  });
  const otherBody = await other.json();
  expect(otherBody.id).not.toBe(firstBody.id);
});

test('checkout API rejects unknown products and invalid quantities', async ({ request }) => {
  const base = {
    customer_name: 'Bad Guest',
    customer_phone: '01712345673',
    order_type: 'pickup',
    payment_method: 'cash',
  };

  const unknown = await request.post(`/api/public/restaurants/${SLUG}/checkout`, {
    headers: { 'Idempotency-Key': 'e2e-bad-product' },
    data: { ...base, items: [{ product_id: 999_999, quantity: 1 }] },
  });
  expect([400, 404]).toContain(unknown.status());

  const zeroQty = await request.post(`/api/public/restaurants/${SLUG}/checkout`, {
    headers: { 'Idempotency-Key': 'e2e-zero-qty' },
    data: { ...base, items: [{ product_id: 1, quantity: 0 }] },
  });
  expect(zeroQty.status()).toBe(400);

  const empty = await request.post(`/api/public/restaurants/${SLUG}/checkout`, {
    headers: { 'Idempotency-Key': 'e2e-empty-cart' },
    data: { ...base, items: [] },
  });
  expect(empty.status()).toBe(400);
});

test('public tracking API is phone-verified and privacy-safe', async ({ request }) => {
  const beefId = await menuItemId(request, 'Beef Kebab 250gm');
  const placed = await request.post(`/api/public/restaurants/${SLUG}/checkout`, {
    headers: { 'Idempotency-Key': 'e2e-track-api' },
    data: {
      customer_name: 'Track Guest',
      customer_phone: '01712345674',
      order_type: 'pickup',
      payment_method: 'cash',
      items: [{ product_id: beefId, quantity: 1 }],
    },
  });
  const { order_no: orderNo } = await placed.json();

  // Correct order + phone → status with a whitelist only.
  const ok = await request.get('/api/public/track', {
    params: { orderNo, phone: '01712345674' },
  });
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body.orderNo).toBe(orderNo);
  expect(body.status).toBe('placed');
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain('customer_phone');
  expect(serialized).not.toContain('customer_address');

  // Wrong phone → uniform 404 (no enumeration).
  const wrong = await request.get('/api/public/track', {
    params: { orderNo, phone: '01799999999' },
  });
  expect(wrong.status()).toBe(404);
});

test('checkout API: split payment creates one row per part (partial status)', async ({ request }) => {
  await enableBkash(request);
  const beefId = await menuItemId(request, 'Beef Kebab 250gm');
  // 1 × 320 split 200 bKash + 120 cash.
  const res = await request.post(`/api/public/restaurants/${SLUG}/checkout`, {
    headers: { 'Idempotency-Key': 'e2e-split-api-1' },
    data: {
      customer_name: 'Split Guest',
      customer_phone: '01712345675',
      order_type: 'pickup',
      items: [{ product_id: beefId, quantity: 1 }],
      payments: [
        { method: 'bkash', amount: 200, reference: 'SPLIT-E2E-1' },
        { method: 'cash', amount: 120 },
      ],
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.payment_method).toBe('split');
  expect(body.payment_status).toBe('partial');
  expect(body.grand_total).toBe(320);
  expect(body.payments).toHaveLength(2);
  const byMethod = Object.fromEntries(body.payments.map((p) => [p.method, p]));
  expect(byMethod.bkash.status).toBe('pending');
  expect(byMethod.bkash.amount).toBe(200);
  expect(byMethod.bkash.reference).toBe('SPLIT-E2E-1');
  expect(byMethod.cash.status).toBe('paid');
  expect(byMethod.cash.amount).toBe(120);
});

test('checkout API: split parts must sum to the server total (SPLIT_MISMATCH)', async ({ request }) => {
  await enableBkash(request);
  const beefId = await menuItemId(request, 'Beef Kebab 250gm');
  const res = await request.post(`/api/public/restaurants/${SLUG}/checkout`, {
    headers: { 'Idempotency-Key': 'e2e-split-bad-sum' },
    data: {
      customer_name: 'Split Guest',
      customer_phone: '01712345676',
      order_type: 'pickup',
      items: [{ product_id: beefId, quantity: 1 }],
      payments: [
        { method: 'bkash', amount: 100 },
        { method: 'cash', amount: 100 }, // 200 ≠ 320
      ],
    },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error.code).toBe('SPLIT_MISMATCH');
});

test('guest splits a pickup order in the UI (bKash + cash) and sees partial status on tracking', async ({
  page,
  request,
}) => {
  await enableBkash(request);
  const beefId = await menuItemId(request, 'Beef Kebab 250gm');
  await checkoutWithCart(page, [
    { product_id: beefId, quantity: 1, variant_id: null, addon_ids: [], name: 'Beef Kebab 250gm', unit_price: BEEF_KEBAB_PRICE, options: [] },
  ]);

  // Split editor appears (2 methods enabled) — toggle it on.
  await page.getByRole('button', { name: /Split payment/ }).click();
  const amountInputs = page.locator('input[type="number"]');
  await expect(amountInputs).toHaveCount(2);
  // cash is seeded with the total; re-allocate 120 cash + 200 bKash.
  await amountInputs.nth(0).fill('120');
  await amountInputs.nth(1).fill('200');
  await expect(page.getByText(/Remaining to allocate/)).toBeVisible();

  await page.getByPlaceholder('Rahim Uddin').fill('Split UI Guest');
  await page.getByPlaceholder('017XXXXXXXX').fill('01712345677');
  await page.getByRole('button', { name: /Place order/ }).click();

  // Confirmation → tracking shows the split as partial (bKash still pending).
  await expect(page.getByText('Order placed! 🎉')).toBeVisible();
  const orderNo = (await page.getByText(/^ORD-/).first().textContent()).trim();
  await page.getByRole('link', { name: /Track your order/ }).click();
  await expect(page.getByText(orderNo)).toBeVisible();
  await expect(page.getByText(/Partial/)).toBeVisible();
});
