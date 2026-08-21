import 'dotenv/config';
import { z } from 'zod';

/**
 * Centralized environment configuration.
 *
 * All process.env reads in the backend should go through this module so the
 * application fails fast at boot when required configuration is missing or
 * malformed — never mid-request with a confusing error.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET must be set and at least 16 characters long'),
  DB_STORAGE: z.string().default('./data.sqlite'),
  // Database dialect. SQLite is the zero-config dev default; PostgreSQL is
  // the V2 target (docker-compose `db` service, production).
  DB_DIALECT: z.enum(['sqlite', 'postgres']).default('sqlite'),
  // PostgreSQL connection. Prefer DATABASE_URL; the discrete DB_* variables
  // are used as a fallback (and by docker-compose to provision the db service).
  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().default('oms'),
  DB_USER: z.string().default('oms'),
  DB_PASSWORD: z.string().default('oms'),
  DB_SSL: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  CORS_ORIGINS: z
    .string()
    .default(
      'http://localhost:5173,http://localhost:5174,' +
        'http://127.0.0.1:5173,http://127.0.0.1:5174'
    ),
  // Public base URL used to build email links (verification, password reset).
  APP_BASE_URL: z.string().default('http://localhost:5173'),
  // ── Email delivery (Phase 5) ──────────────────────────────────────────
  // 'stub' (default) logs emails in dev/test with zero config; 'smtp' sends
  // real mail through any SMTP server (Gmail, Zoho, Mailgun SMTP, SES SMTP…)
  // via nodemailer. Production should set MAIL_DRIVER=smtp.
  MAIL_DRIVER: z.enum(['stub', 'smtp']).default('stub'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  MAIL_FROM: z.string().default('Orderly <no-reply@orderly.app>'),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  // Per-IP request budget for the global /api limiter (default 120/min).
  // The e2e harness raises this so full browser suites never trip the
  // limiter; production keeps the default unless explicitly raised.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().optional(),
  // ── Media / object storage (Phase 4 image pipeline) ────────────────────
  // 'local' writes to UPLOAD_DIR (zero-config dev; served via /uploads).
  // 's3' uses an S3-compatible bucket (AWS, MinIO, R2, etc.).
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
  // S3-compatible credentials — never hardcode. All optional in dev.
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // Custom endpoint for S3-compatible providers (MinIO, R2).
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  // CDN base for public image URLs (e.g. https://cdn.example.com). Falls
  // back to the bucket/API URL when unset.
  CDN_BASE_URL: z.string().optional(),
  // Upload + import limits.
  MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  MAX_IMAGE_DIMENSION: z.coerce.number().int().positive().default(4096),
  MAX_IMPORT_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024),
  MAX_IMPORT_ROWS: z.coerce.number().int().positive().default(2000),
  // ── Online payment gateway (Phase 5/6) ─────────────────────────────────
  // 'none' disables online payments (the default). 'sslcommerz' / 'stripe'
  // / 'bkash' enable the hosted-checkout flow: an order placed with
  // `payment_method: 'online'` returns a gateway redirect URL, and the
  // gateway confirms the payment (webhook for SSLCommerz/Stripe, callback
  // + execute for bKash — flips pending → paid). Sandbox by default — set
  // the *_SANDBOX flags to '0' only for production credentials.
  PAYMENT_GATEWAY: z.enum(['none', 'sslcommerz', 'stripe', 'bkash']).default('none'),
  SSLCOMMERZ_STORE_ID: z.string().optional(),
  SSLCOMMERZ_STORE_PASSWORD: z.string().optional(),
  SSLCOMMERZ_SANDBOX: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  SSLCOMMERZ_SUCCESS_URL: z.string().default('http://localhost:5173/orders'),
  SSLCOMMERZ_FAIL_URL: z.string().default('http://localhost:5173/orders'),
  SSLCOMMERZ_CANCEL_URL: z.string().default('http://localhost:5173/orders'),
  // Internal test override — lets tests/local mocks stand in for the gateway.
  SSLCOMMERZ_API_URL: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_API_URL: z.string().default('https://api.stripe.com'),
  // ── bKash Tokenized Checkout (Phase 6) ─────────────────────────────────
  // Credentials from the bKash merchant portal (sandbox by default — set
  // BKASH_SANDBOX=0 for live). The flow: grant token → create payment →
  // customer pays on bKash's page → browser redirected to BKASH_CALLBACK_URL
  // → the backend executes the payment (trxID) and marks it paid.
  BKASH_APP_KEY: z.string().optional(),
  BKASH_APP_SECRET: z.string().optional(),
  BKASH_USER_NAME: z.string().optional(),
  BKASH_PASSWORD: z.string().optional(),
  BKASH_SANDBOX: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  BKASH_API_URL: z.string().optional(),
  BKASH_CALLBACK_URL: z
    .string()
    .default('http://localhost:4000/api/webhooks/bkash/callback'),
  // ── Usage-based billing (Phase 3 follow-ups) ──────────────────────────
  // Optional webhook that receives per-tenant usage meter snapshots on a
  // schedule (products / orders today / members / storage vs plan limits).
  // When unset the reporter is a no-op; a secret (when set) signs each
  // request with an HMAC-SHA256 `X-Billing-Signature` header.
  BILLING_WEBHOOK_URL: z.string().optional(),
  BILLING_WEBHOOK_SECRET: z.string().optional(),
  BILLING_REPORT_INTERVAL_MS: z.coerce.number().int().positive().default(6 * 60 * 60 * 1000),
  // ── Analytics (Phase 7) ───────────────────────────────────────────────
  // Maximum span (days) a custom analytics date range may cover — bounds the
  // cost of range queries no matter what the client asks for.
  ANALYTICS_MAX_RANGE_DAYS: z.coerce.number().int().positive().default(366),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

/** Origins allowed to call the API (comma-separated in env). */
export const allowedOrigins = env.CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);
