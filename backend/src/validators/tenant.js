import { z } from 'zod';

export const createTenantSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase kebab-case')
    .max(80)
    .optional(),
  settings: z.record(z.unknown()).optional(),
});

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex color, e.g. #00b3a5');

/**
 * Storefront brand theme (per-tenant theming, Phase 4 R3). Lives inside
 * `tenant.settings.brand`; only these public-safe fields are ever exposed
 * through the storefront API.
 */
export const brandSchema = z.object({
  primaryColor: hexColor.optional(),
  accentColor: hexColor.optional(),
  tagline: z.string().trim().max(120).optional(),
  heroImage: z.string().url().max(500).nullable().optional(),
  announcement: z.string().trim().max(160).optional(),
});

export const updateTenantSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  brand: brandSchema.optional(),
  settings: z.record(z.unknown()).optional(),
});

export const setStatusSchema = z.object({
  status: z.enum(['active', 'trial', 'suspended', 'archived']),
});

export const addMemberSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().max(120).optional(),
  password: z.string().min(8).max(128).optional(),
  role: z.enum(['owner', 'manager', 'cashier', 'kitchen', 'delivery', 'staff']),
});
