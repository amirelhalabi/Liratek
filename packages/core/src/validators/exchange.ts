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
     * in sync with `exchangeSubmitSchema`'s own `payments` field below
     * (same trap as partnerId above) — a field missing from ONE schema is
     * silently stripped on whichever transport's endpoint uses it.
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

/**
 * Full exchange-submit contract (EXCHANGE_LOT_SETTLEMENT.md "Named
 * follow-up" F3, rule 14 unification): the ACTUAL shape the Exchange page
 * always sends — leg1/leg2 rates and profits already computed client-side
 * (or lot-priced server-side for exotic legs), because
 * `ExchangeService.addDirectTransaction` never recomputes them from DB
 * rates the way `addTransaction`/`createExchangeSchema` above does.
 *
 * Before this fix, `POST /api/exchange/transactions` validated against
 * `createExchangeSchema` (above) and called `addTransaction` — silently
 * stripping every leg field an operator's rate override or an
 * API-currency trade needs, and re-deriving the rate server-side instead
 * of trusting the one the till actually used. This schema lifts the FULL
 * contract out of what used to be a LOCAL duplicate in
 * electron-app/schemas/index.ts (`ExchangeTransactionSchema`) so the IPC
 * handler (`exchange:add-transaction`) and the REST route validate
 * against ONE schema, both landing on
 * `ExchangeService.addDirectTransaction`.
 *
 * Field optionality is a verbatim lift of the old local duplicate — do
 * NOT tighten leg2Rate, leg2MarketRate, leg2ProfitUsd, viaCurrency,
 * partnerId, or payments to required, and do NOT loosen leg1Rate,
 * leg1MarketRate, leg1ProfitUsd, or totalProfitUsd to optional: every real
 * caller (the Exchange page, every e2e seed helper) already computes and
 * sends all four before submit.
 */
export const exchangeSubmitSchema = z.object({
  fromCurrency: z.string().min(1),
  toCurrency: z.string().min(1),
  amountIn: z.number().positive(),
  amountOut: z.number().positive(),
  leg1Rate: z.number(),
  leg1MarketRate: z.number(),
  leg1ProfitUsd: z.number(),
  leg2Rate: z.number().optional(),
  leg2MarketRate: z.number().optional(),
  leg2ProfitUsd: z.number().optional(),
  viaCurrency: z.string().optional(),
  totalProfitUsd: z.number(),
  clientName: z.string().optional(),
  note: z.string().optional(),
  fromCurrencyName: z.string().optional(),
  toCurrencyName: z.string().optional(),
  /**
   * Owner decision 2026-08-23 (EXCHANGE_LOT_SETTLEMENT.md "NEW named
   * follow-up"): backdating exchanges is ENABLED, trusted, no guard. Was
   * missing from this schema even though `createExchangeSchema` above
   * already had it via the same `transactionTimeSchema` — the Exchange
   * page's backdate override field was silently stripped by
   * validatePayload/validateRequest on BOTH transports before it ever
   * reached ExchangeRepository.createTransaction (which already honors it
   * correctly). Backdating a BUY affects FIFO lot-consumption order by
   * design — see the plan doc's "Accepted behavior" section.
   */
  transaction_time: transactionTimeSchema,
  // LIRA-081 (PFT-R): a "for partner" exchange — see
  // ExchangeRepository.createTransaction. Kept in sync with
  // createExchangeSchema's own partnerId/partnerMode fields above (same
  // trap: a field missing from ONE of the two schemas is silently
  // stripped on whichever transport calls that schema's endpoint).
  partnerId: z.number().int().positive().optional(),
  partnerMode: z.enum(["FOR"]).optional(),
  /** Split payout — see createExchangeSchema's own `payments` doc above. */
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
  tender_exchange_rate: z.number().positive().optional(),
});

export type ExchangeSubmitInput = z.infer<typeof exchangeSubmitSchema>;

export const getExchangeHistorySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(50),
});

/**
 * Edit non-financial metadata (client name / note) on an existing exchange
 * transaction row. EXCHANGE_LOT_SETTLEMENT.md Phase 6 (rule 14/19 cleanup) —
 * lifted here from a LOCAL copy in backend/src/api/exchange.ts so the IPC
 * handler (`exchange:update-metadata`) and the REST route
 * (`POST /api/exchange/update-metadata`) validate against ONE schema.
 */
export const updateExchangeMetadataSchema = z.object({
  id: z.number().int().positive(),
  client_name: z.string().max(255).optional(),
  note: z.string().max(500).optional(),
});

export type CreateExchangeInput = z.infer<typeof createExchangeSchema>;
export type GetExchangeHistoryInput = z.infer<typeof getExchangeHistorySchema>;
export type UpdateExchangeMetadataInput = z.infer<
  typeof updateExchangeMetadataSchema
>;
