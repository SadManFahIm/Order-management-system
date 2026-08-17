/**
 * Vitest setup — runs before test files (and their imports) load.
 * Isolates tests from development data by pointing the database at a scratch
 * file and using a dedicated JWT secret.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-0123456789abcdef';
process.env.DB_STORAGE = './data.test.sqlite';
// Raise the auth rate limit so lockout/brute-force suites can run full
// attempt cycles without tripping the 15-minute limiter.
process.env.RATE_LIMIT_AUTH_MAX = '1000';
// The public menu / availability endpoints share the generic API limiter
// (120/min default) — raise it so storefront suites can hammer them.
process.env.RATE_LIMIT_MAX = '10000';
