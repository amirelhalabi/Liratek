/**
 * LIRA-296 — warranty for any item: every warranty schema, defined once and
 * shared by the IPC handlers and the REST routes (rules 14, 19, 21).
 *
 * Pure (zod only) and browser-safe (rule 29): re-exported through
 * `validators/index.ts`, so both `index.ts` and `browser.ts` carry it.
 */
import { z } from "zod";
import { localDayFormatSchema, refundExchangeRateSchema } from "./common.js";
import { refundKeptChangeSchema, refundLegsSchema } from "./transaction.js";
import type { WarrantyState } from "../utils/warrantyState.js";

// =============================================================================
// Shop setting: warranty terms text (printed on receipts with a warranty line)
// =============================================================================

export const WARRANTY_TERMS_SETTING_KEY = "warranty_terms_text";
export const WARRANTY_TERMS_MAX_LENGTH = 1000;
export const warrantyTermsTextSchema = z
  .string()
  .max(
    WARRANTY_TERMS_MAX_LENGTH,
    `Warranty terms can be at most ${WARRANTY_TERMS_MAX_LENGTH} characters`,
  );

// =============================================================================
// Warranty search (P1) — IPC `warranty:search`, REST `GET /api/warranty/search`
// =============================================================================

/** The states a search may filter on. NONE is never a search result: only
 *  lines that carry a warranty are searched. */
export const WARRANTY_SEARCH_STATES = ["COVERED", "EXPIRED", "VOID"] as const;
export type WarrantySearchState = (typeof WARRANTY_SEARCH_STATES)[number];

