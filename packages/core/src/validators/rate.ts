import { z } from "zod";
import { positiveDecimalSchema, currencyCodeSchema } from "./common.js";

/**
 * Exchange rate validation schemas
 */

export const setRateSchema = z.object({
  fromCurrency: currencyCodeSchema,
  toCurrency: currencyCodeSchema,
  rate: positiveDecimalSchema.min(0.0001, "Rate must be greater than 0"), // Prevent zero/negative rates
});

export const getRateSchema = z.object({
  fromCurrency: currencyCodeSchema.optional(),
  toCurrency: currencyCodeSchema.optional(),
});

export type SetRateInput = z.infer<typeof setRateSchema>;
export type GetRateInput = z.infer<typeof getRateSchema>;
