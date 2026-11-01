import { z } from "zod";
import {
  positiveDecimalSchema,
  currencyCodeSchema,
  transactionTimeSchema,
  historyAllQuerySchema,
  roundingGivenFields,
  addedChangeFields,
  typedNoteField,
} from "./common.js";
import { customerPaymentsField } from "./customerLegs.js";

/**
 * Exchange/currency validation schemas
 */

/**
 * The ONE shortfall cap (rule 14; LIRA-310, owner decisions 2026-10-11) —
 * how far short of the amount due a payment may be closed without the
 * customer or the counterparty paying it: the Waive button on every payment
 * page, the server's check of a waived amount, and the shop keeping a
 * payout's leftover as profit. UP TO AND INCLUDING $5 for a USD total and
 * 450,000 LBP for an LBP total, compared in the total's own currency — never
 * converted, so a rate move cannot change what is allowed. Any other
 * currency has no allowance at all. Exists so a hand-built payload cannot
 * book a real shortchange (e.g. $50 not paid) as a waive or as kept change.
 */
export const SHORTFALL_MAX = { USD: 5, LBP: 450_000 } as const;

/**
 * Payout "keep the change" cap (owner decision 2026-10-06, D9 refined;
 * raised to the shared shortfall cap by LIRA-310). Kept as its own name for
 * its existing readers — ExchangeRepository/keptChange.ts server refusal and
 * MultiPaymentInput payout mode — but it IS `SHORTFALL_MAX`: one value.
 */
export const PAYOUT_KEEP_CHANGE_MAX = SHORTFALL_MAX;

/**
 * Cents / whole-LBP rounding a kept-change figure may carry — the ONE
 * tolerance (rule 14) `resolveKeptChange` (repositories/keptChange.ts)
 * applies when comparing a claimed kept amount with the real excess /
 * shortfall. Lives here (pure, browser-safe — rule 29) next to the cap so
 * a browser-side preview can share it; keptChange.ts itself is Node-only.
 */
export const KEPT_CHANGE_ROUNDING_TOLERANCE = { USD: 0.005, LBP: 0.5 } as const;

/**
 * Is `amount` (in `currency`, the total's own currency) a shortfall the shop
 * may close — 0 up to and including `SHORTFALL_MAX`, plus that currency's
 * rounding tolerance? False for a negative amount and for any currency
 * without a cap. The one predicate the screen and the server share.
 */
export function isWithinShortfallMax(
  amount: number,
  currency: string,
): boolean {
  if (currency !== "USD" && currency !== "LBP") return false;
  if (!Number.isFinite(amount) || amount < 0) return false;
  return (
    amount <= SHORTFALL_MAX[currency] + KEPT_CHANGE_ROUNDING_TOLERANCE[currency]
  );
}

/** Kept-change fields shared by both exchange schemas below — one
 *  definition so neither schema can silently strip them (rule 23). */
const keptChangeFields = {
  /** Payout keep-change: the leftover (owed − paid) the shop keeps as
   *  profit instead of handing it out. See ExchangeRepository. */
  kept_change_usd: z.number().nonnegative().optional(),
  kept_change_lbp: z.number().nonnegative().optional(),
  // LIRA-334 — payout round-up (handed more than owed).
  ...roundingGivenFields,
  // LIRA-336 — change the customer adds on top of amountIn (in toCurrency).
  ...addedChangeFields,
};

/**
 * LIRA-321 — "Customer pays" keys shared by both exchange schemas below (one
 * definition, rule 23: a key missing from ONE schema is silently stripped on
 * whichever transport uses it). `customerPayments` are the lines the customer
 * hands over (money in), `customer_waived_amount` the forgiven leftover, and
 * `clientId` the client a CUSTOMER_ACCOUNT line is booked to. The balance
 * rules (no overpay; a shortfall covered by an account line or a capped
 * forgive) are enforced server-side by `bookCustomerLegs`.
 */
const customerPaysFields = {
  clientId: z.number().int().positive().optional(),
  ...customerPaymentsField,
  /** LIRA-369 — "1 fromCurrency = X USD", typed on the form, for a
   *  customer-side account line in a currency other than USD/LBP. */
  customer_account_usd_rate: z.number().positive().optional(),
  /** LIRA-369 — "1 toCurrency = X USD", typed on the form, for a payout
   *  put on the account in a currency other than USD/LBP. */
  payout_account_usd_rate: z.number().positive().optional(),
};

/** USD and LBP: the currencies a client's account is kept in. */
export function isAccountCurrency(code: string): boolean {
  return code === "USD" || code === "LBP";
}

/**
 * LIRA-365/321 — the ONE rule (rule 14) for whether the customer's leftover
 * may be discounted on an exchange: only when they pay in USD or LBP (the
 * cap is in those currencies). LIRA-369 lifted the same limit for account
 * lines, which any currency may use now (converted to USD at a typed rate).
 * Shared by both schemas below and by `ExchangeRepository.createTransaction`
 * (offline replay skips the schemas).
 */
