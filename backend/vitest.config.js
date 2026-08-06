import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.js'],
    // Test files share a single SQLite test database; run them sequentially
    // to avoid write contention.
    fileParallelism: false,
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.js'],
      exclude: ['src/index.js', 'src/app.js', 'src/config/**', 'src/test/**'],
    },
  },
});
