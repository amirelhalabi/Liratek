/**
 * LIRA-389 SC-001 — the Summary view, table-driven over one fixture on the
 * real schema (create_db.sql):
 *
 *   S1  multi-line sale: Lenovo ×2 + Lenovo ×1 ($445 each) + USB-C cable ×1 ($5) = $1,340
 *   S2  HP sale $470, refunded whole (REFUND row in range)
 *   S3  cable ×3 ($5), one unit refunded item by item — its REFUND row is
 *       dated in DECEMBER, outside the range, and must still net
 *   S4  charger ×2 ($10) — the product is deleted afterwards, legacy text
 *       category "Accessories"
 *   S5  HP sale $470 inside a session basket (+ an OMT send in the same
 *       basket; the basket's pooled $571 cash leg is never volume)
 *   F1  OMT send $101 ($100 + $1 fee) + its auto SUPPLIER_PAYMENT sibling
 *   F2  OMT receive $200
 *   F3  OMT send $101 in the session basket
 *   RC1 MTC credits $5
 *   E1  manual expense $20, E2 auto expense $1 (hidden by default)
 *   CS1 custom service $50, voided (VOIDED + same-type reversal row)
 *
 * The Lenovo product was renamed after its sale (one row, current name).
 *
 * Expectations are hand-computed (the comments show the arithmetic) and the
 * TOTAL is checked against the list itself: `getRecent` with the list's own
 * filters, kept by the list's own row rule (research.md R3).
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
} from "../../repositories/testHelpers/debtItemDb";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../../repositories/TransactionRepository";
import { resetTransactionSummaryRepository } from "../../repositories/TransactionSummaryRepository";
import {
  getTransactionSummaryService,
  resetTransactionSummaryService,
} from "../TransactionSummaryService";
import {
  buildTransactionListFilters,
  isTransactionListRowVisible,
  type TransactionListOption,
} from "../../utils/transactionListFilter";
import {
  transactionSummarySchema,
  type TransactionSummaryInput,
  type TransactionSummaryResult,
} from "../../validators/transactionSummary";

const RANGE = { day_from: "2026-11-01", day_to: "2026-11-30" };

let db: Database.Database;
let ids: Record<string, number>;

function insert(sql: string, ...params: unknown[]): number {
  return Number(db.prepare(sql).run(...params).lastInsertRowid);
}

function txn(o: {
  type: string;
  amount_usd: number;
  amount_lbp?: number;
  source_table?: string;
  source_id?: number;
  status?: string;
  reverses_id?: number | null;
  summary?: string;
  meta?: Record<string, unknown>;
  at: string;
}): number {
  return insert(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id,
       amount_usd, amount_lbp, reverses_id, summary, metadata_json, created_at)
     VALUES (1, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    o.type,
    o.status ?? "ACTIVE",
    o.source_table ?? "x",
    o.source_id ?? 0,
    o.amount_usd,
    o.amount_lbp ?? 0,
    o.reverses_id ?? null,
    o.summary ?? o.type,
    o.meta ? JSON.stringify(o.meta) : null,
    o.at,
  );
}

function leg(o: {
  transaction_id?: number;
  session_id?: number;
  amount: number;
  method?: string;
}): void {
  insert(
    `INSERT INTO payments (tenant_id, transaction_id, session_id, method, drawer_name, currency_code, amount, created_by)
     VALUES (1, ?, ?, ?, 'General', 'USD', ?, 1)`,
    o.transaction_id ?? null,
    o.session_id ?? null,
    o.method ?? "CASH",
    o.amount,
  );
}

function seed(): Record<string, number> {
  const laptops = insert(
    `INSERT INTO product_categories (tenant_id, name) VALUES (1, 'Laptops')`,
  );
  const product = (
    name: string,
    categoryId: number | null,
    legacy: string | null,
  ) =>
    insert(
      `INSERT INTO products (tenant_id, name, item_type, category, category_id) VALUES (1, ?, 'Accessory', ?, ?)`,
      name,
      legacy,
      categoryId,
    );
  const lenovo = product("Lenovo Old Name", laptops, null);
  const hp = product("HP 250 G9", laptops, null);
  const cable = product("USB-C cable", null, null);
  const charger = product("Old charger", null, "Accessories");

  const sale = (lines: Array<[number, number, number, number?]>) => {
    const saleId = insert(
      `INSERT INTO sales (tenant_id, status) VALUES (1, 'completed')`,
    );
    for (const [productId, qty, price, refunded] of lines) {
      insert(
        `INSERT INTO sale_items (tenant_id, sale_id, product_id, quantity, sold_price_usd, refunded_quantity)
         VALUES (1, ?, ?, ?, ?, ?)`,
        saleId,
        productId,
        qty,
        price,
        refunded ?? 0,
      );
    }
    return saleId;
  };

  const s1 = sale([
    [lenovo, 2, 445],
    [lenovo, 1, 445],
    [cable, 1, 5],
  ]);
  const s2 = sale([[hp, 1, 470]]);
  const s3 = sale([[cable, 3, 5, 1]]);
  const s4 = sale([[charger, 2, 10]]);
  const s5 = sale([[hp, 1, 470]]);

  const t1 = txn({
    type: "SALE",
    source_table: "sales",
    source_id: s1,
    amount_usd: 1340,
    summary: "Sale: Lenovo Old Name x3, USB-C cable x1",
    at: "2026-11-02 10:00:00",
  });
  leg({ transaction_id: t1, amount: 1340 });
  const t2 = txn({
    type: "SALE",
    source_table: "sales",
    source_id: s2,
    amount_usd: 470,
    summary: "Sale: HP 250 G9 x1",
    at: "2026-11-03 10:00:00",
  });
  const r2 = txn({
    type: "REFUND",
    source_table: "sales",
    source_id: s2,
    amount_usd: -470,
    reverses_id: t2,
    summary: "REFUND: Sale: HP 250 G9 x1",
    at: "2026-11-04 10:00:00",
  });
  const t3 = txn({
    type: "SALE",
    source_table: "sales",
    source_id: s3,
    amount_usd: 15,
    summary: "Sale: USB-C cable x3",
    at: "2026-11-05 10:00:00",
  });
  // The item refund of 1 cable — in DECEMBER, outside the range.
  txn({
    type: "REFUND",
    source_table: "sales",
    source_id: s3,
    amount_usd: -5,
    summary: "REFUND: USB-C cable x1",
    at: "2026-12-03 10:00:00",
  });
  const t4 = txn({
    type: "SALE",
    source_table: "sales",
    source_id: s4,
    amount_usd: 20,
    summary: "Sale: Old charger x2",
    at: "2026-11-06 10:00:00",
  });

  // Session basket: an HP sale + an OMT send, paid together ($571 cash).
  const session = insert(
    `INSERT INTO customer_sessions (tenant_id, customer_name, started_by) VALUES (1, 'Walk-in', 'admin')`,
  );
  const t5 = txn({
    type: "SALE",
    source_table: "sales",
    source_id: s5,
    amount_usd: 470,
    summary: "Sale: HP 250 G9 x1",
    at: "2026-11-07 10:00:00",
  });
  const f3 = txn({
    type: "FINANCIAL_SERVICE",
    source_table: "financial_services",
    source_id: 3,
    amount_usd: 101,
    meta: { provider: "OMT", service_type: "SEND" },
    at: "2026-11-07 10:00:01",
  });
  for (const [unified, type, amount] of [
    [t5, "sale", 470],
    [f3, "omt", 101],
  ] as const) {
    insert(
      `INSERT INTO customer_session_transactions (tenant_id, session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd)
       VALUES (1, ?, ?, 0, ?, ?)`,
      session,
      type,
      unified,
      amount,
    );
  }
  leg({ session_id: session, amount: 571 });

  const f1 = txn({
    type: "FINANCIAL_SERVICE",
    source_table: "financial_services",
    source_id: 1,
    amount_usd: 101,
    meta: { provider: "OMT", service_type: "SEND" },
    at: "2026-11-08 10:00:00",
  });
  leg({ transaction_id: f1, amount: 101 });
  txn({
    type: "SUPPLIER_PAYMENT",
    source_table: "supplier_ledger",
    source_id: 1,
    amount_usd: 100,
    meta: { is_auto: true },
    at: "2026-11-08 10:00:01",
  });
  const f2 = txn({
    type: "FINANCIAL_SERVICE",
    source_table: "financial_services",
    source_id: 2,
    amount_usd: 200,
    meta: { provider: "OMT", service_type: "RECEIVE" },
    at: "2026-11-09 10:00:00",
  });
  leg({ transaction_id: f2, amount: -200 });
  txn({
    type: "RECHARGE",
    source_table: "recharges",
    source_id: 1,
    amount_usd: 5,
    meta: { provider: "MTC", type: "CREDIT_TRANSFER" },
    at: "2026-11-10 10:00:00",
  });
  const e1 = txn({
    type: "EXPENSE",
    source_table: "expenses",
    source_id: 1,
    amount_usd: 20,
    at: "2026-11-11 10:00:00",
  });
  leg({ transaction_id: e1, amount: -20 });
  txn({
    type: "EXPENSE",
    source_table: "expenses",
    source_id: 2,
    amount_usd: 1,
    meta: { is_auto: true },
    at: "2026-11-11 10:00:01",
  });
  const cs1 = txn({
    type: "CUSTOM_SERVICE",
    source_table: "custom_services",
    source_id: 1,
    amount_usd: 50,
    status: "VOIDED",
    at: "2026-11-12 10:00:00",
  });
  txn({
    type: "CUSTOM_SERVICE",
    source_table: "custom_services",
    source_id: 1,
    amount_usd: -50,
    reverses_id: cs1,
    at: "2026-11-12 10:05:00",
  });

  // A drawer checkpoint: its amounts are the count's net over/short, not
  // money a customer paid — counted, never volume.
  txn({
    type: "CHECKPOINT",
    source_table: "daily_closings",
    source_id: 1,
    amount_usd: -3,
    amount_lbp: 50000,
    at: "2026-11-13 10:00:00",
  });

  // Renamed and deleted AFTER the sales.
  db.prepare(`UPDATE products SET name = 'Lenovo IdeaPad 3' WHERE id = ?`).run(
    lenovo,
  );
  db.prepare(`UPDATE products SET is_deleted = 1 WHERE id = ?`).run(charger);

  return {
    lenovo,
    hp,
    cable,
    charger,
    t1,
    t2,
    r2,
    t3,
    t4,
    t5,
    f1,
    f2,
    f3,
    e1,
    cs1,
  };
}

function summarize(
  input: Partial<TransactionSummaryInput>,
): TransactionSummaryResult {
  return getTransactionSummaryService().summarize(
    transactionSummarySchema.parse({ group_by: "type", ...RANGE, ...input }),
  );
}

/** label (Type rows: module key) → [count, units, volume_usd, volume_lbp] */
function table(
  r: TransactionSummaryResult,
): Record<string, [number, number | null, number, number]> {
  return Object.fromEntries(
    r.rows.map((row) => [
      r.group_by === "type" ? row.key : row.label,
      [row.count, row.units, row.volume_usd, row.volume_lbp],
    ]),
  );
}

