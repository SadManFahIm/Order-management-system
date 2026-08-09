/**
 * One-shot demo bootstrap for a fresh clone (or after a DB reset):
 *
 *   npm run seed:demo
 *
 * Runs, in order:
 *   1. seed-admin       → admin@oms.dev / Str0ngPass!42 (or $SEED_PASSWORD)
 *   2. seed-restaurants → 20 Dhaka restaurant workspaces (89 items, 12 QR tables each)
 *   3. seed-orders      → realistic 7-day order history for the dashboard charts
 *
 * All three are idempotent, so re-running never duplicates data. The backend
 * node scripts are spawned directly (not through `npm run`) so CLI flags are
 * forwarded verbatim on every platform.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = join(root, 'backend');

const runNode = (script, args = []) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: backendDir,
      stdio: 'inherit',
    });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))
    );
  });

const password = process.env.SEED_PASSWORD || 'Str0ngPass!42';

try {
  await runNode('scripts/seed-admin.js', [
    '--name', 'Platform Admin',
    '--email', 'admin@oms.dev',
    '--password', password,
  ]);
  await runNode('scripts/seed-restaurants.js');
  await runNode('scripts/seed-orders.js');

  console.log('\n✅ Demo dataset ready:');
  console.log('   Login → admin@oms.dev / ' + password);
  console.log('   Workspaces → Default Restaurant + 20 seeded restaurants (KFC Dhaka, Pizza Hut, …)');
  console.log('   Start the app → npm run dev  (backend :4000 · frontend :5173)');
} catch (err) {
  console.error('Seed failed:', err.message);
  process.exit(1);
}
