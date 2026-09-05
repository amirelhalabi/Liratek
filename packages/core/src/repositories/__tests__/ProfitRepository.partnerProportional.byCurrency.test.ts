/**
 * Lane B (PARTNER_PROPORTIONAL_RECOGNITION.md) — proves the 7 call sites
 * converted from the binary `notPartnerPending` gate to the proportional
 * `partnerCoverageRatio` weight:
 *
 *   1. getSupplierCommissionTotals (cashless bucket)
 *   2. getFinancialSettledByCurrency
 *   3. getMobileServicesByCurrency
 *   4. getRechargesByCurrency
 *   5. getCustomServicesTotals
 *   6. getLotoTotals
 *   7. getExchangeTotals
 *
 * Owner decision 2026-09-05: a for-partner row recognises its revenue/cost/
 * profit/commission PROPORTIONALLY to how much of its partner obligation has
 * been covered so far, instead of being excluded entirely until fully
 * covered. Each test below seeds THREE rows for its site — one at 0% partner
 * coverage, one at 50%, one at 100% — deliberately choosing amounts where a
 * binary gate and a proportional weight produce DIFFERENT totals (rule 17's
 * "not fixtures where weighted and gated coincide"):
 *
 *   - 0% behaves identically under both old and new code (fully excluded /
 *     contributes 0) — included as the lower continuity boundary.
 *   - 100% behaves identically under both old and new code (fully included)
 *     — included as the upper continuity boundary.
 *   - 50% is the ONLY row that differs: the OLD binary gate excluded it
 *     entirely (covered_amount < amount - 0.005 is still true at 50%, so
 *     `notPartnerPending` was false and the row was fully gated out); the NEW
 *     code includes exactly half its money. This is what makes each
 *     assertion below fail against the pre-conversion SQL — see the task
 *     report for the verbatim failing-first output per site.
 *
 * `count` is asserted as a ROW TALLY (2 — the 50% and 100% rows), never
 * weighted — a weighted count would print as a fraction ("3.4 txns") with no
 * `Math.round` between the query and the UI (Profits.tsx renders `count`
 * bare).
 *
 * Client debt (`notDebtPending`) is left completely unexercised on purpose
 * (no `debt_ledger` row is ever seeded) so these tests isolate the partner
 * axis only — DBT-1 is out of scope for this lane.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const D = "2026-08-01 10:00:00";
const FROM = "2026-08-01 00:00:00";
const TO = "2026-08-01 23:59:59";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      profit_usd REAL DEFAULT 0,
      profit_lbp REAL DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      provider TEXT,
      amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      is_settled INTEGER DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      settlement_id INTEGER,
      created_at TEXT
    );

    CREATE TABLE settlement_commission_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      settlement_ledger_id INTEGER NOT NULL,
      financial_service_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'OMT',
      commission_usd REAL NOT NULL DEFAULT 0,
      commission_lbp REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      currency_code TEXT DEFAULT 'USD',
      price REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      price_usd REAL DEFAULT 0,
      price_lbp REAL DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE loto_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      sale_amount REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE exchange_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      amount_in REAL DEFAULT 0,
      leg1_profit_usd REAL DEFAULT 0,
      leg2_profit_usd REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    -- Referenced by partnerCoverageRatio (proportional) — the SAME rows
    -- notPartnerPending (binary) used to gate on.
    CREATE TABLE partner_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      partner_id INTEGER NOT NULL,
      transaction_type TEXT,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      covered_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Referenced by notDebtPending. Left EMPTY everywhere in this file on
    -- purpose (see file header) — the client-debt axis is out of scope here.
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      transaction_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );
  `);
}

function seedPartnerRow(
  db: Database.Database,
  refTable: string,
  referenceId: number,
  amount: number,
  coveredAmount: number,
): void {
  db.prepare(
    `INSERT INTO partner_ledger
       (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, covered_amount, created_at)
     VALUES (1, 1, 'FOR_TEST', ?, ?, ?, 'USD', 'DEBIT', ?, ?)`,
  ).run(refTable, referenceId, amount, coveredAmount, D);
}

function seedTxn(
  db: Database.Database,
  sourceTable: string,
  sourceId: number,
  type: string,
  profitUsd: number,
  profitLbp = 0,
): number {
  const res = db
    .prepare(
      `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
       VALUES (1, ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
    )
    .run(type, sourceTable, sourceId, profitUsd, profitLbp, D);
  return Number(res.lastInsertRowid);
}

describe("ProfitRepository — partner-proportional recognition (Lane B)", () => {
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

  it("1. getSupplierCommissionTotals (cashless bucket): commission recognises proportionally to partner coverage; count tallies rows with ANY coverage", () => {
    // fs1: 0% covered — contributes 0 either way.
    const fs1 = db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, is_refunded, settlement_id, created_at)
         VALUES (1, 'OMT', 100, 'USD', 0, 0, 1, 0, 901, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedTxn(db, "financial_services", fs1, "FINANCIAL_SERVICE", 0);
    db.prepare(
      `INSERT INTO settlement_commission_allocations (tenant_id, settlement_ledger_id, financial_service_id, service_type, provider, commission_usd, created_at)
       VALUES (1, 901, ?, 'SEND', 'OMT', 10, ?)`,
    ).run(fs1, D);
    seedPartnerRow(db, "financial_services", fs1, 100, 0);

    // fs2: 50% covered — the row that differs old vs new.
    const fs2 = db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, is_refunded, settlement_id, created_at)
         VALUES (1, 'OMT', 100, 'USD', 0, 0, 1, 0, 902, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedTxn(db, "financial_services", fs2, "FINANCIAL_SERVICE", 0);
    db.prepare(
      `INSERT INTO settlement_commission_allocations (tenant_id, settlement_ledger_id, financial_service_id, service_type, provider, commission_usd, created_at)
       VALUES (1, 902, ?, 'SEND', 'OMT', 20, ?)`,
    ).run(fs2, D);
    seedPartnerRow(db, "financial_services", fs2, 100, 50);

    // fs3: 100% covered — contributes fully either way.
    const fs3 = db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, is_refunded, settlement_id, created_at)
         VALUES (1, 'OMT', 100, 'USD', 0, 0, 1, 0, 903, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedTxn(db, "financial_services", fs3, "FINANCIAL_SERVICE", 0);
    db.prepare(
      `INSERT INTO settlement_commission_allocations (tenant_id, settlement_ledger_id, financial_service_id, service_type, provider, commission_usd, created_at)
       VALUES (1, 903, ?, 'SEND', 'OMT', 30, ?)`,
    ).run(fs3, D);
    seedPartnerRow(db, "financial_services", fs3, 100, 100);

    const totals = runWithTenant(1, () =>
      repo.getSupplierCommissionTotals(FROM, TO),
    );
    // NEW (proportional): 10*0 + 20*0.5 + 30*1 = 40.
    // OLD (binary gate) would have been 30 (only fs3 passes; fs2 is still
    // "pending" at 50% under a binary gate) — this is the failing-first proof.
    expect(totals.profit_usd).toBeCloseTo(40, 2);
    expect(totals.count).toBe(2);
  });

  it("2. getFinancialSettledByCurrency: revenue AND commission recognise proportionally to partner coverage", () => {
    const fs1 = db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, is_refunded, created_at)
         VALUES (1, 'OMT', 100, 'USD', 0, 0, 1, 0, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedTxn(db, "financial_services", fs1, "FINANCIAL_SERVICE", 10);
    seedPartnerRow(db, "financial_services", fs1, 100, 0);

    const fs2 = db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, is_refunded, created_at)
         VALUES (1, 'OMT', 200, 'USD', 0, 0, 1, 0, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedTxn(db, "financial_services", fs2, "FINANCIAL_SERVICE", 20);
    seedPartnerRow(db, "financial_services", fs2, 100, 50);

    const fs3 = db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, is_refunded, created_at)
         VALUES (1, 'OMT', 300, 'USD', 0, 0, 1, 0, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedTxn(db, "financial_services", fs3, "FINANCIAL_SERVICE", 30);
    seedPartnerRow(db, "financial_services", fs3, 100, 100);

    const rows = runWithTenant(1, () =>
      repo.getFinancialSettledByCurrency(FROM, TO),
    );
    const usd = rows.find((r) => r.currency === "USD");
    // NEW: revenue = 100*0 + 200*0.5 + 300*1 = 400; commission = 10*0 + 20*0.5 + 30*1 = 40.
    // OLD (binary): only fs3 passes -> revenue 300, commission 30, count 1.
    expect(usd?.revenue).toBeCloseTo(400, 2);
    expect(usd?.commission).toBeCloseTo(40, 2);
    expect(usd?.count).toBe(2);
  });

  it("3. getMobileServicesByCurrency: revenue, cost AND profit all scale by the same per-row ratio", () => {
    const fs1 = db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, is_refunded, created_at)
         VALUES (1, 'iPick', 0, 'USD', 40, 100, 0, 0, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedTxn(db, "financial_services", fs1, "FINANCIAL_SERVICE", 10);
    seedPartnerRow(db, "financial_services", fs1, 100, 0);

    const fs2 = db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, is_refunded, created_at)
         VALUES (1, 'iPick', 0, 'USD', 80, 200, 0, 0, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedTxn(db, "financial_services", fs2, "FINANCIAL_SERVICE", 20);
    seedPartnerRow(db, "financial_services", fs2, 100, 50);

    const fs3 = db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, is_refunded, created_at)
         VALUES (1, 'iPick', 0, 'USD', 120, 300, 0, 0, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedTxn(db, "financial_services", fs3, "FINANCIAL_SERVICE", 30);
    seedPartnerRow(db, "financial_services", fs3, 100, 100);

    const rows = runWithTenant(1, () =>
      repo.getMobileServicesByCurrency(FROM, TO),
    );
    const usd = rows.find((r) => r.currency === "USD");
    // NEW: revenue = 100*0+200*0.5+300*1 = 400; cost = 40*0+80*0.5+120*1 = 160;
    // profit = 10*0+20*0.5+30*1 = 40.
    // OLD (binary): only fs3 passes -> revenue 300, cost 120, profit 30, count 1.
    expect(usd?.revenue).toBeCloseTo(400, 2);
    expect(usd?.cost).toBeCloseTo(160, 2);
    expect(usd?.profit).toBeCloseTo(40, 2);
    expect(usd?.count).toBe(2);
  });

  it("4. getRechargesByCurrency: revenue, cost AND profit all scale by the same per-row ratio", () => {
    const r1 = db
      .prepare(
        `INSERT INTO recharges (tenant_id, currency_code, price, cost, is_refunded, created_at)
         VALUES (1, 'USD', 100, 30, 0, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedTxn(db, "recharges", r1, "RECHARGE", 5);
    seedPartnerRow(db, "recharges", r1, 100, 0);

    const r2 = db
      .prepare(
        `INSERT INTO recharges (tenant_id, currency_code, price, cost, is_refunded, created_at)
         VALUES (1, 'USD', 200, 60, 0, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedTxn(db, "recharges", r2, "RECHARGE", 10);
    seedPartnerRow(db, "recharges", r2, 100, 50);

    const r3 = db
      .prepare(
        `INSERT INTO recharges (tenant_id, currency_code, price, cost, is_refunded, created_at)
         VALUES (1, 'USD', 300, 90, 0, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedTxn(db, "recharges", r3, "RECHARGE", 15);
    seedPartnerRow(db, "recharges", r3, 100, 100);

    const rows = runWithTenant(1, () =>
      repo.getRechargesByCurrency(FROM, TO),
    );
    const usd = rows.find((r) => r.currency_code === "USD");
    // NEW: revenue = 100*0+200*0.5+300*1 = 400; cost = 30*0+60*0.5+90*1 = 120;
    // profit = 5*0+10*0.5+15*1 = 20.
    // OLD (binary): only r3 passes -> revenue 300, cost 90, profit 15, count 1.
    expect(usd?.revenue).toBeCloseTo(400, 2);
    expect(usd?.cost).toBeCloseTo(120, 2);
    expect(usd?.profit).toBeCloseTo(20, 2);
    expect(usd?.count).toBe(2);
  });

  it("5. getCustomServicesTotals: every monetary column (revenue/cost/profit, USD+LBP) scales by the same per-row ratio", () => {
    const cs1 = db
      .prepare(
        `INSERT INTO custom_services (tenant_id, status, price_usd, price_lbp, cost_usd, cost_lbp, is_refunded, created_at)
         VALUES (1, 'completed', 100, 0, 20, 0, 0, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedTxn(db, "custom_services", cs1, "CUSTOM_SERVICE", 8);
    seedPartnerRow(db, "custom_services", cs1, 100, 0);

    const cs2 = db
      .prepare(
        `INSERT INTO custom_services (tenant_id, status, price_usd, price_lbp, cost_usd, cost_lbp, is_refunded, created_at)
         VALUES (1, 'completed', 200, 0, 40, 0, 0, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedTxn(db, "custom_services", cs2, "CUSTOM_SERVICE", 16);
    seedPartnerRow(db, "custom_services", cs2, 100, 50);

    const cs3 = db
      .prepare(
        `INSERT INTO custom_services (tenant_id, status, price_usd, price_lbp, cost_usd, cost_lbp, is_refunded, created_at)
         VALUES (1, 'completed', 300, 0, 60, 0, 0, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedTxn(db, "custom_services", cs3, "CUSTOM_SERVICE", 24);
    seedPartnerRow(db, "custom_services", cs3, 100, 100);

    const totals = runWithTenant(1, () =>
      repo.getCustomServicesTotals(FROM, TO),
    );
    // NEW: revenue_usd = 100*0+200*0.5+300*1 = 400; cost_usd = 20*0+40*0.5+60*1 = 80;
    // profit_usd = 8*0+16*0.5+24*1 = 32.
    // OLD (binary): only cs3 passes -> revenue_usd 300, cost_usd 60, profit_usd 24, count 1.
    expect(totals.revenue_usd).toBeCloseTo(400, 2);
    expect(totals.cost_usd).toBeCloseTo(80, 2);
    expect(totals.profit_usd).toBeCloseTo(32, 2);
    expect(totals.count).toBe(2);
  });

  it("6. getLotoTotals: revenue AND profit (LBP) scale by the same per-row ratio", () => {
    const lt1 = db
      .prepare(
        `INSERT INTO loto_tickets (tenant_id, sale_amount, is_refunded, created_at)
         VALUES (1, 1000, 0, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedTxn(db, "loto_tickets", lt1, "LOTO", 0, 100);
    seedPartnerRow(db, "loto_tickets", lt1, 100, 0);

    const lt2 = db
      .prepare(
        `INSERT INTO loto_tickets (tenant_id, sale_amount, is_refunded, created_at)
         VALUES (1, 2000, 0, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedTxn(db, "loto_tickets", lt2, "LOTO", 0, 200);
    seedPartnerRow(db, "loto_tickets", lt2, 100, 50);

    const lt3 = db
      .prepare(
        `INSERT INTO loto_tickets (tenant_id, sale_amount, is_refunded, created_at)
         VALUES (1, 3000, 0, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedTxn(db, "loto_tickets", lt3, "LOTO", 0, 300);
    seedPartnerRow(db, "loto_tickets", lt3, 100, 100);

    const totals = runWithTenant(1, () => repo.getLotoTotals(FROM, TO));
    // NEW: revenue_lbp = 1000*0+2000*0.5+3000*1 = 4000; profit_lbp = 100*0+200*0.5+300*1 = 400.
    // OLD (binary): only lt3 passes -> revenue_lbp 3000, profit_lbp 300, count 1.
    expect(totals.revenue_lbp).toBeCloseTo(4000, 2);
    expect(totals.profit_lbp).toBeCloseTo(400, 2);
    expect(totals.count).toBe(2);
  });

  it("7. getExchangeTotals: revenue AND profit scale by the same per-row ratio (no client-debt gate exists for exchange)", () => {
    const ex1 = db
      .prepare(
        `INSERT INTO exchange_transactions (tenant_id, amount_in, leg1_profit_usd, leg2_profit_usd, is_refunded, created_at)
         VALUES (1, 100, 10, 0, 0, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedPartnerRow(db, "exchange_transactions", ex1, 100, 0);

    const ex2 = db
      .prepare(
        `INSERT INTO exchange_transactions (tenant_id, amount_in, leg1_profit_usd, leg2_profit_usd, is_refunded, created_at)
         VALUES (1, 200, 20, 0, 0, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedPartnerRow(db, "exchange_transactions", ex2, 100, 50);

    const ex3 = db
      .prepare(
        `INSERT INTO exchange_transactions (tenant_id, amount_in, leg1_profit_usd, leg2_profit_usd, is_refunded, created_at)
         VALUES (1, 300, 30, 0, 0, ?)`,
      )
      .run(D).lastInsertRowid as number;
    seedPartnerRow(db, "exchange_transactions", ex3, 100, 100);

    const totals = runWithTenant(1, () => repo.getExchangeTotals(FROM, TO));
    // NEW: revenue_usd = 100*0+200*0.5+300*1 = 400; profit_usd = 10*0+20*0.5+30*1 = 40.
    // OLD (binary): only ex3 passes -> revenue_usd 300, profit_usd 30, count 1.
    expect(totals.revenue_usd).toBeCloseTo(400, 2);
    expect(totals.profit_usd).toBeCloseTo(40, 2);
    expect(totals.count).toBe(2);
  });
});
