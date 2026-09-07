/**
 * LIRA-176 phase 8a — ClosingRepository.getDailyStatsSnapshot must not
 * overstate maintenance profit once a job carries parts.
 *
 * `maintProfit`'s formula is `final_amount_usd - maintenanceCostUsd("maintenance")`
 * (ProfitRepository.ts's shared fragment: `(alias.cost_usd + alias.parts_cost_usd)`).
 * `final_amount_usd` already includes the parts PRICE (MaintenanceService.saveJob
 * folds it in before writing the job row) — if the daily closing query summed
 * bare `cost_usd` instead of the shared fragment, it would still subtract only
 * the LABOUR cost, silently inflating today's closing profit by the parts
 * margin's cost component every time a job has parts.
 *
 * Schema is the "legacy" (no `transactions` table, no `commission_model`
 * column) shape from ClosingRepository.moduleProfitGates.test.ts, covering
 * every table `getDailyStatsSnapshot` unconditionally prepares — copied here
 * (not imported; each closing-repo test file owns its own fixture per this
 * package's convention) with `insertMaintenance`'s INSERT column list fixed
 * (that helper in the sibling file has a pre-existing, unrelated copy-paste
 * defect — DDL text pasted into an INSERT column list — that makes every test
 * calling it die in SETUP; not touched here, out of this ticket's scope).
 *
 * Rule 17 — the single test below is failing-first; see its doc comment for
 * the exact one-line bug reintroduced and the observed failure.
 */

import Database from "better-sqlite3";
import { ClosingRepository } from "../ClosingRepository";
import { runWithTenant } from "../../db/tenantContext";

let db: Database.Database;
let repo: ClosingRepository;

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
      final_amount_usd REAL, cost_usd REAL, status TEXT, created_at TEXT,
      is_refunded INTEGER DEFAULT 0,
      parts_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      parts_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0
    );

    CREATE TABLE maintenance_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      stock_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );


    CREATE TABLE maintenance_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      maintenance_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

  `);
}

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
  partsCostUsd: number;
  createdAt: string;
}): void {
  db.prepare(
    `INSERT INTO maintenance
       (tenant_id, final_amount_usd, cost_usd, parts_cost_usd, status, created_at)
     VALUES (1, ?, ?, ?, ?, ?)`,
  ).run(row.finalAmountUsd, row.costUsd, row.partsCostUsd, row.status, row.createdAt);
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("ClosingRepository.getDailyStatsSnapshot — maintenance parts profit (LIRA-176 phase 8a)", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ClosingRepository();
  });

  it("a delivered job with parts contributes labour margin PLUS parts margin — not labour margin plus the full parts price", () => {
    // Labour: final 50 (this job has no discount, so cost_usd here is
    // labour-only, as production code always writes it), cost 20 -> margin 30.
    // Parts: price 9 folded into final_amount_usd by MaintenanceService
    // (final_amount_usd = 50 + 9 = 59), cost 4 -> margin 5.
    // Correct total profit: 30 + 5 = 35, NOT 59 - 20 = 39 (the pre-fix bug,
    // which forgot to subtract the parts cost at all).
    insertMaintenance({
      status: "Delivered",
      finalAmountUsd: 59,
      costUsd: 20,
      partsCostUsd: 4,
      createdAt: todayAtUtc("10"),
    });

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalProfitUSD).toBe(35);
  });

  it("a no-parts job (parts_cost_usd=0) is unaffected — anti-regression for the shared-fragment fix", () => {
    insertMaintenance({
      status: "Delivered_Paid",
      finalAmountUsd: 40,
      costUsd: 28,
      partsCostUsd: 0,
      createdAt: todayAtUtc("11"),
    });

    const snap = runWithTenant(1, () => repo.getDailyStatsSnapshot());
    expect(snap.totalProfitUSD).toBe(12);
  });
});
