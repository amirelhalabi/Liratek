import { z } from "zod";
import { counterpartyDiscountInputSchema } from "./counterparty.js";
import { isWithinShortfallMax, SHORTFALL_MAX } from "./exchange.js";
import { OMT_COVERED_TYPE_VALUES } from "../utils/omtCoveredTypes.js";
import { clientDayInputSchema, localDayFormatSchema } from "./common.js";
import {
  ACCOUNT_CREDIT_REASON_MAX,
  ACCOUNT_CREDIT_REASON_MIN,
} from "../constants/accountCreditWriteOff.js";

/**
 * LIRA-256 — which OMT commission types one statement (balance SMS) covers.
 * Shared by the statement-check read (IPC + REST) and both settle schemas.
 * Non-empty: `[]` would mean "covers nothing" — almost certainly a client
 * bug, so it is refused. Absent (on the settle schemas) = all types =
 * unchanged behaviour (S3). Duplicates are allowed and ignored.
 */
export const omtCoveredTypesSchema = z
  .array(z.enum(OMT_COVERED_TYPE_VALUES))
  .min(1);
export type OmtCoveredTypesInput = z.input<typeof omtCoveredTypesSchema>;

/**
 * Supplier ledger validation schemas (CQ-8, rule 14).
 *
 * Lifted verbatim (field names unchanged) from electron-app/schemas/index.ts
 * so the Electron IPC handlers (electron-app/handlers/supplierHandlers.ts)
 * and any REST route validate against ONE schema each. Naming mirrors the
 * existing debt.ts/partner.ts convention (camelCase `<domain><Action>Schema`).
 */

// LIRA-297 — lifted verbatim from electron-app/schemas/index.ts's
// `SupplierCreateSchema` so `suppliers:create` (IPC) and `POST /api/suppliers`
// (REST, which used to check `name` by hand and forward the rest unchecked)
// validate against ONE schema. Keys are exactly CreateSupplierData's.
export const supplierCreateSchema = z.object({
  name: z.string().min(1, "Supplier name is required"),
  contact_name: z.string().optional(),
  phone: z.string().optional(),
  note: z.string().optional(),
  module_key: z.string().optional(),
  provider: z.string().optional(),
});

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>;
// What a caller SENDS — the adapters type the create payload with this.
export type SupplierCreatePayload = z.input<typeof supplierCreateSchema>;

export const supplierLedgerEntrySchema = z.object({
  supplier_id: z.number().int().positive(),
  entry_type: z.enum(["TOP_UP", "PAYMENT", "ADJUSTMENT"]),
  amount_usd: z.number(),
  amount_lbp: z.number(),
  note: z.string().optional(),
  drawer_name: z.string().optional(),
});

// CQ-5 follow-up: a leg amount of 0 (or negative) is not a real payment —
// SupplierRepository's settleTransactions/recordSupplierCashflow loops have
// no runtime skip-guard (unlike DebtRepository's `if (leg.amount <= 0)
// continue`), so a zero leg would post a noisy $0 payments row + a no-op
// drawer upsert, and a negative leg would be silently coerced to its
// magnitude by the repository's Math.abs(). Rejecting non-positive amounts
// here — mirroring partnerSettlementLegSchema's existing `.positive()` — closes
// the gap at the validation boundary instead of special-casing it downstream.
//
// OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §9.5 (rule-12 completeness gap): `direction`
// was typed in electron.d.ts but missing from this schema (and four other
// layers — backendApi.ts, ElectronApiAdapter.ts, packages/ui/src/api/types.ts,
// preload.ts — each owned by a different lane). LIRA-189's account-settlement
// collect direction needs a leg to be markable as an OUT (change/return) leg
// rather than an IN (customer-paid) one, per rule 16's partitionLegs
// convention (utils/payments.ts) — so it is added here, shared by every
// schema that reuses this fragment (supplierSettleSchema, supplierCashflowSchema,
// supplierSettleAccountSchema below), instead of being duplicated per caller.
const supplierPaymentLegSchema = z.object({
  method: z.string().min(1),
  currency_code: z.string().min(1),
  amount: z.number().positive(),
  direction: z.enum(["IN", "OUT"]).optional(),
});

