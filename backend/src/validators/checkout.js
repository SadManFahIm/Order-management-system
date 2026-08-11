import { z } from 'zod';

/**
 * Public storefront checkout (Phase 5) — guest order placement.
 *
 * The client sends ONLY ids + quantities; prices, totals, fees and
 * availability are all resolved server-side from the database. Never trust
 * a client-submitted price or total.
 */
export const checkoutItemSchema = z.object({
  product_id: z.number().int().positive('product_id must be a positive integer'),
  quantity: z.number().int().min(1, 'quantity must be at least 1').max(999),
  variant_id: z.number().int().positive().optional().nullable(),
  addon_ids: z.array(z.number().int().positive()).optional(),
});

export const checkoutSchema = z.object({
  // pickup | delivery | scheduled_pickup | scheduled_delivery
  order_type: z
    .enum(['pickup', 'delivery', 'scheduled_pickup', 'scheduled_delivery'])
    .default('pickup'),
  customer_name: z.string().trim().min(1, 'Customer name is required').max(120),
  customer_phone: z
    .string()
    .trim()
    .min(10, 'A valid phone number is required for order tracking')
    .max(30),
  // Required for delivery orders (validated in the route, needs the order type).
  customer_address: z.string().trim().max(500).optional().or(z.literal('')),
  // Required for scheduled_* orders — ISO datetime, validated in the route.
  scheduled_at: z.string().trim().optional().or(z.literal('')),
  // cash | bkash | nagad | card | online — validated against the tenant's
  // enabled methods in the route.
  payment_method: z.string().trim().max(16).default('cash'),
  // bKash/Nagad transaction ID captured at the counter (optional).
  payment_reference: z.string().trim().max(120).optional().or(z.literal('')),
  items: z.array(checkoutItemSchema).min(1, 'Cart is empty — add items before checkout'),
});
