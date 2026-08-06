import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('A valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: z.string().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(10, 'A token is required'),
});

export const twoFactorLoginSchema = z.object({
  twoFactorToken: z.string().min(10, 'Two-factor token is required'),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

export const twoFactorCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('A valid email is required'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10, 'A token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

/** Provision a staff member into a tenant (platform_admin or manager). */
export const provisionStaffSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  tenantId: z.number().int().positive(),
  role: z.enum(['owner', 'manager', 'cashier', 'kitchen', 'delivery']),
});
