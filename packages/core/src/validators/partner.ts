import { z } from "zod";
import { idSchema } from "./common.js";
import { counterpartyDiscountInputSchema } from "./counterparty.js";
import { settleLegsCrossCurrency } from "../utils/settleLegConversion.js";

/**
 * Partner System validation schemas (LIRA-037).
 *
 * Shared by the REST routes (`backend/src/api/partners.ts`) so partner
 * config + ledger writes are validated over the web transport. The Electron
 * IPC handlers historically passed straight to the service without Zod; these
 * schemas are the single source of truth for the REST surface.
 *
 * NOTE: none of the write schemas carry `userId` — the ledger actor is
 * injected server-side from the authenticated JWT, never trusted from the
 * client (a spoofed actor would mis-attribute a money-moving ledger entry).
 */

// Mirrors CreateLedgerEntryData["transaction_type"] in PartnerRepository —
// the FULL union, not the narrower 7-value handler interface, so valid
// FOR_*/THROUGH_*/WHISH_TOPUP ledger writes are never silently rejected.
const partnerTransactionTypeSchema = z.enum([
  "OMT_SEND",
  "OMT_RECEIVE",
  "WHISH_SEND",
  "WHISH_RECEIVE",
  "THROUGH_OMT_SEND",
  "THROUGH_OMT_RECEIVE",
  "THROUGH_WHISH_SEND",
  "THROUGH_WHISH_RECEIVE",
  "FOR_OMT_SEND",
  "FOR_OMT_RECEIVE",
  "FOR_WHISH_SEND",
  "FOR_WHISH_RECEIVE",
  "CUSTOM_SERVICE",
  "WHISH_TOPUP",
  "SETTLEMENT",
  "ADJUSTMENT",
]);

// Create a partner (config record — no money movement).
export const partnerCreateSchema = z.object({
  name: z.string().min(1, "Partner name is required"),
  phone: z.string().nullish(),
  notes: z.string().nullish(),
  system_association: z.string().nullish(),
});

// Update a partner (config record). All fields optional.
export const partnerUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().nullish(),
  notes: z.string().nullish(),
  is_active: z.number().int().optional(),
  system_association: z.string().nullish(),
});

// Record a manual partner ledger entry (money — writes partner_ledger).
export const partnerRecordTransactionSchema = z.object({
  partnerId: idSchema,
  transactionType: partnerTransactionTypeSchema.optional(),
  referenceTable: z.string().optional(),
  referenceId: z.number().int().positive().optional(),
  amount: z.number().positive(),
  currency: z.string().min(1),
  direction: z.enum(["DEBIT", "CREDIT"]),
  notes: z.string().optional(),
  /** PFT-7b: "cash moved" — the entry is a physical cash event; the drawer
   *  moves with it (PARTNER_PAYMENT txn) and settlement coverage applies. */
  moveCash: z.boolean().optional(),
});

// CQ-11 — a single split-settlement leg (MultiPaymentInput on the Partners
// page): "settle $100 as $60 CASH + $40 OMT". Deliberately NOT the same shape
// as the sales/recharge payment-leg contract (utils/payments.ts) — there is
// LIRA-313 (owner decision 2026-10-12): a leg MAY carry `direction: "OUT"` —
// change the other side hands back on an overpaid settlement, moving the
// drawer the opposite way to the settlement. A leg without `direction` is IN
// (the settlement's own flow), as everywhere else (FEATURE_GUIDE §4). The
// settlement `amount` is the NET: sum(IN) − sum(OUT) — whatever change is not
// handed back stays on the partner's balance.
const partnerSettlementLegSchema = z.object({
  method: z.string().min(1),
  currency_code: z.string().min(1),
  amount: z.number().positive(),
  direction: z.enum(["IN", "OUT"]).optional(),
});

/** LIRA-313 — the settlement amount a leg set pays: IN legs minus OUT
 *  (change handed back) legs. The ONE definition (rule 14), shared by the
 *  schema refine below and PartnerService.settle. */
export function partnerSettlementNet(
  legs: ReadonlyArray<{ amount: number; direction?: "IN" | "OUT" }>,
): number {
  return legs.reduce(
    (sum, leg) => sum + (leg.direction === "OUT" ? -leg.amount : leg.amount),
    0,
  );
}

/** Shop-day bug 2026-10-16 — the method a settlement's legs actually used:
 *  the one method every IN leg uses, or 'SPLIT' when they differ (change
 *  (OUT) legs never count). `fallback` (the sent `settlementMethod`) when
 *  there are no IN legs. The ONE definition (rule 14) for both the
 *  partner_ledger row (PartnerService.settle) and the PARTNER_SETTLEMENT
 *  transaction (PartnerRepository.recordSettlementMoneyMovement). */
export function partnerSettlementMethod(
  legs: ReadonlyArray<{ method: string; direction?: "IN" | "OUT" }> | undefined,
  fallback: string,
): string {
  const methods = new Set(
    (legs ?? []).filter((l) => l.direction !== "OUT").map((l) => l.method),
  );
  if (methods.size === 0) return fallback;
  return methods.size > 1 ? "SPLIT" : [...methods][0];
}

