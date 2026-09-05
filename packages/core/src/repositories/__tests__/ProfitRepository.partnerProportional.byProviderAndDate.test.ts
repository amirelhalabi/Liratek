/**
 * ProfitRepository — partner-PROPORTIONAL recognition (Lane C of the
 * partner-proportional-recognition rollout; owner decision 2026-09-05).
 *
 * `docs/plans/todo_plans/PARTNER_PROPORTIONAL_RECOGNITION.md` classifies 19
 * `notPartnerPending` call sites; this lane owns 10 of them (sites #10-#19 in
 * that doc): `getFinancialSettledByProvider`'s allocation + base arms,
 * `getRechargesByCarrier`, and six of `getByDate`'s per-day CTEs, plus
 * `getRealizedCommissionTotals`. Every one of those 10 sites moved from
 * `notPartnerPending`'s binary all-or-nothing WHERE gate to
 * `partnerCoverageRatio`'s continuous `[0,1]` weight multiplied onto every
 * monetary column — revenue/cost/profit/commission recognise PROPORTIONALLY
 * as the partner's settlement coverage arrives, instead of the whole row
 * waiting for 100% coverage. `count`/`COUNT(DISTINCT …)` columns are NEVER
 * weighted (a fractional count would render literally, e.g. "3.4 txns") —
 * they become `SUM(CASE WHEN ratio > 0 THEN 1 ELSE 0 END)` instead, counting
 * a row the moment ANY money has arrived.
 *
 * Continuity is the property under test at every site: at ratio 0 a row
 * contributes exactly what the OLD binary gate contributed (zero money, zero
 * count) — proven below at each site's own 0%-coverage tier. At ratio 1 a
 * row contributes its full value, matching a NEVER-partner-pending row
 * (also proven below). Only the middle (50%) tier is genuinely NEW behavior.
 *
 * 7 proof groups cover the 10 sites — 3 groups intentionally share ONE proof
 * across TWO sites (same query shape, same table, same `partnerCoverageRatio`
 * refTable/idExpr pairing, so one fixture legitimately proves both):
 *   - Group 1: `getFinancialSettledByProvider`'s BASE arm (site #11) +
 *     `getByDate`'s `daily_commissions` BASE arm (site #14) — both read
 *     `financial_services fs JOIN transactions t`, both weight by
 *     `partnerCoverageRatio("financial_services", "fs.id")`.
 *   - Group 2: `getFinancialSettledByProvider`'s ALLOCATION arm (site #10) +
 *     `getByDate`'s `dailyCommissionsAllocationArm` (site #13) — both read
 *     `settlement_commission_allocations sca`, both weight by
 *     `partnerCoverageRatio("financial_services", "sca.financial_service_id")`.
 *   - Group 3: `getRechargesByCarrier` (site #12) + `getByDate`'s
 *     `daily_recharges` (site #15) — both read `recharges r`, both weight by
 *     `partnerCoverageRatio("recharges", "r.id")`.
 * The remaining 4 sites (custom_services daily_custom #16, loto_tickets
 * daily_loto #17, exchange_transactions daily_exchange #18,
 * getRealizedCommissionTotals #19) are each a genuinely distinct query shape
 * (different source table, or a materially different SELECT list/WHERE) and
 * get their own standalone proof (Groups 4-7).
 *
 * Rule 17 (failing-first): for each of the 7 proof groups, the task report
 * documents reverting that group's `partnerCoverageRatio` conversion(s) back
 * to the OLD `notPartnerPending` gate, running exactly this file, capturing
 * the verbatim failure, then restoring the fix and re-confirming green — see
 * the task's final report for the transcripts (not reproduced in this file's
 * comments, to avoid the doc going stale the next time the surrounding SQL is
 * touched).
 *
 * Fixture note (CLAUDE.md's test-schema trap): `getByDate` is one big
 * `WITH`-query touching sales/sale_items/recharges/custom_services/
 * maintenance/loto_tickets/expenses/exchange_transactions alongside
 * financial_services regardless of which CTE a given test cares about, so
 * the schema below is the union of every module table it references (reused
 * from `ProfitRepository.tenantIsolation.test.ts`'s proven `getByDate`
 * fixture), PLUS `settlement_commission_allocations` +
 * `commission_model`/`settlement_id` on `financial_services` (reused from
 * `ProfitRepository.cashlessSettlementDefersOnDebt.test.ts`'s proven
 * allocation fixture) needed for sites #10/#13.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const FROM_DATE = "2026-07-01";
const TO_DATE = "2026-07-31";
const FROM = "2026-07-01 00:00:00";
const TO = "2026-07-31 23:59:59";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0,
      profit_lbp REAL DEFAULT 0,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      created_at TEXT
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      provider TEXT,
      omt_service_type TEXT,
      amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      commission_model INTEGER NOT NULL DEFAULT 0,
      settlement_id INTEGER,
      omt_fee REAL,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      is_settled INTEGER DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      created_at TEXT,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE settlement_commission_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      settlement_ledger_id INTEGER NOT NULL,
      financial_service_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      commission_usd REAL NOT NULL DEFAULT 0,
      commission_lbp REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      carrier TEXT,
      currency_code TEXT DEFAULT 'USD',
      price REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT,
      refunded_at TEXT DEFAULT NULL
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

    CREATE TABLE maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      final_amount_usd REAL DEFAULT 0,
      final_amount_lbp REAL DEFAULT 0,
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

    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT DEFAULT 'active',
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      expense_date TEXT,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE exchange_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      amount_in REAL DEFAULT 0,
      leg1_profit_usd REAL DEFAULT 0,
      leg2_profit_usd REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      final_amount_usd REAL DEFAULT 0,
      paid_usd REAL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 90000,
      created_at TEXT
    );

    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      sale_id INTEGER,
      sold_price_usd REAL DEFAULT 0,
      cost_price_snapshot_usd REAL DEFAULT 0,
      quantity INTEGER DEFAULT 1,
      is_refunded INTEGER DEFAULT 0
    );

    -- Referenced by partnerCoverageRatio / notPartnerPending (PFT-6).
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

    -- Referenced by notDebtPending / allocationNotDebtPending (DBT-1). Left
    -- empty everywhere in this file (this lane is about the PARTNER axis,
    -- not the client-debt axis) — the NOT EXISTS gate then passes every row.
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

/** A partner_ledger FOR_% row at a given coverage fraction (amount 100,
 *  covered_amount = amount * ratio) — the shape every proof group seeds. */
