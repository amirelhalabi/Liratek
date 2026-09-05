/**
 * Task 3 (PARTNER_PROPORTIONAL_RECOGNITION.md, 2026-09-05) — proves the
 * sales-path wiring: `saleRecognitionWeight` (built by Lane A, left
 * deliberately unwired because the monetary columns it must scale live in
 * other lanes' ranges) is now actually multiplied into every call site that
 * used to gate on the binary `salePaidOrPartnerSettled` predicate:
 *
 *   1. getSalesRevCost (revenue_usd, cost_usd; count row-tallied, not
 *      weighted)
 *   2. getSalesProfit (profit_usd)
 *   3. getByDate's daily_sales/daily_sales_profit CTEs (revenue_usd/cost_usd,
 *      profit_usd — read off the specific calendar day the sale falls on)
 *   4. getByUser's SALE arm (revenue_usd, profit_usd, profit_lbp)
 *   5. getByClient's SALE arm (revenue_usd, profit_usd, profit_lbp)
 *
 * Each seeds THREE for-partner sales — 0%, 50%, 100% partner coverage — and
 * asserts the TOTAL, exactly mirroring
 * `ProfitRepository.partnerProportional.byCurrency.test.ts`'s own rule-17
 * design: 0% and 100% behave identically under the OLD binary gate and the
 * NEW continuous weight (fully excluded / fully included either way); ONLY
 * the 50% row differs (the old gate excluded it outright — still "pending"
 * at 50% coverage — the new code recognises exactly half). This is what
 * makes each assertion below fail against the pre-conversion SQL (see the
 * task report for the verbatim failing-first output per call site).
 *
 * `count` (getSalesRevCost only) is asserted as a ROW TALLY — 2 sales (the
 * 50% and 100% ones) — never weighted, matching every other converted count
 * column in this file (a fractional count has no sensible rendering).
 *
 * A customer-PAID sale (no partner obligation at all) is also covered per
 * call site as the "recognises fully regardless" control, proving the
 * conversion didn't disturb the ordinary, non-partner path.
 *
 * Schema mirrors `ProfitRepository.partnerProportional.byUserAndClient.test.ts`'s
 * own `createSchema` (same tables — getByDate/getByUser/getByClient need the
 * full module set even though this file only exercises the sales columns).
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const D = "2026-09-05 10:00:00";
const FROM_DATE = "2026-09-05";
const TO_DATE = "2026-09-05";
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

/**
 * Seeds one for-partner sale: `sale_items` (revenue/cost), a SALE
 * `transactions` row (profit), and a FOR_% `partner_ledger` row at the given
 * coverage. `paidUsd: 0` throughout — a for-partner sale carries no counter
 * cash (see `salePaidOrPartnerSettled`'s own doc comment) — so the ONLY path
 * to nonzero recognition is the partner branch of `saleRecognitionWeight`.
 */
function seedForPartnerSale(
  db: Database.Database,
  opts: {
    finalAmountUsd: number;
    costUsd: number;
    profitUsd: number;
    profitLbp?: number;
    coveredAmount: number;
    partnerAmount?: number;
  },
): number {
  const saleId = Number(
    db
      .prepare(
        `INSERT INTO sales (tenant_id, status, final_amount_usd, paid_usd, paid_lbp, created_at)
         VALUES (1, 'completed', ?, 0, 0, ?)`,
      )
      .run(opts.finalAmountUsd, D).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO sale_items (tenant_id, sale_id, sold_price_usd, cost_price_snapshot_usd, quantity, is_refunded)
     VALUES (1, ?, ?, ?, 1, 0)`,
  ).run(saleId, opts.finalAmountUsd, opts.costUsd);
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
     VALUES (1, 'SALE', 'ACTIVE', 'sales', ?, 1, ?, 0, ?, ?, NULL, ?)`,
  ).run(saleId, opts.finalAmountUsd, opts.profitUsd, opts.profitLbp ?? 0, D);
  db.prepare(
    `INSERT INTO partner_ledger (partner_id, transaction_type, reference_table, reference_id, amount, direction, covered_amount, created_at)
     VALUES (1, 'FOR_TEST', 'sales', ?, ?, 'DEBIT', ?, ?)`,
  ).run(saleId, opts.partnerAmount ?? opts.finalAmountUsd, opts.coveredAmount, D);
  return saleId;
}

