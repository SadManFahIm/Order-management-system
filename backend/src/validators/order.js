import { z } from 'zod';

export const orderItemSchema = z.object({
  product_id: z.number().int().positive('product_id must be a positive integer'),
  quantity: z.number().int().min(1).max(999, 'quantity must be between 1 and 999'),
});

/** Order creation payload. */
export const createOrderSchema = z.object({
  customer_name: z.string().trim().min(1, 'Customer name is required').max(120),
  customer_phone: z.string().trim().max(30).optional().or(z.literal('')),
  customer_address: z.string().trim().max(500).optional().or(z.literal('')),
  // Physical table for dine-in orders (QR table menu) — validated against
  // the workspace's tables in the route (needs tenant context).
  table_no: z.number().int().positive('table_no must be a positive integer').optional().nullable(),
  // Payment method (cash | bkash | nagad | card) — validated against the
  // tenant's enabled methods in the route (needs tenant context).
  payment_method: z
    .string()
    .trim()
    .max(16)
    .optional()
    .or(z.literal('')),
  // bKash/Nagad transaction ID captured at the counter (optional).
  payment_reference: z.string().trim().max(120).optional().or(z.literal('')),
  // Order type (Phase 5) — pickup default; delivery / scheduled_* supported.
  // The storefront checkout is the primary consumer; merchant (counter) orders
  // may also be placed as delivery or scheduled.
  order_type: z
    .enum(['pickup', 'delivery', 'scheduled_pickup', 'scheduled_delivery'])
    .optional(),
  // Requested pickup/delivery time for scheduled_* orders (ISO datetime,
  // validated in the route).
  scheduled_at: z.string().trim().optional().or(z.literal('')),
  // Delivery zone (Phase 5 follow-up): optional zone a delivery order belongs
  // to; auto-assignment picks a least-loaded rider covering that zone.
  delivery_zone: z.string().trim().max(64).optional().or(z.literal('')),
  // Split payments (Phase 6) — when present, creates one payment row per part
  // instead of a single one; each part must be an enabled non-online method
  // and the parts must sum to the order total (validated in the route/service
  // where the tenant config + grand total are known).
  payments: z
    .array(
      z.object({
        method: z.string().trim().max(16, 'Payment method is too long'),
        amount: z.number().positive('Split amount must be positive'),
        reference: z.string().trim().max(120).optional().or(z.literal('')),
        // Diner label for QR table bill-split — stored on the payment row's
        // notes (visible to cashiers + in the closeout).
        note: z.string().trim().max(80).optional().or(z.literal('')),
      })
    )
    .optional(),
  items: z.array(orderItemSchema).min(1, 'Order must contain at least one item'),
});
