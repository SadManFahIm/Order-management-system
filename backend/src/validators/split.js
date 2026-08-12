import { z } from 'zod';

/**
 * Dine-in split billing payloads (cashier split panel).
 *
 * The frontend may propose diners/allocation, but amounts, methods and the
 * exact-sum invariant are always recomputed/verified server-side in
 * splitService.computeSplitParts — this schema only shapes the request.
 */
export const splitDinerSchema = z.object({
  // Diner label (optional — defaults to "Diner N" server-side).
  label: z.string().trim().max(80).optional().or(z.literal('')),
  method: z.string().trim().max(16, 'Payment method is too long'),
  // bKash/Nagad transaction ID captured at the counter (optional).
  trxID: z.string().trim().max(120).optional().or(z.literal('')),
  // Required only in 'custom' mode — the requested amount for this diner.
  amount: z.number().positive('Amount must be positive').optional(),
});

export const splitRequestSchema = z.object({
  // How the bill was split: equal | item | custom.
  mode: z.enum(['equal', 'item', 'custom']),
  diners: z
    .array(splitDinerSchema)
    .min(2, 'A split needs at least 2 diners')
    .max(20, 'A split supports at most 20 diners'),
  // Item-mode allocation: one row per (order item, diner, quantity).
  allocations: z
    .array(
      z.object({
        orderItemId: z.number().int().positive('orderItemId must be a positive integer'),
        quantity: z.number().int().min(1, 'Quantity must be at least 1'),
        dinerIndex: z.number().int().min(0, 'dinerIndex must be >= 0'),
      })
    )
    .optional(),
});
