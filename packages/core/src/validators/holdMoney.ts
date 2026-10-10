import { z } from "zod";

/**
 * Hold-money validation contracts — shared by the Electron IPC handlers
 * (hold-money:create / hold-money:collect / hold-money:void-pickup) and the
 * REST routes (POST /api/hold-money, POST /api/hold-money/:id/collect,
 * POST /api/hold-money/pickups/:pickupId/void) so every transport validates
 * against ONE schema (rule 14). Pure zod, no DB import — reachable from
 * `browser.ts` (rule 29).
 *
 * LIRA-214 (OWNER_NOTES_REMAINING_BUILD.md #24, migration v183): Hold Money
 * was the one Services tab with no payment form — two bare USD/LBP boxes on
 * drop-off, and a one-click Collect with no method or amount at all. This
 * file adds the payment-leg contract for both directions plus the new
 * partial-pickup / void-a-pickup contracts.
 */

/**
 * Payment methods Hold Money accepts — cash (any drawer, resolved the same
 * way every other flow resolves CASH) plus the shop's own wallets.
 * Deliberately excludes CUSTOMER_ACCOUNT and GIFT_CARD (owner answer #24):
 * a hold is the shop minding a customer's OWN cash, not a sale — there is no
 * "charge it to their account" or "pay with a voucher" concept for money
 * that was never spent.
 */
export const HOLD_MONEY_METHODS = ["CASH", "OMT", "WHISH", "BINANCE"] as const;
export type HoldMoneyMethod = (typeof HOLD_MONEY_METHODS)[number];

/**
 * A single Hold Money payment leg — a drop-off tender/change leg, or a
 * pickup payout leg. Same shape as every other flow's leg
 * (`salePaymentLegSchema`, custom_services' inline legs): snake_case
 * `currency_code`, optional `direction` (absent/"IN" = customer-paid or
 * payout composition, "OUT" = shop-returned change — `partitionLegs`,
 * utils/payments.ts). `amount` is unconstrained (not `.positive()`) to
 * match `salePaymentLegSchema` — a zero/negative stray leg is filtered at
 * the repository, not rejected at the schema, so a UI row mid-edit never
 * 400s the whole submission.
 */
export const holdMoneyPaymentLegSchema = z.object({
  method: z.enum(HOLD_MONEY_METHODS),
  currency_code: z.enum(["USD", "LBP"]),
  amount: z.number(),
  direction: z.enum(["IN", "OUT"]).optional(),
});

export type HoldMoneyPaymentLegInput = z.infer<
  typeof holdMoneyPaymentLegSchema
>;

/**
 * Hold-money CREATE (drop-off) contract. `usd_amount`/`lbp_amount` stay the
 * "amount to hold" total the form has always shown; `payments` is the NEW
 * rule-16 leg array (split/cross-currency tender plus any change-back OUT
 * legs) the payment form now sends alongside it. `payments` is optional —
 * a caller that omits it (a legacy/scripted caller, or a test fixture built
 * before this ticket) keeps getting the pre-existing behaviour: a single
 * CASH leg for the full usd/lbp amount, posted to whichever drawer CASH
 * resolves to today (HoldMoneyRepository no longer hardcodes General).
 */
export const holdMoneyCreateSchema = z
  .object({
    client_name: z.string().trim().min(1, "Customer name is required"),
    phone_number: z.string().optional(),
    // Rule 11: the resolved client, when the operator picked one from the
    // autocomplete instead of typing a walk-in name. Nullable/optional — a
    // walk-in (name+phone only, no clients row) is unaffected.
    client_id: z.number().int().positive().optional().nullable(),
    // .finite() rejects Infinity (e.g. "1e999" coerces to Infinity) so a
    // non-finite amount can never reach the drawer balance and corrupt it.
    usd_amount: z.coerce.number().finite().nonnegative().default(0),
    lbp_amount: z.coerce.number().finite().nonnegative().default(0),
    notes: z.string().optional(),
    transaction_time: z.string().optional(),
    payments: z.array(holdMoneyPaymentLegSchema).optional(),
    // Owner answer #24: "a currency switch is allowed at the day's Buy
    // rate, editable on the form" — the rate the operator's OWN payment
    // sheet actually converted a cross-currency leg at, reconciled against
    // (moneyPosting.ts's `tenderExchangeRate`), never an independent
    // lookup. No profit is ever booked off it (Hold Money always stamps
    // profit_usd/profit_lbp = 0).
    exchange_rate: z.number().positive().optional(),
  })
  .refine((d) => (d.usd_amount ?? 0) > 0 || (d.lbp_amount ?? 0) > 0, {
    message: "At least one of USD or LBP amount is required",
    path: ["usd_amount"],
  });

// z.input (not z.infer/z.output) — `usd_amount`/`lbp_amount` carry
// `.default(0)`, so the OUTPUT type would make them non-optional even
// though every caller (the payment form, the repository's own `?? 0`
// handling, and legacy/scripted callers) may omit either one. Rule 21: this
// is the adapter/frontend-facing PRE-validation payload type, and the
// pre-defaults input shape is the correct (and more permissive — every
// concrete caller still satisfies it) contract to expose.
export type HoldMoneyCreateInput = z.input<typeof holdMoneyCreateSchema>;

/**
 * Hold-money COLLECT (pickup) contract (LIRA-214, migration v183). `id` is
 * the hold being paid out of. `usd_amount`/`lbp_amount` are the PORTION of
 * the hold's remaining balance being returned THIS pickup — omitting either
 * (or both) defaults that currency to its FULL remaining balance, which is
 * how a full one-shot pickup is expressed (the pre-partial-pickup one-click
 * Collect is now just that default with the new payment-form legs attached).
 * `payments` are the payout's own composition (rule 16 — NOT customer-paid
 * IN legs; a payout the same way `postPayoutLegs`/the RECEIVE cashout sheet
 * already model one). A pickup never carries an OUT (change) leg — the
 * repository refuses one; `direction` stays on the shared leg schema only
 * because the drop-off side still uses it. Optional, same backward-compatibility reasoning as
 * `holdMoneyCreateSchema.payments`: an omitted array posts a single CASH
 * leg for the full portion being collected.
 */
