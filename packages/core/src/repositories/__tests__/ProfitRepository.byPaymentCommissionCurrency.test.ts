/**
 * LPAY-R3-3 (Round 3 adversarial review, lane LPay — By Payment Method tab):
 * `getRealizedCommissionTotals` / `getPendingCommissionTotals` /
 * `getPendingCommissionByProvider` bucket on `currency != 'LBP'`, so a EUR
 * (or USDT/any non-USD/non-LBP) financial-service commission lands in the
 * "USD" total — the same PA-1.4 mistake `getPaymentMethodRows` already fixed
 * for its own payment-leg rows (`p.currency_code = 'USD'`, exact match).
 *
 * These three methods are SHARED with `FinancialRepository.getMonthlyPL`
 * (a different report, a different owning lane — LO, see ProfitService.ts's
 * "getPendingCommissionTotals is owned by lane LO" call site) and are pinned
 * by `LIRA158.*`, `ProfitRepository.commissionGates`,
 * `ProfitRepository.partnerProportional.byProviderAndDate` and
 * `ProfitRepository.tenantIsolation` — none of which this lane owns or may
 * edit. Narrowing the bucketing UNCONDITIONALLY would change those screens'
 * numbers and break those pinned assertions blind.
 *
 * Fix (the reviewer's named alternative — "a By-Payment-only variant with
 * = 'USD'"): an additive, backward-compatible `strictUsdBucketing` parameter,
 * defaulting to `false` (the exact old `!= 'LBP'` behavior, byte-for-byte,
 * for getMonthlyPL and every other existing caller). Only
 * `ProfitService.getByPaymentMethod` — this lane's own method — passes
 * `true`. No other call site changes, so no other lane's pinned test can be
 * affected.
 *
 * Rule 17 proof (RED observed before GREEN): before this fix landed,
 * `getRealizedCommissionTotals`/`getPendingCommissionTotals`/
 * `getPendingCommissionByProvider` took only `(fromDt, toDt)` — calling them
 * with a 3rd `true` argument, as the "strict bucketing" cases below do, was a
 * TypeScript compile error under ts-jest (no such parameter existed), so the
 * whole file failed before a single assertion ran. Observed, verbatim:
 *
 *   "ProfitRepository.byPaymentCommissionCurrency.test.ts:129:56 - error TS2554:
 *    Expected 2 arguments, but got 3."
 *   (one such error per strict-mode call site: getRealizedCommissionTotals,
 *   getPendingCommissionTotals, getPendingCommissionByProvider)
 *
 * After adding the optional 3rd parameter (default `false`) to all three
 * methods and threading `true` through `ProfitService.getByPaymentMethod`'s
 * three call sites, the whole file compiled and every case below passed.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const D = "2026-07-01 10:00:00";
const FROM = "2026-07-01 00:00:00";
const TO = "2026-07-01 23:59:59";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one');

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
      omt_fee REAL,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      is_settled INTEGER DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      created_at TEXT
    , refunded_at TEXT DEFAULT NULL);

    -- Empty, but referenced by partnerCoverageRatio/notDebtPending's
    -- correlated subqueries on every row regardless.
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
      notes TEXT,
      user_id INTEGER,
      settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      transaction_id INTEGER,
      due_date TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      is_refunded INTEGER DEFAULT 0,
      session_id INTEGER,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    , refunded_at TEXT DEFAULT NULL);
  `);
}

/** Insert a settled commission fs row (given currency) + its FINANCIAL_SERVICE txn. */
function seedSettledCommission(
  db: Database.Database,
  currency: string,
  commission: number,
  provider = "OMT",
): { fsId: number; txnId: number } {
  const fs = db
    .prepare(
      `INSERT INTO financial_services
         (tenant_id, provider, amount, currency, commission, cost, price, is_settled, is_refunded, created_at)
       VALUES (1, ?, 100, ?, ?, 0, 0, 1, 0, ?)`,
    )
    .run(provider, currency, commission, D);
  const fsId = Number(fs.lastInsertRowid);
  const txn = db
    .prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, created_at)
       VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 100, ?, ?)`,
    )
    .run(fsId, commission, D);
  return { fsId, txnId: Number(txn.lastInsertRowid) };
}

/** Insert a PENDING (unsettled) commission fs row (given currency), no txn needed. */
function seedPendingCommission(
  db: Database.Database,
  currency: string,
  commission: number,
  provider = "OMT",
): void {
  db.prepare(
    `INSERT INTO financial_services
       (tenant_id, provider, amount, currency, commission, cost, price, is_settled, is_refunded, created_at)
     VALUES (1, ?, 100, ?, ?, 0, 0, 0, 0, ?)`,
  ).run(provider, currency, commission, D);
}

describe("ProfitRepository commission currency bucketing — strictUsdBucketing (LPAY-R3-3)", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    seedSettledCommission(db, "USD", 10);
    seedSettledCommission(db, "EUR", 7);
    seedPendingCommission(db, "USD", 4, "WHISH");
    seedPendingCommission(db, "EUR", 3, "WHISH");
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  describe("default (false / omitted) — byte-for-byte old behavior, unchanged for other callers", () => {
    it("getRealizedCommissionTotals still lumps EUR into total_usd", () => {
      const r = runWithTenant(1, () => repo.getRealizedCommissionTotals(FROM, TO));
      expect(r.total_usd).toBe(17); // 10 (USD) + 7 (EUR) — old `!= 'LBP'` bucketing
      expect(r.total_lbp).toBe(0);
    });

    it("getPendingCommissionTotals still lumps EUR into total_usd", () => {
      const r = runWithTenant(1, () => repo.getPendingCommissionTotals(FROM, TO));
      expect(r.total_usd).toBe(7); // 4 (USD) + 3 (EUR)
      expect(r.total_lbp).toBe(0);
    });

    it("getPendingCommissionByProvider still lumps EUR into total_usd", () => {
      const rows = runWithTenant(1, () =>
        repo.getPendingCommissionByProvider(FROM, TO),
      );
      const whish = rows.find((r) => r.provider === "WHISH");
      expect(whish).toBeDefined();
      expect(whish!.total_usd).toBe(7);
    });
  });

  describe("strictUsdBucketing = true — EUR dropped, PA-1.4 convention", () => {
    it("getRealizedCommissionTotals drops the EUR row from both totals", () => {
      const r = runWithTenant(1, () =>
        repo.getRealizedCommissionTotals(FROM, TO, true),
      );
      expect(r.total_usd).toBe(10); // EUR's 7 dropped, not lumped in
      expect(r.total_lbp).toBe(0);
      // `count` stays currency-agnostic (same precedent as
      // getPaymentMethodRows's `count`, PA-1.4 payment part): the EUR
      // commission genuinely settled, it just has no dollar column of its
      // own, so it still counts as one recognized settlement.
      expect(r.count).toBe(2);
    });

    it("getPendingCommissionTotals drops the EUR row from both totals", () => {
      const r = runWithTenant(1, () =>
        repo.getPendingCommissionTotals(FROM, TO, true),
      );
      expect(r.total_usd).toBe(4);
      expect(r.total_lbp).toBe(0);
    });

    it("getPendingCommissionByProvider drops the EUR row from total_usd", () => {
      const rows = runWithTenant(1, () =>
        repo.getPendingCommissionByProvider(FROM, TO, true),
      );
      const whish = rows.find((r) => r.provider === "WHISH");
      expect(whish).toBeDefined();
      expect(whish!.total_usd).toBe(4);
    });

    it("a genuine LBP commission still lands in total_lbp, not dropped", () => {
      seedSettledCommission(db, "LBP", 500000, "OMT");
      const r = runWithTenant(1, () =>
        repo.getRealizedCommissionTotals(FROM, TO, true),
      );
      expect(r.total_lbp).toBe(500000);
      expect(r.total_usd).toBe(10); // unaffected
    });
  });

  // ===========================================================================
  // LPAY-V7 (OWNER_NOTES_2026-09-21.md §6.5 PA-3.5 review, round 3):
  // getPendingCommissionByProvider never had a total_lbp column at all, so a
  // legacy model-0 provider whose pending commission is denominated in LBP
  // read as "$0.00" in ProfitService.getByPaymentMethod's per-provider label
  // — the column simply didn't exist to carry the real figure.
  // ===========================================================================
  describe("LPAY-V7 — getPendingCommissionByProvider carries total_lbp", () => {
    it("an LBP-only pending provider's total_lbp is populated, not silently absent", () => {
      seedPendingCommission(db, "LBP", 900_000, "BOB");

      const rows = runWithTenant(1, () =>
        repo.getPendingCommissionByProvider(FROM, TO),
      );
      const bob = rows.find((r) => r.provider === "BOB");
      expect(bob).toBeDefined();
      expect(bob!.total_lbp).toBe(900_000);
      // No USD figure for this provider — it never had a USD-denominated row.
      expect(bob!.total_usd).toBe(0);
    });

    it("a provider with BOTH USD and LBP pending commission carries both totals independently", () => {
      seedPendingCommission(db, "USD", 4, "WHISH"); // already seeded in beforeEach
      seedPendingCommission(db, "LBP", 300_000, "WHISH");

      const rows = runWithTenant(1, () =>
        repo.getPendingCommissionByProvider(FROM, TO),
      );
      const whish = rows.find((r) => r.provider === "WHISH");
      expect(whish).toBeDefined();
      // beforeEach already seeded WHISH with 4 USD + 3 EUR (lumped into USD
      // under the default != 'LBP' bucketing) = 7; this test adds another 4
      // USD = 11, plus the new 300,000 LBP row.
      expect(whish!.total_usd).toBe(11);
      expect(whish!.total_lbp).toBe(300_000);
    });
  });
});
