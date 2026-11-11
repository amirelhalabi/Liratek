/**
 * LIRA-389 — the Audit & Transactions Summary view.
 *
 * The summary groups EXACTLY the rows the list shows: the same `getRecent`
 * filters and the same per-row rule (`utils/transactionListFilter.ts`, one
 * definition for both), run here on the server for both transports. Then:
 *
 *  - reversal rows (refunds, void reversal rows, undo-refund rows, hold
 *    pickup voids, voucher cancels) are never rows of their own — they only
 *    net into their original, whatever their date;
 *  - refunded originals (voided, refunded, or every line refunded item by
 *    item) are left out unless "include refunded" is on; then they count
 *    with their refund netted;
 *  - Type / Service type rows sum each transaction's own stored amount per
 *    currency (never payment legs, never a session basket's pooled amount);
 *  - Product / Category rows come from the counted sales' lines: units =
 *    quantity − refunded quantity, volume = unit price × those units (USD —
 *    sales are USD-priced).
 *
 * The exact relation to the list's row count is pinned in
 * `specs/389-transactions-summary/research.md` R3 and its test.
 *
 * Rule 13: no SQL here — `TransactionRepository.getRecent` and
 * `TransactionSummaryRepository` do every read.
 */
import {
  getTransactionRepository,
  type TransactionRepository,
  type TransactionWithUser,
} from "../repositories/TransactionRepository.js";
import {
  getTransactionSummaryRepository,
  type SummarySaleLine,
  type TransactionSummaryRepository,
} from "../repositories/TransactionSummaryRepository.js";
import { POSTING_RULE_EXCLUSIONS } from "../constants/postingRules.js";
import {
  SUMMARY_MODULE_LABELS,
  buildTransactionListFilters,
  isTransactionListRowVisible,
  summaryGroupKeyOf,
  type SummaryModuleKey,
} from "../utils/transactionListFilter.js";
import type {
  TransactionSummaryRequest,
  TransactionSummaryResult,
  TransactionSummaryRow,
} from "../validators/transactionSummary.js";
import logger from "../utils/logger.js";

/** The most transactions one summary reads (`truncated` says when hit). */
export const SUMMARY_ROW_CAP = 100_000;
/** Rows per `getRecent` page — the list's own fetch cap (FETCH_CAP). */
const SUMMARY_PAGE_SIZE = 5_000;

/**
 * Types that only ever reverse another row: the posting rules' "reversal"
 * class (REFUND, REFUND_UNDO, HOLD_MONEY_COLLECT_VOID — one definition,
 * `constants/postingRules.ts`) plus the Vouchers page's own reversal row,
 * VOUCHER_CANCEL (`reversedByIdSql` treats it as the voucher sale's refund).
 */
const REVERSAL_TYPES: ReadonlySet<string> = new Set([
  ...Object.entries(POSTING_RULE_EXCLUSIONS)
    .filter(([, reason]) => reason === "reversal")
    .map(([type]) => type),
  "VOUCHER_CANCEL",
]);

/**
 * Types the summary COUNTS but never adds to a volume: their stored amount
 * is not money a customer paid. A CHECKPOINT carries the drawer count's net
 * over/short (`ClosingRepository`), which the list itself shows apart
 * (`formatCheckpointAmounts`, Method "—").
 */
export const SUMMARY_COUNT_ONLY_TYPES: ReadonlySet<string> = new Set([
  "CHECKPOINT",
]);

type Row = TransactionWithUser;

/** A row that only reverses another one (never a summary row of its own). */
export function isSummaryReversalRow(
  row: Pick<Row, "type" | "reverses_id">,
): boolean {
  return row.reverses_id != null || REVERSAL_TYPES.has(row.type);
}

