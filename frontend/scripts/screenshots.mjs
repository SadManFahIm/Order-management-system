/**
 * Capture real screenshots of the running app for the README.
 *
 * Prereqs: backend on :4000 and frontend dev server on :5173, seeded with
 * admin@oms.dev / Str0ngPass!42 and the default restaurant workspace.
 *
 *   node scripts/screenshots.mjs
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

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function shot(page, name, { fullPage = false } = {}) {
  await page.waitForTimeout(700); // let animations/skeletons settle
  await page.screenshot({ path: join(OUT, name), fullPage });
  console.log('saved', name);
}

/** Logs in and lands on an authenticated route. */
async function login(browserRef, theme) {
  const page = await browserRef.newPage({ viewport });
  if (theme === 'dark') {
    await page.addInitScript(() => {
      localStorage.setItem('oms.theme', 'dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    });
  }
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

await browser.close();
console.log('done —', OUT);