export function exchangeCustomerCanForgive(fromCurrency: string): boolean {
  return isAccountCurrency(fromCurrency);
}

/** The plain message for the rule above — same text on every path. */
export function exchangeForgiveBlockedMessage(fromCurrency: string): string {
  return `A discount isn't available when the customer pays in ${fromCurrency} — take the full amount.`;
}

/** The fields {@link exchangeAccountIssues} reads. */
export interface ExchangeAccountInput {
  fromCurrency: string;
  toCurrency: string;
  partnerMode?: "FOR" | undefined;
  clientId?: number | undefined;
  payments?: Array<{ method: string; currencyCode: string }> | undefined;
  customerPayments?:
    | Array<{ method: string; currencyCode: string }>
    | undefined;
  customer_account_usd_rate?: number | undefined;
  payout_account_usd_rate?: number | undefined;
  kept_change_usd?: number | undefined;
  kept_change_lbp?: number | undefined;
  rounding_given_usd?: number | undefined;
  rounding_given_lbp?: number | undefined;
  added_change_usd?: number | undefined;
  added_change_lbp?: number | undefined;
  tender_exchange_rate?: number | undefined;
}

/** Payout methods for a currency other than USD/LBP (owner 2026-11-01). */
export const NATIVE_PAYOUT_METHODS: readonly string[] = [
  "CASH",
  "CUSTOMER_ACCOUNT",
];

/**
 * LIRA-369 — the ONE set of rules (rule 14) for the payout side in a
 * currency other than USD/LBP, the customer's account on either side, and
 * the typed account rates. Pure: both schemas run it as a refine and
 * `ExchangeRepository.createTransaction` throws its first issue (offline
 * replay and scripted callers skip the schemas).
 */
export function exchangeAccountIssues(
  data: ExchangeAccountInput,
): Array<{ path: Array<string | number>; message: string }> {
  const issues: Array<{ path: Array<string | number>; message: string }> = [];
  const payout = data.payments ?? [];
  const customer = data.customerPayments ?? [];
  const isAccount = (l: { method: string }) => l.method === "CUSTOMER_ACCOUNT";
  const to = data.toCurrency;
  const from = data.fromCurrency;

  if (data.partnerMode === "FOR") {
    for (const key of [
      "customer_account_usd_rate",
      "payout_account_usd_rate",
    ] as const) {
      if (data[key] !== undefined) {
        issues.push({
          path: [key],
          message: "A partner exchange has no customer account.",
        });
      }
    }
    return issues;
  }

  if (payout.some(isAccount) && !data.clientId) {
    issues.push({
      path: ["clientId"],
      message: "Choose a client to put the payout on their account.",
    });
  }

  const nativePayout = !isAccountCurrency(to) && payout.length > 0;
  if (nativePayout) {
    payout.forEach((leg, i) => {
      if (leg.currencyCode !== to) {
        issues.push({
          path: ["payments", i, "currencyCode"],
          message: `The shop pays in ${to} only on this exchange.`,
        });
      }
      if (!NATIVE_PAYOUT_METHODS.includes(leg.method)) {
        issues.push({
          path: ["payments", i, "method"],
          message: `Pay ${to} in cash or to the customer's account.`,
        });
      }
    });
    for (const key of [
      "kept_change_usd",
      "kept_change_lbp",
      "rounding_given_usd",
      "rounding_given_lbp",
      "added_change_usd",
      "added_change_lbp",
      "tender_exchange_rate",
    ] as const) {
      if ((data[key] ?? 0) > 0) {
        issues.push({
          path: [key],
          message: `Keep change, round-up and added change work in USD and LBP only — not on a ${to} payout.`,
        });
      }
    }
  }

  const rateRule = (
    key: "customer_account_usd_rate" | "payout_account_usd_rate",
    currency: string,
    needed: boolean,
  ) => {
    if (needed && !(data[key] !== undefined && data[key] > 0)) {
      issues.push({
        path: [key],
        message: `Type the ${currency} → USD rate for the amount put on the account.`,
      });
    }
    if (!needed && data[key] !== undefined) {
      issues.push({
        path: [key],
        message: `This rate is only for ${currency} put on the customer's account.`,
      });
    }
  };
  rateRule(
    "payout_account_usd_rate",
    to,
    !isAccountCurrency(to) && payout.some(isAccount),
  );
  rateRule(
    "customer_account_usd_rate",
    from,
    !isAccountCurrency(from) && customer.some(isAccount),
  );
  return issues;
}

