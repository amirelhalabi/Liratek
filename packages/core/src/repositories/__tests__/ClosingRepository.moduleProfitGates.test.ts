/**
 * Three independent, pre-existing bugs in `ClosingRepository
 * .getDailyStatsSnapshot`, found during the LIRA-158 guard extension
 * (`profitRecognition.guard.test.ts`'s `EXCLUDED_UNITS` entries for
 * `rechargeProfit`/`customProfit`/`maintProfit`) but fixed independently of
 * that ticket:
 *
 *   1. `maintProfit` gated on `LOWER(status) = 'completed'` — the maintenance
 *      workflow has NO "completed" status (its real states are
 *      Received/In_Progress/Ready/Delivered/Delivered_Paid, per
 *      `create_db.sql`'s `status TEXT DEFAULT 'Received'`), so this predicate
 *      matched ZERO rows, ever. Maintenance profit was unconditionally $0 in
 *      every daily closing snapshot. Fixed by reusing the SAME canonical
 *      definition `ProfitRepository` already uses for its own Profits-page
 *      maintenance queries — generalised from a private `m.`-hardcoded
 *      constant into an exported `maintenanceCompleted(alias)` function
 *      (mirroring `notRefunded(alias)` in the same file) so both files share
 *      ONE definition (rule 14) instead of a second copy that silently
 *      drifted out of sync with the first.
 *   2. `rechargeProfit` carried NO `is_refunded` filter — a same-day
 *      voided/refunded recharge kept contributing its (price - cost) margin
 *      forever. Fixed by reusing the same `notRefunded(alias)` fragment
 *      already imported into this file (from `ProfitRepository.ts`) and
 *      already used by `finProfitLegacy`/`finProfitSettlement` a few lines
 *      above — no new predicate invented.
 *   3. `customProfit` carried the same NO-`is_refunded`-filter bug as
 *      `rechargeProfit`. Same fix, same reused fragment. `status =
 *      'completed'` is untouched (custom_services DOES have a real
 *      'completed' state, unlike maintenance).
 *
 * After this fix all five module profit sources this method sums
 * (sales/financial-service/recharge/custom-service/maintenance) carry a
 * refund gate — `salesProfit` already had `si.is_refunded = 0`, LIRA-158
 * added `notRefunded` to `finProfitLegacy`, and this change adds it to the
 * remaining two (plus fixes maintenance's status predicate so it can
 * contribute at all). That parity is the point of this file, not a
 * coincidence.
 *
 * Schema-drift trap (see `LIRA158.closingCashBasis.test.ts`'s header and
 * `reference_test_schema_completeness`): `getDailyStatsSnapshot` prepares a
 * statement per revenue module UNCONDITIONALLY, so a fixture missing any one
 * of sales/sale_items/debt_ledger/expenses/financial_services/recharges/
 * custom_services/maintenance throws in SETUP and kills every test in the
 * file, reading like a broken assertion rather than a schema gap. This
 * fixture is the "legacy" shape (no `commission_model` column on
 * `financial_services`, no `transactions` table) — proven safe by
 * `LIRA158.closingCashBasis.test.ts`'s own "schema-drift guard" describe
 * block — since none of these three bugs touch the settlement-day
 * commission path.
 *
 * Rule 17 — each test's doc comment records the ACTUAL observed
 * expected-vs-received values from reverting the specific fixed predicate
 * back to its pre-fix form, running this file, and restoring it. Every
 * revert/run/restore cycle in this file's commit was performed for real
 * (`ClosingRepository.ts` was temporarily edited back to the buggy
 * predicate, `npx jest ClosingRepository.moduleProfitGates -t "<name>"` was
 * run, the failure observed, then the fix was restored) — not asserted from
 * reading the diff.
 */

import Database from "better-sqlite3";
import { ClosingRepository } from "../ClosingRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

let db: Database.Database;
let repo: ClosingRepository;

/**
 * Legacy-shape fixture (no `commission_model` column, no `transactions`
 * table) — covers every table `getDailyStatsSnapshot` unconditionally
 * prepares. `recharges` and `custom_services` carry `is_refunded` (the real
 * `create_db.sql` column both fixed queries now gate on); `maintenance`
 * carries the real `status` values the fixed `maintenanceCompleted` predicate
 * checks against.
 */