/**
 * LIRA-310 — the Waive on a supplier settlement (batch or account): the
 * counterparty discount shape, capped PER CURRENCY at `SHORTFALL_MAX`
 * (up to and including $5 / 450,000 LBP). Refined on the FIELD, never on
 * the parent object, so the settle schemas stay plain ZodObjects (`.shape`
 * is read by the backend suppliers API test). The repository re-checks the
 * cap and every money rule (trust boundary).
 */
const settlementDiscountSchema = counterpartyDiscountInputSchema.superRefine(
  (d, ctx) => {
    if (!isWithinShortfallMax(d.amount_usd, "USD")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `The waived amount is more than $${SHORTFALL_MAX.USD}.`,
        path: ["amount_usd"],
      });
    }
    if (!isWithinShortfallMax(d.amount_lbp, "LBP")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `The waived amount is more than ${SHORTFALL_MAX.LBP.toLocaleString("en-US")} LBP.`,
        path: ["amount_lbp"],
      });
    }
  },
);

export const supplierSettleSchema = z.object({
  supplier_id: z.number().int().positive(),
  financial_service_ids: z.array(z.number().int().positive()).min(1),
  amount_usd: z.number(),
  amount_lbp: z.number(),
  // COMMISSION_AT_SETTLEMENT_PLAN.md D1-D9 — the batch's commission MODEL is
  // derived server-side from the selected financial_services rows'
  // `commission_model` (never trusted from the client), so this field's
  // meaning depends on what SupplierRepository.settleTransactions resolves
  // it to be:
  //   LEGACY batches (commission_model = 0, rows written before the
  //     commission-at-settlement cutover): INFORMATIONAL/AUDIT ONLY — those
  //     rows' supplier_owed was booked netted (principal + fee − commission),
  //     so this drives NO drawer/ledger movement (see
  //     SupplierRepository.SettleTransactionsData doc comment).
  //   NEW-MODEL batches (commission_model = 1, at-settlement — D1-D9):
  //     MONEY-BEARING — booked as a real `SUPPLIER_PAYS_US` supplier_ledger
  //     credit and split across the settled rows via largest-remainder
  //     proportional allocation (`supplier_settlements` +
  //     `settlement_commission_allocations`, D5/D6).
  // LIRA-166 — was a bare `z.number()`, which let a negative commission
  // through to SupplierRepository.settleTransactions: the SUPPLIER_PAYS_US
  // ledger credit normalises with `-Math.abs(...)` while the settlement
  // profit stamp books the raw value, so the ledger and the profit stamp
  // disagreed in sign. Not reachable through the settlement UI (its
  // commission inputs reject a leading "-" at the keystroke level), but
  // reachable via direct IPC/REST.
  commission_usd: z.number().nonnegative(),
  commission_lbp: z.number().nonnegative(),
  // D8 — how the operator entered commission_usd/commission_lbp for a
  // NEW-MODEL batch: a single LUMP total for the whole batch, or a per-unit
  // RATE × commission_unit_count. Snapshotted onto supplier_settlements for
  // audit; ignored for a LEGACY batch. Defaults to 'LUMP' when omitted.
  entry_mode: z.enum(["LUMP", "RATE"]).optional(),
  // RATE mode only — audit snapshot of the per-unit rate/count the operator
  // entered; the FINAL money amount always lives in commission_usd/
  // commission_lbp above regardless of entry mode.
  commission_rate: z.number().nonnegative().optional(),
  commission_unit_count: z.number().int().nonnegative().optional(),
  // BILL_COMMISSION_SETTLEMENT_PLAN.md follow-up (owner, 2026-08-13) — for a
  // BILLS-ONLY batch (server-verified, never trusted from this field alone),
  // how the entered commission actually arrives:
  //   'TOP_UP' (default when omitted, byte-identical to pre-existing
  //     behavior) — the provider (Katsh/iPick) funds a top-up straight into
  //     its OWN drawer; `payments` below must stay empty (no cash owed).
  //   'OTHER_PAYMENT' — the commission arrives via real payment-method legs
  //     instead (`payments` below), e.g. genuine CASH into the till.
  //     SupplierRepository verifies the legs sum to commission_usd/
  //     commission_lbp before accepting them.
  // Ignored for every other batch shape (legacy, non-bills new-model) — the
  // provider-drawer top-up is the ONLY commission-collection path those
  // shapes have ever had, and this field cannot change that.
  commission_collection_mode: z.enum(["TOP_UP", "OTHER_PAYMENT"]).optional(),
  // Deprecated — no longer used to move money (net pay moves only through
  // `payments[]`; a CASH leg for the primary provider resolves to the
  // Primary Cash Drawer, OMT_System/Whish_System). Kept optional so older
  // callers that still send it don't fail validation; ignored by the
  // repository. Real cash now moves EXCLUSIVELY through `payments[]`.
  drawer_name: z.string().optional(),
  note: z.string().optional(),
  payments: z.array(supplierPaymentLegSchema).optional(),
  // Owner decision 2026-10-07: the rate the Settle sheet's payment input
  // showed (hand-typed or the buy rate), stamped on the SUPPLIER_SETTLEMENT
  // transaction. Stamp-only — legs reconcile per currency, never converted.
  exchange_rate: z.number().positive().optional(),
  // LIRA-256 — the OMT commission types this settlement's statement covers.
  // When present, the batch is REFUSED if a new-style (commission_model = 1)
  // OMT transfer of another type is selected (decision S1); stamped on the
  // settlement's metadata for the record. Absent = all types = unchanged
  // behaviour (S3).
  covered_omt_service_types: omtCoveredTypesSchema.optional(),
  // LIRA-310 — Waive: the supplier accepted `amount − discount`. The legs
  // pay that; the gap posts as a bundled supplier DISCOUNT (received).
  discount: settlementDiscountSchema.optional(),
});

