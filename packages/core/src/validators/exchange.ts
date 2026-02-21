import { z } from "zod";
import { positiveDecimalSchema, currencyCodeSchema } from "./common.js";

/**
 * Exchange/currency validation schemas
 */

export const createExchangeSchema = z
  .object({
    fromCurrency: currencyCodeSchema,
    toCurrency: currencyCodeSchema,
    amountIn: positiveDecimalSchema,
    amountOut: positiveDecimalSchema,
    rate: positiveDecimalSchema,
    clientName: z.string().max(255).optional(),
    note: z.string().max(500).optional(),
  })
  .refine((data) => data.fromCurrency !== data.toCurrency, {
    message: "From and To currencies must be different",
  });

export const getExchangeHistorySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(50),
});

export type CreateExchangeInput = z.infer<typeof createExchangeSchema>;
export type GetExchangeHistoryInput = z.infer<typeof getExchangeHistorySchema>;
