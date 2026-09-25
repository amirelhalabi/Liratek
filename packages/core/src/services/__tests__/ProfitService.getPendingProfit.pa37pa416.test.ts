/**
 * OWNER_NOTES_2026-09-21.md §6 — Lane LP, `ProfitService.getPendingProfit`.
 *
 *  - PA-4.16: a DB error used to be caught and swallowed into a normal-
 *    shaped, all-zero SUCCESS payload — on screen this was indistinguishable
 *    from "no pending profit this period". It must now RETHROW so the
 *    caller (IPC handler / REST route) sees a real failure.
 *  - PA-3.7: the return shape now carries `unsettled_totals
 *    .awaiting_settlement_count` (round 2: from `ProfitRepository
 *    .getPendingCommissionTotals`, read-only, LP-3) and `deferred` (from
 *    `ProfitRepository.getDeferredProfit`, read-only — that method is owned
 *    by lane LO and is NOT edited here).
 *  - LP-1/LP-2 (round 2): a for-partner sale — at ANY partner coverage level
 *    — no longer contributes to `rows`/`totals.count`/
 *    `totals.total_outstanding_usd` at all (round-1 only zeroed its
 *    `potential_profit_usd`, leaving a phantom row `getDeferredProfit`
 *    already double-counted).
 *  - LP-5 (round 2): `unsettled_totals.total_pending_commission_usd` is an
 *    EXACT `currency === "USD"` match, so a third currency (e.g. Binance
 *    USDT) contributes to neither the USD nor the LBP total instead of being
 *    silently absorbed into USD.
 *
 * RED proof (rule 17), actually run (2026-09-23): with `getPendingProfit`'s
 * `catch` block temporarily reverted to `return` the old all-zero shape
 * instead of `throw error`, `npx jest
 * ProfitService.getPendingProfit.pa37pa416 --maxWorkers=1` reported "Tests:
 * 1 failed, 4 passed" — the rethrow test failed with "Received function did
 * not throw" while the 4 other (unaffected) cases still passed. The revert
 * was undone and the same command reported "Tests: 5 passed, 5 total".
 *
 * Round-2 RED proofs, actually run (2026-09-23):
 *  - LP-1/LP-2: with `ProfitRepository.getPendingSaleProfit`'s
 *    `AND NOT ${saleHasPartnerObligation("s")}` clause temporarily removed,
 *    `npx jest ProfitService.getPendingProfit.pa37pa416 --maxWorkers=1 -t
 *    "LP-1"` failed with "Expected length: 1, Received length: 2" — the
 *    fully-covered 2025 partner sale (id 2) came back in `rows` alongside
 *    the ordinary sale (id 1). Clause restored, same command: 1 passed.
 *  - LP-5: with the `.filter((r) => r.currency === "USD")` temporarily
 *    reverted to `.filter((r) => r.currency !== "LBP")`, `npx jest
 *    ProfitService.getPendingProfit.pa37pa416 --maxWorkers=1 -t "LP-5"`
 *    failed with "Expected: 3, Received: 10" (the $7 USDT row got lumped
 *    into the $3 USD row). Filter restored, same command: 1 passed.
 *  - Full file, both reverts undone: "Tests: 7 passed, 7 total".
 */

import Database from "better-sqlite3";
import { ProfitService, resetProfitService } from "../ProfitService.js";
import { resetProfitRepository } from "../../repositories/ProfitRepository.js";

const D = "2026-09-23 10:00:00";
const FROM = "2026-09-01";
const TO = "2026-09-30";

interface TestDb extends Database.Database {}

let db: TestDb;
let service: ProfitService;

