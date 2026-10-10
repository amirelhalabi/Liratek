/**
 * LIRA-296 — warranty for any item: every warranty schema, defined once and
 * shared by the IPC handlers and the REST routes (rules 14, 19, 21).
 *
 * Pure (zod only) and browser-safe (rule 29): re-exported through
 * `validators/index.ts`, so both `index.ts` and `browser.ts` carry it.
 */
import { z } from "zod";
import { localDayFormatSchema } from "./common.js";
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
