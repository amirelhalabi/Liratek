/**
 * ProfitRepository — proportional partner recognition for `getByUser`,
 * `getByClient`, and `getDeferredProfit` (PARTNER_PROPORTIONAL_RECOGNITION.md
 * Step 2, 2026-09-05).
 *
 * Before this change all three methods gated on `txnNotPartnerPending` (or,
 * for `getByUser`/`getByClient`, the combined `NOT (txnNotPartnerPending(t)
 * AND notDebtPending(t.id))` guard): a for-partner row contributed either
 * its FULL money (fully covered) or ZERO (any coverage shortfall at all).
 * After this change, `getByUser`/`getByClient` weight every otherwise-
 * ungated monetary column by `txnPartnerCoverageRatio(t)` (client debt stays
 * binary, unconverted — DBT-1 is out of scope), and `getDeferredProfit`'s
 * `partnerRow` reports the UNCOVERED remainder `profit * (1 - ratio)` instead
 * of the full stamp for any not-fully-covered row.
 *
 * Fixtures deliberately use 0% / 50% / 100% coverage — NOT the two extremes
 * alone — because at 0%/100% the old binary gate and the new continuous
 * ratio produce IDENTICAL numbers (that is the whole point of the
 * conversion: reproduce the old behaviour exactly at the extremes). Only the
 * 50% case can tell a correctly-converted query apart from one that is still
 * secretly binary underneath, which is why rule 17's failing-first proof
 * (see the bottom of this file) reverts to the OLD gated query and expects
 * the 50% assertions specifically to fail while the 0%/100% ones keep
 * passing.
 *
 * Two transaction shapes are covered per method, matching the two branches
 * inside getByUser/getByClient's CASE that have NO partner-awareness of
 * their own (and so needed a direct `* txnPartnerCoverageRatio(t)`
 * multiplication in this conversion) — the SALE and SUPPLIER_SETTLEMENT
 * branches are deliberately NOT exercised here since those carry their OWN
 * ratio internally via `saleRecognitionWeight`/`supplierSettlementProfitArm`
 * (a separate conversion — PARTNER_PROPORTIONAL_RECOGNITION.md Lane A/Task 3,
 * covered by `ProfitRepository.saleRecognitionWeight.test.ts` instead — not
 * this file's concern):
 *   (a) the generic ELSE branch — a RECHARGE transaction, and
 *   (b) the inline `financial_services` is_settled branch — a
 *       FINANCIAL_SERVICE transaction.
 *
 * Schema is the LEGACY (pre-v150) shape — NO `settlement_commission_allocations`
 * table — copied from
 * `ProfitRepository.cashlessSettlementDefersOnDebt.test.ts`'s own
 * `createLegacySchema`, so `_hasSettlementAllocationsTable()` is false and
 * `supplierSettlementProfitArm` degrades to `""` (contributes nothing) —
 * this file's assertions never depend on Lane A's in-flight conversion of
 * that helper.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const D = "2026-09-05 10:00:00";
const FROM = "2026-09-05 00:00:00";
const TO = "2026-09-05 23:59:59";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL, source_id INTEGER NOT NULL, user_id INTEGER, amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0, profit_lbp REAL DEFAULT 0, client_id INTEGER, client_name TEXT, client_phone TEXT,
      reverses_id INTEGER, created_at TEXT
    );
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, username TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, full_name TEXT, phone_number TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0, id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER,
      provider TEXT, omt_service_type TEXT, amount REAL DEFAULT 0, currency TEXT DEFAULT 'USD', commission REAL DEFAULT 0,
      omt_fee REAL, cost REAL DEFAULT 0, price REAL DEFAULT 0, is_settled INTEGER DEFAULT 0, is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0, created_at TEXT, refunded_at TEXT DEFAULT NULL
    );
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, partner_id INTEGER NOT NULL, transaction_type TEXT,
      reference_table TEXT, reference_id INTEGER, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')), covered_amount REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 1, client_id INTEGER NOT NULL, transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0, transaction_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0, covered_usd REAL NOT NULL DEFAULT 0, covered_lbp REAL NOT NULL DEFAULT 0, refunded_at TEXT DEFAULT NULL
    );
    CREATE TABLE sales (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT, final_amount_usd REAL DEFAULT 0, paid_usd REAL DEFAULT 0, paid_lbp REAL DEFAULT 0, exchange_rate_snapshot REAL DEFAULT 90000, created_at TEXT);
    CREATE TABLE sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, sale_id INTEGER, sold_price_usd REAL DEFAULT 0, cost_price_snapshot_usd REAL DEFAULT 0, quantity INTEGER DEFAULT 1, is_refunded INTEGER DEFAULT 0);
    CREATE TABLE recharges (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, carrier TEXT, currency_code TEXT DEFAULT 'USD', price REAL DEFAULT 0, cost REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE custom_services (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT, price_usd REAL DEFAULT 0, price_lbp REAL DEFAULT 0, cost_usd REAL DEFAULT 0, cost_lbp REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE maintenance (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT, final_amount_usd REAL DEFAULT 0, final_amount_lbp REAL DEFAULT 0, cost_usd REAL DEFAULT 0, cost_lbp REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE loto_tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, sale_amount REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, status TEXT DEFAULT 'active', amount_usd REAL DEFAULT 0, amount_lbp REAL DEFAULT 0, expense_date TEXT, is_refunded INTEGER DEFAULT 0);
    CREATE TABLE exchange_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, amount_in REAL DEFAULT 0, leg1_profit_usd REAL DEFAULT 0, leg2_profit_usd REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0, created_at TEXT);
  `);
  db.prepare(`INSERT INTO users (id, tenant_id, username) VALUES (1, 1, 'cashier1')`).run();
}

/** Seeds a RECHARGE-type transaction (ELSE branch) with an optional partner_ledger coverage row. */
function seedRechargeTxn(
  db: Database.Database,
  opts: { amountUsd: number; profitUsd: number; coveredAmount?: number },
): number {
  const rechargeId = Number(
    db
      .prepare(
        `INSERT INTO recharges (tenant_id, carrier, price, cost, created_at) VALUES (1, 'Alfa', ?, 0, ?)`,
      )
      .run(opts.amountUsd, D).lastInsertRowid,
  );
  const txnId = Number(
    db
      .prepare(
        `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'RECHARGE', 'recharges', ?, 1, ?, 0, ?, 0, NULL, ?)`,
      )
      .run(rechargeId, opts.amountUsd, opts.profitUsd, D).lastInsertRowid,
  );
  if (opts.coveredAmount !== undefined) {
    db.prepare(
      `INSERT INTO partner_ledger (partner_id, transaction_type, reference_table, reference_id, amount, direction, covered_amount)
       VALUES (1, 'FOR_PARTNER', 'recharges', ?, ?, 'DEBIT', ?)`,
    ).run(rechargeId, opts.amountUsd, opts.coveredAmount);
  }
  return txnId;
}