function createSchema(d: Database.Database): void {
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
      currency_code TEXT, price REAL, cost REAL, created_at TEXT,
      is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL
    );
    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      profit_usd REAL, status TEXT, created_at TEXT,
      is_refunded INTEGER DEFAULT 0
    );
    CREATE TABLE maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      final_amount_usd REAL, cost_usd REAL, status TEXT, created_at TEXT
    );
  `);
}

/** "Today, local calendar day, at HH:00:00 local time" as the UTC string a
 *  real `created_at` column would store — same construction used across the
 *  sibling `LIRA158.closingCashBasis.test.ts` / `ClosingRepository
 *  .localBusinessDay.test.ts` fixtures, so `todayLocal()`'s
 *  `DATE(col,'localtime') = DATE('now','localtime')` matches regardless of
 *  the machine's actual TZ. Hour is zero-padded — an unpadded single digit
 *  makes SQLite's `datetime(...)` silently return NULL. */
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

function insertMaintenance(row: {
  status: string;
  finalAmountUsd: number;
  costUsd: number;
  createdAt: string;
}): void {
  db.prepare(
    `INSERT INTO maintenance (tenant_id, final_amount_usd, cost_usd, status, created_at)
     VALUES (1, ?, ?, ?, ?)`,
  ).run(row.finalAmountUsd, row.costUsd, row.status, row.createdAt);
}

function insertRecharge(row: {
  price: number;
  cost: number;
  isRefunded?: number;
  createdAt: string;
  currencyCode?: string;
}): void {
  db.prepare(
    `INSERT INTO recharges (tenant_id, currency_code, price, cost, is_refunded, created_at)
     VALUES (1, ?, ?, ?, ?, ?)`,
  ).run(
    row.currencyCode ?? "USD",
    row.price,
    row.cost,
    row.isRefunded ?? 0,
    row.createdAt,
  );
}

function insertCustomService(row: {
  profitUsd: number;
  status: string;
  isRefunded?: number;
  createdAt: string;
}): void {
  db.prepare(
    `INSERT INTO custom_services (tenant_id, profit_usd, status, is_refunded, created_at)
     VALUES (1, ?, ?, ?, ?)`,
  ).run(row.profitUsd, row.status, row.isRefunded ?? 0, row.createdAt);
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("ClosingRepository.getDailyStatsSnapshot — module profit gates (maintenance status, recharge/custom-service refund)", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ClosingRepository();
  });

  describe("BUG 1 — maintenance profit (status predicate)", () => {
    it("1. a 'Delivered' maintenance job contributes its profit to totalProfitUSD", () => {
      // Pre-fix (`LOWER(status) = 'completed'`) this was $0 — 'delivered' !=
      // 'completed'. OBSERVED reverting the fix (see file header): with the
      // predicate restored to `LOWER(status) = 'completed'`, this exact test
      // failed with `expect(received).toBe(expected) // Expected: 30,
      // Received: 0` — proving the pre-fix code really did read $0.
      insertMaintenance({
        status: "Delivered",
        finalAmountUsd: 50,
        costUsd: 20,
        createdAt: todayAtUtc("10"),
      });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(30);
    });

    it("2. a 'Delivered_Paid' maintenance job also contributes", () => {
      // Same predicate, second member of the IN (...) list. OBSERVED
      // reverting the fix: failed with Expected: 12, Received: 0.
      insertMaintenance({
        status: "Delivered_Paid",
        finalAmountUsd: 40,
        costUsd: 28,
        createdAt: todayAtUtc("11"),
      });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(12);
    });

    it("3. a 'Received' (not yet completed) job contributes nothing", () => {
      // Passes both before AND after the fix — included to prove the fix
      // doesn't over-correct into counting EVERY maintenance row regardless
      // of status (it would be a different, worse bug if a Received job's
      // profit leaked into today's total before the device is even
      // delivered).
      insertMaintenance({
        status: "Received",
        finalAmountUsd: 999,
        costUsd: 1,
        createdAt: todayAtUtc("09"),
      });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(0);
    });
  });

  describe("BUG 2 — recharge profit (refund gate)", () => {
    it("4. a refunded recharge contributes nothing; a live one still does", () => {
      // Pre-fix (no is_refunded filter at all) the refunded row's margin
      // (5 - 2 = 3) was summed right alongside the live row's (10 - 4 = 6),
      // for a combined 9. OBSERVED reverting the fix (dropping
      // `AND notRefunded("recharges")`): this test failed with
      // `Expected: 6, Received: 9` — proving the refunded row really did
      // contribute before the gate was added.
      insertRecharge({
        price: 5,
        cost: 2,
        isRefunded: 1,
        createdAt: todayAtUtc("10"),
      });
      insertRecharge({
        price: 10,
        cost: 4,
        isRefunded: 0,
        createdAt: todayAtUtc("11"),
      });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(6);
    });
  });

  describe("BUG 3 — custom-service profit (refund gate)", () => {
    it("5. a refunded custom service contributes nothing; a live completed one still does", () => {
      // Pre-fix (no is_refunded filter) the refunded row's profit_usd (8)
      // summed alongside the live row's (15), for a combined 23. OBSERVED
      // reverting the fix (dropping `AND notRefunded("custom_services")`):
      // this test failed with `Expected: 15, Received: 23` — proving the
      // refunded row really did contribute before the gate was added.
      insertCustomService({
        profitUsd: 8,
        status: "completed",
        isRefunded: 1,
        createdAt: todayAtUtc("10"),
      });
      insertCustomService({
        profitUsd: 15,
        status: "completed",
        isRefunded: 0,
        createdAt: todayAtUtc("11"),
      });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(15);
    });

    it("6. a non-completed (pending) custom service still contributes nothing, unaffected by the refund-gate change", () => {
      // Pre-existing `status = 'completed'` predicate, untouched by this
      // fix — included so the refund-gate addition is proven NOT to have
      // loosened the pre-existing status gate as a side effect.
      insertCustomService({
        profitUsd: 999,
        status: "pending",
        isRefunded: 0,
        createdAt: todayAtUtc("09"),
      });

      const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
      expect(snap.totalProfitUSD).toBe(0);
    });
  });
});
