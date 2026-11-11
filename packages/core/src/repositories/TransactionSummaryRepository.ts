/**
 * LIRA-389 — the reads behind the Audit & Transactions Summary view that the
 * list query (`TransactionRepository.getRecent`) does not already return:
 *
 *  - the sale lines of the counted sales (product, category, units, sold
 *    price, item-refunded quantity) for the Product / Category rows;
 *  - the reversal rows linked to the counted transactions, WHATEVER their
 *    date, so a refund is netted into its original's row (a June sale
 *    refunded in July nets in June's summary).
 *
 * Reporting repository (rule 13): SQL only, no grouping. Every statement
 * carries a literal `tenant_id = ?` (check:tenant-scoping), written
 * `+tenant_id` so SQLite never picks the tenant_id index: in a per-tenant
 * database file that index matches every row, while `reverses_id`,
 * `(source_table, source_id)` and `sale_items.sale_id` are selective
 * (EXPLAIN QUERY PLAN checked 2026-11-11). Id lists are read
 * in chunks so a large range never exceeds SQLite's bound-parameter ceiling.
 */
import { BaseRepository } from "./BaseRepository.js";
import { PRODUCT_CATEGORY_KEY_SQL } from "./productCategoryFragment.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

/** Same ceiling as `TransactionRepository`'s session batches. */
const CHUNK_SIZE = 400;

function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK_SIZE) {
    out.push(list.slice(i, i + CHUNK_SIZE));
  }
  return out;
}

/** One sale line, as the Product / Category rows read it. */
export interface SummarySaleLine {
  sale_id: number;
  product_id: number;
  /** Current product name; null when the product row no longer exists. */
  product_name: string | null;
  product_deleted: number;
  /** The product's display category; null = no category. */
  category: string | null;
  quantity: number;
  refunded_quantity: number;
  /** Price of ONE unit, in USD (sales are USD-priced). */
  sold_price_usd: number;
}

/** A reversal row linked to a counted transaction. */
export interface SummaryReversalRow {
  id: number;
  type: string;
  reverses_id: number | null;
  source_table: string;
  source_id: number;
  amount_usd: number;
  amount_lbp: number;
}

export class TransactionSummaryRepository extends BaseRepository<{
  id: number;
}> {
  constructor() {
    // Base table is irrelevant — this repo only runs report reads.
    super("transactions", { softDelete: false });
  }

  protected getColumns(): string {
    return "id";
  }

  /** The lines of these sales (`sales.id`), with product and category. */
  getSaleLines(saleIds: readonly number[]): SummarySaleLine[] {
    const tenantId = getCurrentTenantId();
    const out: SummarySaleLine[] = [];
    for (const ids of chunks(saleIds)) {
      const placeholders = ids.map(() => "?").join(", ");
      out.push(
        ...this.query<SummarySaleLine>(
          `SELECT si.sale_id,
                  si.product_id,
                  p.name AS product_name,
                  COALESCE(p.is_deleted, 0) AS product_deleted,
                  ${PRODUCT_CATEGORY_KEY_SQL} AS category,
                  COALESCE(si.quantity, 0) AS quantity,
                  COALESCE(si.refunded_quantity, 0) AS refunded_quantity,
                  COALESCE(si.sold_price_usd, 0) AS sold_price_usd
             FROM sale_items si
             LEFT JOIN products p ON p.id = si.product_id AND p.tenant_id = ?
             LEFT JOIN product_categories pc ON pc.id = p.category_id AND pc.tenant_id = ?
            WHERE +si.tenant_id = ? AND si.sale_id IN (${placeholders})
            ORDER BY si.sale_id, si.id`,
          tenantId,
          tenantId,
          tenantId,
          ...ids,
        ),
      );
    }
    return out;
  }

  /**
   * ACTIVE reversal rows linked to counted transactions, by the links the
   * rest of the app already uses (`reversedByIdSql`,
   * `saleItemRefundOriginalIdSql`):
   *  - `reverses_id` → one of `originalIds` (refund, void reversal row,
   *    hold-pickup void, compensating discount, warranty-cost reversal);
   *  - a sale's item-refund rows and their undo rows: REFUND / REFUND_UNDO,
   *    `reverses_id IS NULL`, `source_table = 'sales'`, `source_id` in
   *    `saleIds`;
   *  - a voucher sale's cancel: VOUCHER_CANCEL on the same voucher.
   */
  getLinkedReversals(input: {
    originalIds: readonly number[];
    saleIds: readonly number[];
    voucherIds: readonly number[];
  }): SummaryReversalRow[] {
    const tenantId = getCurrentTenantId();
    const cols = `id, type, reverses_id, source_table, source_id,
                  COALESCE(amount_usd, 0) AS amount_usd,
                  COALESCE(amount_lbp, 0) AS amount_lbp`;
    const out: SummaryReversalRow[] = [];
    for (const ids of chunks(input.originalIds)) {
      const placeholders = ids.map(() => "?").join(", ");
      out.push(
        ...this.query<SummaryReversalRow>(
          `SELECT ${cols} FROM transactions
            WHERE +tenant_id = ? AND status = 'ACTIVE'
              AND reverses_id IN (${placeholders})`,
          tenantId,
          ...ids,
        ),
      );
    }
    for (const ids of chunks(input.saleIds)) {
      const placeholders = ids.map(() => "?").join(", ");
      out.push(
        ...this.query<SummaryReversalRow>(
          `SELECT ${cols} FROM transactions
            WHERE +tenant_id = ? AND status = 'ACTIVE'
              AND type IN ('REFUND', 'REFUND_UNDO') AND reverses_id IS NULL
              AND source_table = 'sales' AND source_id IN (${placeholders})`,
          tenantId,
          ...ids,
        ),
      );
    }
    for (const ids of chunks(input.voucherIds)) {
      const placeholders = ids.map(() => "?").join(", ");
      out.push(
        ...this.query<SummaryReversalRow>(
          `SELECT ${cols} FROM transactions
            WHERE +tenant_id = ? AND status = 'ACTIVE'
              AND type = 'VOUCHER_CANCEL' AND reverses_id IS NULL
              AND source_table = 'vouchers' AND source_id IN (${placeholders})`,
          tenantId,
          ...ids,
        ),
      );
    }
    return out;
  }
}

let instance: TransactionSummaryRepository | null = null;

export function getTransactionSummaryRepository(): TransactionSummaryRepository {
  if (!instance) instance = new TransactionSummaryRepository();
  return instance;
}

export function resetTransactionSummaryRepository(): void {
  instance = null;
}