/** Seeds a settled FINANCIAL_SERVICE transaction (inline is_settled branch) with optional partner coverage. */
function seedFsTxn(
  db: Database.Database,
  opts: { amount: number; profitUsd: number; coveredAmount?: number },
): number {
  const fsId = Number(
    db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, amount, cost, price, is_settled, created_at) VALUES (1, 'OMT', ?, 0, 0, 1, ?)`,
      )
      .run(opts.amount, D).lastInsertRowid,
  );
  const txnId = Number(
    db
      .prepare(
        `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
         VALUES (1, 'FINANCIAL_SERVICE', 'financial_services', ?, 1, ?, 0, ?, 0, NULL, ?)`,
      )
      .run(fsId, opts.amount, opts.profitUsd, D).lastInsertRowid,
  );
  if (opts.coveredAmount !== undefined) {
    db.prepare(
      `INSERT INTO partner_ledger (partner_id, transaction_type, reference_table, reference_id, amount, direction, covered_amount)
       VALUES (1, 'FOR_PARTNER', 'financial_services', ?, ?, 'DEBIT', ?)`,
    ).run(fsId, opts.amount, opts.coveredAmount);
  }
  return txnId;
}

describe("ProfitRepository — partner-proportional recognition (getByUser/getByClient/getDeferredProfit)", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  describe("getByUser — ELSE branch (RECHARGE)", () => {
    it("0% coverage -> 0 revenue/profit, but the row is still counted (unweighted count)", () => {
      seedRechargeTxn(db, { amountUsd: 100, profitUsd: 20, coveredAmount: 0 });
      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      expect(rows).toHaveLength(1);
      expect(rows[0].revenue_usd).toBeCloseTo(0, 5);
      expect(rows[0].profit_usd).toBeCloseTo(0, 5);
      expect(rows[0].transaction_count).toBe(1);
    });

    it("50% coverage -> exactly half revenue/profit recognised", () => {
      seedRechargeTxn(db, { amountUsd: 100, profitUsd: 20, coveredAmount: 50 });
      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      expect(rows[0].revenue_usd).toBeCloseTo(50, 5);
      expect(rows[0].profit_usd).toBeCloseTo(10, 5);
      expect(rows[0].transaction_count).toBe(1);
    });

    it("100% coverage -> full revenue/profit recognised", () => {
      seedRechargeTxn(db, { amountUsd: 100, profitUsd: 20, coveredAmount: 100 });
      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      expect(rows[0].revenue_usd).toBeCloseTo(100, 5);
      expect(rows[0].profit_usd).toBeCloseTo(20, 5);
    });

    it("non-partner row -> unaffected (ratio defaults to 1.0)", () => {
      seedRechargeTxn(db, { amountUsd: 100, profitUsd: 20 }); // no partner_ledger row at all
      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      expect(rows[0].revenue_usd).toBeCloseTo(100, 5);
      expect(rows[0].profit_usd).toBeCloseTo(20, 5);
    });
  });

  describe("getByUser — inline financial_services branch (FINANCIAL_SERVICE, is_settled)", () => {
    it("50% coverage -> half of fsRevenue/profit recognised", () => {
      seedFsTxn(db, { amount: 80, profitUsd: 8, coveredAmount: 40 });
      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      expect(rows[0].revenue_usd).toBeCloseTo(40, 5); // fsRevenue = amount (cost=0) * 0.5
      expect(rows[0].profit_usd).toBeCloseTo(4, 5);
    });

    it("0% coverage -> 0", () => {
      seedFsTxn(db, { amount: 80, profitUsd: 8, coveredAmount: 0 });
      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      expect(rows[0].revenue_usd).toBeCloseTo(0, 5);
      expect(rows[0].profit_usd).toBeCloseTo(0, 5);
    });

    it("100% coverage -> full amount", () => {
      seedFsTxn(db, { amount: 80, profitUsd: 8, coveredAmount: 80 });
      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      expect(rows[0].revenue_usd).toBeCloseTo(80, 5);
      expect(rows[0].profit_usd).toBeCloseTo(8, 5);
    });
  });

  describe("getByClient — ELSE branch (RECHARGE), mirrors getByUser", () => {
    it("50% coverage -> exactly half revenue/profit recognised", () => {
      seedRechargeTxn(db, { amountUsd: 100, profitUsd: 20, coveredAmount: 50 });
      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      expect(rows).toHaveLength(1);
      expect(rows[0].revenue_usd).toBeCloseTo(50, 5);
      expect(rows[0].profit_usd).toBeCloseTo(10, 5);
      expect(rows[0].transaction_count).toBe(1);
    });

    it("0% and 100% reproduce the old binary extremes", () => {
      const t0 = seedRechargeTxn(db, { amountUsd: 100, profitUsd: 20, coveredAmount: 0 });
      void t0;
      let rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      expect(rows[0].revenue_usd).toBeCloseTo(0, 5);

      db.prepare(`DELETE FROM transactions`).run();
      db.prepare(`DELETE FROM partner_ledger`).run();
      db.prepare(`DELETE FROM recharges`).run();
      seedRechargeTxn(db, { amountUsd: 100, profitUsd: 20, coveredAmount: 100 });
      rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      expect(rows[0].revenue_usd).toBeCloseTo(100, 5);
    });
  });

  describe("getDeferredProfit — partnerRow reports the UNCOVERED remainder", () => {
    it("0% coverage -> full profit deferred", () => {
      seedRechargeTxn(db, { amountUsd: 100, profitUsd: 20, coveredAmount: 0 });
      const row = runWithTenant(1, () => repo.getDeferredProfit(FROM, TO));
      expect(row.partner_profit_usd).toBeCloseTo(20, 5);
    });

    it("50% coverage -> exactly half of the profit is still deferred", () => {
      seedRechargeTxn(db, { amountUsd: 100, profitUsd: 20, coveredAmount: 50 });
      const row = runWithTenant(1, () => repo.getDeferredProfit(FROM, TO));
      expect(row.partner_profit_usd).toBeCloseTo(10, 5);
    });

    it("100% coverage -> nothing deferred", () => {
      seedRechargeTxn(db, { amountUsd: 100, profitUsd: 20, coveredAmount: 100 });
      const row = runWithTenant(1, () => repo.getDeferredProfit(FROM, TO));
      expect(row.partner_profit_usd).toBeCloseTo(0, 5);
    });

    it("non-partner row -> nothing deferred (ratio defaults to 1.0, 1 - 1.0 = 0)", () => {
      seedRechargeTxn(db, { amountUsd: 100, profitUsd: 20 });
      const row = runWithTenant(1, () => repo.getDeferredProfit(FROM, TO));
      expect(row.partner_profit_usd).toBeCloseTo(0, 5);
    });

    it("reconciles: realized (getByUser) + deferred (getDeferredProfit) sums to the full stamp at 50% coverage", () => {
      seedRechargeTxn(db, { amountUsd: 100, profitUsd: 20, coveredAmount: 50 });
      const realized = runWithTenant(1, () => repo.getByUser(FROM, TO));
      const deferred = runWithTenant(1, () => repo.getDeferredProfit(FROM, TO));
      expect(realized[0].profit_usd + deferred.partner_profit_usd).toBeCloseTo(20, 5);
    });
  });
});
