/**
 * Capture real screenshots of the running app for the README.
 *
 * Prereqs: backend on :4000 and frontend dev server on :5173, seeded with
 * admin@oms.dev / Str0ngPass!42 and the default restaurant.
 *
 *   node scripts/screenshots.mjs
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

async function shot(page, name) {
  await page.waitForTimeout(600); // let animations/skeletons settle
  await page.screenshot({ path: join(OUT, name), fullPage: false });
  console.log('saved', name);
}

// ---------- 1. Public storefront (no auth) — light ----------
let page = await browser.newPage({ viewport });
await page.goto(`${BASE}/m/default-restaurant`, { waitUntil: 'networkidle' });
await shot(page, 'public-menu-light.png');

// ---------- 2. Login — light ----------
page = await browser.newPage({ viewport });
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await shot(page, 'login-light.png');

// ---------- 3. Login — dark ----------
page = await browser.newPage({ viewport });
await page.addInitScript(() => {
  localStorage.setItem('oms.theme', 'dark');
  document.documentElement.setAttribute('data-theme', 'dark');
});
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await shot(page, 'login-dark.png');

// ---------- 4. Products (authenticated) — light ----------
page = await browser.newPage({ viewport });
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#login-email', ADMIN.email);
await page.fill('#login-password', ADMIN.password);
await page.click('button[type="submit"]');
await page.waitForURL(/\/products/);
await page.getByRole('heading', { name: 'Products' }).waitFor();
await page.waitForTimeout(800);
await shot(page, 'products-light.png');

// ---------- 5. Products (authenticated) — dark ----------
page = await browser.newPage({ viewport });
await page.addInitScript(() => {
  localStorage.setItem('oms.theme', 'dark');
  document.documentElement.setAttribute('data-theme', 'dark');
});
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#login-email', ADMIN.email);
await page.fill('#login-password', ADMIN.password);
await page.click('button[type="submit"]');
await page.waitForURL(/\/products/);
await page.getByRole('heading', { name: 'Products' }).waitFor();
await page.waitForTimeout(800);
await shot(page, 'products-dark.png');

await browser.close();
console.log('done —', OUT);