/** The "Customer pays" refines both exchange schemas apply. */
function refineCustomerPays(
  data: {
    fromCurrency: string;
    // `| undefined` so the frontend's exactOptionalPropertyTypes accepts
    // zod's inferred optionals (tests import this module directly).
    partnerMode?: "FOR" | undefined;
    clientId?: number | undefined;
    customerPayments?:
      | Array<{ method: string; currencyCode: string }>
      | undefined;
    customer_waived_amount?: number | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const lines = data.customerPayments;
  const hasCustomerPays =
    (lines !== undefined && lines.length > 0) ||
    (data.customer_waived_amount ?? 0) > 0;
  if (!hasCustomerPays) return;
  if (data.partnerMode === "FOR") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "A partner exchange takes no money from a customer — remove the customer's payment lines.",
      path: ["customerPayments"],
    });
  }
  (lines ?? []).forEach((line, i) => {
    if (line.currencyCode !== data.fromCurrency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `The customer pays in ${data.fromCurrency} only on this exchange.`,
        path: ["customerPayments", i, "currencyCode"],
      });
    }
  });
  if (
    (lines ?? []).some((l) => l.method === "CUSTOMER_ACCOUNT") &&
    !data.clientId
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Choose a client to put part of the payment on their account.",
      path: ["clientId"],
    });
  }
  if (
    !exchangeCustomerCanForgive(data.fromCurrency) &&
    (data.customer_waived_amount ?? 0) > 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: exchangeForgiveBlockedMessage(data.fromCurrency),
      path: ["customer_waived_amount"],
    });
  }
}

/** LIRA-369 — {@link exchangeAccountIssues} as a refine on both schemas. */
function refineExchangeAccount(
  data: ExchangeAccountInput,
  ctx: z.RefinementCtx,
): void {
  for (const issue of exchangeAccountIssues(data)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: issue.message,
      path: issue.path,
    });
  }
}

export const createExchangeSchema = z
  .object({
    fromCurrency: currencyCodeSchema,
    toCurrency: currencyCodeSchema,
    amountIn: positiveDecimalSchema,
    amountOut: positiveDecimalSchema,
    rate: positiveDecimalSchema,
    clientName: z.string().max(255).optional(),
    note: z.string().max(500).optional(),
    /** LIRA-366: the cashier's own note; `note` keeps generated labels. */
    typedNote: typedNoteField,
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
    ...keptChangeFields,
    ...customerPaysFields,
  })
  .refine((data) => data.fromCurrency !== data.toCurrency, {
    message: "From and To currencies must be different",
  })
  .superRefine((data, ctx) => {
    refineCustomerPays(data, ctx);
    refineExchangeAccount(data, ctx);
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
export const exchangeSubmitSchema = z
  .object({
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
    /** LIRA-366: the cashier's own note; `note` keeps generated labels. */
    typedNote: typedNoteField,
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
    ...keptChangeFields,
    ...customerPaysFields,
    // LIRA-329 — informational only (kept on the transaction's details and
    // client columns; never read by any money step): whether the cashier
    // typed their own rate for each leg, and the picked client's phone.
    leg1RateOverridden: z.boolean().optional(),
    leg2RateOverridden: z.boolean().optional(),
    clientPhone: z.string().max(30).optional(),
  })
  .superRefine((data, ctx) => {
    refineCustomerPays(data, ctx);
    refineExchangeAccount(data, ctx);
    // A cross exchange (viaCurrency set) needs a USD anchor for its
    // internal "from -> USD -> to" passthrough — mirrors
    // `ExchangeRepository._crossUsdNotional`'s anchor priority: when
    // `toCurrency === 'LBP'` it anchors off `leg2Rate`; otherwise
    // (`fromCurrency === 'LBP'`, or an exotic<->exotic pair) it anchors off
    // `leg1Rate` FIRST, but for the exotic<->exotic case it falls back to
    // `leg2Rate` at runtime if the FROM currency has no configured
    // `exchange_rates` row. That fallback is a DB-state question this
    // stateless validator cannot see — so rather than replicate
    // `_crossUsdNotional`'s field selection (and risk drifting out of sync
    // with it again), this requires BOTH leg1Rate and leg2Rate whenever
    // `viaCurrency` is set, covering every anchor path the repository can
    // take regardless of which one it picks at runtime. Before this check,
    // a hand-built cross payload that omitted the anchor rate reached
    // `data.leg2Rate as number` unchecked and divided 1/undefined inside
    // `_usdPerUnitFromExecutedRate` -> a NaN `unit_cost_usd` lot.
    if (!data.viaCurrency) return;
    for (const field of ["leg1Rate", "leg2Rate"] as const) {
      const value = data[field];
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} must be a finite positive number for a cross exchange (viaCurrency set)`,
          path: [field],
        });
      }
    }
  });

export type ExchangeSubmitInput = z.infer<typeof exchangeSubmitSchema>;
/** The payload type the frontend adapters send (rule 21 — derived from the
 *  schema, never hand-copied). */
export type ExchangeSubmitPayload = z.input<typeof exchangeSubmitSchema>;

export const getExchangeHistorySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(50),
  all: historyAllQuerySchema,
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

// LIRA-297 (rule 21) — what a caller SENDS: `z.input`, so `.default()`
// fields stay optional. The adapters (backendApi.ts, ElectronApiAdapter.ts,
// packages/ui ApiAdapter) type their payloads with these, never with a
// hand-copied object literal.
export type UpdateExchangeMetadataPayload = z.input<
  typeof updateExchangeMetadataSchema
>;
