import { z } from "zod";
import {
  positiveDecimalSchema,
  positiveIntegerSchema,
  transactionTimeSchema,
  refundExchangeRateSchema,
} from "./common.js";
import { refundLegsSchema, refundUnitExtrasSchema } from "./transaction.js";

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
export const saleProcessSchema = z
  .object({
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
  })
  .refine(
    (data) =>
      data.partnerMode !== "FOR" ||
      !(data.payments ?? []).some(
        (p) => p.direction !== "OUT" && p.method === "CUSTOMER_ACCOUNT",
      ),
    {
      // FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §3: mirrors
      // validators/customService.ts's identical refine. Under partnerMode
      // "FOR" there is no customer owing — the PARTNER owes — so a
      // CUSTOMER_ACCOUNT payment leg is never valid here (an OUT leg is
      // change/return, not a counter payment, so it's excluded). Mirrors
      // the repository-layer rejection in `SalesRepository.processSale`'s
      // `assertNoCustomerAccountLeg` call; this is the edge (Zod) half of
      // rule 19 — reject before the write, not just inside it. Sales has no
      // separate legacy payment-method field (unlike Loto/Financial
      // Services/Recharge), so this is the only refine this schema needs.
      message:
        "payments cannot include a Customer Account leg on a for-partner sale — there is no customer owing, the partner owes",
      path: ["payments"],
    },
  );

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

/**
 * `GET /api/sales/:id` (REST) path-param variant of `getSaleSchema` above.
 * `id` uses `z.coerce` — a URL param is ALWAYS a string ("67", never 67), so
 * `getSaleSchema`'s plain `z.number()` rejected every single request through
 * `validateParams` (the exact trap `backend/src/api/maintenance.ts` already
 * has a comment about, above its own `GET /jobs/:id/history` route) — this
 * is the fix, not a rename of `getSaleSchema`, because that schema is kept
 * for any IPC-style caller that already hands it a real number (rule 14: add
 * the correctly-shaped schema, don't reshape one whose contract is fine for
 * its own callers). Same pattern as `productUnitIdSchema`/
 * `lotBreakdownSchema` elsewhere in this file's siblings.
 */
export const saleIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
export type SaleIdParamInput = z.infer<typeof saleIdParamSchema>;

/**
 * Edit non-financial metadata (walk-in name/phone, note) on a `sales` row.
 * Mirrors the `sales:update-metadata` IPC handler's own inline shape
 * (electron-app/handlers/salesHandlers.ts) — that handler validates nothing
 * beyond `requireRole`, so this schema is the first real validation the field
 * set gets; shared by the REST route (rule 14).
 */
export const saleUpdateMetadataSchema = z.object({
  id: z.number().int().positive(),
  note: z.string().max(500).optional(),
  client_name: z.string().max(255).optional(),
  client_phone: z.string().max(50).optional(),
});

export type SaleUpdateMetadataInput = z.infer<typeof saleUpdateMetadataSchema>;

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

/**
 * LIRA-231 — POS "Refund Sale" (whole sale) and "Refund item" buttons, both
 * given the SAME operator-chosen return-method override contract the
 * Transactions page's LIRA-078 refund modal uses: `refundLegsSchema`
 * (packages/core/src/validators/transaction.ts) is reused verbatim (rule 14)
 * — never a second "one refund leg" shape. Omitting `refundLegs` reproduces
 * today's default proportional-mirror reversal, unchanged.
 *
 * 2026-09-26 owner decision: `unitExtras` gives the POS refund window the
 * SAME "Returned phones" per-unit defective/warranty-override flagging the
 * Transactions page's whole-refund flow has always had — reusing
 * `refundUnitExtrasSchema` (the SAME schema `POST /api/transactions/:id/
 * refund` already validates `refundUnitExtras` with) verbatim, rule 14.
 * Money-correctness (which unit_ids actually belong to this sale) is still
 * the repository's job, not Zod's — see `TransactionRepository.
 * refundBySaleId`'s `opts.refundUnitExtras` forwarding.
 *
 * `saleId` here is a BODY field (not a route param) so the IPC handler and
 * the REST route validate the exact same object shape (rule 19b) — the REST
 * route additionally reads `:id` from the URL and folds it in before
 * validating, matching `saleRefundItemSchema` below.
 */
export const saleRefundSchema = z.object({
  saleId: z.number().int().positive(),
  refundLegs: refundLegsSchema.optional(),
  unitExtras: refundUnitExtrasSchema.optional(),
  // LIRA-236 (REFUND_EXCHANGE_RATE_PLAN.md §3) — the cashier-typed exchange
  // rate; omitted keeps today's per-currency exact-match behavior.
  exchangeRate: refundExchangeRateSchema,
});
export type SaleRefundInput = z.infer<typeof saleRefundSchema>;

/**
 * LIRA-231 — refund a specific item, with the same optional override.
 * `saleItemId`/`refundQuantity` mirror `sales:refund-item`'s pre-existing
 * manual checks (electron-app/handlers/salesHandlers.ts had no schema at all
 * before this ticket — rule 23's three-way key-set diff: schema now covers
 * every key the handler already forwarded, plus the new `refundLegs`).
 *
 * 2026-09-26: `unitExtras` — same schema, same rule-14 reuse as
 * `saleRefundSchema` above — validated by `SalesRepository.refundSaleItem`
 * against THIS ITEM's own linked units only (never the whole sale's).
 */
export const saleRefundItemSchema = z.object({
  saleId: z.number().int().positive(),
  saleItemId: z.number().int().positive(),
  refundQuantity: z.number().int().positive(),
  refundLegs: refundLegsSchema.optional(),
  unitExtras: refundUnitExtrasSchema.optional(),
  // LIRA-236 — see `saleRefundSchema`'s own doc.
  exchangeRate: refundExchangeRateSchema,
});
export type SaleRefundItemInput = z.infer<typeof saleRefundItemSchema>;

/**
 * LIRA-231 — read-only refund preview for the POS refund flow: the sale's
 * (or, with `item`, one item's proportional share of the sale's) own
 * customer-facing payment legs, used to pre-fill RefundMethodModal, plus
 * whether the sale is session-linked (both POS refund buttons are blocked
 * for a session-paid sale — see `TransactionRepository.refundBySaleId` /
 * `SalesRepository.refundSaleItem`'s identical guard).
 */
export const saleRefundPreviewSchema = z.object({
  saleId: z.number().int().positive(),
  item: z
    .object({
      saleItemId: z.number().int().positive(),
      refundQuantity: z.number().int().positive(),
    })
    .optional(),
});
export type SaleRefundPreviewInput = z.infer<typeof saleRefundPreviewSchema>;