/** Pay a supplier / record a supplier paying us, via payment-method legs. */
export const supplierCashflowSchema = z
  .object({
    supplier_id: z.number().int().positive(),
    direction: z.enum(["PAY", "RECEIVE"]),
    payments: z.array(supplierPaymentLegSchema).min(1),
    note: z.string().optional(),
    exchange_rate: z.number().positive().optional(),
    // CQ-10: a PAY-direction cashflow may bundle a forgiven remainder
    // ("owed X, paid Y, discount Z") — posts its OWN 'DISCOUNT' supplier_ledger
    // row + COUNTERPARTY_DISCOUNT transaction. Never valid on RECEIVE (the
    // supplier can't simultaneously pay us AND forgive what we owe them) —
    // SupplierRepository.recordSupplierCashflow also enforces this at the
    // data layer as a safety net.
    discount: counterpartyDiscountInputSchema.optional(),
  })
  .refine((d) => !d.discount || d.direction === "PAY", {
    message: "discount is only valid on PAY-direction cashflow",
    path: ["discount"],
  });

// LIRA-322 (contracts/settle-account.md) — one currency's part of an
// amount-first account settlement. `direction` must match what is owed in
// this currency after netting (checked by the repository, which sees the
// rows); the IN legs are in THIS currency (OMT never settles a currency in
// another), change (OUT) legs may be in any currency (LIRA-315).
const settleAccountCurrencySectionSchema = z.object({
  direction: z.enum(["PAY", "COLLECT"]),
  payments: z.array(supplierPaymentLegSchema),
  commission: z.number().nonnegative().optional(),
  waive: z.number().nonnegative().optional(),
});

const SETTLE_ACCOUNT_CURRENCIES = ["USD", "LBP"] as const;

const settleAccountPerCurrencySchema = z
  .object({
    USD: settleAccountCurrencySectionSchema.optional(),
    LBP: settleAccountCurrencySectionSchema.optional(),
  })
  .superRefine((pc, ctx) => {
    if (!pc.USD && !pc.LBP) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter an amount in at least one currency",
        path: [],
      });
    }
    for (const currency of SETTLE_ACCOUNT_CURRENCIES) {
      pc[currency]?.payments.forEach((leg, i) => {
        if (leg.direction !== "OUT" && leg.currency_code !== currency) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `A ${currency} amount is paid in ${currency} only`,
            path: [currency, "payments", i, "currency_code"],
          });
        }
      });
    }
  });

