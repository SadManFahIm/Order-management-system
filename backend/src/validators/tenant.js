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

/**
 * WhatsApp order alerts (Phase 5). Lives inside `tenant.settings.whatsapp`.
 * `number` is the merchant's WhatsApp (for wa.me links); `webhookUrl`
 * receives a POST per new order when `enabled` (Twilio/WATI/Infobip/any
 * gateway); `secret` is sent as a Bearer token to authenticate the hook.
 */
export const whatsappSchema = z.object({
  enabled: z.boolean().optional(),
  number: z
    .string()
    .trim()
    .regex(/^[+]?[0-9\s-]{7,17}$/, 'Must be a valid phone number (e.g. +8801712345678)')
    .optional()
    .or(z.literal('')),
  webhookUrl: z.string().url('Must be a valid URL').max(500).optional().or(z.literal('')),
  secret: z.string().trim().max(200).optional().or(z.literal('')),
  // Also fire a customer-facing status-change notification (to the order's
  // customer_phone) through the same webhook when the order moves status.
  notifyCustomer: z.boolean().optional(),
});

/** One payment method's config inside tenant.settings.paymentMethods. */
const paymentMethodSchema = z.object({
  enabled: z.boolean().optional(),
  number: z
    .string()
    .trim()
    .regex(/^[+]?[0-9\s-]{7,17}$/, 'Must be a valid phone number (e.g. +8801712345678)')
    .optional()
    .or(z.literal('')),
});

/**
 * Accepted payment methods (cash/bKash/Nagad/card/online) with the receiving
 * number for mobile wallets. Lives inside `tenant.settings.paymentMethods`;
 * the storefront/order UI only ever sees the enabled whitelist, never
 * secrets. `online` routes the customer to the hosted gateway (SSLCommerz /
 * Stripe) when the platform has one configured.
 */
export const paymentMethodsSchema = z.object({
  cash: paymentMethodSchema.optional(),
  bkash: paymentMethodSchema.optional(),
  nagad: paymentMethodSchema.optional(),
  card: paymentMethodSchema.optional(),
  online: paymentMethodSchema.optional(),
});

/**
 * Daily closeout email (Phase 5). Lives inside `tenant.settings.reports`:
 * `closeoutEmail` is where the report is delivered, and `autoSendCloseout`
 * schedules it nightly at `hour` (0–23, Dhaka time) when enabled.
 */
/**
 * VAT configuration (Phase 5, NBR-ready). Lives inside `tenant.settings.vat`:
 * `defaultRate` is the workspace-wide VAT % used by the VAT report for items
 * without their own `vat_rate` (Bangladesh: 5% food / 15% standard).
 */
export const vatSettingsSchema = z.object({
  defaultRate: z.coerce.number().min(0).max(100).optional(),
});

export const reportsSettingsSchema = z.object({
  closeoutEmail: z.string().trim().email().max(254).optional().or(z.literal('')),
  autoSendCloseout: z
    .object({
      enabled: z.boolean().optional(),
      hour: z.coerce.number().int().min(0).max(23).default(23),
    })
    .optional(),
});

export const updateTenantSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  brand: brandSchema.optional(),
  whatsapp: whatsappSchema.optional(),
  paymentMethods: paymentMethodsSchema.optional(),
  reports: reportsSettingsSchema.optional(),
  vat: vatSettingsSchema.optional(),
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

export const createInviteSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(['owner', 'manager', 'cashier', 'kitchen', 'delivery', 'staff']).default('cashier'),
  days: z.coerce.number().int().min(1).max(30).optional(),
});

export const transferOwnershipSchema = z.object({
  userId: z.coerce.number().int().positive(),
});

export const changePlanSchema = z.object({
  code: z.enum(['free', 'starter', 'pro', 'growth']),
});

export const samlConfigSchema = z.object({
  enabled: z.boolean().default(true),
  idpEntityId: z.string().trim().min(3).max(255),
  idpSsoUrl: z.string().url('Must be a valid IdP SSO URL').max(500),
  idpSloUrl: z.string().url('Must be a valid IdP SLO URL').max(500).optional().nullable(),
  idpCert: z.string().trim().min(64, 'PEM certificate looks too short').max(20000),
  attributeEmail: z.string().trim().min(1).max(64).default('nameid'),
  attributeName: z.string().trim().min(1).max(64).default('displayname'),
  defaultRole: z.enum(['owner', 'manager', 'cashier', 'kitchen', 'delivery', 'staff']).default('cashier'),
});
