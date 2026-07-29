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
const supplierPaymentLegSchema = z.object({
  method: z.string().min(1),
  currency_code: z.string().min(1),
  amount: z.number().positive(),
});

export const supplierSettleSchema = z.object({
  supplier_id: z.number().int().positive(),
  financial_service_ids: z.array(z.number().int().positive()).min(1),
  amount_usd: z.number(),
  amount_lbp: z.number(),
  // Informational/audit only under the OMT/WHISH float model (owner-
  // confirmed 2026-07-29) — the fee-only supplier_owed figure already
  // excludes the shop's commission, so this no longer drives any drawer
  // movement (see SupplierRepository.SettleTransactionsData doc comment).
  commission_usd: z.number(),
  commission_lbp: z.number(),
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

/** Log a delivery batch for a product supplier (FIFO payment coverage). */
export const supplierPurchaseCreateSchema = z.object({
  supplier_id: z.number().int().positive(),
  total_usd: z.number().positive("Amount must be greater than 0"),
  note: z.string().optional(),
});

// CQ-10 (D4: admin-only on both transports) — standalone write-off: forgive
// part of what the shop owes a supplier, with NO cashflow attached. Field
// names mirror supplierCashflowSchema's snake_case convention. Per-currency
// "does not exceed the outstanding balance" is a SERVICE-layer check
// (SupplierService.writeOffSupplierDebt) — it needs the live balance.
export const supplierWriteOffSchema = z
  .object({
    supplier_id: z.number().int().positive(),
    amount_usd: z.number().nonnegative().default(0),
    amount_lbp: z.number().nonnegative().default(0),
    reason: z.string().optional(),
  })
  .refine((d) => d.amount_usd > 0 || d.amount_lbp > 0, {
    message: "At least one amount (USD or LBP) must be greater than 0",
  });

export type SupplierLedgerEntryInput = z.infer<
  typeof supplierLedgerEntrySchema
>;
export type SupplierSettleInput = z.infer<typeof supplierSettleSchema>;
export type SupplierCashflowInput = z.infer<typeof supplierCashflowSchema>;
export type SupplierPurchaseCreateInput = z.infer<
  typeof supplierPurchaseCreateSchema
>;
export type SupplierWriteOffInput = z.infer<typeof supplierWriteOffSchema>;