export type SettleAccountCurrencySection = z.infer<
  typeof settleAccountCurrencySectionSchema
>;

// LIRA-189 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5, CONTRACT_W2.md §2.1) — settle
// the WHOLE OMT open-credit account (the counter, OMT App and iPick
// together) in one call. `account_supplier_id` is the parent supplier id;
// `selections` is the operator's explicit tick-list from the merged
// unsettled queue (LIRA-188's getAccountUnsettled) — the frontend
// pre-selects oldest-first (D8) but the repository MUST re-validate every id
// against account membership at write time and never trust these ids alone.
// `direction` mirrors recordSupplierCashflow's PAY/RECEIVE (§8.4: cashout
// credits can flip the account net negative, i.e. OMT owes the shop, which
// needs the COLLECT/RECEIVE path) — reused, not duplicated (rule 14).
// `created_by` is deliberately NOT part of this schema: like every sibling
// settle/cashflow schema above, the actor is injected by the handler/route
// from the session (IPC) or the JWT (REST, rule 19c), never trusted from the
// request body.
const supplierSettleAccountBaseSchema = z.object({
  account_supplier_id: z.number().int().positive(),
  // Legacy whole-row path only (required there, refused with per_currency —
  // see refineSettleAccount below).
  direction: z.enum(["PAY", "COLLECT"]).optional(),
  // Legacy: required, the tick-list. Amount-first: an optional scope override.
  selections: z
    .array(
      z.object({
        kind: z.enum(["FINANCIAL_SERVICE", "LEDGER"]),
        id: z.number().int().positive(),
      }),
    )
    .min(1)
    .optional(),
  amount_usd: z.number().optional(),
  amount_lbp: z.number().optional(),
  // Operator-entered per-child settlement commission — same shape/meaning as
  // supplierSettleSchema's commission_usd/commission_lbp above. LIRA-189 also
  // sums the STORED commission of any WALLET_CASHOUT rows in the batch from
  // transactions.metadata_json.commission (D14, plan §8.3a) and stamps that
  // automatically; that sum is computed server-side and is NOT part of this
  // field or this schema.
  // Legacy path only (the amount-first path takes per_currency.*.commission).
  commission_usd: z.number().optional(),
  commission_lbp: z.number().optional(),
  entry_mode: z.enum(["LUMP", "RATE"]).optional(),
  commission_rate: z.number().nonnegative().optional(),
  commission_unit_count: z.number().int().nonnegative().optional(),
  note: z.string().optional(),
  exchange_rate: z.number().positive().optional(),
  payments: z.array(supplierPaymentLegSchema).optional(),
  // LIRA-203 (owner D18 follow-up) — pay MORE than `selections` net to;
  // the difference is booked as a standalone account credit, applied
  // manually at a later settlement (never auto-applied — see
  // SupplierRepository.SettleAccountData's own doc comment for the full
  // design). Optional/defaults to 0 so every existing caller is
  // byte-identical. `amount_usd`/`amount_lbp` above stay the EXACT rows
  // net — this field is additive, not a replacement. The repository
  // rejects a nonzero value on direction: "COLLECT".
  surplus_usd: z.number().nonnegative().optional(),
  surplus_lbp: z.number().nonnegative().optional(),
  // LIRA-256 — the OMT commission types this settlement's statement covers.
  // When present, the batch is REFUSED if a new-style (commission_model = 1)
  // OMT transfer of another type is selected (decision S1); stamped on the
  // settlement's metadata for the record. Absent = all types = unchanged
  // behaviour (S3).
  covered_omt_service_types: omtCoveredTypesSchema.optional(),
  // LIRA-310 — Waive: settle the selected rows for less than they net to
  // (PAY → received, COLLECT → forgiven). Refused with a surplus.
  discount: settlementDiscountSchema.optional(),
  // LIRA-322 — presence selects the amount-first path: the operator enters
  // money per currency and the server decides what closes
  // (allocateAccountSettlement). Absent = the legacy whole-row path, byte-
  // identical to before.
  per_currency: settleAccountPerCurrencySchema.optional(),
  // LIRA-322 (FR-021) — the signed in-scope remaining the sheet previewed,
  // per currency; the server refuses the settlement if it has changed.
  expected_owed: z
    .object({ usd: z.number(), lbp: z.number() })
    .optional(),
  // LIRA-343 (contracts/settle-account-days.md) — amount-first only. `true`
  // adds every open account row (row_scope 'ACCOUNT', either sign) to the
  // scope. `credit_used` is how much of that account credit to use, per
  // currency, as the user set it; it requires `include_account_credits`.
  // Both are refused on the legacy whole-row path (refineSettleAccount).
  // Read by SupplierRepository._amountFirstScope / _settleAccountAmountFirst.
  include_account_credits: z.boolean().optional(),
  credit_used: z
    .object({
      usd: z.number().min(0).optional(),
      lbp: z.number().min(0).optional(),
    })
    .optional(),
});