export const holdMoneyCollectSchema = z.object({
  id: z.number().int().positive(),
  usd_amount: z.coerce.number().finite().nonnegative().optional(),
  lbp_amount: z.coerce.number().finite().nonnegative().optional(),
  payments: z.array(holdMoneyPaymentLegSchema).optional(),
  exchange_rate: z.number().positive().optional(),
  transaction_time: z.string().optional(),
  // Kept change (owner decision 2026-10-07): a pickup is a PAYOUT — when the
  // cashier hands out less than the portion the leftover stays with the
  // shop as profit. A CLAIM only — the repository verifies it and never
  // books it unchecked:
  //  - ONE-currency pickup: capped below PAYOUT_KEEP_CHANGE_MAX in the
  //    pickup's own currency, verified by `resolveKeptChange` (payer
  //    "payout").
  //  - TWO-currency pickup (USD and LBP both returned): per currency, NO cap
  //    — kept = portion − handed in that currency (handed ≤ portion), and
  //    the claim must match exactly — verified by `resolveKeptChange`'s
//    `perCurrencyNoCap` payout mode, which does its arithmetic with
//    `holdPickupKeptPerCurrency` below.
  kept_change_usd: z.number().nonnegative().optional(),
  kept_change_lbp: z.number().nonnegative().optional(),
});

export type HoldMoneyCollectInput = z.infer<typeof holdMoneyCollectSchema>;

/**
 * Two-currency Hold Money pickup kept change (owner decision 2026-10-07:
 * "a pickup paid out in BOTH currencies may keep a leftover in each
 * currency, with no cap"). The ONE definition of the per-currency math,
 * shared by the pickup sheet (what it claims) and the server check
 * (`resolveKeptChange` payer "payout" with `perCurrencyNoCap`,
 * repositories/keptChange.ts, called by `HoldMoneyRepository.collectHold`)
 * — rule 14. Pure arithmetic, no DB or Node import, so it stays reachable
 * from `browser.ts` (rule 29). The claim-vs-computed tolerance is
 * `KEPT_CHANGE_ROUNDING_TOLERANCE` (validators/exchange.ts).
 *
 * Per currency: `handed` = the sum of the payout legs in that currency
 * (`Math.abs`, exactly what the posting loop debits; OUT legs ignored — the
 * repository refuses them before this runs), `kept` = portion − handed,
 * rounded to cents / whole LBP and floored at 0. `overUsd`/`overLbp` flag a
 * currency where MORE than the portion was handed: that is a cross-currency
 * payout (part of one currency paid in the other), which is exact-only —
 * the caller must not claim kept change for it.
 *
 * Funding (kept only from drawer methods) is NOT checked here — it needs the
 * payment-method table; the repository enforces it.
 */
export interface HoldPickupKeptResult {
  handedUsd: number;
  handedLbp: number;
  keptUsd: number;
  keptLbp: number;
  overUsd: boolean;
  overLbp: boolean;
}

/** Same epsilons the pickup sheet and repository use for "nothing left" /
 *  "more than the portion" (deliberately coarser than the kept-claim
 *  rounding tolerance — a different question). */
export const HOLD_PICKUP_EPSILON = { USD: 0.01, LBP: 1 } as const;

export function holdPickupKeptPerCurrency(
  portion: { usd: number; lbp: number },
  legs: ReadonlyArray<{
    currency_code: string;
    amount: number;
    direction?: "IN" | "OUT" | undefined;
  }>,
): HoldPickupKeptResult {
  let handedUsd = 0;
  let handedLbp = 0;
  for (const leg of legs) {
    if (leg.direction === "OUT") continue;
    const amt = Math.abs(leg.amount);
    if (!Number.isFinite(amt) || amt === 0) continue;
    if (leg.currency_code === "USD") handedUsd += amt;
    else if (leg.currency_code === "LBP") handedLbp += amt;
  }
  const overUsd = handedUsd > portion.usd + HOLD_PICKUP_EPSILON.USD;
  const overLbp = handedLbp > portion.lbp + HOLD_PICKUP_EPSILON.LBP;
  const keptUsd = Math.max(
    0,
    Math.round((portion.usd - handedUsd) * 100) / 100,
  );
  const keptLbp = Math.max(0, Math.round(portion.lbp - handedLbp));
  return { handedUsd, handedLbp, keptUsd, keptLbp, overUsd, overLbp };
}

/**
 * Void (reverse) ONE pickup event — the rule-20 reversal owner for a
 * partial or full return recorded in error. See
 * `TRANSACTION_TYPES.HOLD_MONEY_COLLECT_VOID`'s doc comment
 * (constants/transactionTypes.ts) for the full mechanism.
 */
export const holdMoneyVoidPickupSchema = z.object({
  pickup_id: z.number().int().positive(),
});

export type HoldMoneyVoidPickupInput = z.infer<
  typeof holdMoneyVoidPickupSchema
>;

// LIRA-297 (rule 21) — what a caller SENDS: `z.input`, so `.default()`
// fields stay optional. The adapters (backendApi.ts, ElectronApiAdapter.ts,
// packages/ui ApiAdapter) type their payloads with these, never with a
// hand-copied object literal.
export type HoldMoneyCollectPayload = z.input<typeof holdMoneyCollectSchema>;
