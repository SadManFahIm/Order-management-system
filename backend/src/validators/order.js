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
  items: z.array(orderItemSchema).min(1, 'Order must contain at least one item'),
});