/** Keys of the legacy whole-row payload that are refused next to `per_currency`. */
const LEGACY_ONLY_SETTLE_ACCOUNT_KEYS = [
  "direction",
  "amount_usd",
  "amount_lbp",
  "surplus_usd",
  "surplus_lbp",
  "discount",
  // Lead decision 2026-10-15: the amount-first commission is
  // per_currency.*.commission — the legacy flat figure is refused next to it.
  "commission_usd",
  "commission_lbp",
] as const;

/** LIRA-343 — amount-first-only keys, refused on the legacy whole-row path
 *  (the inverse of {@link LEGACY_ONLY_SETTLE_ACCOUNT_KEYS}). */
const AMOUNT_FIRST_ONLY_SETTLE_ACCOUNT_KEYS = [
  "include_account_credits",
  "credit_used",
] as const;

/** Keys the legacy whole-row payload has always required. */
const LEGACY_REQUIRED_SETTLE_ACCOUNT_KEYS = [
  "direction",
  "selections",
  "amount_usd",
  "amount_lbp",
  "commission_usd",
  "commission_lbp",
] as const;

function refineSettleAccount(
  d: z.infer<typeof supplierSettleAccountBaseSchema>,
  ctx: z.RefinementCtx,
): void {
  if (d.per_currency !== undefined) {
    for (const key of LEGACY_ONLY_SETTLE_ACCOUNT_KEYS) {
      if (d[key] !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} is not used when settling by amount (per_currency)`,
          path: [key],
        });
      }
    }
    // FR-021 — the server refuses a stale preview; it needs the preview.
    if (d.expected_owed === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expected_owed is required when settling by amount",
        path: ["expected_owed"],
      });
    }
    // LIRA-343 — account credit can only be used when it is in the scope.
    if (d.credit_used !== undefined && d.include_account_credits !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "credit_used needs include_account_credits",
        path: ["credit_used"],
      });
    }
    return;
  }
  for (const key of AMOUNT_FIRST_ONLY_SETTLE_ACCOUNT_KEYS) {
    if (d[key] !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${key} is only used when settling by amount (per_currency)`,
        path: [key],
      });
    }
  }
  for (const key of LEGACY_REQUIRED_SETTLE_ACCOUNT_KEYS) {
    if (d[key] === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Required",
        path: [key],
      });
    }
  }
}

// The cross-field rules need the whole object, so they run in a parent
// superRefine — which in Zod 3 returns a ZodEffects with no `.shape`. The
// backend and frontend key tests read `supplierSettleAccountSchema.shape`
// (rule 23), so the base object's shape is carried over onto the refined
// schema; parsing always runs the refinements.
export const supplierSettleAccountSchema = Object.assign(
  supplierSettleAccountBaseSchema.superRefine(refineSettleAccount),
  { shape: supplierSettleAccountBaseSchema.shape },
);