/** The list's own rows for these options (getRecent + the list rule). */
function listRows(
  options: TransactionListOption[],
  extra: Record<string, unknown> = {},
) {
  const repo = new TransactionRepository();
  const filters = { ...buildTransactionListFilters(options, RANGE), ...extra };
  return repo
    .getRecent(
      5000,
      filters as Parameters<TransactionRepository["getRecent"]>[1],
    )
    .filter((r) => isTransactionListRowVisible(r, options));
}

beforeEach(() => {
  db = installDebtItemTestDb();
  initFixedTenantContext(1);
  resetTransactionRepository();
  resetTransactionSummaryRepository();
  resetTransactionSummaryService();
  ids = seed();
});

afterEach(() => {
  resetTransactionSummaryService();
  resetTransactionSummaryRepository();
  resetTransactionRepository();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

describe("LIRA-389 — Summary by Product / Category (US1)", () => {
  it.each([
    [
      "product, refunded excluded",
      { group_by: "product", include_refunded: false },
      {
        // S1: 2+1 units × $445
        "Lenovo IdeaPad 3": [1, 3, 1335, 0],
        // S1 1×$5 + S3 (3−1)×$5
        "USB-C cable": [2, 3, 15, 0],
        "Old charger": [1, 2, 20, 0],
        // S5 only — S2 was refunded
        "HP 250 G9": [1, 1, 470, 0],
      },
      // distinct sales S1, S3, S4, S5; units 3+3+2+1; $1335+15+20+470
      { count: 4, units: 9, volume_usd: 1840, volume_lbp: 0 },
    ],
    [
      "product, refunded included",
      { group_by: "product", include_refunded: true },
      {
        "Lenovo IdeaPad 3": [1, 3, 1335, 0],
        "USB-C cable": [2, 3, 15, 0],
        "Old charger": [1, 2, 20, 0],
        // S2 counted with its refund netted: 0 units, $0
        "HP 250 G9": [2, 1, 470, 0],
      },
      { count: 5, units: 9, volume_usd: 1840, volume_lbp: 0 },
    ],
    [
      "category, refunded excluded",
      { group_by: "category", include_refunded: false },
      {
        // S1 (Lenovo ×3) + S5 (HP ×1): $1335 + $470
        Laptops: [2, 4, 1805, 0],
        "(no category)": [2, 3, 15, 0],
        Accessories: [1, 2, 20, 0],
      },
      { count: 4, units: 9, volume_usd: 1840, volume_lbp: 0 },
    ],
    [
      "product, search 'lenovo' narrows to its lines",
      { group_by: "product", search: "lenovo" },
      { "Lenovo IdeaPad 3": [1, 3, 1335, 0] },
      { count: 1, units: 3, volume_usd: 1335, volume_lbp: 0 },
    ],
  ] as const)("%s", (_name, input, rows, total) => {
    const r = summarize(input as Partial<TransactionSummaryInput>);
    expect(table(r)).toEqual(rows);
    expect(r.total).toEqual(total);
    expect(r.truncated).toBe(false);
  });

  it("marks the deleted product and keys product rows by id", () => {
    const r = summarize({ group_by: "product" });
    const charger = r.rows.find((x) => x.label === "Old charger");
    expect(charger).toMatchObject({ deleted: true, product_id: ids.charger });
    const lenovo = r.rows.find((x) => x.label === "Lenovo IdeaPad 3");
    expect(lenovo).toMatchObject({ deleted: false, product_id: ids.lenovo });
  });
});

describe("LIRA-389 — Summary by Type / Service type (US2)", () => {
  it.each([
    [
      "type, refunded excluded",
      { group_by: "type", include_refunded: false },
      {
        // S1 1340 + S3 (15 − 5, December refund netted) + S4 20 + S5 470
        sales: [4, null, 1840, 0],
        // F1 101 + F2 200 + F3 101 (the basket's $571 never counted)
        financial: [3, null, 402, 0],
        telecom: [1, null, 5, 0],
        // E1 only — E2 is an auto row, hidden like the list hides it
        expenses: [1, null, 20, 0],
        // the checkpoint: counted, its over/short never volume
        drawers: [1, null, 0, 0],
      },
      { count: 10, units: null, volume_usd: 2267, volume_lbp: 0 },
    ],
    [
      "type, refunded included",
      { group_by: "type", include_refunded: true },
      {
        // + S2 (470 − 470)
        sales: [5, null, 1840, 0],
        financial: [3, null, 402, 0],
        telecom: [1, null, 5, 0],
        expenses: [1, null, 20, 0],
        // CS1 voided: 50 − 50
        services: [1, null, 0, 0],
        drawers: [1, null, 0, 0],
      },
      { count: 12, units: null, volume_usd: 2267, volume_lbp: 0 },
    ],
    [
      "service type",
      { group_by: "service" },
      {
        SALE: [4, null, 1840, 0],
        // F1 + F3 (basket member) — $101 each, fee included
        "OMT System Send": [2, null, 202, 0],
        "OMT System Recv": [1, null, 200, 0],
        "MTC Credits": [1, null, 5, 0],
        EXPENSE: [1, null, 20, 0],
        Checkpoint: [1, null, 0, 0],
      },
      { count: 10, units: null, volume_usd: 2267, volume_lbp: 0 },
    ],
  ] as const)("%s", (_name, input, rows, total) => {
    const r = summarize(input as Partial<TransactionSummaryInput>);
    expect(table(r)).toEqual(rows);
    expect(r.total).toEqual(total);
  });

  it("never makes a refund or reversal row a row of its own", () => {
    const r = summarize({ group_by: "type", include_refunded: true });
    expect(r.rows.map((x) => x.key)).not.toContain("refunds");
  });
});

describe("LIRA-389 — the summary matches the list (US3, research R3)", () => {
  const isReversal = (r: { type: string; reverses_id: number | null }) =>
    r.reverses_id != null || r.type === "REFUND" || r.type === "REFUND_UNDO";

  it.each([
    ["All types", [] as TransactionListOption[], 12],
    // The Expense filter reveals the auto expense: E1 + E2
    ["Expense", [{ type: "EXPENSE" }], 2],
    // Rows with a cash leg: S1, F1, F2, E1 + the cash-paid basket (S5, F3)
    ["Cash only", [{ cash_only: true }], 6],
    // Mixed typed + untyped: every sale (S1–S5) ∪ the cash rows (F1, F2, E1, F3)
    ["Sale + Cash only", [{ type: "SALE" }, { cash_only: true }], 9],
  ] as const)(
    "%s: TOTAL (refunded included) = list rows − reversal rows",
    (_name, options, expected) => {
      const list = listRows([...options]);
      const r = summarize({
        group_by: "type",
        include_refunded: true,
        options: [...options] as TransactionSummaryInput["options"],
      });
      expect(r.total.count).toBe(list.length - list.filter(isReversal).length);
      expect(r.total.count).toBe(expected);
    },
  );

  it("refunded excluded: TOTAL = list rows − reversal rows − refunded originals", () => {
    const list = listRows([]);
    const refunded = list.filter(
      (r) =>
        !isReversal(r) && (r.status === "VOIDED" || r.reversed_by_id != null),
    );
    const r = summarize({ group_by: "type" });
    expect(r.total.count).toBe(
      list.length - list.filter(isReversal).length - refunded.length,
    );
    expect(refunded.map((x) => x.id).sort()).toEqual([ids.t2, ids.cs1].sort());
  });

  it("a product row's drill shows its Count + its refunded sales (R3a)", () => {
    const hpRow = summarize({ group_by: "product" }).rows.find(
      (x) => x.product_id === ids.hp,
    );
    const drilled = listRows([], { sale_product_id: ids.hp });
    // HP row Count 1 (S5) + the refunded S2, listed with its badge
    expect(hpRow?.count).toBe(1);
    expect(drilled.map((x) => x.id).sort()).toEqual([ids.t2, ids.t5].sort());
  });

  it("a category drill (null = no category) lists the sales holding it", () => {
    expect(
      listRows([], { sale_category: null })
        .map((x) => x.id)
        .sort(),
    ).toEqual([ids.t1, ids.t3].sort());
    expect(
      listRows([], { sale_category: "Accessories" }).map((x) => x.id),
    ).toEqual([ids.t4]);
  });
});

describe("LIRA-389 — a year of a busy shop (SC-004 edge)", () => {
  // 35,000 rows: more than one SQLite statement can bind when getRecent
  // attaches payment legs. Before the summary paged through getRecent this
  // range threw "Query execution failed" (observed in the SC-004 benchmark,
  // 40,000 rows); this guard was written after that fix, so it is NOT
  // proven failing-first itself.
  it("reads a range larger than one statement can bind, page by page", () => {
    const ins = db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, created_at)
       VALUES (1, 'EXPENSE', 'ACTIVE', 'expenses', ?, 1, 1, ?)`,
    );
    db.transaction(() => {
      for (let i = 0; i < 35_000; i++) {
        ins.run(1000 + i, `2026-11-20 0${i % 10}:00:00`);
      }
    })();
    const r = summarize({ group_by: "type" });
    expect(r.truncated).toBe(false);
    // 10 counted fixture rows + 35,000 expenses
    expect(r.total.count).toBe(35_010);
    expect(r.rows.find((x) => x.key === "expenses")).toMatchObject({
      count: 35_001,
      volume_usd: 35_020,
    });
  });
});
