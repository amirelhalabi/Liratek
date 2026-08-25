import { z } from "zod";
import {
  positiveDecimalSchema,
  positiveIntegerSchema,
  transactionTimeSchema,
} from "./common.js";

/**
 * Sales validation schemas
 */

const saleItemSchema = z.object({
  product_id: z.number().int().positive(),
  quantity: positiveIntegerSchema.min(1),
  unit_price_usd: positiveDecimalSchema,
  unit_price_lbp: positiveDecimalSchema.optional(),
  discount_percent: z.number().min(0).max(100).default(0),
});

/**
 * A checkout payment leg (split payment / change). Shared by the Electron IPC
 * handler (sales:process) and the REST route (POST /api/sales/process) —
 * ONE schema, two transports (CLAUDE.md rule 14).
 */
export const salePaymentLegSchema = z.object({
  method: z.string().min(1),
  currency_code: z.string().min(1),
  amount: z.number(),
  // Present only for GIFT_CARD legs — the voucher code being redeemed.
  voucher_code: z.string().optional(),
  // IN (customer pays, default) or OUT (shop returns change to customer).
  direction: z.enum(["IN", "OUT"]).optional(),
});

/**
 * The FULL sale-processing payload as sent by the POS checkout — items,
 * split payment legs, change legs, client propagation, exchange rate.
 * This is the contract `SalesService.processSale` is written against.
 */
export const saleProcessSchema = z.object({
  client_id: z.number().int().nullable(),
  client_name: z.string().optional(),
  client_phone: z.string().optional(),
  items: z
    .array(
      z.object({
        product_id: z.number().int().positive(),
        quantity: z.number().positive(),
        price: z.number().nonnegative(),
        imei: z.string().optional(),
        // LIRA-143 phase 4: the specific IN_STOCK product_units row being
        // sold on this line (checkout scanned/picked an IMEI). Optional —
        // a product with no registered units still sells exactly as today;
        // the repository's strictness check (SalesRepository.processSale)
        // is what actually requires this when the product HAS registered
        // stock, not this schema.
        product_unit_id: z.number().int().positive().optional(),
      }),
    )
    .min(1, "Sale must have at least one item"),
  total_amount: z.number().nonnegative(),
  discount: z.number().nonnegative(),
  final_amount: z.number().nonnegative(),
  payment_usd: z.number().nonnegative(),
  payment_lbp: z.number().nonnegative(),
  payments: z.array(salePaymentLegSchema).optional(),
  change_given_usd: z.number().optional(),
  change_given_lbp: z.number().optional(),
  // T3 keep-change (docs/plans/done_plans/T3_KEEP_CHANGE_PLAN.md): per-currency amounts
  // the shop KEEPS instead of returning as change. No OUT legs accompany
  // them; the repository adds them to the sale transaction's profit stamp.
  // Explicit amounts (not a flag) so what the operator saw is what books.
  kept_change_usd: z.number().nonnegative().optional(),
  kept_change_lbp: z.number().nonnegative().optional(),
  exchange_rate: z.number().positive(),
  drawer_name: z.string().optional(),
  id: z.number().int().positive().optional(),
  status: z.enum(["completed", "draft", "cancelled"]).optional(),
  note: z.string().optional(),
  // PFT-2 (Partner FOR-Transactions): the unpaid remainder routes to
  // partner_ledger instead of the client's debt_ledger when set. Only "FOR"
  // is valid for POS.
  partnerId: z.number().int().positive().optional(),
  partnerMode: z.enum(["FOR"]).optional(),
});

export type SaleProcessInput = z.infer<typeof saleProcessSchema>;

/**
 * @deprecated Thin aspirational contract that never matched what the checkout
 * sends — kept only for its unit test. Use `saleProcessSchema` (above), the
 * real shared contract, for any sale-processing endpoint.
 */
export const createSaleSchema = z.object({
  client_id: z.number().int().positive().optional(),
  client_name: z.string().max(255).optional(),
  items: z.array(saleItemSchema).min(1, "At least one item is required"),
  discount: positiveDecimalSchema.default(0),
  total_usd: positiveDecimalSchema,
  total_lbp: positiveDecimalSchema.optional(),
  amount_paid_usd: positiveDecimalSchema.default(0),
  amount_paid_lbp: positiveDecimalSchema.default(0),
  payment_method: z.string().min(1).default("CASH"),
  drawer_name: z.string().max(100).optional(),
  status: z.enum(["draft", "completed", "refunded"]).default("completed"),
  notes: z.string().max(500).optional(),
  transaction_time: transactionTimeSchema,
});

export const getSaleSchema = z.object({
  id: z.number().int().positive(),
});

export const searchSalesSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  clientId: z.number().int().positive().optional(),
  status: z.enum(["draft", "completed", "refunded"]).optional(),
  limit: z.number().int().positive().max(100).default(50),
});

export type SaleItemInput = z.infer<typeof saleItemSchema>;
export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type GetSaleInput = z.infer<typeof getSaleSchema>;
export type SearchSalesInput = z.infer<typeof searchSalesSchema>;
