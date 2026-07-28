import { z } from "zod";
import { positiveDecimalSchema, transactionTimeSchema } from "./common.js";

/**
 * Internal wallet exchange validation (owner req 2026-07-28): convert a
 * provider wallet's own USD balance to LBP or vice versa — OMT_App / Whish_App
 * only, USD/LBP only (never General, never an arbitrary currency).
 */

export const walletDrawerNameSchema = z.enum(["OMT_App", "Whish_App"]);
export const walletCurrencySchema = z.enum(["USD", "LBP"]);

export const createWalletExchangeSchema = z
  .object({
    drawerName: walletDrawerNameSchema,
    fromCurrency: walletCurrencySchema,
    toCurrency: walletCurrencySchema,
    amountIn: positiveDecimalSchema,
    rate: positiveDecimalSchema,
    note: z.string().max(500).optional(),
    transaction_time: transactionTimeSchema,
  })
  .refine((data) => data.fromCurrency !== data.toCurrency, {
    message: "From and to currency must be different",
  });

export const getWalletExchangeHistorySchema = z.object({
  drawerName: walletDrawerNameSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).default(50),
});

export type CreateWalletExchangeInput = z.infer<
  typeof createWalletExchangeSchema
>;
export type GetWalletExchangeHistoryInput = z.infer<
  typeof getWalletExchangeHistorySchema
>;