// LIRA-344 — "Remove credit": close one open account credit OMT will not
// accept and book it as an expense (no drawer). Shared by the IPC handler
// and the REST route (rule 14). `account_supplier_id` is the account parent
// (the REST route takes it from the URL); `expected_remaining` is the
// credit as the sheet showed it (signed, ledger sign: negative = OMT owes
// the shop) — the server refuses when it has changed. `client_day` dates
// the expense by the shop's own day (rule 27). Every key is read by
// SupplierRepository.removeAccountCredit (rule 23 reverse). `created_by` is
// injected from the session / JWT, never sent (rule 19c).
export const removeAccountCreditSchema = z.object({
  account_supplier_id: z.number().int().positive(),
  ledger_row_id: z.number().int().positive(),
  reason: z
    .string()
    .trim()
    .min(ACCOUNT_CREDIT_REASON_MIN, "Enter a reason (at least 3 characters)")
    .max(ACCOUNT_CREDIT_REASON_MAX, "The reason is too long (200 characters at most)"),
  expected_remaining: z.object({ usd: z.number(), lbp: z.number() }),
  client_day: clientDayInputSchema,
});
/** What a caller sends (adapters, preload). */
export type RemoveAccountCreditPayload = z.input<typeof removeAccountCreditSchema>;
/** What the service / repository receive (after parsing). */
export type RemoveAccountCreditInput = z.output<typeof removeAccountCreditSchema>;

// LIRA-343 (contracts/calendar-reads.md) — the calendar reads. One month
// (`YYYY-MM`) of account rows, and one shop day (`YYYY-MM-DD`) of details.
// Shared by the IPC handler and the REST route (rule 14).
export const accountMonthSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be YYYY-MM"),
});
export type AccountMonthInput = z.infer<typeof accountMonthSchema>;

export const accountDaySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "day must be YYYY-MM-DD"),
});
export type AccountDayInput = z.infer<typeof accountDaySchema>;

// 2026-10-27 (owner option B) — the params of the "Check against OMT's
// statement" read (`suppliers:account-expected-statement` and
// `GET /api/suppliers/:id/account-expected-statement`, rule 14): the
// covered OMT commission types (LIRA-256) and the shop's day the statement
// covers, inclusive. The day is the CLIENT's (rule 27) and must be a real
// calendar date; both are optional, absent = the old read.
export const accountExpectedStatementParamsSchema = z.object({
  covered: omtCoveredTypesSchema.optional(),
  up_to_day: localDayFormatSchema
    .refine((d) => {
      const [y, m, day] = d.split("-").map(Number);
      const t = new Date(Date.UTC(y, m - 1, day));
      return (
        t.getUTCFullYear() === y &&
        t.getUTCMonth() === m - 1 &&
        t.getUTCDate() === day
      );
    }, "up_to_day must be a real YYYY-MM-DD day")
    .optional(),
});
/** What a caller sends (adapters, preload). */
export type AccountExpectedStatementParamsInput = z.input<
  typeof accountExpectedStatementParamsSchema
>;

// LIRA-343 T033a (FR-016c) — the supplier Transactions window's optional
// from–to filter, by the SHOP's day (`YYYY-MM-DD`, rule 27: the repository
// buckets rows with `localDayExpr`). Shared by every read that takes it —
// IPC handlers and REST routes alike (rules 14, 23). Each bound is optional;
// an empty string is the window's cleared date field and means "no bound"
// (the repository ignores falsy bounds), so the input type stays
// `string | undefined` for the adapters (rule 21). from <= to when both set.
const shopDayBoundSchema = z
  .union([
    z.literal(""),
    z
      .string()
      .regex(
        /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
        "day must be YYYY-MM-DD",
      ),
  ])
  .optional();
export const supplierDayRangeSchema = z
  .object({ from: shopDayBoundSchema, to: shopDayBoundSchema })
  .refine((r) => !r.from || !r.to || r.from <= r.to, {
    message: "from must be on or before to",
  });
/** What a caller sends (adapters, preload, the service signatures). */
export type SupplierDayRangeInput = z.input<typeof supplierDayRangeSchema>;

