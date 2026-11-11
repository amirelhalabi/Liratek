/**
 * LIRA-389 — Audit & Transactions Summary view: the request both transports
 * validate (`transactions:summary` IPC, `GET /api/transactions/summary`), the
 * result shape, and the two list drill-down keys `getRecent` accepts
 * (`transactions:get-recent` / `GET /api/transactions/recent`).
 *
 * The request carries exactly what the list itself sends — the selected
 * Type-filter options (with every tag core's list rule reads,
 * `utils/transactionListFilter.ts`), the search text and the operator's own
 * days (rule 27) — plus the grouping and the "include refunded" toggle.
 *
 * Browser-safe (zod + constants only): re-exported from both entry points.
 */
import { z } from "zod";
import { localDayFormatSchema } from "./common.js";
import { PAID_VIA_DRAWERS } from "../constants/paidViaDrawer.js";
import {
  TRANSACTION_TYPES,
  type TransactionType,
} from "../constants/transactionTypes.js";

const transactionTypeValues = Object.values(TRANSACTION_TYPES) as [
  TransactionType,
  ...TransactionType[],
];

/** One selected Type-filter option (`TransactionListOption`). Every tag is
 *  listed: Zod strips unknown keys, and a dropped `cash_only` would silently
 *  widen the summary to every row (rule 23). */
export const transactionListOptionSchema = z.object({
  type: z.enum(transactionTypeValues).optional(),
  provider: z.string().min(1).max(64).optional(),
  service_type: z.string().min(1).max(64).optional(),
  has_item_key: z.boolean().optional(),
  cash_only: z.boolean().optional(),
  supplier_credit_only: z.boolean().optional(),
  paid_via_drawer: z.enum(PAID_VIA_DRAWERS).optional(),
  paid_via_account: z.boolean().optional(),
  paid_via_voucher: z.boolean().optional(),
});

export const TRANSACTION_SUMMARY_GROUPS = [
  "type",
  "service",
  "product",
  "category",
] as const;
export type TransactionSummaryGroupBy =
  (typeof TRANSACTION_SUMMARY_GROUPS)[number];

export const transactionSummarySchema = z.object({
  group_by: z.enum(TRANSACTION_SUMMARY_GROUPS),
  include_refunded: z.boolean().default(false),
  /** Empty = All types. Capped well above FILTER_GROUPS' option count. */
  options: z.array(transactionListOptionSchema).max(50).default([]),
  search: z.string().max(200).optional(),
  day_from: localDayFormatSchema.optional(),
  day_to: localDayFormatSchema.optional(),
});

/** What a caller sends (rule 21: the adapter payload type). */
export type TransactionSummaryInput = z.input<typeof transactionSummarySchema>;
/** What the service receives after parsing. */
export type TransactionSummaryRequest = z.output<
  typeof transactionSummarySchema
>;

/** One Summary row. `label` is English; the page translates it. */
export interface TransactionSummaryRow {
  /** Module key / service title / `product:<id>` / `category:<name>`. */
  key: string;
  label: string;
  /** Transactions in the row (product / category: sales containing it). */
  count: number;
  /** Units sold, net of item refunds — product / category rows only. */
  units: number | null;
  volume_usd: number;
  volume_lbp: number;
  /** Product rows: the product (drill-down) and whether it is deleted. */
  product_id?: number;
  deleted?: boolean;
  /** Category rows: the category name, null = no category (drill-down). */
  category?: string | null;
}

export interface TransactionSummaryResult {
  group_by: TransactionSummaryGroupBy;
  rows: TransactionSummaryRow[];
  total: {
    /** Distinct transactions counted (product / category: distinct sales). */
    count: number;
    units: number | null;
    volume_usd: number;
    volume_lbp: number;
  };
  /** The range held more transactions than one summary reads. */
  truncated: boolean;
}

/**
 * The list's drill-down keys (a clicked Product / Category summary row):
 * only SALE rows whose sale has a line of that product / of a product in
 * that category. `sale_category: null` = products with no category.
 */
export const transactionSaleDrillFiltersSchema = z.object({
  sale_product_id: z.number().int().positive().optional(),
  sale_category: z.string().min(1).max(200).nullable().optional(),
});

export type TransactionSaleDrillFiltersInput = z.input<
  typeof transactionSaleDrillFiltersSchema
>;
