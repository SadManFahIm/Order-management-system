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
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
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