// LIRA-191 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5) — set or clear a supplier's
// account parent (`suppliers.account_supplier_id`, migration v176). `null`
// detaches the supplier back to standalone. Every data-dependent invariant
// (self-parent, one-level-deep chains, parent existence/tenant/active,
// orphaning open unsettled rows) is enforced server-side in
// SupplierRepository.updateAccountLink, next to the rows it protects (rule
// 13/14) — a schema can't see other suppliers' rows, so it only shapes the
// wire payload. `created_by` is deliberately NOT part of this schema, same
// as every sibling settle/cashflow schema above: the actor is injected by
// the handler/route from the session (IPC) or the JWT (REST, rule 19c).
export const supplierAccountLinkSchema = z.object({
  supplier_id: z.number().int().positive(),
  account_supplier_id: z.number().int().positive().nullable(),
});

/** Log a delivery batch for a product supplier (FIFO payment coverage). */
export const supplierPurchaseCreateSchema = z.object({
  supplier_id: z.number().int().positive(),
  total_usd: z.number().positive("Amount must be greater than 0"),
  note: z.string().optional(),
});

/**
 * LIRA-087 (migration v189) — record a supplier debt WITHOUT a product line
 * yet (`SupplierRepository.recordDebt`); a later stock intake can attach
 * products to this exact row instead of booking a second debt. `created_by`
 * is intentionally NOT part of this schema — same convention as
 * `receiveStockSchema`: injected server-side from the authenticated session,
 * never trusted from the client body (rule 19c).
 */
export const supplierRecordDebtSchema = z
  .object({
    supplier_id: z.number().int().positive(),
    amount_usd: z.number().nonnegative().default(0),
    amount_lbp: z.number().nonnegative().default(0),
    note: z.string().trim().max(500).optional().nullable(),
  })
  .refine((d) => d.amount_usd > 0 || d.amount_lbp > 0, {
    message: "Amount must be greater than 0 in at least one currency",
    path: ["amount_usd"],
  });

export type SupplierRecordDebtInput = z.infer<typeof supplierRecordDebtSchema>;

// Owner decision D8 (SUPPLIER_STOCK_INTAKE_PLAN.md): the standalone
// supplier write-off is REMOVED — `supplierWriteOffSchema` /
// `SupplierWriteOffInput` used to live here. The bundled Pay-form discount
// (`counterpartyDiscountInputSchema`, `supplierCashflowSchema.discount`)
// stays; only the no-cashflow-attached standalone write-off is gone. See
// this agent's handoff report for every file that still imports the
// deleted schema/type — they are NOT edited here (out of scope for this
// agent) and will fail to compile until updated.

export type SupplierLedgerEntryInput = z.infer<
  typeof supplierLedgerEntrySchema
>;
export type SupplierSettleInput = z.infer<typeof supplierSettleSchema>;
export type SupplierSettleAccountInput = z.infer<
  typeof supplierSettleAccountSchema
>;
export type SupplierCashflowInput = z.infer<typeof supplierCashflowSchema>;
export type SupplierAccountLinkInput = z.infer<
  typeof supplierAccountLinkSchema
>;
export type SupplierPurchaseCreateInput = z.infer<
  typeof supplierPurchaseCreateSchema
>;

// LIRA-297 (rule 21) — what a caller SENDS: `z.input`, so `.default()`
// fields stay optional. The adapters (backendApi.ts, ElectronApiAdapter.ts,
// packages/ui ApiAdapter) type their payloads with these, never with a
// hand-copied object literal.
export type SupplierLedgerEntryPayload = z.input<
  typeof supplierLedgerEntrySchema
>;
export type SupplierSettleAccountPayload = z.input<
  typeof supplierSettleAccountSchema
>;
export type SupplierCashflowPayload = z.input<typeof supplierCashflowSchema>;
export type SupplierPurchaseCreatePayload = z.input<
  typeof supplierPurchaseCreateSchema
>;
export type SupplierRecordDebtPayload = z.input<
  typeof supplierRecordDebtSchema
>;
