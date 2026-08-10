#!/usr/bin/env node
/**
 * Gateway test-mode end-to-end (Phase 5/6) — proves the FULL online-payment
 * loop works without any real gateway credentials.
 *
 *   run:   npm run gateway:e2e   (or node scripts/gateway-e2e.mjs)
 *
 * Flow driven against the REAL app code (not mocks):
 *   1. start the local gateway sandbox (auto-confirm mode)
 *   2. boot the backend in-process against a scratch SQLite DB, with the
 *      sandbox wired in as the gateway (SSLCOMMERZ_API_URL / STRIPE_API_URL /
 *      BKASH_API_URL)
 *   3. create a tenant + owner + product, log in, accept online payments
 *   4. place an order with payment_method=online → assert pending + paymentUrl
 *   5. let the sandbox confirm it — signed webhook (md5 / HMAC-SHA256) for
 *      SSLCommerz/Stripe; browser redirect → execute for bKash
 *   6. assert the payment record + order flipped to paid
 *
 * One worker process per gateway (PAYMENT_GATEWAY must be set before the app
 * imports its env config), coordinated by this launcher. Exits 0 only if
 * ALL THREE flows pass.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Worker mode: run one gateway flow in-process ──────────────────────────
const gatewayArg = process.argv.find((a) => a.startsWith('--gateway='));
if (gatewayArg) {
  const gateway = gatewayArg.split('=')[1];
  await runWorker(gateway);
  process.exit(0);
}

// ── Launcher mode: sandbox + one worker per gateway ───────────────────────
const sandboxPort = await new Promise((resolve) => {
  const probe = http.createServer();
  probe.listen(0, '127.0.0.1', () => {
    const p = probe.address().port;
    probe.close(() => resolve(p));
  });
});

const sandbox = spawn(
  process.execPath,
  [path.join(root, 'scripts', 'gateway-sandbox.mjs'), '--port', String(sandboxPort), '--auto', '--api', 'http://localhost:4599'],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);
let sandboxLog = '';
sandbox.stdout.on('data', (c) => (sandboxLog += c));
sandbox.stderr.on('data', (c) => (sandboxLog += c));

const waitForSandbox = async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://localhost:${sandboxPort}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`sandbox did not start:\n${sandboxLog}`);
};

const spawnWorker = (gateway) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(root, 'scripts', 'gateway-e2e.mjs'), `--gateway=${gateway}`],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GATEWAY_SANDBOX_PORT: String(sandboxPort) } }
    );
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('exit', (code) => {
      process.stdout.write(out);
      code === 0 ? resolve() : reject(new Error(`${gateway} flow failed (exit ${code})`));
    });
  });

try {
  console.log('🧪 Gateway test-mode E2E (sandbox on :' + sandboxPort + ')\n');
  await waitForSandbox();
  await spawnWorker('sslcommerz');
  await spawnWorker('stripe');
  await spawnWorker('bkash');
  console.log('\n✅✅✅ All three gateway flows verified end-to-end (SSLCommerz + Stripe + bKash).');
  process.exitCode = 0;
} catch (e) {
  console.error(`\n❌ E2E failed: ${e.message}`);
  console.error('--- sandbox log ---\n' + sandboxLog.slice(-2000));
  process.exitCode = 1;
} finally {
  sandbox.kill();
}

// ── Worker body: real in-process app + sandbox, asserts paid ──────────────
async function runWorker(gateway) {
  process.env.PAYMENT_GATEWAY = gateway;
  process.env.DB_DIALECT = 'sqlite';
  process.env.DB_STORAGE = path.join(root, `gateway-e2e-${gateway}-${Date.now()}.sqlite`);
  process.env.NODE_ENV = 'test';
  process.env.PORT = '4599';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'gateway-e2e-secret-0123456789';
  process.env.SSLCOMMERZ_API_URL = `http://localhost:${process.env.GATEWAY_SANDBOX_PORT}/gwprocess/v4/api.php`;
  process.env.STRIPE_API_URL = `http://localhost:${process.env.GATEWAY_SANDBOX_PORT}`;
  process.env.SSLCOMMERZ_STORE_ID = process.env.SSLCOMMERZ_STORE_ID || 'sandbox-store';
  process.env.SSLCOMMERZ_STORE_PASSWORD = process.env.SSLCOMMERZ_STORE_PASSWORD || 'sandbox-store-pass';
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_sandbox';
  process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_sandbox';
  if (gateway === 'bkash') {
    process.env.BKASH_API_URL = `http://localhost:${process.env.GATEWAY_SANDBOX_PORT}/tokenized`;
    process.env.BKASH_APP_KEY = process.env.BKASH_APP_KEY || 'sandbox-app-key';
    process.env.BKASH_APP_SECRET = process.env.BKASH_APP_SECRET || 'sandbox-app-secret';
    process.env.BKASH_USER_NAME = process.env.BKASH_USER_NAME || '01700000000';
    process.env.BKASH_PASSWORD = process.env.BKASH_PASSWORD || 'sandbox-password';
    process.env.BKASH_CALLBACK_URL = 'http://localhost:4599/api/webhooks/bkash/callback';
  }

  const file = (p) => pathToFileURL(p).href;
  const bcrypt = (await import('bcryptjs')).default;
  const { default: app } = await import(file(path.join(root, 'src', 'app.js')));
  const sequelize = (await import(file(path.join(root, 'src', 'config', 'db.js')))).default;
  const { resetTestDb } = await import(file(path.join(root, 'src', 'test', 'resetDb.js')));
  const { User, Tenant, UserTenant, Product, Order, Payment } = await import(file(path.join(root, 'src', 'models', 'index.js')));
  await resetTestDb();
  const server = app.listen(4599, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));

  const ts = Date.now();
  const tenant = await Tenant.create({ name: `E2E ${gateway} ${ts}`, slug: `e2e-${gateway}-${ts.toString(36)}` });
  const owner = await User.create({
    name: 'E2E Owner',
    email: `e2e-${gateway}-${ts}@example.com`,
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenant.id, role: 'owner' });

  const login = await fetch('http://localhost:4599/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: owner.email, password: 'password123' }),
  });
  const { accessToken } = await login.json();
  if (!accessToken) throw new Error(`${gateway}: login failed — ${JSON.stringify(await login.json().catch(() => ({})))}`);

  const product = await Product.create({
    tenant_id: tenant.id,
    name: `E2E ${gateway} Burger`,
    price: 412,
    weight_gm: 300,
    enabled: true,
  });

  const enable = await fetch(`http://localhost:4599/api/tenants/${tenant.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ paymentMethods: { cash: { enabled: true }, online: { enabled: true } } }),
  });
  if (!enable.ok) throw new Error(`${gateway}: enabling online payments failed (${enable.status})`);

  const placed = await fetch('http://localhost:4599/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      customer_name: `E2E ${gateway} Customer`,
      customer_phone: '01712345678',
      payment_method: 'online',
      items: [{ product_id: product.id, quantity: 2 }],
    }),
  });
  const order = await placed.json();
  if (placed.status !== 201) throw new Error(`${gateway}: order create failed (${placed.status}): ${JSON.stringify(order)}`);
  if (order.payment_status !== 'pending' || !order.paymentUrl) {
    throw new Error(`${gateway}: expected pending payment + paymentUrl, got ${order.payment_status} / ${order.paymentUrl}`);
  }
  console.log(`  ${gateway}: order ${order.order_no} created — pending, paymentUrl=${order.paymentUrl}`);

  if (gateway === 'bkash') {
    // bKash has no server webhook — the sandbox pay page 302-redirects the
    // customer's browser to the merchant callback, which executes the payment.
    // One fetch (auto-following the redirect) completes the whole loop.
    await fetch(order.paymentUrl).catch(() => {});
  }

  // Sandbox auto-confirms; poll until the webhook lands.
  for (let i = 0; i < 40; i++) {
    const fresh = await Order.findByPk(order.id);
    if (fresh.payment_status === 'paid') break;
    await new Promise((r) => setTimeout(r, 250));
  }

  const final = await Order.findByPk(order.id);
  const payment = await Payment.findOne({ where: { order_id: order.id } });
  if (final.payment_status !== 'paid' || payment?.status !== 'paid') {
    throw new Error(`${gateway}: webhook did not confirm — order=${final.payment_status}, payment=${payment?.status}`);
  }

  console.log(`✅ ${gateway.padEnd(10)} ${order.order_no} → ${payment.reference} → PAID (৳${payment.amount})`);
  await new Promise((r) => server.close(r));
  await sequelize.close();
  const fs = await import('node:fs');
  fs.rmSync(process.env.DB_STORAGE, { force: true });
}
