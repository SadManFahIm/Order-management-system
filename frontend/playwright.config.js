import { defineConfig } from '@playwright/test';

// CI runs on ubuntu with `npx playwright install --with-deps chromium`;
// locally we reuse the installed Chrome (no browser download needed).
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  // Single worker: the e2e backend is one scratch DB — specs share it and
  // must run serially to stay deterministic.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5174',
    headless: true,
    channel: CI ? undefined : 'chrome',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      // Real API on a wiped scratch DB (backend/scripts/e2e-server.js).
      // Generous timeout: a cold boot runs 12 migrations + seeds against a
      // fresh PostgreSQL 16 service, which is slow under a loaded shared
      // runner (observed 120s+ wall time on GitHub-hosted ubuntu-latest).
      command: 'node scripts/e2e-server.js',
      cwd: '../backend',
      port: 4100,
      reuseExistingServer: !CI,
      timeout: 240_000,
    },
    {
      // Vite dev server proxying /api → :4100 (via VITE_API_TARGET).
      command: 'npm run dev -- --port 5174 --strictPort',
      cwd: '.',
      port: 5174,
      reuseExistingServer: !CI,
      timeout: 120_000,
      env: { VITE_API_TARGET: 'http://localhost:4100' },
    },
  ],
});
