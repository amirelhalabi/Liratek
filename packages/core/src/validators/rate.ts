import { z } from "zod";
import { currencyCodeSchema } from "./common.js";

/**
 * Exchange rate validation schemas — new 4-column schema (v30)
 *
 * One row per non-USD currency: (to_code, market_rate, delta, is_stronger)
 * Universal formula: rate = market_rate + is_stronger × (action × delta)
 */

export const setRateSchema = z.object({
  to_code: currencyCodeSchema,
  market_rate: z.number().positive("Market rate must be positive"),
  delta: z.number().min(0, "Delta must be ≥ 0"),
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
