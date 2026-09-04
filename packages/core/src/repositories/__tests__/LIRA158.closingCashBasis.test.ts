/**
 * LIRA-158 Phase 4 — Closing goes settlement-day cash basis (owner decision
 * D10/D14).
 *
 * `ClosingRepository.getDailyStatsSnapshot`'s `finProfit` sub-query
 * (docs/plans/todo_plans/LIRA-158_COMMISSION_REPORTING_PLAN.md §1.3, §3
 * Phase 4) had three independent defects:
 *
 *   1. No `commission_model` gate — summed the stale creation-time ESTIMATE
 *      for an AT_SETTLEMENT (`commission_model = 1`) row forever, even after
 *      settlement recognised the real, operator-ENTERED figure elsewhere.
 *   2. No `is_settled` gate, and bucketed on the TRANSACTION day — the fix
 *      moves recognition to the SETTLEMENT day for model-1 rows only
 *      (cash basis, D10/D14). A legacy (`commission_model = 0`) row is a
 *      per-row CUTOVER (D3) and keeps reading `financial_services.commission`
 *      on its transaction day, completely unchanged.
 *   3. No `is_refunded` gate at all — a voided financial service kept
 *      contributing its commission forever. Independent, pre-existing bug
 *      (bonus fix, §1.3), fixed in the same change since it lives in the
 *      exact query being touched.
 *
 * The fix reuses `ProfitRepository`'s exported rule-14 fragments
 * (`embeddedCommission`, `hasCommissionModelColumn`, `notRefunded`) rather
 * than re-deriving the model/refund predicates, and mirrors
 * `ProfitRepository.getSupplierCommissionTotals`'s exact predicate
 * (`status = 'ACTIVE' AND source_table = 'supplier_ledger' AND type IN
 * ('SUPPLIER_SETTLEMENT', 'REFUND')`) for the new settlement-day source,
 * swapping its arbitrary `dateRange` for this file's own `todayLocal`.
 *
 * Schema-drift trap (plan §5, `reference_test_schema_completeness`):
 * `getDailyStatsSnapshot` prepares a statement per revenue module
 * UNCONDITIONALLY, so a single missing table/column throws and kills EVERY
 * test in the file in SETUP. `ClosingRepository.localBusinessDay.test.ts`'s
 * existing fixture has NEITHER `financial_services.commission_model` NOR a
 * `transactions` table at all — this is the real shape a naive rewrite would
 * have broken, which is why Test 6 below reproduces both absences together
 * and why `ClosingRepository._hasTransactionsTable()` (a `sqlite_master`
 * probe, same shape as `FinancialServiceRepository
 * ._hasSettlementAllocationsTable()`) guards the new settlement-day query
 * exactly the way `_hasCommissionModelColumn()` already guards the model
 * gate.
 *
 * "Today" is exercised dynamically off the DB's own `date('now','localtime')`
 * (mirroring `ClosingRepository.localBusinessDay.test.ts`'s
 * `localTodayAtUtc` helper) rather than a fixed calendar constant, because
 * `todayLocal()` compares against SQLite's live `DATE('now','localtime')` —
 * a fixed date would silently stop matching the day this suite happens to
 * run.
 *
 * Rule 17 — each test's doc comment names the exact line in
 * `ClosingRepository.ts` that must exist for it to pass; deleting that line
 * (or reverting to the pre-fix query) flips the assertion. Verified by
 * inspection against the diff, not by toggling and re-running (harness
 * constraint: "Run nothing" for this task).
 */

import Database from "better-sqlite3";
import { ClosingRepository } from "../ClosingRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

let db: Database.Database;
let repo: ClosingRepository;

/**
 * Post-v161 shape: `financial_services` carries `commission_model` + `cost`
 * + `is_settled`, and a `transactions` table exists for the settlement-day
 * source. Covers every table `getDailyStatsSnapshot` touches, including the
 * ones this fixture never populates (sales/sale_items/debt_ledger/expenses/
 * recharges/custom_services/maintenance) — all unconditionally prepared, so
 * all must exist even with zero rows (plan §5).
 */
function createFullSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      final_amount_usd REAL, paid_usd REAL DEFAULT 0, paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 90000, status TEXT, created_at TEXT
    );
    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, sale_id INTEGER,
      sold_price_usd REAL, cost_price_snapshot_usd REAL, is_refunded INTEGER DEFAULT 0
    );
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      amount_usd REAL, amount_lbp REAL, transaction_type TEXT, created_at TEXT,
      transaction_id INTEGER
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL
    , covered_usd REAL NOT NULL DEFAULT 0, covered_lbp REAL NOT NULL DEFAULT 0);
    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      amount_usd REAL, amount_lbp REAL, expense_date TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL
    , status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      currency TEXT, commission REAL, commission_model INTEGER NOT NULL DEFAULT 0,
      cost REAL DEFAULT 0, is_settled INTEGER DEFAULT 0, created_at TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      currency_code TEXT, price REAL, cost REAL, created_at TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      profit_usd REAL, status TEXT, created_at TEXT
    , is_refunded INTEGER DEFAULT 0);
    CREATE TABLE maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      final_amount_usd REAL, cost_usd REAL, status TEXT, created_at TEXT,
      is_refunded INTEGER DEFAULT 0
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0,
      profit_lbp REAL DEFAULT 0,
      reverses_id INTEGER,
      created_at TEXT
    );
  `);
}

/**
 * Pre-v148 shape — byte-for-byte the fixture
 * `ClosingRepository.localBusinessDay.test.ts` already ships: NO
 * `commission_model` column on `financial_services`, and NO `transactions`
 * table at all. This is the schema-drift case both
 * `_hasCommissionModelColumn()` (via `embeddedCommission`'s "1 = 1"
 * degradation) and `_hasTransactionsTable()` must survive without throwing.
 */
function createLegacySchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      final_amount_usd REAL, paid_usd REAL DEFAULT 0, paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 90000, status TEXT, created_at TEXT
    );
    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, sale_id INTEGER,
      sold_price_usd REAL, cost_price_snapshot_usd REAL, is_refunded INTEGER DEFAULT 0
    );
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      amount_usd REAL, amount_lbp REAL, transaction_type TEXT, created_at TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      amount_usd REAL, amount_lbp REAL, expense_date TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL
    , status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      currency TEXT, commission REAL, created_at TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      currency_code TEXT, price REAL, cost REAL, created_at TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      profit_usd REAL, status TEXT, created_at TEXT
    , is_refunded INTEGER DEFAULT 0);
    CREATE TABLE maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      final_amount_usd REAL, cost_usd REAL, status TEXT, created_at TEXT,
      is_refunded INTEGER DEFAULT 0
    );
  `);
}

/** "Today, local calendar day, at HH:00:00 local time" converted to the UTC
 *  string a real `created_at` column would store — same construction as
 *  `ClosingRepository.localBusinessDay.test.ts`'s `localTodayAtUtc`, so
 *  `todayLocal()`'s `DATE(col,'localtime') = DATE('now','localtime')`
 *  matches regardless of the machine's actual TZ.
 *
 *  `hour` is zero-padded to two digits before being spliced into the SQL
 *  string: SQLite's `datetime(...)` requires a strict `HH:MM:SS` component
 *  and silently returns NULL (not an error) for a single-digit hour like
 *  `'2026-08-31 9:00:00'` — verified directly against better-sqlite3. An
 *  unpadded caller (`todayAtUtc("9")`) previously produced a NULL
 *  `created_at`, which made the row invisible to every date-bucketed query
 *  in the file (caught as LIRA-158's Failure 3: a legacy model-0 row
 *  appeared to contribute 0 instead of its commission — a test-data bug,
 *  not a `ClosingRepository` bug). Padding here closes the trap for every
 *  call site, present and future. */
function todayAtUtc(hour: string): string {
  const hh = hour.padStart(2, "0");
  return (
    db
      .prepare(
        `SELECT datetime(date('now','localtime') || ' ${hh}:00:00', 'utc') AS ts`,
      )
      .get() as { ts: string }
  ).ts;
}

/** Same construction, one local calendar day earlier — used as the
 *  "transaction day" for a row settled today, so settlement-day vs
 *  transaction-day bucketing is unambiguous. Same zero-padding guard as
 *  {@link todayAtUtc}. */
function yesterdayAtUtc(hour: string): string {
  const hh = hour.padStart(2, "0");
  return (
    db
      .prepare(
        `SELECT datetime(date('now','localtime','-1 day') || ' ${hh}:00:00', 'utc') AS ts`,
      )
      .get() as { ts: string }
  ).ts;
}

