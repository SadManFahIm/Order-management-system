/**
 * Capture real screenshots of the running app for the README.
 *
 * Prereqs: backend on :4000 and frontend dev server on :5173, seeded with
 * admin@oms.dev / Str0ngPass!42 and the Dhaka restaurant workspaces
 * (`npm run seed:restaurants` + `seed:orders` + `seed:payment-demo`).
 *
 *   node scripts/screenshots.mjs
 *
 * The authenticated pages are captured in the FIRST workspace that has
 * orders (so charts and the Phase 6 split/refund/invoice examples are
 * never empty), chosen via the API before the browser run.
 *
 * Re-run whenever the UI changes so docs/screenshots stays current.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', '..', 'docs', 'screenshots');
const BASE = 'http://localhost:5173';
const ADMIN = { email: 'admin@oms.dev', password: 'Str0ngPass!42' };

mkdirSync(OUT, { recursive: true });

// Crisp captures: 2× device scale (retina-grade) so the README images look
// sharp on any display — the PNGs are written at 2× the viewport resolution.
const viewport = { width: 1600, height: 1000 };
const CONTEXT = { viewport, deviceScaleFactor: 2 };

// Pick the first workspace the admin can see that actually has orders, so
// the dashboard/orders/invoice shots are always populated (the API proxy at
// /api forwards to the backend on :4000).
let tenantId = null;
let adminToken = null;
{
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  const auth = await loginRes.json();
  adminToken = auth.accessToken || null;
  if (auth.accessToken) {
    const tenantRes = await fetch(`${BASE}/api/auth/tenants`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    const tenants = await tenantRes.json();
    for (const t of tenants) {
      const ordersRes = await fetch(`${BASE}/api/orders`, {
        headers: { Authorization: `Bearer ${auth.accessToken}`, 'X-Tenant': String(t.id) },
      });
      const orders = await ordersRes.json();
      if (Array.isArray(orders) && orders.length > 0) {
        tenantId = String(t.id);
        console.log('capturing authenticated pages in workspace', t.id, t.name);
        break;
      }
    }
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function shot(page, name, { fullPage = false } = {}) {
  await page.waitForTimeout(700); // let animations/skeletons settle
  await page.screenshot({ path: join(OUT, name), fullPage });
  console.log('saved', name);
}

/** Logs in, lands on an authenticated route, and pins the data-rich workspace. */
async function login(browserRef, theme) {
  const page = await browserRef.newPage(CONTEXT);
  await page.addInitScript(
    ([t, dark]) => {
      if (dark) {
        localStorage.setItem('oms.theme', 'dark');
        document.documentElement.setAttribute('data-theme', 'dark');
      }
      if (t) localStorage.setItem('active_tenant_id', t);
    },
    [tenantId, theme === 'dark']
  );
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#login-email', ADMIN.email);
  await page.fill('#login-password', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|products)/);
  return page;
}

// ---------- 1. CRAV-style landing page (no auth) — light ----------
let page = await browser.newPage(CONTEXT);
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await shot(page, 'landing-light.png', { fullPage: true });

// ---------- 2. Public storefront (no auth) — rice paper (light) ---------
page = await browser.newPage(CONTEXT);
await page.addInitScript(() => {
  localStorage.setItem('oms.storefront.paper', 'light');
});
await page.goto(`${BASE}/m/default-restaurant`, { waitUntil: 'networkidle' });
await shot(page, 'public-menu-light.png');

// ---------- 2a. Public storefront — ink paper (dark) + food orbs --------
page = await browser.newPage(CONTEXT);
await page.addInitScript(() => {
  localStorage.setItem('oms.storefront.paper', 'dark');
});
await page.goto(`${BASE}/m/default-restaurant`, { waitUntil: 'networkidle' });
await shot(page, 'public-menu-ink-paper.png');

// ---------- 2b. Storefront with cart open (Phase 5 checkout journey) ----
page = await browser.newPage(CONTEXT);
await page.addInitScript(() => {
  localStorage.setItem('oms.storefront.paper', 'light');
});
await page.goto(`${BASE}/m/kfc-dhaka`, { waitUntil: 'networkidle' });
const addFirst = page.getByRole('button', { name: /Add|যোগ/ }).first();
if (await addFirst.count()) {
  await addFirst.click();
  await page.waitForTimeout(600);
  // If the item has variants/add-ons an options modal opens — confirm it so
  // the item lands in the cart (the modal's button says “Add to cart” too).
  const modalAdd = page.getByRole('button', { name: /Add to cart|কার্টে যোগ/ });
  if (await modalAdd.count()) {
    await modalAdd.click();
    await page.waitForTimeout(600);
  }
}
await shot(page, 'storefront-cart-light.png');

