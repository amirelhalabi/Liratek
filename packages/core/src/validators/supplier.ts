import { z } from "zod";
import { counterpartyDiscountInputSchema } from "./counterparty.js";

/**
 * Supplier ledger validation schemas (CQ-8, rule 14).
 *
 * Lifted verbatim (field names unchanged) from electron-app/schemas/index.ts
 * so the Electron IPC handlers (electron-app/handlers/supplierHandlers.ts)
 * and any REST route validate against ONE schema each. Naming mirrors the
 * existing debt.ts/partner.ts convention (camelCase `<domain><Action>Schema`).
 */

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
  //   LEGACY batches (commission_model = 0, embedded — pre-existing OMT/
  //     WHISH float model, owner-confirmed 2026-07-29): INFORMATIONAL/AUDIT
  //     ONLY — the gross supplier_owed figure already excludes the shop's
  //     commission, so this drives NO drawer/ledger movement (see
  //     SupplierRepository.SettleTransactionsData doc comment).
  //   NEW-MODEL batches (commission_model = 1, at-settlement — D1-D9):
  //     MONEY-BEARING — booked as a real `SUPPLIER_PAYS_US` supplier_ledger
  //     credit and split across the settled rows via largest-remainder
  //     proportional allocation (`supplier_settlements` +
  //     `settlement_commission_allocations`, D5/D6).
  commission_usd: z.number(),
  commission_lbp: z.number(),
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
  // Deprecated — no longer used to move money (OMT_System/Whish_System is
  // the provider float, never a real cash drawer). Kept optional so older
  // callers that still send it don't fail validation; ignored by the
  // repository. Real cash now moves EXCLUSIVELY through `payments[]`.
  drawer_name: z.string().optional(),
  note: z.string().optional(),
  payments: z.array(supplierPaymentLegSchema).optional(),
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
export const supplierSettleAccountSchema = z.object({
  account_supplier_id: z.number().int().positive(),
  direction: z.enum(["PAY", "COLLECT"]),
  selections: z
    .array(
      z.object({
        kind: z.enum(["FINANCIAL_SERVICE", "LEDGER"]),
        id: z.number().int().positive(),
      })
    )
    .min(1),
  amount_usd: z.number(),
  amount_lbp: z.number(),
  // Operator-entered per-child settlement commission — same shape/meaning as
  // supplierSettleSchema's commission_usd/commission_lbp above. LIRA-189 also
  // sums the STORED commission of any WALLET_CASHOUT rows in the batch from
  // transactions.metadata_json.commission (D14, plan §8.3a) and stamps that
  // automatically; that sum is computed server-side and is NOT part of this
  // field or this schema.
  commission_usd: z.number(),
  commission_lbp: z.number(),
  entry_mode: z.enum(["LUMP", "RATE"]).optional(),
  commission_rate: z.number().nonnegative().optional(),
  commission_unit_count: z.number().int().nonnegative().optional(),
  note: z.string().optional(),
  exchange_rate: z.number().positive().optional(),
  payments: z.array(supplierPaymentLegSchema).optional(),
});

/** Log a delivery batch for a product supplier (FIFO payment coverage). */
export const supplierPurchaseCreateSchema = z.object({
  supplier_id: z.number().int().positive(),
  total_usd: z.number().positive("Amount must be greater than 0"),
  note: z.string().optional(),
});

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
export type SupplierPurchaseCreateInput = z.infer<
  typeof supplierPurchaseCreateSchema
>;
