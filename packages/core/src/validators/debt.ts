import { z } from "zod";
import {
  positiveDecimalSchema,
  idSchema,
  transactionTimeSchema,
} from "./common.js";
import { counterpartyDiscountInputSchema } from "./counterparty.js";

/**
 * Debt management validation schemas
 */

const repaymentPaymentLineSchema = z.object({
  method: z.string().min(1),
  currencyCode: z.string().min(1),
  amount: z.number().min(0),
  // CQ-8 schema-drift fix: the electron-app-local DebtRepaymentSchema this
  // core schema replaces already carried `direction` (IN/OUT — a return leg
  // hands change back to the customer, see utils/payments.ts partitionLegs).
  // This field was missing here, so the REST repayment route
  // (validateRequest(addRepaymentSchema) in backend/src/api/debts.ts) has
  // been silently stripping `direction` off every payment leg since that
  // route was wired — a live, pre-existing gap on the web transport for
  // repayments with change-return legs, fixed by adding it here (both
  // transports now share one schema, so this fixes REST for free).
  direction: z.enum(["IN", "OUT"]).optional(),
});

// Add debt repayment
export const addRepaymentSchema = z
  .object({
    clientId: idSchema,
    amountUSD: positiveDecimalSchema.default(0),
    amountLBP: positiveDecimalSchema.default(0),
    note: z.string().max(500).optional(),
    userId: idSchema.optional(),
    paidByMethod: z.string().min(1).optional(),
    payments: z.array(repaymentPaymentLineSchema).optional(),
    // T3 keep-change (docs/plans/done_plans/T3_KEEP_CHANGE_PLAN.md KC-2): per-currency
    // change the shop keeps instead of returning. Excluded from the debt
    // reduction by the caller; stamped as profit on the DEBT_REPAYMENT
    // transaction ("Other / kept change" profits line).
    keptChangeUSD: z.number().nonnegative().optional(),
    keptChangeLBP: z.number().nonnegative().optional(),
    // CQ-10: a repayment may bundle a forgiven remainder alongside the cash
    // paid ("owed X, paid Y, discount Z") — posts its OWN 'Debt Discount'
    // ledger row + COUNTERPARTY_DISCOUNT transaction (DebtRepository.addRepayment).
    discount: counterpartyDiscountInputSchema.optional(),
    transaction_time: transactionTimeSchema,
  })
  .refine(
    (data) =>
      data.amountUSD > 0 ||
      data.amountLBP > 0 ||
      (data.payments &&
        data.payments.length > 0 &&
        data.payments.some((p) => p.amount > 0)),
    {
      message: "At least one amount (USD or LBP) must be greater than 0",
    },
  );

// Add credit (shop owes customer)
export const addCreditSchema = z
  .object({
    clientId: idSchema,
    amountUsd: z.number().min(0).default(0),
    amountLbp: z.number().min(0).default(0),
    note: z.string().max(500).optional(),
    transactionTime: transactionTimeSchema,
  })
  .refine((data) => data.amountUsd > 0 || data.amountLbp > 0, {
    message: "At least one amount (USD or LBP) must be greater than 0",
  });

// Get debtor summary
export const getDebtorSummarySchema = z.object({
  clientId: idSchema.optional(),
  hasDebtOnly: z.coerce.boolean().default(false),
});

// Payment leg for cash-out / account-entry (carries IN/OUT direction).
const debtPaymentLegSchema = z.object({
  method: z.string().min(1),
  currencyCode: z.string().min(1),
  amount: z.number(),
  direction: z.enum(["IN", "OUT"]).optional(),
});

// Cash out a client's prepaid credit (CREDIT_CASH_OUT — drawer OUT). Shared by
// the IPC handler (debt:cash-out) and the REST route (rule 14).
export const debtCashOutSchema = z.object({
  clientId: z.number().int().positive(),
  amountUSD: z.number().nonnegative(),
  amountLBP: z.number().nonnegative(),
  payments: z.array(debtPaymentLegSchema).optional(),
  note: z.string().optional(),
  transaction_time: z.string().optional(),
});