// Settle a partner balance (money — writes a SETTLEMENT partner_ledger entry;
// direction is computed server-side from the current balance).
export const partnerSettleSchema = z
  .object({
    partnerId: idSchema,
    amount: z.number().positive(),
    currency: z.string().min(1),
    settlementMethod: z.string().min(1),
    notes: z.string().optional(),
    // CQ-10: a settlement may bundle a forgiven remainder ("owed X, paid Y,
    // discount Z") — posts its OWN 'DISCOUNT' partner_ledger entry (same
    // direction as the settlement) + COUNTERPARTY_DISCOUNT transaction
    // (PartnerService.settle). partner_ledger is one-currency-per-row, so only
    // the side matching `currency` above is honored — PartnerService.settle
    // rejects a discount that supplies BOTH amount_usd AND amount_lbp
    // (ambiguous which currency it belongs to) rather than silently drop one.
    discount: counterpartyDiscountInputSchema.optional(),
    // CQ-11 — split-leg settlement (e.g. $60 CASH + $40 OMT), backing the
    // shared MultiPaymentInput settle modal. When present it SUPERSEDES
    // settlementMethod for money movement (PartnerRepository writes N
    // payments rows + N drawer deltas instead of one) — but
    // `settlementMethod` is still required and still stamped on the
    // partner_ledger row itself; omitting `payments` entirely keeps the
    // legacy single-leg behavior byte-identical.
    payments: z.array(partnerSettlementLegSchema).min(1).optional(),
    // Owner decision 2026-10-07: the rate the settle modal's payment input
    // showed (hand-typed or the buy rate), stamped on the PARTNER_SETTLEMENT
    // transaction so the row saves the rate the cashier actually used.
    // Stamp-only — the refine below locks every leg to `currency`, so no
    // amount is ever converted at it.
    exchange_rate: z.number().positive().optional(),
  })
  .refine(
    (d) =>
      !d.payments ||
      d.payments.every((leg) => leg.currency_code === d.currency),
    {
      message:
        "Every payment leg's currency_code must match the settlement currency — multi-currency settles stay one-settle-per-currency",
      path: ["payments"],
    },
  )
  .refine(
    (d) =>
      !d.payments ||
      Math.abs(partnerSettlementNet(d.payments) - d.amount) <= 0.005,
    {
      message:
        "Payment legs (paid minus change handed back) must sum to the settlement amount",
      path: ["payments"],
    },
  )
  .refine(
    (d) => !d.payments || d.payments.some((leg) => leg.direction !== "OUT"),
    {
      message: "A settlement needs at least one payment leg, not only change",
      path: ["payments"],
    },
  )
  .refine(
    (d) =>
      !d.payments || !d.payments.some((leg) => leg.method === "CLIENT_ACCOUNT"),
    {
      message:
        "CLIENT_ACCOUNT settles no money — it cannot appear as a split payment leg; use settlementMethod alone for account settlements",
      path: ["payments"],
    },
  )
  .refine((d) => !(d.payments && d.settlementMethod === "CLIENT_ACCOUNT"), {
    message:
      "A CLIENT_ACCOUNT settlement moves no money and cannot be combined with split payment legs",
    path: ["payments"],
  });

// CQ-10 (D4: admin-only on both transports) — standalone write-off: forgive
// part of a partner balance with NO settlement attached. Mirrors the fixed
// {amount_usd, amount_lbp, reason?} discount contract, but — like
// partnerSettleSchema's `discount` — partner_ledger can only book ONE
// currency per call; PartnerService.writeOff rejects supplying both.
export const partnerWriteOffSchema = z
  .object({
    partnerId: idSchema,
    amount_usd: z.number().nonnegative().default(0),
    amount_lbp: z.number().nonnegative().default(0),
    reason: z.string().optional(),
  })
  .refine((d) => d.amount_usd > 0 || d.amount_lbp > 0, {
    message: "At least one amount (USD or LBP) must be greater than 0",
  });

export type PartnerCreateInput = z.infer<typeof partnerCreateSchema>;
export type PartnerUpdateInput = z.infer<typeof partnerUpdateSchema>;
export type PartnerRecordTransactionInput = z.infer<
  typeof partnerRecordTransactionSchema
>;
export type PartnerSettleInput = z.infer<typeof partnerSettleSchema>;
export type PartnerWriteOffInput = z.infer<typeof partnerWriteOffSchema>;

// LIRA-297 (rule 21) — what a caller SENDS: `z.input`, so `.default()`
// fields stay optional. The adapters (backendApi.ts, ElectronApiAdapter.ts,
// packages/ui ApiAdapter) type their payloads with these, never with a
// hand-copied object literal.
export type PartnerCreatePayload = z.input<typeof partnerCreateSchema>;
export type PartnerUpdatePayload = z.input<typeof partnerUpdateSchema>;
export type PartnerRecordTransactionPayload = z.input<
  typeof partnerRecordTransactionSchema