function seedPartnerLedger(
  db: Database.Database,
  refTable: string,
  referenceId: number,
  ratio: number,
  createdAt: string,
): void {
  db.prepare(
    `INSERT INTO partner_ledger
       (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, covered_amount, created_at)
     VALUES (1, 1, 'FOR_TEST', ?, ?, 100, 'USD', 'DEBIT', ?, ?)`,
  ).run(refTable, referenceId, 100 * ratio, createdAt);
}

function seedFs(
  db: Database.Database,
  opts: { provider: string; amount?: number; cost?: number; currency?: string; createdAt: string; settlementId?: number | null },
): number {
  const res = db
    .prepare(
      `INSERT INTO financial_services
         (tenant_id, provider, amount, cost, currency, commission, is_settled, settlement_id, is_refunded, created_at)
       VALUES (1, ?, ?, ?, ?, 0, 1, ?, 0, ?)`,
    )
    .run(
      opts.provider,
      opts.amount ?? 100,
      opts.cost ?? 0,
      opts.currency ?? "USD",
      opts.settlementId ?? null,
      opts.createdAt,
    );
  return Number(res.lastInsertRowid);
}

function seedFsTransaction(
  db: Database.Database,
  fsId: number,
  profitUsd: number,
  createdAt: string,
): number {
  const res = db
    .prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, profit_usd, created_at)
       VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, ?, ?)`,
    )
    .run(fsId, profitUsd, createdAt);
  return Number(res.lastInsertRowid);
}

function seedAllocation(
  db: Database.Database,
  opts: {
    settlementLedgerId: number;
    financialServiceId: number;
    provider: string;
    commissionUsd: number;
    createdAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO settlement_commission_allocations
       (tenant_id, settlement_ledger_id, financial_service_id, service_type, provider, commission_usd, commission_lbp, created_at)
     VALUES (1, ?, ?, 'SEND', ?, ?, 0, ?)`,
  ).run(opts.settlementLedgerId, opts.financialServiceId, opts.provider, opts.commissionUsd, opts.createdAt);
}

function seedRecharge(
  db: Database.Database,
  carrier: string,
  price: number,
  cost: number,
  createdAt: string,
): number {
  const res = db
    .prepare(
      `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
       VALUES (1, ?, 'USD', ?, ?, 0, ?)`,
    )
    .run(carrier, price, cost, createdAt);
  return Number(res.lastInsertRowid);
}