/** An original the list marks voided / refunded (fully). */
export function isSummaryRefundedOriginal(
  row: Pick<
    Row,
    "status" | "reversed_by_id" | "item_refunded" | "item_refund_remaining"
  >,
): boolean {
  return (
    row.status === "VOIDED" ||
    row.reversed_by_id != null ||
    (row.item_refunded === true && row.item_refund_remaining !== true)
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const isSaleRow = (r: Row) =>
  r.type === "SALE" && r.source_table === "sales" && r.source_id != null;

interface Bucket {
  key: string;
  label: string;
  ids: Set<number>;
  units: number;
  usd: number;
  lbp: number;
  extra: Partial<TransactionSummaryRow>;
}

function toRow(b: Bucket, withUnits: boolean): TransactionSummaryRow {
  return {
    key: b.key,
    label: b.label,
    count: b.ids.size,
    units: withUnits ? b.units : null,
    volume_usd: round2(b.usd),
    volume_lbp: round2(b.lbp),
    ...b.extra,
  };
}

function bySize(a: TransactionSummaryRow, b: TransactionSummaryRow): number {
  return b.count - a.count || a.label.localeCompare(b.label);
}

export class TransactionSummaryService {
  constructor(
    private readonly txnRepo: TransactionRepository,
    private readonly summaryRepo: TransactionSummaryRepository,
  ) {}

  summarize(input: TransactionSummaryRequest): TransactionSummaryResult {
    const options = input.options ?? [];
    const filters = buildTransactionListFilters(options, {
      search: input.search,
      day_from: input.day_from,
      day_to: input.day_to,
    });
    const { rows: raw, truncated } = this._readListRows(filters);
    if (truncated) {
      logger.warn(
        { cap: SUMMARY_ROW_CAP, group_by: input.group_by },
        "Transactions summary hit its row cap",
      );
    }

    const counted = raw.filter(
      (r) =>
        isTransactionListRowVisible(r, options) &&
        !isSummaryReversalRow(r) &&
        (input.include_refunded || !isSummaryRefundedOriginal(r)),
    );

    if (input.group_by === "product" || input.group_by === "category") {
      return this._byProduct(input, counted, truncated);
    }
    return this._byRow(input, counted, truncated);
  }

  /**
   * Every row the list query returns for these filters, read page by page
   * with the list's own keyset cursor (`before`, LIRA-348) — one huge
   * `getRecent` would bind one parameter per row when it attaches payment
   * legs and fails past SQLite's variable limit (measured: 40,000 rows).
   */
  private _readListRows(
    filters: ReturnType<typeof buildTransactionListFilters>,
  ): { rows: Row[]; truncated: boolean } {
    const rows: Row[] = [];
    let before: { created_at: string; id: number } | undefined;
    for (;;) {
      const page = this.txnRepo.getRecent(SUMMARY_PAGE_SIZE, {
        ...filters,
        ...(before ? { before } : {}),
      } as Parameters<TransactionRepository["getRecent"]>[1]);
      rows.push(...page);
      if (page.length < SUMMARY_PAGE_SIZE) return { rows, truncated: false };
      if (rows.length >= SUMMARY_ROW_CAP) return { rows, truncated: true };
      const last = page[page.length - 1]!;
      before = { created_at: last.created_at, id: last.id };
    }
  }

  /** Net amount per counted transaction: its own stored amount plus every
   *  ACTIVE reversal row linked to it (any date). */
  private _netAmounts(
    counted: Row[],
  ): Map<number, { usd: number; lbp: number }> {
    const net = new Map<number, { usd: number; lbp: number }>();
    const bySale = new Map<number, number>();
    const byVoucher = new Map<number, number>();
    for (const r of counted) {
      net.set(r.id, { usd: r.amount_usd ?? 0, lbp: r.amount_lbp ?? 0 });
      if (isSaleRow(r)) bySale.set(r.source_id as number, r.id);
      if (r.type === "VOUCHER_SALE" && r.source_table === "vouchers") {
        byVoucher.set(r.source_id as number, r.id);
      }
    }
    const reversals = this.summaryRepo.getLinkedReversals({
      originalIds: [...net.keys()],
      saleIds: [...bySale.keys()],
      voucherIds: [...byVoucher.keys()],
    });
    const seen = new Set<number>();
    for (const rev of reversals) {
      if (seen.has(rev.id)) continue;
      seen.add(rev.id);
      const originalId =
        rev.reverses_id != null
          ? rev.reverses_id
          : rev.source_table === "sales"
            ? bySale.get(rev.source_id)
            : byVoucher.get(rev.source_id);
      const target = originalId != null ? net.get(originalId) : undefined;
      if (!target) continue;
      target.usd += rev.amount_usd;
      target.lbp += rev.amount_lbp;
    }
    return net;
  }

  /** Type (module) and Service type rows. */
  private _byRow(
    input: TransactionSummaryRequest,
    counted: Row[],
    truncated: boolean,
  ): TransactionSummaryResult {
    const dimension = input.group_by === "service" ? "service" : "type";
    const net = this._netAmounts(counted);
    const buckets = new Map<string, Bucket>();
    let usd = 0;
    let lbp = 0;
    for (const r of counted) {
      const key = summaryGroupKeyOf(r, dimension);
      const label =
        dimension === "type"
          ? (SUMMARY_MODULE_LABELS[key as SummaryModuleKey] ?? key)
          : key;
      const b = buckets.get(key) ?? {
        key,
        label,
        ids: new Set<number>(),
        units: 0,
        usd: 0,
        lbp: 0,
        extra: {},
      };
      const amount = SUMMARY_COUNT_ONLY_TYPES.has(r.type)
        ? { usd: 0, lbp: 0 }
        : net.get(r.id)!;
      b.ids.add(r.id);
      b.usd += amount.usd;
      b.lbp += amount.lbp;
      usd += amount.usd;
      lbp += amount.lbp;
      buckets.set(key, b);
    }
    return {
      group_by: input.group_by,
      rows: [...buckets.values()].map((b) => toRow(b, false)).sort(bySize),
      total: {
        count: counted.length,
        units: null,
        volume_usd: round2(usd),
        volume_lbp: round2(lbp),
      },
      truncated,
    };
  }

  /** Product and Category rows, from the counted sales' lines. */
  private _byProduct(
    input: TransactionSummaryRequest,
    counted: Row[],
    truncated: boolean,
  ): TransactionSummaryResult {
    const sales = counted.filter(isSaleRow);
    const saleRowBySaleId = new Map<number, Row>();
    for (const r of sales) saleRowBySaleId.set(r.source_id as number, r);
    const lines = this.summaryRepo.getSaleLines([...saleRowBySaleId.keys()]);

    const linesBySale = new Map<number, SummarySaleLine[]>();
    for (const l of lines) {
      linesBySale.set(l.sale_id, [...(linesBySale.get(l.sale_id) ?? []), l]);
    }

    const term = (input.search ?? "").trim().toLowerCase();
    const contains = (s: string | null | undefined) =>
      !!s && s.toLowerCase().includes(term);

    const byCategory = input.group_by === "category";
    const buckets = new Map<string, Bucket>();
    const totalSales = new Set<number>();
    let units = 0;
    let usd = 0;

    for (const [saleId, saleLines] of linesBySale) {
      const row = saleRowBySaleId.get(saleId)!;
      // A search narrows to the lines it names (product or category), unless
      // the sale was found by its client or cashier, or no line names it.
      let kept = saleLines;
      if (term && !contains(row.client_name) && !contains(row.username)) {
        const named = saleLines.filter(
          (l) => contains(l.product_name) || contains(l.category),
        );
        if (named.length > 0) kept = named;
      }
      // A refunded sale counted with "include refunded": its refund nets
      // every line to nothing.
      const refundedWhole = isSummaryRefundedOriginal(row);
      for (const l of kept) {
        const netQty = refundedWhole
          ? 0
          : Math.max(0, (l.quantity ?? 0) - (l.refunded_quantity ?? 0));
        const volume = netQty * (l.sold_price_usd ?? 0);
        const key = byCategory
          ? `category:${l.category ?? ""}`
          : `product:${l.product_id}`;
        const b = buckets.get(key) ?? {
          key,
          label: byCategory
            ? (l.category ?? "(no category)")
            : (l.product_name ?? `#${l.product_id}`),
          ids: new Set<number>(),
          units: 0,
          usd: 0,
          lbp: 0,
          extra: byCategory
            ? { category: l.category }
            : { product_id: l.product_id, deleted: l.product_deleted === 1 },
        };
        b.ids.add(row.id);
        b.units += netQty;
        b.usd += volume;
        buckets.set(key, b);
        totalSales.add(row.id);
        units += netQty;
        usd += volume;
      }
    }

    return {
      group_by: input.group_by,
      rows: [...buckets.values()].map((b) => toRow(b, true)).sort(bySize),
      total: {
        count: totalSales.size,
        units,
        volume_usd: round2(usd),
        volume_lbp: 0,
      },
      truncated,
    };
  }
}

let instance: TransactionSummaryService | null = null;

export function getTransactionSummaryService(): TransactionSummaryService {
  if (!instance) {
    instance = new TransactionSummaryService(
      getTransactionRepository(),
      getTransactionSummaryRepository(),
    );
  }
  return instance;
}

export function resetTransactionSummaryService(): void {
  instance = null;
}
