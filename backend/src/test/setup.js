/**
 * Vitest setup — runs before test files (and their imports) load.
 * Isolates tests from development data by pointing the database at a scratch
 * file and using a dedicated JWT secret.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-0123456789abcdef';
process.env.DB_STORAGE = './data.test.sqlite';