function seedRechargeTransaction(db: Database.Database, rId: number, profitUsd: number, createdAt: string): void {
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, created_at)
     VALUES (1, 'RECHARGE', 'ACTIVE', 'recharges', ?, ?, ?)`,
  ).run(rId, profitUsd, createdAt);
}

function seedCustomService(
  db: Database.Database,
  opts: { priceUsd: number; priceLbp: number; costUsd: number; costLbp: number; createdAt: string },
): number {
  const res = db
    .prepare(
      `INSERT INTO custom_services (tenant_id, status, price_usd, price_lbp, cost_usd, cost_lbp, is_refunded, created_at)
       VALUES (1, 'completed', ?, ?, ?, ?, 0, ?)`,
    )
    .run(opts.priceUsd, opts.priceLbp, opts.costUsd, opts.costLbp, opts.createdAt);
  return Number(res.lastInsertRowid);
}

function seedCustomServiceTransaction(
  db: Database.Database,
  csId: number,
  profitUsd: number,
  profitLbp: number,
  createdAt: string,
): void {
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_usd, profit_lbp, created_at)
     VALUES (1, 'CUSTOM_SERVICE', 'ACTIVE', 'custom_services', ?, ?, ?, ?)`,
  ).run(csId, profitUsd, profitLbp, createdAt);
}

function seedLotoTicket(db: Database.Database, saleAmountLbp: number, createdAt: string): number {
  const res = db
    .prepare(`INSERT INTO loto_tickets (tenant_id, sale_amount, is_refunded, created_at) VALUES (1, ?, 0, ?)`)
    .run(saleAmountLbp, createdAt);
  return Number(res.lastInsertRowid);
}