/** Seeds an ordinary, fully customer-paid sale (no partner obligation at all). */
function seedPaidSale(
  db: Database.Database,
  opts: { finalAmountUsd: number; costUsd: number; profitUsd: number },
): number {
  const saleId = Number(
    db
      .prepare(
        `INSERT INTO sales (tenant_id, status, final_amount_usd, paid_usd, paid_lbp, created_at)
         VALUES (1, 'completed', ?, ?, 0, ?)`,
      )
      .run(opts.finalAmountUsd, opts.finalAmountUsd, D).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO sale_items (tenant_id, sale_id, sold_price_usd, cost_price_snapshot_usd, quantity, is_refunded)
     VALUES (1, ?, ?, ?, 1, 0)`,
  ).run(saleId, opts.finalAmountUsd, opts.costUsd);
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, created_at)
     VALUES (1, 'SALE', 'ACTIVE', 'sales', ?, 1, ?, 0, ?, 0, NULL, ?)`,
  ).run(saleId, opts.finalAmountUsd, opts.profitUsd, D);
  return saleId;
}

/** Seeds the standard 0%/50%/100% triple used by every describe block below. */
function seedTriple(db: Database.Database): void {
  seedForPartnerSale(db, {
    finalAmountUsd: 100,
    costUsd: 30,
    profitUsd: 10,
    coveredAmount: 0,
  });
  seedForPartnerSale(db, {
    finalAmountUsd: 200,
    costUsd: 60,
    profitUsd: 20,
    coveredAmount: 50,
    partnerAmount: 100, // pin the FOR_% amount independent of final_amount_usd -> ratio 50/100 = 0.5
  });
  seedForPartnerSale(db, {
    finalAmountUsd: 300,
    costUsd: 90,
    profitUsd: 30,
    coveredAmount: 100,
    partnerAmount: 100,
  });
}

