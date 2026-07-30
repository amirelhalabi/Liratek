import { z } from "zod";
import {
  positiveDecimalSchema,
  currencyCodeSchema,
  transactionTimeSchema,
} from "./common.js";

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
    transaction_time: transactionTimeSchema,
    // LIRA-081 (PFT-R): a "for partner" exchange — the partner stands in for
    // the walk-in customer. See ExchangeRepository.createTransaction.
    partnerId: z.number().int().positive().optional(),
    partnerMode: z.enum(["FOR"]).optional(),
    /**
     * Split payout (2026-07-30): how the shop pays the customer's amountOut
     * across several legs — reconciled hard-reject against amountOut in
     * toCurrency; each leg debits its own drawer in its own currency. Keep
     * in sync with the LOCAL duplicate in electron-app/schemas/index.ts's
     * ExchangeTransactionSchema (rule-14 debt, same trap as partnerId above)
     * — a field missing THERE is silently stripped on desktop; missing HERE,
     * on web.
     */
    payments: z
      .array(
        z.object({
          method: z.string(),
          currencyCode: z.string(),
          amount: z.number().positive(),
          direction: z.enum(["IN", "OUT"]).optional(),
        }),
      )
      .optional(),
    /** The USD→LBP rate the payment sheet actually converted payout legs at
     *  (lira-095 — reconcile at the till's rate, not the server rate). */
    tender_exchange_rate: z.number().positive().optional(),
  })
  .refine((data) => data.fromCurrency !== data.toCurrency, {
    message: "From and To currencies must be different",
  });

export const getExchangeHistorySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(50),
});

export type CreateExchangeInput = z.infer<typeof createExchangeSchema>;
export type GetExchangeHistoryInput = z.infer<typeof getExchangeHistorySchema>;