function seedLotoTransaction(db: Database.Database, ltId: number, profitLbp: number, createdAt: string): void {
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, profit_lbp, created_at)
     VALUES (1, 'LOTO', 'ACTIVE', 'loto_tickets', ?, ?, ?)`,
  ).run(ltId, profitLbp, createdAt);
}

function seedExchange(db: Database.Database, amountIn: number, leg1ProfitUsd: number, createdAt: string): number {
  const res = db
    .prepare(
      `INSERT INTO exchange_transactions (tenant_id, amount_in, leg1_profit_usd, leg2_profit_usd, is_refunded, created_at)
       VALUES (1, ?, ?, 0, 0, ?)`,
    )
    .run(amountIn, leg1ProfitUsd, createdAt);
  return Number(res.lastInsertRowid);
}

describe("ProfitRepository — partner-proportional recognition (Lane C, owner decision 2026-09-05)", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
  });

  describe("Group 1 (sites #11 + #14) — financial_services BASE arm: getFinancialSettledByProvider + getByDate daily_commissions, both weighted by partnerCoverageRatio('financial_services','fs.id')", () => {
    it("0% / 50% / 100% partner coverage recognises 0 / half / full revenue+profit; count only at ratio > 0", () => {
      // Three providers (isolate getFinancialSettledByProvider's GROUP BY provider)
      // on three distinct dates (isolate getByDate's GROUP BY day).
      const fs0 = seedFs(db, { provider: "P0", amount: 100, cost: 0, createdAt: "2026-07-05 12:00:00" });
      seedFsTransaction(db, fs0, 10, "2026-07-05 12:00:00");
      seedPartnerLedger(db, "financial_services", fs0, 0, "2026-07-05 12:00:00");

      const fs50 = seedFs(db, { provider: "P50", amount: 100, cost: 0, createdAt: "2026-07-10 12:00:00" });
      seedFsTransaction(db, fs50, 10, "2026-07-10 12:00:00");
      seedPartnerLedger(db, "financial_services", fs50, 0.5, "2026-07-10 12:00:00");

      const fs100 = seedFs(db, { provider: "P100", amount: 100, cost: 0, createdAt: "2026-07-15 12:00:00" });
      seedFsTransaction(db, fs100, 10, "2026-07-15 12:00:00");
      seedPartnerLedger(db, "financial_services", fs100, 1, "2026-07-15 12:00:00");

      const rows = runWithTenant(1, () => repo.getFinancialSettledByProvider(FROM, TO));
      const p0 = rows.find((r) => r.provider === "P0");
      const p50 = rows.find((r) => r.provider === "P50");
      const p100 = rows.find((r) => r.provider === "P100");

      expect(p0?.revenue_usd ?? 0).toBe(0);
      expect(p0?.profit_usd ?? 0).toBe(0);
      expect(p0?.count ?? 0).toBe(0);

      expect(p50?.revenue_usd).toBeCloseTo(50, 2);
      expect(p50?.profit_usd).toBeCloseTo(5, 2);
      expect(p50?.count).toBe(1);

      expect(p100?.revenue_usd).toBeCloseTo(100, 2);
      expect(p100?.profit_usd).toBeCloseTo(10, 2);
      expect(p100?.count).toBe(1);

      const daily = runWithTenant(1, () => repo.getByDate(FROM_DATE, TO_DATE, FROM, TO));
      const d0 = daily.find((r) => r.date === "2026-07-05");
      const d50 = daily.find((r) => r.date === "2026-07-10");
      const d100 = daily.find((r) => r.date === "2026-07-15");

      expect(d0?.revenue_usd ?? 0).toBe(0);
      expect(d0?.profit_usd ?? 0).toBe(0);
      expect(d50?.revenue_usd).toBeCloseTo(50, 2);
      expect(d50?.profit_usd).toBeCloseTo(5, 2);
      expect(d100?.revenue_usd).toBeCloseTo(100, 2);
      expect(d100?.profit_usd).toBeCloseTo(10, 2);
    });
  });

  describe("Group 2 (sites #10 + #13) — financial_services ALLOCATION arm: getFinancialSettledByProvider + getByDate dailyCommissionsAllocationArm, both weighted by partnerCoverageRatio('financial_services','sca.financial_service_id')", () => {
    it("0% / 50% / 100% partner coverage recognises 0 / half / full allocation commission", () => {
      // The underlying fs row is dated OUTSIDE the report window (June) so the
      // BASE arm never contributes — isolates the ALLOCATION arm's own weighting,
      // mirroring LIRA158.settlementAttribution.test.ts's D7-period-assignment trick.
      const TXN_DAY = "2026-06-15 12:00:00";

      const fs0 = seedFs(db, { provider: "A0", amount: 100, createdAt: TXN_DAY, settlementId: 901 });
      seedFsTransaction(db, fs0, 0, TXN_DAY);
      seedAllocation(db, { settlementLedgerId: 901, financialServiceId: fs0, provider: "A0", commissionUsd: 8, createdAt: "2026-07-05 12:00:00" });
      seedPartnerLedger(db, "financial_services", fs0, 0, "2026-07-05 12:00:00");

      const fs50 = seedFs(db, { provider: "A50", amount: 100, createdAt: TXN_DAY, settlementId: 902 });
      seedFsTransaction(db, fs50, 0, TXN_DAY);
      seedAllocation(db, { settlementLedgerId: 902, financialServiceId: fs50, provider: "A50", commissionUsd: 8, createdAt: "2026-07-10 12:00:00" });
      seedPartnerLedger(db, "financial_services", fs50, 0.5, "2026-07-10 12:00:00");

      const fs100 = seedFs(db, { provider: "A100", amount: 100, createdAt: TXN_DAY, settlementId: 903 });
      seedFsTransaction(db, fs100, 0, TXN_DAY);
      seedAllocation(db, { settlementLedgerId: 903, financialServiceId: fs100, provider: "A100", commissionUsd: 8, createdAt: "2026-07-15 12:00:00" });
      seedPartnerLedger(db, "financial_services", fs100, 1, "2026-07-15 12:00:00");

      const rows = runWithTenant(1, () => repo.getFinancialSettledByProvider(FROM, TO));
      const a0 = rows.find((r) => r.provider === "A0");
      const a50 = rows.find((r) => r.provider === "A50");
      const a100 = rows.find((r) => r.provider === "A100");

      expect(a0?.profit_usd ?? 0).toBe(0);
      expect(a50?.profit_usd).toBeCloseTo(4, 2);
      expect(a100?.profit_usd).toBeCloseTo(8, 2);

      const daily = runWithTenant(1, () => repo.getByDate(FROM_DATE, TO_DATE, FROM, TO));
      const d0 = daily.find((r) => r.date === "2026-07-05");
      const d50 = daily.find((r) => r.date === "2026-07-10");
      const d100 = daily.find((r) => r.date === "2026-07-15");

      expect(d0?.profit_usd ?? 0).toBe(0);
      expect(d50?.profit_usd).toBeCloseTo(4, 2);
      expect(d100?.profit_usd).toBeCloseTo(8, 2);
    });
  });

  describe("Group 3 (sites #12 + #15) — recharges: getRechargesByCarrier + getByDate daily_recharges, both weighted by partnerCoverageRatio('recharges','r.id')", () => {
    it("0% / 50% / 100% partner coverage recognises 0 / half / full revenue+cost+profit; count only at ratio > 0", () => {
      const r0 = seedRecharge(db, "C0", 20, 5, "2026-07-05 12:00:00");
      seedRechargeTransaction(db, r0, 15, "2026-07-05 12:00:00");
      seedPartnerLedger(db, "recharges", r0, 0, "2026-07-05 12:00:00");

      const r50 = seedRecharge(db, "C50", 20, 5, "2026-07-10 12:00:00");
      seedRechargeTransaction(db, r50, 15, "2026-07-10 12:00:00");
      seedPartnerLedger(db, "recharges", r50, 0.5, "2026-07-10 12:00:00");

      const r100 = seedRecharge(db, "C100", 20, 5, "2026-07-15 12:00:00");
      seedRechargeTransaction(db, r100, 15, "2026-07-15 12:00:00");
      seedPartnerLedger(db, "recharges", r100, 1, "2026-07-15 12:00:00");

      const rows = runWithTenant(1, () => repo.getRechargesByCarrier(FROM, TO));
      const c0 = rows.find((r) => r.carrier === "C0");
      const c50 = rows.find((r) => r.carrier === "C50");
      const c100 = rows.find((r) => r.carrier === "C100");

      expect(c0?.revenue_usd ?? 0).toBe(0);
      expect(c0?.cost_usd ?? 0).toBe(0);
      expect(c0?.profit_usd ?? 0).toBe(0);
      expect(c0?.count ?? 0).toBe(0);

      expect(c50?.revenue_usd).toBeCloseTo(10, 2);
      expect(c50?.cost_usd).toBeCloseTo(2.5, 2);
      expect(c50?.profit_usd).toBeCloseTo(7.5, 2);
      expect(c50?.count).toBe(1);

      expect(c100?.revenue_usd).toBeCloseTo(20, 2);
      expect(c100?.cost_usd).toBeCloseTo(5, 2);
      expect(c100?.profit_usd).toBeCloseTo(15, 2);
      expect(c100?.count).toBe(1);

      const daily = runWithTenant(1, () => repo.getByDate(FROM_DATE, TO_DATE, FROM, TO));
      const d0 = daily.find((r) => r.date === "2026-07-05");
      const d50 = daily.find((r) => r.date === "2026-07-10");
      const d100 = daily.find((r) => r.date === "2026-07-15");

      expect(d0?.revenue_usd ?? 0).toBe(0);
      expect(d0?.cost_usd ?? 0).toBe(0);
      expect(d0?.profit_usd ?? 0).toBe(0);

      expect(d50?.revenue_usd).toBeCloseTo(10, 2);
      expect(d50?.cost_usd).toBeCloseTo(2.5, 2);
      expect(d50?.profit_usd).toBeCloseTo(7.5, 2);

      expect(d100?.revenue_usd).toBeCloseTo(20, 2);
      expect(d100?.cost_usd).toBeCloseTo(5, 2);
      expect(d100?.profit_usd).toBeCloseTo(15, 2);
    });
  });

  describe("Group 4 (site #16, standalone) — getByDate daily_custom, weighted by partnerCoverageRatio('custom_services','cs.id')", () => {
    it("0% / 50% / 100% partner coverage recognises 0 / half / full revenue+cost+profit (both currencies)", () => {
      const cs0 = seedCustomService(db, { priceUsd: 30, priceLbp: 300000, costUsd: 10, costLbp: 100000, createdAt: "2026-07-05 12:00:00" });
      seedCustomServiceTransaction(db, cs0, 20, 200000, "2026-07-05 12:00:00");
      seedPartnerLedger(db, "custom_services", cs0, 0, "2026-07-05 12:00:00");

      const cs50 = seedCustomService(db, { priceUsd: 30, priceLbp: 300000, costUsd: 10, costLbp: 100000, createdAt: "2026-07-10 12:00:00" });
      seedCustomServiceTransaction(db, cs50, 20, 200000, "2026-07-10 12:00:00");
      seedPartnerLedger(db, "custom_services", cs50, 0.5, "2026-07-10 12:00:00");

      const cs100 = seedCustomService(db, { priceUsd: 30, priceLbp: 300000, costUsd: 10, costLbp: 100000, createdAt: "2026-07-15 12:00:00" });
      seedCustomServiceTransaction(db, cs100, 20, 200000, "2026-07-15 12:00:00");
      seedPartnerLedger(db, "custom_services", cs100, 1, "2026-07-15 12:00:00");

      const daily = runWithTenant(1, () => repo.getByDate(FROM_DATE, TO_DATE, FROM, TO));
      const d0 = daily.find((r) => r.date === "2026-07-05");
      const d50 = daily.find((r) => r.date === "2026-07-10");
      const d100 = daily.find((r) => r.date === "2026-07-15");

      expect(d0?.revenue_usd ?? 0).toBe(0);
      expect(d0?.cost_usd ?? 0).toBe(0);
      expect(d0?.profit_usd ?? 0).toBe(0);

      expect(d50?.revenue_usd).toBeCloseTo(15, 2);
      expect(d50?.cost_usd).toBeCloseTo(5, 2);
      expect(d50?.profit_usd).toBeCloseTo(10, 2);

      expect(d100?.revenue_usd).toBeCloseTo(30, 2);
      expect(d100?.cost_usd).toBeCloseTo(10, 2);
      expect(d100?.profit_usd).toBeCloseTo(20, 2);
    });
  });

  describe("Group 5 (site #17, standalone) — getByDate daily_loto, weighted by partnerCoverageRatio('loto_tickets','lt.id')", () => {
    it("0% / 50% / 100% partner coverage recognises 0 / half / full LBP revenue+profit", () => {
      const lt0 = seedLotoTicket(db, 500, "2026-07-05 12:00:00");
      seedLotoTransaction(db, lt0, 100, "2026-07-05 12:00:00");
      seedPartnerLedger(db, "loto_tickets", lt0, 0, "2026-07-05 12:00:00");

      const lt50 = seedLotoTicket(db, 500, "2026-07-10 12:00:00");
      seedLotoTransaction(db, lt50, 100, "2026-07-10 12:00:00");
      seedPartnerLedger(db, "loto_tickets", lt50, 0.5, "2026-07-10 12:00:00");

      const lt100 = seedLotoTicket(db, 500, "2026-07-15 12:00:00");
      seedLotoTransaction(db, lt100, 100, "2026-07-15 12:00:00");
      seedPartnerLedger(db, "loto_tickets", lt100, 1, "2026-07-15 12:00:00");

      const daily = runWithTenant(1, () => repo.getByDate(FROM_DATE, TO_DATE, FROM, TO));
      const d0 = daily.find((r) => r.date === "2026-07-05");
      const d50 = daily.find((r) => r.date === "2026-07-10");
      const d100 = daily.find((r) => r.date === "2026-07-15");

      expect(d0?.revenue_lbp ?? 0).toBe(0);
      expect(d0?.profit_lbp ?? 0).toBe(0);

      expect(d50?.revenue_lbp).toBeCloseTo(250, 2);
      expect(d50?.profit_lbp).toBeCloseTo(50, 2);

      expect(d100?.revenue_lbp).toBeCloseTo(500, 2);
      expect(d100?.profit_lbp).toBeCloseTo(100, 2);
    });
  });

  describe("Group 6 (site #18, standalone) — getByDate daily_exchange, weighted by partnerCoverageRatio('exchange_transactions','exchange_transactions.id')", () => {
    it("0% / 50% / 100% partner coverage recognises 0 / half / full USD revenue+profit (also guards the EXCHANGE_LEG_PROFIT precedence trap — leg1=40/leg2=0 means an unparenthesized '(leg1+leg2) * ratio' bug would leak leg1 unweighted)", () => {
      const ex0 = seedExchange(db, 200, 40, "2026-07-05 12:00:00");
      seedPartnerLedger(db, "exchange_transactions", ex0, 0, "2026-07-05 12:00:00");

      const ex50 = seedExchange(db, 200, 40, "2026-07-10 12:00:00");
      seedPartnerLedger(db, "exchange_transactions", ex50, 0.5, "2026-07-10 12:00:00");

      const ex100 = seedExchange(db, 200, 40, "2026-07-15 12:00:00");
      seedPartnerLedger(db, "exchange_transactions", ex100, 1, "2026-07-15 12:00:00");

      const daily = runWithTenant(1, () => repo.getByDate(FROM_DATE, TO_DATE, FROM, TO));
      const d0 = daily.find((r) => r.date === "2026-07-05");
      const d50 = daily.find((r) => r.date === "2026-07-10");
      const d100 = daily.find((r) => r.date === "2026-07-15");

      // revenue_usd on ProfitByDateRow includes daily_exchange's amount_in
      // contribution directly (see the outer SELECT's revenue_usd sum).
      expect(d0?.revenue_usd ?? 0).toBe(0);
      expect(d50?.revenue_usd).toBeCloseTo(100, 2);
      expect(d100?.revenue_usd).toBeCloseTo(200, 2);

      // profit_usd folds in every category; isolate the exchange leg by
      // checking the DELTA matches the expected weighted leg1 profit exactly
      // (nothing else is seeded on these three dates, so profit_usd IS the
      // exchange contribution here).
      expect(d0?.profit_usd ?? 0).toBe(0);
      expect(d50?.profit_usd).toBeCloseTo(20, 2);
      expect(d100?.profit_usd).toBeCloseTo(40, 2);
    });
  });

  describe("Group 7 (site #19, standalone) — getRealizedCommissionTotals, weighted by partnerCoverageRatio('financial_services','fs.id')", () => {
    it("0% partner coverage recognises zero commission and zero count", () => {
      const fsId = seedFs(db, { provider: "R0", amount: 100, createdAt: "2026-07-10 12:00:00" });
      db.prepare(`UPDATE financial_services SET commission = 12 WHERE id = ?`).run(fsId);
      seedFsTransaction(db, fsId, 0, "2026-07-10 12:00:00");
      seedPartnerLedger(db, "financial_services", fsId, 0, "2026-07-10 12:00:00");

      const totals = runWithTenant(1, () => repo.getRealizedCommissionTotals(FROM, TO));
      expect(totals.total_usd).toBe(0);
      expect(totals.count).toBe(0);
    });

    it("50% partner coverage recognises half the commission and counts the row once", () => {
      const fsId = seedFs(db, { provider: "R50", amount: 100, createdAt: "2026-07-10 12:00:00" });
      db.prepare(`UPDATE financial_services SET commission = 12 WHERE id = ?`).run(fsId);
      seedFsTransaction(db, fsId, 0, "2026-07-10 12:00:00");
      seedPartnerLedger(db, "financial_services", fsId, 0.5, "2026-07-10 12:00:00");

      const totals = runWithTenant(1, () => repo.getRealizedCommissionTotals(FROM, TO));
      expect(totals.total_usd).toBeCloseTo(6, 2);
      expect(totals.count).toBe(1);
    });

    it("100% partner coverage recognises the full commission and counts the row once", () => {
      const fsId = seedFs(db, { provider: "R100", amount: 100, createdAt: "2026-07-10 12:00:00" });
      db.prepare(`UPDATE financial_services SET commission = 12 WHERE id = ?`).run(fsId);
      seedFsTransaction(db, fsId, 0, "2026-07-10 12:00:00");
      seedPartnerLedger(db, "financial_services", fsId, 1, "2026-07-10 12:00:00");

      const totals = runWithTenant(1, () => repo.getRealizedCommissionTotals(FROM, TO));
      expect(totals.total_usd).toBeCloseTo(12, 2);
      expect(totals.count).toBe(1);
    });

    it("a NEVER-partner row (no FOR_% partner_ledger row at all) recognises its full commission unchanged — partnerCoverageRatio's COALESCE(...,1.0) default must not regress the overwhelming majority (non-partner) case", () => {
      const fsId = seedFs(db, { provider: "WalkIn", amount: 100, createdAt: "2026-07-10 12:00:00" });
      db.prepare(`UPDATE financial_services SET commission = 9 WHERE id = ?`).run(fsId);
      seedFsTransaction(db, fsId, 0, "2026-07-10 12:00:00");
      // No seedPartnerLedger call at all.

      const totals = runWithTenant(1, () => repo.getRealizedCommissionTotals(FROM, TO));
      expect(totals.total_usd).toBeCloseTo(9, 2);
      expect(totals.count).toBe(1);
    });
  });
});