export const warrantySearchSchema = z.object({
  /** Name, phone, receipt number (`RCP-12`, `rcp12`, `12`), product name or
   *  barcode, serial/IMEI. Trimmed; blank means "no text filter". */
  q: z
    .string()
    .max(100)
    .optional()
    .transform((v) => {
      const t = v?.trim();
      return t ? t : undefined;
    }),
  /** Sale day range (inclusive), the shop's own days. */
  from: localDayFormatSchema.optional(),
  to: localDayFormatSchema.optional(),
  state: z.enum(WARRANTY_SEARCH_STATES).optional(),
  /** The shop's own "today" — decides COVERED vs EXPIRED (rule 27). */
  client_day: localDayFormatSchema,
  /** `z.coerce`: the REST route validates the query string, where every
   *  value arrives as a string. */
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** What a caller sends (limit optional; a query-string limit may be text). */
export type WarrantySearchInput = z.input<typeof warrantySearchSchema>;
/** What the service works with after parsing. */
export type WarrantySearchQuery = z.output<typeof warrantySearchSchema>;

/** One tracked unit (serial/IMEI) on a warranty line. */
export interface WarrantySearchUnit {
  id: number;
  serial: string | null;
  /** This unit's own state: its override wins; a unit put back in stock by
   *  a refund is VOID. */
  state: WarrantyState;
  overrideUntil: string | null;
}

/** One warranty line, as the search returns it (newest sale first). */
export interface WarrantySearchRow {
  source: "SALE" | "REPAIR";
  saleId: number | null;
  /** `RCP-<sale id>` (receiptNumberFor). */
  receiptNumber: string | null;
  saleItemId: number | null;
  maintenanceId: number | null;
  /** When the sale was made (stored timestamp). */
  soldAt: string;
  customer: { id: number | null; name: string | null; phone: string | null };
  product: { id: number | null; name: string; barcode: string | null };
  quantity: number;
  refundedQuantity: number;
  /** quantity − refundedQuantity: units still under this warranty. */
  coveredQuantity: number;
  units: WarrantySearchUnit[];
  warrantyUntil: string | null;
  warrantyMonths: number | null;
  state: WarrantyState;
  openClaimId: number | null;
}

// =============================================================================
// Warranty claims (P2) — IPC `warranty:claim` … / REST `/api/warranty/claims`
// =============================================================================

export const WARRANTY_CLAIM_ACTIONS = ["REPAIR", "REPLACE", "REFUND"] as const;
export type WarrantyClaimActionInput = (typeof WARRANTY_CLAIM_ACTIONS)[number];

/** Refusal codes a claim operation answers with (envelope `code`). */
export const WARRANTY_CLAIM_ERROR_CODES = [
  "NOT_COVERED",
  "ALREADY_CLAIMED",
  "OUT_OF_STOCK",
  "NO_COVERED_UNIT_LEFT",
  "FORBIDDEN_ACTION",
  "REPLACEMENT_UNIT_REQUIRED",
  "ALREADY_VOIDED",
  "DEFECTIVE_ALREADY_SENT",
  "DEFECTIVE_RESOLVED",
  "NOT_HELD",
  "NOT_FOUND",
  "INVALID",
  // P3 — supplier returns
  "SUPPLIER_REQUIRED",
  "RETURN_NOT_OPEN",
  "RESTOCK_ALREADY_SOLD",
] as const;
export type WarrantyClaimErrorCode =
  (typeof WARRANTY_CLAIM_ERROR_CODES)[number];

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => {
      const t = v?.trim();
      return t ? t : undefined;
    });

export const createWarrantyClaimSchema = z
  .object({
    /** The sale line claimed on — or `maintenance_id` for a repair's own
     *  warranty. Exactly one of the two. */
    sale_item_id: z.number().int().positive().optional(),
    maintenance_id: z.number().int().positive().optional(),
    /** The tracked unit (serial/IMEI) being claimed, when the line has one. */
    unit_id: z.number().int().positive().optional(),
    action: z.enum(WARRANTY_CLAIM_ACTIONS),
    /** REPLACE of a tracked product: the IN_STOCK unit handed over. */
    replacement_unit_id: z.number().int().positive().optional(),
    notes: optionalText(500),
    /** Admin only: why an EXPIRED warranty is honoured anyway. */
    override_reason: optionalText(500),
    /** REFUND only — the same return-method contract as "Refund item". */
    refund: z
      .object({
        legs: refundLegsSchema.optional(),
        exchange_rate: refundExchangeRateSchema,
        kept_change: refundKeptChangeSchema.optional(),
      })
      .optional(),
    /** The shop's own day: decides COVERED vs EXPIRED (rule 27). */
    client_day: localDayFormatSchema,
  })
  .refine((v) => (v.sale_item_id == null) !== (v.maintenance_id == null), {
    message: "Pick exactly one: a sale line or a repair job",
    path: ["sale_item_id"],
  });
export type CreateWarrantyClaimInput = z.input<
  typeof createWarrantyClaimSchema
>;
export type CreateWarrantyClaimData = z.output<
  typeof createWarrantyClaimSchema
>;

export const voidWarrantyClaimSchema = z.object({
  claim_id: z.coerce.number().int().positive(),
});
export type VoidWarrantyClaimInput = z.input<typeof voidWarrantyClaimSchema>;

/** Claim history for a sale line, a repair job or a unit (one of them). */
export const warrantyClaimsForSchema = z
  .object({
    sale_item_id: z.coerce.number().int().positive().optional(),
    maintenance_id: z.coerce.number().int().positive().optional(),
    unit_id: z.coerce.number().int().positive().optional(),
  })
  .refine(
    (v) =>
      [v.sale_item_id, v.maintenance_id, v.unit_id].filter((x) => x != null)
        .length === 1,
    { message: "Pick one of sale_item_id, maintenance_id or unit_id" },
  );
export type WarrantyClaimsForInput = z.input<typeof warrantyClaimsForSchema>;

export const DEFECTIVE_ITEM_STATUSES = [
  "HELD",
  "SENT_TO_SUPPLIER",
  "WRITTEN_OFF",
  "RETURNED_TO_STOCK",
] as const;

export const listDefectiveItemsSchema = z.object({
  status: z.enum(DEFECTIVE_ITEM_STATUSES).optional(),
});
export type ListDefectiveItemsInput = z.input<typeof listDefectiveItemsSchema>;

export const resolveDefectiveSchema = z.object({
  defective_item_id: z.coerce.number().int().positive(),
  outcome: z.enum(["WRITE_OFF", "NOT_FAULTY"]),
});
export type ResolveDefectiveInput = z.input<typeof resolveDefectiveSchema>;

/** One row of a claim history (newest first). */
export interface WarrantyClaimView {
  id: number;
  sale_item_id: number | null;
  maintenance_id: number | null;
  unit_id: number | null;
  action: WarrantyClaimActionInput;
  status: "OPEN" | "DONE" | "VOIDED";
  override_reason: string | null;
  notes: string | null;
  user_id: number;
  username: string | null;
  repair_job_id: number | null;
  replacement_unit_id: number | null;
  refund_transaction_id: number | null;
  voided_at: string | null;
  created_at: string;
}

/** What `warranty:claim` answers on success. */
export interface WarrantyClaimResultData {
  claim: WarrantyClaimView;
  repairJobId?: number;
  replacementUnitId?: number;
  refundTransactionId?: number;
}

/** One defective item, as the admin list shows it. */
export interface DefectiveItemView {
  id: number;
  product_id: number;
  product_name: string | null;
  unit_id: number | null;
  serial: string | null;
  quantity: number;
  unit_cost_usd: number;
  warranty_claim_id: number;
  claim_action: string | null;
  sale_item_id: number | null;
  status: (typeof DEFECTIVE_ITEM_STATUSES)[number];
  resolved_at: string | null;
  created_at: string;
}

/** The envelope every warranty write answers with (rule 19c): a refusal
 *  carries its machine `code`. */
export type WarrantyEnvelope<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: WarrantyClaimErrorCode };

