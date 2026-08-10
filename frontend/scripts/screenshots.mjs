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

const viewport = { width: 1440, height: 900 };

// Pick the first workspace the admin can see that actually has orders, so
// the dashboard/orders/invoice shots are always populated (the API proxy at
// /api forwards to the backend on :4000).
let tenantId = null;
{
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  const auth = await loginRes.json();
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
  const page = await browserRef.newPage({ viewport });
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
let page = await browser.newPage({ viewport });
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await shot(page, 'landing-light.png', { fullPage: true });

// ---------- 2. Public storefront (no auth) — light ----------
page = await browser.newPage({ viewport });
await page.goto(`${BASE}/m/default-restaurant`, { waitUntil: 'networkidle' });
await shot(page, 'public-menu-light.png');

// ---------- 3. Login — light ----------
page = await browser.newPage({ viewport });
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await shot(page, 'login-light.png');

// ---------- 4. Login — dark ----------
page = await browser.newPage({ viewport });
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

// ---------- 8. Customer tracking (no auth) — light ----------
page = await browser.newPage({ viewport });
await page.goto(`${BASE}/track`, { waitUntil: 'networkidle' });
await shot(page, 'track-light.png');

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
page = await browser.newPage({ viewport });
await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
await shot(page, 'register-light.png');

// ---------- 18. Public storefront — dark (design system showcase) -----
page = await browser.newPage({ viewport });
await page.addInitScript(() => {
  localStorage.setItem('oms.theme', 'dark');
  document.documentElement.setAttribute('data-theme', 'dark');
});
await page.goto(`${BASE}/m/default-restaurant`, { waitUntil: 'networkidle' });
await shot(page, 'public-menu-dark.png');

// ---------- 19. Landing — dark (design system showcase) ----------
page = await browser.newPage({ viewport });
await page.addInitScript(() => {
  localStorage.setItem('oms.theme', 'dark');
  document.documentElement.setAttribute('data-theme', 'dark');
});
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await shot(page, 'landing-dark.png', { fullPage: true });

await browser.close();
console.log('done —', OUT);