// Manual, till-moving account entry from the Accounts (Debts) page.
// direction "credit" → drawer IN (shop owes customer); "debt" → drawer OUT.
export const debtAccountEntrySchema = z
  .object({
    direction: z.enum(["credit", "debt"]),
    clientId: z.number().int().positive(),
    amountUSD: z.number().nonnegative(),
    amountLBP: z.number().nonnegative(),
    payments: z.array(debtPaymentLegSchema).optional(),
    note: z.string().max(500).optional(),
    transaction_time: z.string().optional(),
  })
  .refine((data) => data.amountUSD > 0 || data.amountLBP > 0, {
    message: "At least one amount (USD or LBP) must be greater than 0",
  });

// Use credit from a client's account (reduce a prepaid credit balance —
// opposite of addCredit). Shared by the IPC handler (debt:use-credit, CQ-9:
// electron-app/schemas/index.ts's DebtUseCreditSchema now re-exports this)
// and the REST route (rule 14). Field names/laxity (`transactionTime`, plain
// optional string — no `.datetime()`) are a byte-for-byte lift of the local
// schema this replaces, so swapping the IPC re-export is behavior-identical.
export const debtUseCreditSchema = z
  .object({
    clientId: idSchema,
    amountUsd: z.number().nonnegative().default(0),
    amountLbp: z.number().nonnegative().default(0),
    note: z.string().max(500).optional(),
    transactionTime: z.string().optional(),
  })
  .refine((data) => data.amountUsd > 0 || data.amountLbp > 0, {
    message: "At least one amount (USD or LBP) must be greater than 0",
  });

// Edit non-financial metadata (currently just `note`) on a debt_ledger row.
// CQ-9: backing schema for the new `POST /api/debts/update-metadata` REST
// route (backend/src/api/debts.ts) — mirrors the `debts:update-metadata` IPC
// handler's payload shape (electron-app/handlers/debtHandlers.ts). The IPC
// handler itself does not validate its payload today (a pre-existing gap;
// electron-app/handlers/ is out of scope for this change), so this schema is
// REST-only for now — the IPC side gets the same shape for free whenever
// that handler is wired up.
export const debtUpdateMetadataSchema = z.object({
  id: idSchema,
  note: z.string().max(500).optional(),
});

// CQ-10 (D4: admin-only on both transports) — standalone write-off: forgive
// part of a client's debt with NO settlement attached. Field-name style
// mirrors addRepaymentSchema/debtCashOutSchema (`clientId`, `amountUSD`,
// `amountLBP`). Per-currency "does not exceed the outstanding balance" is a
// SERVICE-layer check (DebtService.writeOffDebt, mirroring cashOut's
// per-currency guard) — it needs the live balance, which a schema can't see.
export const debtWriteOffSchema = z
  .object({
    clientId: idSchema,
    amountUSD: z.number().nonnegative().default(0),
    amountLBP: z.number().nonnegative().default(0),
    reason: z.string().max(500).optional(),
    transaction_time: z.string().optional(),
  })
  .refine((data) => data.amountUSD > 0 || data.amountLBP > 0, {
    message: "At least one amount (USD or LBP) must be greater than 0",
  });

export type AddRepaymentInput = z.infer<typeof addRepaymentSchema>;
export type AddCreditInput = z.infer<typeof addCreditSchema>;
export type GetDebtorSummaryInput = z.infer<typeof getDebtorSummarySchema>;
export type DebtCashOutInput = z.infer<typeof debtCashOutSchema>;
export type DebtAccountEntryInput = z.infer<typeof debtAccountEntrySchema>;
export type DebtUseCreditInput = z.infer<typeof debtUseCreditSchema>;
export type DebtUpdateMetadataInput = z.infer<typeof debtUpdateMetadataSchema>;
export type DebtWriteOffInput = z.infer<typeof debtWriteOffSchema>;