// ---------------------------------------------------------------------------
// P3 — supplier returns (US7)
// ---------------------------------------------------------------------------

export const SUPPLIER_RETURN_STATUSES = [
  "SENT",
  "CREDITED",
  "REPLACED",
  "REJECTED",
] as const;
export type SupplierReturnStatus = (typeof SUPPLIER_RETURN_STATUSES)[number];

export const SUPPLIER_RETURN_OUTCOMES = [
  "CREDITED",
  "REPLACED",
  "REJECTED",
] as const;
export type SupplierReturnOutcome = (typeof SUPPLIER_RETURN_OUTCOMES)[number];

/** Send a HELD defective item back to a supplier. The supplier defaults
 *  from the FIFO batch the sold unit came from. */
export const createSupplierReturnSchema = z.object({
  defective_item_id: z.coerce.number().int().positive(),
  supplier_id: z.coerce.number().int().positive().optional(),
  notes: optionalText(500),
});
export type CreateSupplierReturnInput = z.input<
  typeof createSupplierReturnSchema
>;

/** Record the supplier's answer. CREDITED needs a credit (USD and/or LBP);
 *  REJECTED needs a note saying why. */
export const closeSupplierReturnSchema = z
  .object({
    supplier_return_id: z.coerce.number().int().positive(),
    outcome: z.enum(SUPPLIER_RETURN_OUTCOMES),
    credit_usd: z.number().min(0).max(1_000_000).optional(),
    credit_lbp: z.number().min(0).max(100_000_000_000).optional(),
    notes: optionalText(500),
  })
  .refine(
    (v) =>
      v.outcome !== "CREDITED" ||
      (v.credit_usd ?? 0) > 0 ||
      (v.credit_lbp ?? 0) > 0,
    { message: "Enter the credit the supplier gave", path: ["credit_usd"] },
  )
  .refine((v) => v.outcome !== "REJECTED" || !!v.notes, {
    message: "Say why the supplier rejected it",
    path: ["notes"],
  });
export type CloseSupplierReturnInput = z.input<
  typeof closeSupplierReturnSchema
>;

export const listSupplierReturnsSchema = z.object({
  status: z.enum(SUPPLIER_RETURN_STATUSES).optional(),
});
export type ListSupplierReturnsInput = z.input<
  typeof listSupplierReturnsSchema
>;

/** One supplier return, as the admin list shows it. */
export interface SupplierReturnView {
  id: number;
  defective_item_id: number;
  warranty_claim_id: number;
  supplier_id: number;
  supplier_name: string | null;
  product_id: number | null;
  product_name: string | null;
  serial: string | null;
  unit_cost_usd: number | null;
  status: SupplierReturnStatus;
  credit_usd: number;
  credit_lbp: number;
  notes: string | null;
  sent_at: string | null;
  closed_at: string | null;
  user_id: number;
  closed_by: number | null;
}

// ---------------------------------------------------------------------------
// P3 — warranty report (US8)
// ---------------------------------------------------------------------------

/** Claims in [from, to] (the shop's own days); "today" decides what is
 *  still covered (rule 27). */
export const warrantyReportSchema = z
  .object({
    from: localDayFormatSchema,
    to: localDayFormatSchema,
    client_day: localDayFormatSchema,
  })
  .refine((v) => v.from <= v.to, {
    message: "The start day must be on or before the end day",
    path: ["from"],
  });
export type WarrantyReportInput = z.input<typeof warrantyReportSchema>;

/** One item still under warranty. */
export interface WarrantyReportItem {
  source: "SALE" | "REPAIR";
  saleId: number | null;
  receiptNumber: string | null;
  saleItemId: number | null;
  maintenanceId: number | null;
  productName: string;
  customerName: string | null;
  customerPhone: string | null;
  coveredQuantity: number;
  warrantyUntil: string;
}

export interface WarrantyReport {
  /** Items still COVERED on `client_day`, grouped by category. */
  underWarranty: {
    category: string;
    count: number;
    items: WarrantyReportItem[];
  }[];
  /** Claims made in the period (voided claims left out). The money comes
   *  from the same WARRANTY_COST rows the Profits "Warranty cost" line sums,
   *  so `netCost` here equals minus that line for the same days. */
  claims: {
    byAction: { REPAIR: number; REPLACE: number; REFUND: number };
    total: number;
    grossCostUsd: number;
    supplierRecoveredUsd: number;
    netCostUsd: number;
    /** A supplier credit given in LBP (USD fields above stay USD-only). */
    grossCostLbp: number;
    supplierRecoveredLbp: number;
    netCostLbp: number;
  };
}

