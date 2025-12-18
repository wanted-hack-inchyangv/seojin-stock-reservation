import { z } from "zod";

export const createStockSchema = z.object({
  sku: z.string().min(1).max(128),
  quantity: z.number().int().nonnegative(),
});

export const reserveSchema = z.object({
  sku: z.string().min(1).max(128),
  quantity: z.number().int().positive(),
  ttlMs: z.number().int().positive().optional(),
});

export type CreateStockInput = z.infer<typeof createStockSchema>;
export type ReserveInput = z.infer<typeof reserveSchema>;
