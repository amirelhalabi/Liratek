/**
 * Task 2 (PARTNER_PROPORTIONAL_RECOGNITION.md, continuity guard) — proves
 * `havingAnyContribution` restores exact row-membership parity for the
 * grouped list queries converted from `notPartnerPending`'s binary WHERE
 * gate to `partnerCoverageRatio`'s continuous weight.
 *
 * The bug this guards: once a partner-pending row's monetary columns are
 * WEIGHTED instead of WHERE-gated, its group key (provider/carrier/currency)
 * still has an underlying row even when every one of them is fully
 * uncovered (ratio 0) — `GROUP BY` still emits it, just with every column
 * reading 0. Before the conversion such a group had ZERO matching rows at
 * all (the binary gate excluded them pre-grouping), so it never appeared.
 * `LIRA158.settlementAttribution.test.ts` already proves this for
 * `getFinancialSettledByProvider` (a WHISH row settled with the supplier but
 * wholly partner-uncovered must NOT surface — that test's own failing-first
 * output, captured before this fix existed, is quoted in the task report).
 * This file proves the same property for the four other grouped queries
 * `havingAnyContribution` was also wired into: `getRechargesByCarrier`,
 * `getFinancialSettledByCurrency`, `getMobileServicesByCurrency`, and
 * `getRechargesByCurrency`.
 *
 * Each `describe` block seeds a group key with ONLY a 0%-covered row (the
 * phantom-row case — must be ABSENT from the result) alongside an
 * independent group key with a 50%-covered row (the control — must be
 * PRESENT with exactly half its money, proving the HAVING clause doesn't
 * over-drop a genuinely partially-recognised group). Rule 17's failing-first
 * proof (see the task report) reverts `havingAnyContribution`'s call at each
 * site and shows the "phantom absent" assertion fail (the group surfaces
 * with all-zero values instead) while the 50% control keeps passing.
 *
 * Schema mirrors `ProfitRepository.partnerProportional.byCurrency.test.ts`'s
 * own `createSchema` (same tables, same shape) — kept as a local copy rather
 * than a shared import so this file has no cross-file coupling to a sibling
 * lane's test internals.
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

    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      carrier TEXT,
      currency_code TEXT DEFAULT 'USD',
      price REAL DEFAULT 0,
      cost REAL DEFAULT 0,
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
    -- purpose — the client-debt axis is not this file's concern.
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

describe("ProfitRepository — zero-row continuity (Task 2, havingAnyContribution)", () => {
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

  describe("getRechargesByCarrier", () => {
    it("a carrier whose only row is fully partner-uncovered (0%) is ABSENT, not a $0.00 row", () => {
      const r1 = db
        .prepare(
          `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
           VALUES (1, 'MTC', 'USD', 100, 30, 0, ?)`,
        )
        .run(D).lastInsertRowid as number;
      seedTxn(db, "recharges", r1, "RECHARGE", 5);
      seedPartnerRow(db, "recharges", r1, 100, 0);

      const rows = runWithTenant(1, () => repo.getRechargesByCarrier(FROM, TO));
      expect(rows.find((r) => r.carrier === "MTC")).toBeUndefined();
    });

    it("a carrier with a 50%-covered row is PRESENT with exactly half recognised (control — not over-dropped)", () => {
      const r1 = db
        .prepare(
          `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
           VALUES (1, 'Alfa', 'USD', 100, 30, 0, ?)`,
        )
        .run(D).lastInsertRowid as number;
      seedTxn(db, "recharges", r1, "RECHARGE", 10);
      seedPartnerRow(db, "recharges", r1, 100, 50);

      const rows = runWithTenant(1, () => repo.getRechargesByCarrier(FROM, TO));
      const alfa = rows.find((r) => r.carrier === "Alfa");
      expect(alfa).toBeDefined();
      expect(alfa?.revenue_usd).toBeCloseTo(50, 2);
      expect(alfa?.cost_usd).toBeCloseTo(15, 2);
      expect(alfa?.profit_usd).toBeCloseTo(5, 2);
      expect(alfa?.count).toBe(1);
    });
  });

  describe("getFinancialSettledByCurrency", () => {
    it("a currency whose only settled row is fully partner-uncovered (0%) is ABSENT, not a $0.00 row", () => {
      const fs1 = db
        .prepare(
          `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, is_refunded, created_at)
           VALUES (1, 'OMT', 100, 'LBP', 0, 0, 1, 0, ?)`,
        )
        .run(D).lastInsertRowid as number;
      seedTxn(db, "financial_services", fs1, "FINANCIAL_SERVICE", 0, 10);
      seedPartnerRow(db, "financial_services", fs1, 100, 0);

      const rows = runWithTenant(1, () =>
        repo.getFinancialSettledByCurrency(FROM, TO),
      );
      expect(rows.find((r) => r.currency === "LBP")).toBeUndefined();
    });

    it("a currency with a 50%-covered row is PRESENT with exactly half recognised (control)", () => {
      const fs1 = db
        .prepare(
          `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, is_refunded, created_at)
           VALUES (1, 'OMT', 100, 'LBP', 0, 0, 1, 0, ?)`,
        )
        .run(D).lastInsertRowid as number;
      seedTxn(db, "financial_services", fs1, "FINANCIAL_SERVICE", 0, 20);
      seedPartnerRow(db, "financial_services", fs1, 100, 50);

      const rows = runWithTenant(1, () =>
        repo.getFinancialSettledByCurrency(FROM, TO),
      );
      const lbp = rows.find((r) => r.currency === "LBP");
      expect(lbp).toBeDefined();
      expect(lbp?.revenue).toBeCloseTo(50, 2);
      expect(lbp?.commission).toBeCloseTo(10, 2);
      expect(lbp?.count).toBe(1);
    });
  });

  describe("getMobileServicesByCurrency", () => {
    it("a currency whose only row is fully partner-uncovered (0%) is ABSENT, not a $0.00 row", () => {
      const fs1 = db
        .prepare(
          `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, is_refunded, created_at)
           VALUES (1, 'iPick', 0, 'LBP', 40, 100, 0, 0, ?)`,
        )
        .run(D).lastInsertRowid as number;
      seedTxn(db, "financial_services", fs1, "FINANCIAL_SERVICE", 0, 10);
      seedPartnerRow(db, "financial_services", fs1, 100, 0);

      const rows = runWithTenant(1, () =>
        repo.getMobileServicesByCurrency(FROM, TO),
      );
      expect(rows.find((r) => r.currency === "LBP")).toBeUndefined();
    });

    it("a currency with a 50%-covered row is PRESENT with exactly half recognised (control)", () => {
      const fs1 = db
        .prepare(
          `INSERT INTO financial_services (tenant_id, provider, amount, currency, cost, price, is_settled, is_refunded, created_at)
           VALUES (1, 'iPick', 0, 'LBP', 40, 100, 0, 0, ?)`,
        )
        .run(D).lastInsertRowid as number;
      seedTxn(db, "financial_services", fs1, "FINANCIAL_SERVICE", 0, 10);
      seedPartnerRow(db, "financial_services", fs1, 100, 50);

      const rows = runWithTenant(1, () =>
        repo.getMobileServicesByCurrency(FROM, TO),
      );
      const lbp = rows.find((r) => r.currency === "LBP");
      expect(lbp).toBeDefined();
      expect(lbp?.revenue).toBeCloseTo(50, 2);
      expect(lbp?.cost).toBeCloseTo(20, 2);
      expect(lbp?.profit).toBeCloseTo(5, 2);
      expect(lbp?.count).toBe(1);
    });
  });

  describe("getRechargesByCurrency", () => {
    it("a currency whose only row is fully partner-uncovered (0%) is ABSENT, not a $0.00 row", () => {
      const r1 = db
        .prepare(
          `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
           VALUES (1, 'MTC', 'LBP', 100, 30, 0, ?)`,
        )
        .run(D).lastInsertRowid as number;
      seedTxn(db, "recharges", r1, "RECHARGE", 0, 10);
      seedPartnerRow(db, "recharges", r1, 100, 0);

      const rows = runWithTenant(1, () => repo.getRechargesByCurrency(FROM, TO));
      expect(rows.find((r) => r.currency_code === "LBP")).toBeUndefined();
    });

    it("a currency with a 50%-covered row is PRESENT with exactly half recognised (control)", () => {
      const r1 = db
        .prepare(
          `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
           VALUES (1, 'MTC', 'LBP', 100, 30, 0, ?)`,
        )
        .run(D).lastInsertRowid as number;
      seedTxn(db, "recharges", r1, "RECHARGE", 0, 10);
      seedPartnerRow(db, "recharges", r1, 100, 50);

      const rows = runWithTenant(1, () => repo.getRechargesByCurrency(FROM, TO));
      const lbp = rows.find((r) => r.currency_code === "LBP");
      expect(lbp).toBeDefined();
      expect(lbp?.revenue).toBeCloseTo(50, 2);
      expect(lbp?.cost).toBeCloseTo(15, 2);
      expect(lbp?.profit).toBeCloseTo(5, 2);
      expect(lbp?.count).toBe(1);
    });
  });
});