// ---------- 2c. Checkout — guest cart pre-filled, ticket design ----------
const checkoutInit = (paper) => [
  ([cart, p]) => {
    localStorage.setItem('oms.cart.kfc-dhaka', JSON.stringify(cart));
    localStorage.setItem('oms.storefront.paper', p);
  },
  [
    [
      { product_id: 1, quantity: 2, variant_id: null, addon_ids: [], name: 'Hot & Crispy Chicken (2 pc)', unit_price: 320, options: [] },
      { product_id: 2, quantity: 1, variant_id: null, addon_ids: [], name: 'Zinger Burger', unit_price: 260, options: [] },
    ],
    paper,
  ],
];
page = await browser.newPage(CONTEXT);
await page.addInitScript(...checkoutInit('light'));
await page.goto(`${BASE}/m/kfc-dhaka/checkout`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await shot(page, 'checkout-light.png', { fullPage: true });

// ---------- 2d. Checkout — ink paper (dark ticket) ----------
page = await browser.newPage(CONTEXT);
await page.addInitScript(...checkoutInit('dark'));
await page.goto(`${BASE}/m/kfc-dhaka/checkout`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await shot(page, 'checkout-ink-paper.png', { fullPage: true });

// ---------- 3. Login — light ----------
page = await browser.newPage(CONTEXT);
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await shot(page, 'login-light.png');

// ---------- 4. Login — dark ----------
page = await browser.newPage(CONTEXT);
await page.addInitScript(() => {
  localStorage.setItem('oms.theme', 'dark');
  document.documentElement.setAttribute('data-theme', 'dark');
});
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await shot(page, 'login-dark.png');

// ---------- 5. Dashboard — light (closeout trend + forecast + MoM) ----------
page = await login(browser, 'light');
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: /Dashboard|ড্যাশবোর্ড/ }).waitFor();
await page.waitForTimeout(900);
await shot(page, 'dashboard-light.png', { fullPage: true });

// ---------- 6. Reports — light (closeout + VAT compliance) ----------
page = await login(browser, 'light');
await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: /Daily closeout|দৈনিক ক্লোজআউট/ }).waitFor();
await page.waitForTimeout(900);
await shot(page, 'reports-light.png', { fullPage: true });