function createSchema(d: TestDb): void {
  d.exec(`
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, status TEXT,
      final_amount_usd REAL DEFAULT 0, discount_usd REAL DEFAULT 0,
      paid_usd REAL DEFAULT 0, paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 90000, created_at TEXT
    );
    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, sale_id INTEGER,
      product_id INTEGER, sold_price_usd REAL DEFAULT 0, cost_price_snapshot_usd REAL DEFAULT 0,
      quantity INTEGER DEFAULT 1, is_refunded INTEGER DEFAULT 0
    );
    CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, name TEXT);
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE', source_table TEXT NOT NULL, source_id INTEGER NOT NULL,
      client_id INTEGER, client_name TEXT, client_phone TEXT,
      profit_usd REAL DEFAULT 0, profit_lbp REAL DEFAULT 0, created_at TEXT
    );
    CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, full_name TEXT, phone_number TEXT);
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, partner_id INTEGER NOT NULL,
      transaction_type TEXT, reference_table TEXT, reference_id INTEGER, amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD', direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      covered_amount REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL, amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0,
      transaction_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, is_refunded INTEGER DEFAULT 0,
      covered_usd REAL NOT NULL DEFAULT 0, covered_lbp REAL NOT NULL DEFAULT 0, refunded_at TEXT DEFAULT NULL
    );
    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, provider TEXT,
      omt_service_type TEXT, amount REAL DEFAULT 0, currency TEXT DEFAULT 'USD', commission REAL DEFAULT 0,
      commission_model INTEGER NOT NULL DEFAULT 0, omt_fee REAL, is_settled INTEGER DEFAULT 0,
      is_refunded INTEGER DEFAULT 0, created_at TEXT, refunded_at TEXT DEFAULT NULL
    );
  `);
}

