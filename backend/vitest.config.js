import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.js'],
    // Test files share a single SQLite test database; run them sequentially
    // to avoid write contention.
    fileParallelism: false,
    // DB reset (drop + recreate all tables) can exceed the default 10s hook
    // timeout under v8 coverage instrumentation — give it headroom.
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.js'],
      exclude: ['src/index.js', 'src/app.js', 'src/config/**', 'src/test/**'],
      // Hard floor — the CI coverage gate fails below these (see ci.yml).
      // Calibrated from a full-suite run (87.6% lines / 90.6% functions /
      // 69.1% branches / 89.7% statements); raise as coverage grows.
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 68,
        statements: 87,
      },
    },
  },
});