// ---------- 7. QR table menu — light ----------
page = await login(browser, 'light');
await page.goto(`${BASE}/tables`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await shot(page, 'qr-menu-light.png');

// ---------- 7b. Ink-paper diner receipt (Phase 6 split billing) ----------
// Place a guest order on a storefront with a menu, split it by item through
// the merchant API, then capture the diner's ink-paper receipt + kitchen
// ticket. Deterministic across reseeds (nothing is hard-coded).
{
  let splitTarget = null;
  if (adminToken) {
    const tenantsRes = await fetch(`${BASE}/api/auth/tenants`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const tenants = await tenantsRes.json();
    for (const t of tenants) {
      try {
        const menuRes = await fetch(`${BASE}/api/public/restaurants/${t.slug}/menu`);
        const menu = await menuRes.json();
        const item = menu.categories?.flatMap((c) => c.items)?.[0];
        if (item) {
          splitTarget = { tenant: t, item };
          break;
        }
      } catch {
        /* tenant without a public menu — skip */
      }
    }
  }
  if (splitTarget) {
    const { tenant: t, item } = splitTarget;
    const placed = await fetch(`${BASE}/api/public/restaurants/${t.slug}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `shot-split-${Date.now()}` },
      body: JSON.stringify({
        customer_name: 'Screenshot Guest',
        customer_phone: '01712345680',
        order_type: 'pickup',
        payment_method: 'cash',
        items: [{ product_id: item.id, quantity: 2 }],
      }),
    });
    const order = await placed.json();
    const orderItem = order.items?.[0];
    if (order.id && orderItem && adminToken) {
      const split = await fetch(`${BASE}/api/orders/${order.id}/split`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
          'X-Tenant': String(t.id),
        },
        body: JSON.stringify({
          mode: 'item',
          diners: [
            { label: 'Rahim', method: 'cash' },
            { label: 'Karim', method: 'bkash', trxID: 'TRX-SHOT-001' },
          ],
          allocations: [
            { orderItemId: orderItem.id, quantity: 1, dinerIndex: 0 },
            { orderItemId: orderItem.id, quantity: 1, dinerIndex: 1 },
          ],
        }),
      });
      const splitBody = await split.json();
      const rahimPart = splitBody.parts?.find((p) => p.dinerLabel === 'Rahim');
      if (rahimPart) {
        page = await login(browser, 'light');
        await page.goto(`${BASE}/orders/${order.id}/split/receipts/${rahimPart.paymentId}`, {
          waitUntil: 'networkidle',
        });
        await page.getByRole('heading', { name: /Diner receipt|রসিদ/ }).waitFor().catch(() => {});
        await page.waitForTimeout(900);
        await shot(page, 'diner-receipt-ink-paper.png', { fullPage: true });
        // Kitchen ticket view — same ink-paper sheet, quantities only.
        const kotBtn = page.getByRole('button', { name: /Kitchen ticket|কিচেন টিকেট/ });
        if (await kotBtn.count()) {
          await kotBtn.click();
          await page.waitForTimeout(700);
          await shot(page, 'diner-kot-ink-paper.png', { fullPage: true });
        }
      }
    }
  } else {
    console.log('skipped diner-receipt shot — no tenant with a public menu found');
  }
}

// ---------- 8. Customer tracking (no auth) — the ticket lookup, light ---
page = await browser.newPage(CONTEXT);
await page.addInitScript(() => {
  localStorage.setItem('oms.storefront.paper', 'light');
});
await page.goto(`${BASE}/track`, { waitUntil: 'networkidle' });
await shot(page, 'track-light.png');

// ---------- 8a. Track a real order — the live ticket (light + ink) ------
// Place a guest order via the public API and open its confirmation track
// link, so the status ticket is never empty no matter how the DB is seeded.
{
  const menuRes = await fetch(`${BASE}/api/public/restaurants/kfc-dhaka/menu`);
  const { categories } = await menuRes.json();
  const item = categories.flatMap((c) => c.items)[0];
  const placed = await fetch(`${BASE}/api/public/restaurants/kfc-dhaka/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `shot-track-${Date.now()}` },
    body: JSON.stringify({
      customer_name: 'Screenshot Guest',
      customer_phone: '01712345680',
      order_type: 'pickup',
      payment_method: 'cash',
      items: [{ product_id: item.id, quantity: 1 }],
    }),
  });
  const order = await placed.json();
  if (order.trackUrl) {
    for (const [name, paper] of [['track-ticket-light.png', 'light'], ['track-ticket-ink-paper.png', 'dark']]) {
      page = await browser.newPage(CONTEXT);
      await page.addInitScript((p) => {
        localStorage.setItem('oms.storefront.paper', p);
      }, paper);
      await page.goto(`${BASE}${order.trackUrl}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      await shot(page, name);
    }
  } else {
    console.log('skipped track-ticket shots — checkout did not return a trackUrl');
  }
}

// ---------- 9. Products (authenticated) — light ----------
page = await login(browser, 'light');
await page.goto(`${BASE}/products`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: /Products|প্রোডাক্ট/ }).waitFor();
await page.waitForTimeout(800);
await shot(page, 'products-light.png');

// ---------- 10. Products (authenticated) — dark ----------
page = await login(browser, 'dark');
await page.goto(`${BASE}/products`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: /Products|প্রোডাক্ট/ }).waitFor();
await page.waitForTimeout(800);
await shot(page, 'products-dark.png');

// ---------- 11. Orders — Phase 6 (split badge + refund + invoice action) --
page = await login(browser, 'light');
await page.goto(`${BASE}/orders`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: /Orders|অর্ডার/ }).waitFor();
await page.waitForTimeout(1200);
await shot(page, 'orders-phase6-light.png');

// ---------- 12. Invoice — Phase 6 (VAT split + linked payments) ----------
// Open the first invoice link found on the orders page — deterministic even
// when reseeding shifts order ids.
const invoiceHref = await page
  .locator('a[href*="/invoice"]')
  .first()
  .getAttribute('href')
  .catch(() => null);
if (invoiceHref) {
  await page.goto(`${BASE}${invoiceHref}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await shot(page, 'invoice-phase6-light.png', { fullPage: true });
  // The invoice sheet is ink-paper by design — capture it on its own.
  await shot(page, 'invoice-ink-paper.png', { fullPage: true });
} else {
  console.log('skipped invoice — no invoice link found');
}

// ---------- 13. New Order — Phase 6 split-payment editor ----------
page = await login(browser, 'light');
await page.goto(`${BASE}/orders/new`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: /New order|নতুন অর্ডার/ }).waitFor();
const addButtons = page.getByRole('button', { name: '+ Add' });
if ((await addButtons.count()) >= 2) {
  await addButtons.nth(0).click();
  await addButtons.nth(1).click();
  await page.getByRole('button', { name: /Split payment/ }).click();
  await page.waitForTimeout(700);
}
await shot(page, 'neworder-split-light.png');

// ---------- 13b. Split-billing panel (dine-in split) — ink paper --------
// Open the panel on the seeded Split Bill Demo order when present, else the
// first order row with a Split bill button; capture the ink-paper panel.
page = await login(browser, 'light');
await page.goto(`${BASE}/orders`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: /Orders|অর্ডার/ }).waitFor();
let splitRow = page.locator('tr', { hasText: 'Split Bill Demo' });
if (!(await splitRow.count())) {
  splitRow = page.locator('tr').filter({ has: page.getByRole('button', { name: /Split bill/ }) }).first();
}
if (await splitRow.count()) {
  await splitRow.getByRole('button', { name: /Split bill/ }).first().click();
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(800);
  await shot(page, 'split-billing-panel-ink-paper.png');
  await page.getByRole('dialog').getByRole('button', { name: /Close|বন্ধ/ }).click().catch(() => {});
  // Diner receipt — first receipt link on the demo order row.
  const receiptHref = await splitRow
    .locator('a[href*="/receipts/"]')
    .first()
    .getAttribute('href')
    .catch(() => null);
  if (receiptHref) {
    await page.goto(`${BASE}${receiptHref}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await shot(page, 'diner-receipt-light.png', { fullPage: true });
  }
} else {
  console.log('skipped split-billing shots — no Split Bill Demo order found');
}

// ---------- 13c. Reports — closeout split-parts table (Phase 6) --------
page = await login(browser, 'light');
await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: /Daily closeout|দৈনিক ক্লোজআউট/ }).waitFor();
// The seeded split orders fall on the seeding day — keep today's date unless
// the day has no splits (then leave it; the capture just shows the normal view).
await page.waitForTimeout(1200);
await shot(page, 'reports-split-parts-light.png', { fullPage: true });

// ---------- 14. Merchant Menu — Phase 4 (Wolt/Deliveroo grouped view) --
page = await login(browser, 'light');
await page.goto(`${BASE}/menu`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: /Menu/ }).waitFor();
await page.waitForTimeout(900);
await shot(page, 'menu-merchant-light.png', { fullPage: true });

// ---------- 15. Promotions — Phase 4 (offers list) ----------
page = await login(browser, 'light');
await page.goto(`${BASE}/promotions`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: /Promotions|প্রোমোশন/ }).waitFor();
await page.waitForTimeout(800);
await shot(page, 'promotions-light.png');

// ---------- 16. Settings — Phase 4/6 (storefront branding + payments) --
page = await login(browser, 'light');
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: /Settings|সেটিংস/ }).waitFor();
await page.waitForTimeout(900);
await shot(page, 'settings-light.png', { fullPage: true });

// ---------- 17. Register (no auth) — light ----------
page = await browser.newPage(CONTEXT);
await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
await shot(page, 'register-light.png');

// ---------- 18. Public storefront — dark (ink-paper showcase) ----------
page = await browser.newPage(CONTEXT);
await page.addInitScript(() => {
  localStorage.setItem('oms.theme', 'dark');
  document.documentElement.setAttribute('data-theme', 'dark');
  localStorage.setItem('oms.storefront.paper', 'dark');
});
await page.goto(`${BASE}/m/default-restaurant`, { waitUntil: 'networkidle' });
await shot(page, 'public-menu-dark.png');

// ---------- 19. Landing — dark (design system showcase) ----------
page = await browser.newPage(CONTEXT);
await page.addInitScript(() => {
  localStorage.setItem('oms.theme', 'dark');
  document.documentElement.setAttribute('data-theme', 'dark');
});
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await shot(page, 'landing-dark.png', { fullPage: true });

// ---------- 20. Platform admin analytics (Phase 7) — cross-tenant view --
page = await login(browser, 'light');
await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: /Platform analytics|প্ল্যাটফর্ম অ্যানালিটিক্স/ }).waitFor();
await page.waitForTimeout(1000);
await shot(page, 'admin-analytics-light.png', { fullPage: true });

await browser.close();
console.log('done —', OUT);
