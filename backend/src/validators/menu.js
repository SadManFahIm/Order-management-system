import { z } from 'zod';

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(120),
  parentId: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentId: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const variantSchema = z.object({
  name: z.string().trim().min(1, 'Variant name is required').max(80),
  priceAdjustment: z.number().min(0).optional(),
  sortOrder: z.number().int().min(0).optional(),
  // Per-variant stock (Phase 4) — NULL = unlimited / inherits the product.
  stock: z.number().int().min(0).nullable().optional(),
});

export const addonSchema = z.object({
  name: z.string().trim().min(1, 'Add-on name is required').max(120),
  price: z.number().min(0).optional(),
  sortOrder: z.number().int().min(0).optional(),
});
