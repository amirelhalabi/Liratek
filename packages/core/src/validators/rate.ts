import { z } from "zod";
import { currencyCodeSchema } from "./common.js";

/**
 * Exchange rate validation schemas
 *
 * One row per non-USD currency: (to_code, market_rate, buy_rate, sell_rate, is_stronger)
 */

export const setRateSchema = z.object({
  to_code: currencyCodeSchema,
  market_rate: z.number().positive("Market rate must be positive"),
  buy_rate: z.number().positive("Buy rate must be positive"),
  sell_rate: z.number().positive("Sell rate must be positive"),
  is_stronger: z
    .union([z.literal(1), z.literal(-1)])
    .refine((v) => v === 1 || v === -1, {
      message:
        "is_stronger must be 1 (weaker than USD) or -1 (stronger than USD)",
    }),
});

export const deleteRateSchema = z.object({
  to_code: currencyCodeSchema,
});

export type SetRateData = z.infer<typeof setRateSchema>;
export type DeleteRateData = z.infer<typeof deleteRateSchema>;
