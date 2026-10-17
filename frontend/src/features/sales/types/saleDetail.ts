/**
 * The saved POS sale as `getSale` + `getSaleItems` return it (both
 * transports call `SalesService.getSale` / `getSaleItems`). Shared by the
 * sale details window and the one receipt description
 * (`utils/saleReceipt.ts`, LIRA-333).
 */

export interface SaleDetailItem {
  id: number;
  sale_id: number;
  product_id: number;
  quantity: number;
  sold_price_usd: number;
  name: string;
  barcode: string;
  imei?: string;
  is_refunded?: number;
  refunded_quantity?: number;
  /** LIRA-143 phase 6a — stamped once at sale time (sale_items.warranty_until,
   *  already selected via `si.*` in SalesRepository.getSaleItems). Null for a
   *  non-IMEI-tracked line or a product with no warranty_months. */
  warranty_until?: string | null;
  /** LIRA-296 — the line's SOLD unit's override (LIRA-143), when there is
   *  one; it wins over `warranty_until` (same precedence as the search). */
  warranty_override_until?: string | null;
  /** LIRA-296 P3 — what the line's serial is called ('IMEI' | 'Serial');
   *  missing on older data (then "IMEI"). */
  serial_label?: string | null;
}

export interface SaleDetail {
  id: number;
  client_id: number | null;
  client_name: string | null;
  client_phone: string | null;
  total_amount_usd: number;
  discount_usd: number;
  final_amount_usd: number;
  /** LIRA-319: the extra charged on top of the items, from the sale's
   *  transaction row. Optional — absent on a server that does not send it
   *  (and on every sale before the feature), read as 0. */
  extra_usd?: number | null;
  paid_usd: number;
  paid_lbp: number;
  change_given_usd: number;
  change_given_lbp: number;
  exchange_rate_snapshot: number;
  status: string;
  created_at: string;
  /** LIRA-333 (contracts/sale-receipt-read.md) — the receipt figures added
   *  to the saved-sale read. All optional: a server from before the
   *  feature does not send them; missing reads as null / 0. */
  /** Phone saved with the sale (its SALE transaction) — FR-012 #1. */
  sale_phone?: string | null;
  /** The linked client's phone — FR-012 #2. */
  linked_client_phone?: string | null;
  /** Tender handed over at sale time; unlike `paid_*`, a later debt
   *  repayment never changes it. */
  tender_usd?: number;
  tender_lbp?: number;
  /** Gift-card part of the sale, USD. */
  gift_card_usd?: number;
  /** Part charged to the client's account, USD (never "paid"). */
  on_account_usd?: number;
}