describe("ProfitRepository — partner-proportional recognition, sales path (Task 3)", () => {
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

  describe("getSalesRevCost", () => {
    it("weights revenue_usd/cost_usd by saleRecognitionWeight; count tallies rows with ANY coverage", () => {
      seedTriple(db);
      const row = runWithTenant(1, () => repo.getSalesRevCost(FROM, TO));
      // NEW: revenue = 100*0 + 200*0.5 + 300*1 = 400; cost = 30*0 + 60*0.5 + 90*1 = 120.
      // OLD (binary salePaidOrPartnerSettled gate): only the 100%-covered sale
      // passes -> revenue 300, cost 90, count 1 — this is the failing-first proof.
      expect(row.revenue_usd).toBeCloseTo(400, 2);
      expect(row.cost_usd).toBeCloseTo(120, 2);
      expect(row.count).toBe(2);
    });

    it("a fully customer-paid sale (no partner obligation) still recognises fully", () => {
      seedPaidSale(db, { finalAmountUsd: 50, costUsd: 15, profitUsd: 5 });
      const row = runWithTenant(1, () => repo.getSalesRevCost(FROM, TO));
      expect(row.revenue_usd).toBeCloseTo(50, 2);
      expect(row.cost_usd).toBeCloseTo(15, 2);
      expect(row.count).toBe(1);
    });
  });

  describe("getSalesProfit", () => {
    it("weights profit_usd by saleRecognitionWeight", () => {
      seedTriple(db);
      const row = runWithTenant(1, () => repo.getSalesProfit(FROM, TO));
      // NEW: 10*0 + 20*0.5 + 30*1 = 40. OLD (binary): only the 100% sale -> 30.
      expect(row.profit_usd).toBeCloseTo(40, 2);
    });

    it("a fully customer-paid sale still recognises its full profit", () => {
      seedPaidSale(db, { finalAmountUsd: 50, costUsd: 15, profitUsd: 5 });
      const row = runWithTenant(1, () => repo.getSalesProfit(FROM, TO));
      expect(row.profit_usd).toBeCloseTo(5, 2);
    });
  });

  describe("getByDate — daily_sales / daily_sales_profit CTEs", () => {
    it("the sale's own calendar day shows the weighted revenue/cost/profit totals", () => {
      seedTriple(db);
      const rows = runWithTenant(1, () =>
        repo.getByDate(FROM_DATE, TO_DATE, FROM, TO),
      );
      const day = rows.find((r) => r.date === "2026-09-05");
      expect(day).toBeDefined();
      // revenue_usd/cost_usd come from daily_sales; profit_usd includes
      // daily_sales_profit's contribution (no other module seeded this day).
      expect(day!.revenue_usd).toBeCloseTo(400, 2);
      expect(day!.cost_usd).toBeCloseTo(120, 2);
      expect(day!.profit_usd).toBeCloseTo(40, 2);
    });
  });

  describe("getByUser — SALE arm", () => {
    it("weights revenue_usd/profit_usd by saleRecognitionWeight", () => {
      seedTriple(db);
      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      expect(rows).toHaveLength(1);
      expect(rows[0].revenue_usd).toBeCloseTo(400, 2);
      expect(rows[0].profit_usd).toBeCloseTo(40, 2);
      // transaction_count is an UNCONDITIONAL row tally (never gated by
      // either predicate — see this method's own doc comment), so it counts
      // all three sales regardless of coverage.
      expect(rows[0].transaction_count).toBe(3);
    });

    it("weights profit_lbp the same way for an LBP-profit for-partner sale", () => {
      seedForPartnerSale(db, {
        finalAmountUsd: 100,
        costUsd: 0,
        profitUsd: 0,
        profitLbp: 1000,
        coveredAmount: 50,
        partnerAmount: 100,
      });
      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      // NEW: 1000 * 0.5 = 500. OLD (binary, still pending at 50%): 0.
      expect(rows[0].profit_lbp).toBeCloseTo(500, 2);
    });

    it("a fully customer-paid sale still recognises fully", () => {
      seedPaidSale(db, { finalAmountUsd: 50, costUsd: 15, profitUsd: 5 });
      const rows = runWithTenant(1, () => repo.getByUser(FROM, TO));
      expect(rows[0].revenue_usd).toBeCloseTo(50, 2);
      expect(rows[0].profit_usd).toBeCloseTo(5, 2);
    });
  });

  describe("getByClient — SALE arm (mirrors getByUser)", () => {
    it("weights revenue_usd/profit_usd by saleRecognitionWeight", () => {
      seedTriple(db);
      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      expect(rows).toHaveLength(1);
      expect(rows[0].revenue_usd).toBeCloseTo(400, 2);
      expect(rows[0].profit_usd).toBeCloseTo(40, 2);
      expect(rows[0].transaction_count).toBe(3);
    });

    it("weights profit_lbp the same way for an LBP-profit for-partner sale", () => {
      seedForPartnerSale(db, {
        finalAmountUsd: 100,
        costUsd: 0,
        profitUsd: 0,
        profitLbp: 1000,
        coveredAmount: 50,
        partnerAmount: 100,
      });
      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      expect(rows[0].profit_lbp).toBeCloseTo(500, 2);
    });

    it("a fully customer-paid sale still recognises fully", () => {
      seedPaidSale(db, { finalAmountUsd: 50, costUsd: 15, profitUsd: 5 });
      const rows = runWithTenant(1, () => repo.getByClient(FROM, TO, 50));
      expect(rows[0].revenue_usd).toBeCloseTo(50, 2);
      expect(rows[0].profit_usd).toBeCloseTo(5, 2);
    });
  });
});
