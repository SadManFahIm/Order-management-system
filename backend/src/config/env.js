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
    .default('http://localhost:5173,http://localhost:5174'),
  // Public base URL used to build email links (verification, password reset).
  APP_BASE_URL: z.string().default('http://localhost:5173'),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
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