>;
export type PartnerWriteOffPayload = z.input<typeof partnerWriteOffSchema>;

// ── LIRA-346 — settle partners by day (specs/346-partner-settle-by-day) ────

/** `YYYY-MM` — a calendar month of the shop. */
export const partnerSettleMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM");

/** `YYYY-MM-DD` — a shop day. */
export const partnerSettleDaySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Day must be YYYY-MM-DD");

/** Month rows read (calendar grid). */
export const partnerMonthRowsSchema = z.object({
  partnerId: idSchema,
  month: partnerSettleMonthSchema,
});

/** One day's rows with the settlements that paid them. */
export const partnerDayDetailSchema = z.object({
  partnerId: idSchema,
  day: partnerSettleDaySchema,
});

/** One currency of a settle-picked-days request. `payer` says who hands
 *  over the money: the partner (money IN to the shop) or the shop (money
 *  OUT). The legs pay the NET (IN − OUT change), in this currency only. */
const partnerSettleDaysSectionSchema = z
  .object({
    payer: z.enum(["PARTNER", "SHOP"]),
    payments: z.array(partnerSettlementLegSchema).default([]),
    /** Forgive (today's bundled discount), oldest picked debts first. */
    forgive: z
      .object({
        amount: z.number().nonnegative(),
        reason: z.string().max(500).optional(),
      })
      .optional(),
  })
  .refine(
    (s) => !s.payments.some((leg) => leg.method === "CLIENT_ACCOUNT"),
    {
      message: "CLIENT_ACCOUNT settles no money — it cannot be a payment leg",
      path: ["payments"],
    },
  )
  .refine(
    (s) =>
      s.payments.length === 0 || s.payments.some((l) => l.direction !== "OUT"),
    {
      message: "A settlement needs at least one payment leg, not only change",
      path: ["payments"],
    },
  );

/**
 * Settle picked days (LIRA-346, D1–D10). `selections` = the head ids of the
 * picked days' open rows (minus the ones unticked); `include_account_credits`
 * adds every open account row (partner credit, overpay, ↺ reliefs) to the
 * scope; `credit_used` = how much partner credit the user chose per currency;
 * `expected_owed` = what the sheet showed (selections + account rows, signed:
 * + the partner owes the shop) — the server refuses when it changed.
 * "Settle old history up to <day>" is this same request with no money.
 */
export const partnerSettleDaysSchema = z
  .object({
    partnerId: idSchema,
    selections: z.array(idSchema).max(5000),
    include_account_credits: z.boolean().optional(),
    credit_used: z
      .object({
        usd: z.number().nonnegative().optional(),
        lbp: z.number().nonnegative().optional(),
      })
      .optional(),
    expected_owed: z.object({ usd: z.number(), lbp: z.number() }),
    per_currency: z.object({
      USD: partnerSettleDaysSectionSchema.optional(),
      LBP: partnerSettleDaysSectionSchema.optional(),
    }),
    notes: z.string().max(500).optional(),
    exchange_rate: z.number().positive().optional(),
  })
  .refine((d) => !!d.per_currency.USD || !!d.per_currency.LBP, {
    message: "Enter at least one currency",
    path: ["per_currency"],
  })
  // LIRA-359 (owner decision 2026-10-29) — a box may be paid in the other
  // currency, converted at the box's rate: every leg is USD or LBP, and a
  // leg in the other currency needs the rate it is converted at.
  .refine(
    (d) =>
      (["USD", "LBP"] as const).every(
        (c) =>
          !d.per_currency[c] ||
          d.per_currency[c]!.payments.every(
            (l) => l.currency_code === "USD" || l.currency_code === "LBP",
          ),
      ),
    {
      message: "Every payment leg must be in USD or LBP",
      path: ["per_currency"],
    },
  )
  .refine(
    (d) =>
      !!d.exchange_rate ||
      (["USD", "LBP"] as const).every(
        (c) =>
          !d.per_currency[c] ||
          !settleLegsCrossCurrency(d.per_currency[c]!.payments, c),
      ),
    {
      message:
        "A payment in the other currency needs the exchange rate it is converted at",
      path: ["exchange_rate"],
    },
  )
  .refine((d) => new Set(d.selections).size === d.selections.length, {
    message: "A row is picked twice",
    path: ["selections"],
  })
  .refine((d) => !d.credit_used || d.include_account_credits === true, {
    message: "Partner credit can only be used with the account rows in scope",
    path: ["credit_used"],
  });

export type PartnerSettleDaysInput = z.infer<typeof partnerSettleDaysSchema>;
export type PartnerSettleDaysPayload = z.input<typeof partnerSettleDaysSchema>;
export type PartnerMonthRowsInput = z.infer<typeof partnerMonthRowsSchema>;
export type PartnerDayDetailInput = z.infer<typeof partnerDayDetailSchema>;