beforeEach(() => {
  db = new Database(":memory:") as TestDb;
  createSchema(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  resetProfitService();
  resetProfitRepository();
  service = new ProfitService();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("ProfitService.getPendingProfit — PA-4.16 (rethrow) / PA-3.7 (wiring)", () => {
  it("PA-4.16: rethrows on a repository error instead of returning a fake all-zero success payload", () => {
    // Force the underlying query to fail: drop a table getPendingSaleProfit
    // depends on.
    db.exec(`DROP TABLE sales;`);

    expect(() => service.getPendingProfit(FROM, TO)).toThrow();
  });

  it("PA-3.7: unsettled_totals.awaiting_settlement_count surfaces a model-1 row with zero legacy rows present", () => {
    db.prepare(
      `INSERT INTO financial_services (tenant_id, provider, currency, commission, commission_model, is_settled, is_refunded, created_at)
       VALUES (1, 'OMT', 'USD', 0, 1, 0, 0, ?)`,
    ).run(D);

    const result = service.getPendingProfit(FROM, TO);

    expect(result.unsettled_commissions).toHaveLength(0);
    expect(result.unsettled_totals.awaiting_settlement_count).toBe(1);
  });

  it("PA-3.7: deferred is present and reflects an uncovered partner-pending transaction", () => {
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', 1, 20, 0, ?)`,
    ).run(D);
    db.prepare(
      `INSERT INTO partner_ledger (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, covered_amount)
       VALUES (1, 1, 'FOR_SUPPLIER', 'financial_services', 1, 20, 'USD', 'CREDIT', 5)`,
    ).run();

    const result = service.getPendingProfit(FROM, TO);

    // 25% covered (5/20) -> 75% of the $20 stamp (=15) is still deferred.
    expect(result.deferred.partner_profit_usd).toBeCloseTo(15, 2);
  });

  it("returns the ordinary zero-activity shape without throwing when nothing is pending", () => {
    const result = service.getPendingProfit(FROM, TO);

    expect(result.rows).toEqual([]);
    expect(result.totals.count).toBe(0);
    expect(result.unsettled_commissions).toEqual([]);
    expect(result.unsettled_totals.awaiting_settlement_count).toBe(0);
    expect(result.deferred.partner_profit_usd).toBe(0);
    expect(result.deferred.client_debt_profit_usd).toBe(0);
  });

  it("PA-3.8 wiring: an unpaid sale outside the requested from/to still comes back through the service", () => {
    db.prepare(
      `INSERT INTO sales (id, tenant_id, status, final_amount_usd, paid_usd, created_at)
       VALUES (1, 1, 'completed', 40, 0, '2026-01-01 09:00:00')`,
    ).run();
    db.prepare(
      `INSERT INTO sale_items (tenant_id, sale_id, sold_price_usd, cost_price_snapshot_usd, quantity, is_refunded)
       VALUES (1, 1, 40, 25, 1, 0)`,
    ).run();

    const result = service.getPendingProfit(FROM, TO);

    expect(result.rows).toHaveLength(1);
    expect(result.totals.total_pending_profit_usd).toBeCloseTo(15, 2);
  });

  it("LP-1/LP-2 (round 2): a fully-covered for-partner sale from 2025 contributes NOTHING to rows/count/total_outstanding_usd — reproduces the adversarial probe (was count:2, total_outstanding_usd:650; must now be count:1, total_outstanding_usd:150)", () => {
    // An ordinary unpaid sale (id 1) plus a fully-covered for-partner sale
    // from 2025 (id 2, outside FROM/TO, matching PA-3.8's own
    // date-independence). Pre-round-2: the partner sale stayed in the list
    // at outstanding_usd 500 forever (weighting only zeroed its profit, not
    // its presence) — count 2, total_outstanding_usd 650. Post-fix: the
    // partner sale is excluded outright.
    db.prepare(
      `INSERT INTO sales (id, tenant_id, status, final_amount_usd, paid_usd, created_at)
       VALUES (1, 1, 'completed', 150, 0, ?)`,
    ).run(D);
    db.prepare(
      `INSERT INTO sale_items (tenant_id, sale_id, sold_price_usd, cost_price_snapshot_usd, quantity, is_refunded)
       VALUES (1, 1, 150, 100, 1, 0)`,
    ).run();

    db.prepare(
      `INSERT INTO sales (id, tenant_id, status, final_amount_usd, paid_usd, created_at)
       VALUES (2, 1, 'completed', 500, 0, '2025-06-01 12:00:00')`,
    ).run();
    db.prepare(
      `INSERT INTO sale_items (tenant_id, sale_id, sold_price_usd, cost_price_snapshot_usd, quantity, is_refunded)
       VALUES (1, 2, 500, 300, 1, 0)`,
    ).run();
    db.prepare(
      `INSERT INTO partner_ledger (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, covered_amount)
       VALUES (1, 1, 'FOR_SUPPLIER', 'sales', 2, 500, 'USD', 'CREDIT', 500)`,
    ).run();

    const result = service.getPendingProfit(FROM, TO);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].sale_id).toBe(1);
    expect(result.totals.count).toBe(1);
    expect(result.totals.total_outstanding_usd).toBeCloseTo(150, 2);
    expect(result.totals.total_pending_profit_usd).toBeCloseTo(50, 2);
  });

  it("LP-5: an unsettled commission in a THIRD currency (e.g. USDT) contributes to neither total_pending_commission_usd nor _lbp", () => {
    db.prepare(
      `INSERT INTO financial_services (tenant_id, provider, currency, commission, commission_model, is_settled, is_refunded, created_at)
       VALUES (1, 'BINANCE', 'USDT', 7, 0, 0, 0, ?)`,
    ).run(D);
    db.prepare(
      `INSERT INTO financial_services (tenant_id, provider, currency, commission, commission_model, is_settled, is_refunded, created_at)
       VALUES (1, 'WHISH', 'USD', 3, 0, 0, 0, ?)`,
    ).run(D);

    const result = service.getPendingProfit(FROM, TO);

    expect(result.unsettled_totals.total_pending_commission_usd).toBeCloseTo(
      3,
      2,
    );
    expect(result.unsettled_totals.total_pending_commission_lbp).toBe(0);
    // The USDT row is still visible in the raw row list (nothing hides the
    // row itself) — only the currency TOTALS must not silently absorb it.
    expect(result.unsettled_commissions).toHaveLength(2);
  });
});