function insertFs(row: {
  currency?: string;
  commission: number;
  commissionModel?: number;
  isSettled?: number;
  isRefunded?: number;
  createdAt: string;
  withCommissionModelColumn: boolean;
}): void {
  if (row.withCommissionModelColumn) {
    db.prepare(
      `INSERT INTO financial_services
         (tenant_id, currency, commission, commission_model, is_settled, is_refunded, cost, created_at)
       VALUES (1, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(
      row.currency ?? "USD",
      row.commission,
      row.commissionModel ?? 0,
      row.isSettled ?? 0,
      row.isRefunded ?? 0,
      row.createdAt,
    );
  } else {
    db.prepare(
      `INSERT INTO financial_services
         (tenant_id, currency, commission, is_refunded, created_at)
       VALUES (1, ?, ?, ?, ?)`,
    ).run(row.currency ?? "USD", row.commission, row.isRefunded ?? 0, row.createdAt);
  }
}

function insertSettlementTxn(row: {
  type: "SUPPLIER_SETTLEMENT" | "REFUND";
  profitUsd: number;
  createdAt: string;
  status?: string;
}): void {
  db.prepare(
    `INSERT INTO transactions
       (tenant_id, type, status, source_table, source_id, profit_usd, created_at)
     VALUES (1, ?, ?, 'supplier_ledger', 1, ?, ?)`,
  ).run(row.type, row.status ?? "ACTIVE", row.profitUsd, row.createdAt);
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("ClosingRepository.getDailyStatsSnapshot — LIRA-158 settlement-day cash basis", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    createFullSchema(db);
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ClosingRepository();
  });

  it("1. a model-1 row does NOT contribute its estimate on its transaction day", () => {
    // Pre-fix this row alone would surface as 0.50 (the estimate), summed
    // unconditionally with no commission_model gate. Breaks if
    // `embeddedCommission("financial_services", hasCommissionModel)` is
    // dropped from the legacy sub-query's WHERE (ClosingRepository.ts).
    insertFs({
      commission: 0.5,
      commissionModel: 1,
      isSettled: 0,
      createdAt: todayAtUtc("10"),
      withCommissionModelColumn: true,
    });

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalProfitUSD).toBe(0);
  });

  it("2. after settlement, the ENTERED commission contributes on the SETTLEMENT day (not the stale estimate)", () => {
    // Estimate (0.50, stamped at creation) deliberately != entered (2.00,
    // stamped by SupplierRepository at settlement) — a wrong source is
    // unmistakable. The fs row's own created_at is YESTERDAY (transaction
    // day); the SUPPLIER_SETTLEMENT transaction's created_at is TODAY
    // (settlement day) — only the settlement-day figure may appear in
    // today's snapshot. Breaks if the settlement sub-query is removed, or if
    // it buckets on `financial_services.created_at` instead of the
    // transaction row's own `created_at` (ClosingRepository.ts).
    insertFs({
      commission: 0.5,
      commissionModel: 1,
      isSettled: 1,
      createdAt: yesterdayAtUtc("10"),
      withCommissionModelColumn: true,
    });
    insertSettlementTxn({
      type: "SUPPLIER_SETTLEMENT",
      profitUsd: 2.0,
      createdAt: todayAtUtc("11"),
    });

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalProfitUSD).toBe(2.0);
  });

  it("3. a legacy model-0 row still contributes on its transaction day, unchanged (D3 cutover)", () => {
    // Breaks if `embeddedCommission` is inverted or the legacy branch is
    // removed — a per-row cutover means model-0 rows must read EXACTLY as
    // they did before LIRA-158.
    insertFs({
      commission: 1.25,
      commissionModel: 0,
      isSettled: 1,
      createdAt: todayAtUtc("09"),
      withCommissionModelColumn: true,
    });

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalProfitUSD).toBe(1.25);
  });

  it("4. a REFUNDED financial service contributes nothing (new is_refunded gate, independent bonus fix)", () => {
    // Pre-fix `finProfit` carried no is_refunded filter at all (unlike the
    // sibling `salesProfit` query eight lines above, which always gated
    // `si.is_refunded = 0`) — a voided financial service kept inflating the
    // total forever. Breaks if `notRefunded("financial_services")` is
    // removed from the legacy sub-query's WHERE (ClosingRepository.ts).
    insertFs({
      commission: 3.0,
      commissionModel: 0,
      isRefunded: 1,
      createdAt: todayAtUtc("10"),
      withCommissionModelColumn: true,
    });

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalProfitUSD).toBe(0);
  });

  it("5. a voided settlement nets to 0 on the settlement day (rule 20, via the REFUND row)", () => {
    // The REFUND row shares source_table='supplier_ledger' and carries the
    // negated stamp on the SAME day as the original settlement. Breaks if
    // 'REFUND' is dropped from the settlement sub-query's
    // `type IN ('SUPPLIER_SETTLEMENT', 'REFUND')` list (ClosingRepository.ts)
    // — the settlement's +2.00 would then survive uncancelled.
    insertFs({
      commission: 0.5,
      commissionModel: 1,
      isSettled: 1,
      createdAt: yesterdayAtUtc("10"),
      withCommissionModelColumn: true,
    });
    insertSettlementTxn({
      type: "SUPPLIER_SETTLEMENT",
      profitUsd: 2.0,
      createdAt: todayAtUtc("11"),
    });
    insertSettlementTxn({
      type: "REFUND",
      profitUsd: -2.0,
      createdAt: todayAtUtc("12"),
    });

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalProfitUSD).toBe(0);
  });
});

describe("ClosingRepository.getDailyStatsSnapshot — schema-drift guard (pre-v148 fixture)", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    createLegacySchema(db);
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ClosingRepository();
  });

  it("6. a fixture with no commission_model column (and no transactions table) still returns the legacy numbers and throws nothing", () => {
    // Reproduces ClosingRepository.localBusinessDay.test.ts's real fixture
    // shape exactly: no commission_model column AND no transactions table at
    // all. Breaks (throws "no such column: commission_model" or "no such
    // table: transactions", killing every test in the file in SETUP) if
    // either `_hasCommissionModelColumn()`'s "1 = 1" degradation in
    // `embeddedCommission` or `_hasTransactionsTable()`'s guard around the
    // settlement sub-query is removed from ClosingRepository.ts.
    insertFs({
      commission: 4.0,
      createdAt: todayAtUtc("10"),
      withCommissionModelColumn: false,
    });

    expect(() =>
      runWithTenant(1, () => repo.getDailyStatsSnapshot()),
    ).not.toThrow();

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalProfitUSD).toBe(4.0);
  });
});
