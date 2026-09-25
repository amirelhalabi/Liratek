/**
 * OWNER_NOTES_2026-09-21.md §6 — Lane LO (Overview + By Module + By Date),
 * repository-layer items. Each describe block below is named after its PA-id
 * (or its round-2 LO-V-id) and documents, in its own header, what it proves
 * and whether it was observed RED against the pre-fix code (rule 17).
 *
 * ROUND 1 provenance (LO-V13, round-2 adversarial review): the original
 * header here claimed the WHOLE file was run once against pre-fix code with
 * every "OBSERVED RED" case failing as quoted. That claim was disclosed as
 * inaccurate under review (the file cannot even compile against pre-fix
 * types under ts-jest — `getTopupBuybackProfit`/`FinByProviderRow.cost_usd`
 * are TS2339 on that code — so any quoted RED can only have come from an
 * INCREMENTAL run against a partially-fixed file, one case/group at a time,
 * not the whole file against a clean pre-fix checkout). This note replaces
 * that claim rather than repeating it.
 *
 * ROUND 2 provenance (this pass): every describe block ADDED in round 2 (the
 * "(round 2 adversarial review)"-suffixed ones — LO-V2, LO-V1, LO-V12, LO-V7)
 * was rule-17 proven with Edit-based bug reintroduction — no revert: the
 * fix was implemented FIRST, each one was then temporarily broken again
 * in place (documented "TEMP rule-17 bug reintroduction" edits, applied and
 * un-applied one at a time), run, confirmed to fail with the exact message
 * now quoted in its own comment, then the fix was restored and re-confirmed
 * green. The PA-2.10 reconciliation test's EXTENDED fixture (round 2) is
 * NOT separately rule-17 proven as one unit — same reasoning its own
 * original comment already gives: it is a cross-check that only makes sense
 * once the individual fixes it exercises (LO-V1, LO-V2, LO-V12, all proven
 * above) already exist; it proves the SUM reconciles, not any one mechanism.
 *
 * Fixture pattern copied from ProfitRepository.fsStampModel1Recognition.test.ts
 * (in-memory better-sqlite3 + __LIRATEK_TEST_DB__ + runWithTenant).
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { ProfitService } from "../../services/ProfitService";
import { runWithTenant } from "../../db/tenantContext";

const D = "2026-07-01 10:00:00";
const FROM_DATE = "2026-07-01";
const FROM = "2026-07-01 00:00:00";
const TO = "2026-07-01 23:59:59";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one');

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      username TEXT NOT NULL
    );

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      full_name TEXT,
      phone_number TEXT
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      name TEXT
    );

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      final_amount_usd REAL DEFAULT 0,
      paid_usd REAL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 90000,
      discount_usd DECIMAL(10, 2) DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      sale_id INTEGER,
      product_id INTEGER,
      sold_price_usd REAL DEFAULT 0,
      cost_price_snapshot_usd REAL DEFAULT 0,
      quantity INTEGER DEFAULT 1,
      is_refunded INTEGER DEFAULT 0
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0,
      profit_lbp REAL DEFAULT 0,
      reverses_id INTEGER,
      created_at TEXT
    );

    CREATE TABLE financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      provider TEXT,
      service_type TEXT,
      omt_service_type TEXT,
      amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      commission_model INTEGER DEFAULT 0,
      omt_fee REAL,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      is_settled INTEGER DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      settlement_id INTEGER DEFAULT NULL,
      created_at TEXT
    , refunded_at TEXT DEFAULT NULL);

    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      carrier TEXT,
      currency_code TEXT DEFAULT 'USD',
      price REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    , refunded_at TEXT DEFAULT NULL);

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
    ,
      parts_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      parts_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0
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
      expense_date TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE exchange_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      amount_in REAL DEFAULT 0,
      leg1_profit_usd REAL DEFAULT 0,
      leg2_profit_usd REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    , refunded_at TEXT DEFAULT NULL);

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

    CREATE TABLE settlement_commission_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      settlement_ledger_id INTEGER NOT NULL,
      financial_service_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      commission_usd REAL NOT NULL DEFAULT 0,
      commission_lbp REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function seedFs(
  db: Database.Database,
  row: {
    provider: string;
    serviceType: string;
    amount: number;
    cost?: number;
    price?: number;
    currency?: string;
    commissionModel: number;
    isSettled: number;
    profitUsd?: number;
    profitLbp?: number;
    userId: number;
    clientName: string;
  },
): { fsId: number; txnId: number } {
  const fs = db
    .prepare(
      `INSERT INTO financial_services
         (tenant_id, provider, service_type, amount, currency, commission,
          commission_model, cost, price, is_settled, is_refunded, created_at)
       VALUES (1, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0, ?)`,
    )
    .run(
      row.provider,
      row.serviceType,
      row.amount,
      row.currency ?? "USD",
      row.commissionModel,
      row.cost ?? 0,
      row.price ?? 0,
      row.isSettled,
      D,
    );
  const fsId = Number(fs.lastInsertRowid);
  const txn = db
    .prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, user_id,
          client_name, amount_usd, profit_usd, profit_lbp, created_at)
       VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fsId,
      row.userId,
      row.clientName,
      row.amount,
      row.profitUsd ?? 0,
      row.profitLbp ?? 0,
      D,
    );
  return { fsId, txnId: Number(txn.lastInsertRowid) };
}

function withDb(fn: (db: Database.Database, repo: ProfitRepository) => void) {
  const db = new Database(":memory:");
  createSchema(db);
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  const repo = new ProfitRepository();
  try {
    fn(db, repo);
  } finally {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
  }
}

describe("PA-1.4 (FS part) — By Module / By Date stop lumping non-LBP currency into USD", () => {
  it("getFinancialSettledByProvider: a EUR-denominated commission row contributes to neither revenue_usd nor revenue_lbp (proven against a genuine USD row on the SAME provider, so the row survives HAVING and the columns are directly comparable — see LO-EUR-phantom below for the EUR-only case, where the row is now absent entirely)", () => {
    // OBSERVED RED (pre-fix): revenue_usd toBe(40) received 80 — the old
    // `fs.currency != 'LBP'` CASE lumped the EUR row's amount into the USD
    // bucket alongside the genuine USD row.
    withDb((db, repo) => {
      seedFs(db, {
        provider: "OMT",
        serviceType: "SEND",
        amount: 40,
        currency: "USD",
        commissionModel: 0,
        isSettled: 1,
        profitUsd: 4,
        userId: 1,
        clientName: "Usd Client",
      });
      seedFs(db, {
        provider: "OMT",
        serviceType: "SEND",
        amount: 40,
        currency: "EUR",
        commissionModel: 0,
        isSettled: 1,
        profitUsd: 4,
        userId: 1,
        clientName: "Eur Client",
      });
      const rows = runWithTenant(1, () =>
        repo.getFinancialSettledByProvider(FROM, TO),
      );
      const omt = rows.find((r) => r.provider === "OMT");
      expect(omt?.revenue_usd).toBe(40);
      expect(omt?.revenue_lbp).toBe(0);
      expect(omt?.profit_usd).toBe(4);
      expect(omt?.profit_lbp).toBe(0);
    });
  });

  it("getFinancialSettledByProvider (LO-EUR-phantom, open_LO.txt): a provider with ONLY EUR rows produces NO row at all — not an all-zero row with a phantom count", () => {
    // OBSERVED RED (pre-fix): `omt` was truthy with `count: 1` even though
    // every money column was 0 — the count SUM was not currency-gated like
    // revenue/cost/profit/kept-change already are (PA-1.4), so it alone
    // survived havingAnyContribution's OR and produced a By Module row
    // reading "FINANCIAL_SERVICE_OMT: 0/0 ... count 1" (probe S5) that
    // disagreed with the Overview's own count (which drops an EUR row's
    // count entirely, ProfitService's finSvc loop, LO-V10).
    withDb((db, repo) => {
      seedFs(db, {
        provider: "OMT",
        serviceType: "SEND",
        amount: 40,
        currency: "EUR",
        commissionModel: 0,
        isSettled: 1,
        profitUsd: 4,
        userId: 1,
        clientName: "Eur Client",
      });
      const rows = runWithTenant(1, () =>
        repo.getFinancialSettledByProvider(FROM, TO),
      );
      const omt = rows.find((r) => r.provider === "OMT");
      expect(omt).toBeUndefined();
    });
  });

  it("getFinancialSettledByProvider: a genuine USD row is unaffected (still lands in the usd columns)", () => {
    withDb((db, repo) => {
      seedFs(db, {
        provider: "OMT",
        serviceType: "SEND",
        amount: 40,
        currency: "USD",
        commissionModel: 0,
        isSettled: 1,
        profitUsd: 4,
        userId: 1,
        clientName: "Usd Client",
      });
      const rows = runWithTenant(1, () =>
        repo.getFinancialSettledByProvider(FROM, TO),
      );
      const omt = rows.find((r) => r.provider === "OMT");
      expect(omt?.revenue_usd).toBe(40);
      expect(omt?.profit_usd).toBe(4);
    });
  });

  it("getByDate (daily_commissions): a EUR row contributes to neither revenue_usd nor revenue_lbp for the day", () => {
    // OBSERVED RED (pre-fix): revenue_usd toBe(0) received 40.
    withDb((db, repo) => {
      seedFs(db, {
        provider: "OMT",
        serviceType: "SEND",
        amount: 40,
        currency: "EUR",
        commissionModel: 0,
        isSettled: 1,
        profitUsd: 4,
        userId: 1,
        clientName: "Eur Client",
      });
      const rows = runWithTenant(1, () =>
        repo.getByDate(FROM_DATE, FROM_DATE, FROM, TO),
      );
      expect(rows[0].revenue_usd).toBe(0);
      expect(rows[0].revenue_lbp).toBe(0);
      expect(rows[0].profit_usd).toBe(0);
      expect(rows[0].profit_lbp).toBe(0);
    });
  });
});

describe("PA-2.8 — mobile-service provider (BOB, legacy commission_model=0) recognises the same way in By Module as the Overview does", () => {
  it("getFinancialSettledByProvider: an UNSETTLED BOB row is recognised (matching getMobileServicesByCurrency's own no-settlement-gate behavior), not silently dropped", () => {
    // OBSERVED RED (pre-fix, corrected LO-R9): expect(bob).toBeDefined()
    // failed (received undefined) — the row was excluded from the query
    // entirely, because BOB is commission_model = 0 and was unsettled, so
    // the old bare `fsStampRecognized` gate dropped it (unlike iPick/Katsh,
    // which are commission_model = 1 and already recognised immediately
    // post-PA-0.1).
    withDb((db, repo) => {
      seedFs(db, {
        provider: "BOB",
        serviceType: "BILL",
        amount: 90,
        cost: 80,
        price: 90,
        commissionModel: 0,
        isSettled: 0,
        profitUsd: 10,
        userId: 1,
        clientName: "Bob Client",
      });
      const rows = runWithTenant(1, () =>
        repo.getFinancialSettledByProvider(FROM, TO),
      );
      const bob = rows.find((r) => r.provider === "BOB");
      expect(bob).toBeDefined();
      expect(bob?.profit_usd).toBe(10);
      expect(bob?.revenue_usd).toBe(90);
    });
  });

  it("getMobileServicesByCurrency (Overview) agrees: the same unsettled BOB row is recognised there too (unchanged, already correct)", () => {
    withDb((db, repo) => {
      seedFs(db, {
        provider: "BOB",
        serviceType: "BILL",
        amount: 90,
        cost: 80,
        price: 90,
        commissionModel: 0,
        isSettled: 0,
        profitUsd: 10,
        userId: 1,
        clientName: "Bob Client",
      });
      const rows = runWithTenant(1, () =>
        repo.getMobileServicesByCurrency(FROM, TO),
      );
      expect(rows[0]?.profit).toBe(10);
    });
  });

  it("getFinancialSettledByProvider: a non-mobile legacy (commission_model=0) UNSETTLED row is still correctly excluded (the gate still applies to genuine commission providers)", () => {
    withDb((db, repo) => {
      seedFs(db, {
        provider: "OMT",
        serviceType: "SEND",
        amount: 50,
        commissionModel: 0,
        isSettled: 0,
        profitUsd: 5,
        userId: 1,
        clientName: "Legacy Client",
      });
      const rows = runWithTenant(1, () =>
        repo.getFinancialSettledByProvider(FROM, TO),
      );
      expect(rows.find((r) => r.provider === "OMT")).toBeUndefined();
    });
  });
});

describe("PA-2.9 — By Module's FS-provider rows carry real cost (not hard-coded 0)", () => {
  it("getFinancialSettledByProvider: a BILL row's cost_usd is fs.cost (weighted), not 0", () => {
    // OBSERVED RED (pre-fix): FinByProviderRow had no cost_usd/cost_lbp field
    // at all — this assertion failed to compile against the old type, and
    // the runtime value (once cast through `as any`) was undefined.
    withDb((db, repo) => {
      seedFs(db, {
        provider: "Katsh",
        serviceType: "BILL",
        amount: 90,
        cost: 80,
        price: 90,
        commissionModel: 1,
        isSettled: 0,
        profitUsd: 10,
        userId: 1,
        clientName: "Katsh Client",
      });
      const rows = runWithTenant(1, () =>
        repo.getFinancialSettledByProvider(FROM, TO),
      );
      const katsh = rows.find((r) => r.provider === "Katsh");
      expect(katsh?.cost_usd).toBe(80);
      expect(katsh?.cost_lbp).toBe(0);
      expect(katsh?.revenue_usd).toBe(90);
      expect(katsh?.profit_usd).toBe(10);
    });
  });
});

describe("PA-2.3 — top-up / buyback profit reaches a dedicated query", () => {
  it("getTopupBuybackProfit: sums TELECOM_CREDIT_BUYBACK + RECHARGE_TOPUP profit, excludes a refunded row entirely", () => {
    // OBSERVED RED (pre-fix): `repo.getTopupBuybackProfit` did not exist —
    // TypeError: repo.getTopupBuybackProfit is not a function.
    withDb((db, repo) => {
      const rc1 = db
        .prepare(
          `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
           VALUES (1, 'MTC', 'USD', 0, 0, 0, ?)`,
        )
        .run(D);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, created_at)
         VALUES (1, 'TELECOM_CREDIT_BUYBACK', 'ACTIVE', 'recharges', ?, 1, 9, 3, ?)`,
      ).run(Number(rc1.lastInsertRowid), D);

      const rc2 = db
        .prepare(
          `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
           VALUES (1, 'WHISH_APP', 'USD', 0, 0, 0, ?)`,
        )
        .run(D);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, created_at)
         VALUES (1, 'RECHARGE_TOPUP', 'ACTIVE', 'recharges', ?, 1, 20, 1, ?)`,
      ).run(Number(rc2.lastInsertRowid), D);

      // A REFUNDED buyback: excluded via notRefunded(r), same convention as
      // getRechargesByCurrency/getRechargesByCarrier.
      const rc3 = db
        .prepare(
          `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
           VALUES (1, 'MTC', 'USD', 0, 0, 1, ?)`,
        )
        .run(D);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, created_at)
         VALUES (1, 'TELECOM_CREDIT_BUYBACK', 'ACTIVE', 'recharges', ?, 1, 5, 2, ?)`,
      ).run(Number(rc3.lastInsertRowid), D);

      const result = runWithTenant(1, () =>
        repo.getTopupBuybackProfit(FROM, TO),
      );
      expect(result.profit_usd).toBe(4); // 3 + 1, refunded row excluded
      expect(result.profit_lbp).toBe(0);
      expect(result.count).toBe(2);
    });
  });
});

describe("PA-3.1 — sales kept change stored in LBP (profit_lbp) reaches net", () => {
  it("getSalesProfit: sums t.profit_lbp alongside t.profit_usd", () => {
    // OBSERVED RED (pre-fix): SalesProfitRow had no profit_lbp field —
    // the query only ever selected profit_usd.
    withDb((db, repo) => {
      const sale = db
        .prepare(
          `INSERT INTO sales (tenant_id, status, final_amount_usd, paid_usd, paid_lbp, exchange_rate_snapshot, created_at)
           VALUES (1, 'completed', 6, 6, 0, 90000, ?)`,
        )
        .run(D);
      const saleId = Number(sale.lastInsertRowid);
      db.prepare(
        `INSERT INTO sale_items (tenant_id, sale_id, product_id, sold_price_usd, cost_price_snapshot_usd, quantity, is_refunded)
         VALUES (1, ?, NULL, 6, 4, 1, 0)`,
      ).run(saleId);
      // profit_usd carries the item margin ($2); profit_lbp carries kept
      // change only (90,000 LBP), per SalesRepository.ts's own convention
      // (profit_usd: saleProfitUsd + kept_change_usd, profit_lbp: kept_change_lbp).
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, profit_lbp, created_at)
         VALUES (1, 'SALE', 'ACTIVE', 'sales', ?, 6, 2, 90000, ?)`,
      ).run(saleId, D);

      const result = runWithTenant(1, () => repo.getSalesProfit(FROM, TO));
      expect(result.profit_usd).toBe(2);
      expect(result.profit_lbp).toBe(90000);
    });
  });

  it("getByDate (daily_sales_profit): the day's profit_lbp includes the sale's kept change", () => {
    // OBSERVED RED (pre-fix): rows[0].profit_lbp toBe(90000) received 0 —
    // daily_sales_profit never selected profit_lbp at all, and the final
    // SELECT's profit_lbp column never referenced dsp.
    withDb((db, repo) => {
      const sale = db
        .prepare(
          `INSERT INTO sales (tenant_id, status, final_amount_usd, paid_usd, paid_lbp, exchange_rate_snapshot, created_at)
           VALUES (1, 'completed', 6, 6, 0, 90000, ?)`,
        )
        .run(D);
      const saleId = Number(sale.lastInsertRowid);
      db.prepare(
        `INSERT INTO sale_items (tenant_id, sale_id, product_id, sold_price_usd, cost_price_snapshot_usd, quantity, is_refunded)
         VALUES (1, ?, NULL, 6, 4, 1, 0)`,
      ).run(saleId);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, profit_lbp, created_at)
         VALUES (1, 'SALE', 'ACTIVE', 'sales', ?, 6, 2, 90000, ?)`,
      ).run(saleId, D);

      const rows = runWithTenant(1, () =>
        repo.getByDate(FROM_DATE, FROM_DATE, FROM, TO),
      );
      expect(rows[0].profit_lbp).toBe(90000);
      expect(rows[0].net_profit_lbp).toBe(90000);
    });
  });
});

describe("PA-2.2 — By Date carries the same three extra sources as By Module (PA-2.1): kept change, discounts, bills-only supplier commission", () => {
  it("getByDate: a debt-repayment kept-change row reaches the day's profit_usd/net_profit_usd", () => {
    // OBSERVED RED (pre-fix): rows[0].profit_usd toBe(3) received 0 — no CTE
    // ever selected DEBT_REPAYMENT/KEPT_CHANGE profit.
    withDb((db, repo) => {
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, created_at)
         VALUES (1, 'DEBT_REPAYMENT', 'ACTIVE', 'debt_ledger', 1, 10, 3, ?)`,
      ).run(D);
      const rows = runWithTenant(1, () =>
        repo.getByDate(FROM_DATE, FROM_DATE, FROM, TO),
      );
      expect(rows[0].profit_usd).toBe(3);
      expect(rows[0].net_profit_usd).toBe(3);
    });
  });

  it("getByDate: a COUNTERPARTY_DISCOUNT row reaches the day's profit_usd", () => {
    // OBSERVED RED (pre-fix): rows[0].profit_usd toBe(-4) received 0.
    withDb((db, repo) => {
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, created_at)
         VALUES (1, 'COUNTERPARTY_DISCOUNT', 'ACTIVE', 'debt_ledger', 1, 0, -4, ?)`,
      ).run(D);
      const rows = runWithTenant(1, () =>
        repo.getByDate(FROM_DATE, FROM_DATE, FROM, TO),
      );
      expect(rows[0].profit_usd).toBe(-4);
    });
  });

  it("getByDate: a bills-only SUPPLIER_SETTLEMENT row reaches the day's profit_usd (degraded schema — no allocations table, so it is bills-only by construction)", () => {
    // OBSERVED RED (pre-fix): rows[0].profit_usd toBe(7) received 0.
    withDb((db, repo) => {
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, created_at)
         VALUES (1, 'SUPPLIER_SETTLEMENT', 'ACTIVE', 'supplier_ledger', 1, 0, 7, ?)`,
      ).run(D);
      const rows = runWithTenant(1, () =>
        repo.getByDate(FROM_DATE, FROM_DATE, FROM, TO),
      );
      expect(rows[0].profit_usd).toBe(7);
    });
  });

  it("getByDate: TELECOM_CREDIT_BUYBACK/RECHARGE_TOPUP profit reaches the day's profit_usd (PA-2.3, By Date half)", () => {
    // OBSERVED RED (pre-fix): rows[0].profit_usd toBe(4) received 0.
    withDb((db, repo) => {
      const rc = db
        .prepare(
          `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
           VALUES (1, 'MTC', 'USD', 0, 0, 0, ?)`,
        )
        .run(D);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, created_at)
         VALUES (1, 'TELECOM_CREDIT_BUYBACK', 'ACTIVE', 'recharges', ?, 1, 9, 4, ?)`,
      ).run(Number(rc.lastInsertRowid), D);
      const rows = runWithTenant(1, () =>
        repo.getByDate(FROM_DATE, FROM_DATE, FROM, TO),
      );
      expect(rows[0].profit_usd).toBe(4);
    });
  });
});

describe("PA-3.6 — pending FS commission carries the same partner-coverage gate as the settled bucket", () => {
  it("getFinancialPendingByCurrency: a FOR-partner unsettled row with 0% partner coverage contributes 0, not the full stamp", () => {
    // OBSERVED RED (pre-fix): rows[0]?.commission toBe(0) received 5 — the
    // pending bucket had no partnerCoverageRatio weighting at all, so a
    // wholly partner-owed row's full commission counted as "the shop's
    // pending money" even though none of it is the shop's.
    withDb((db, repo) => {
      const seeded = seedFs(db, {
        provider: "OMT",
        serviceType: "SEND",
        amount: 50,
        commissionModel: 0,
        isSettled: 0,
        profitUsd: 5,
        userId: 1,
        clientName: "Partner Client",
      });
      db.prepare(
        `INSERT INTO partner_ledger (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, covered_amount, created_at)
         VALUES (1, 1, 'FOR_PARTNER', 'financial_services', ?, 50, 'USD', 'CREDIT', 0, ?)`,
      ).run(seeded.fsId, D);

      const rows = runWithTenant(1, () =>
        repo.getFinancialPendingByCurrency(FROM, TO),
      );
      expect(rows.find((r) => r.currency === "USD")).toBeUndefined();
    });
  });
});

describe("PA-3.10 — deferred cashless-commission is exposed as its own DeferredProfitRow field", () => {
  it("getDeferredProfit: cashless_deferred_profit_usd carries ONLY the cashless-settlement share, not ordinary debt-pending recharge/service profit", () => {
    // OBSERVED RED (pre-fix): DeferredProfitRow had no
    // cashless_deferred_profit_usd/_lbp field — the card could not
    // distinguish "cashless commission awaiting client repayment" from
    // "any debt-pending profit at all".
    withDb((db, repo) => {
      // An ordinary debt-pending RECHARGE (not a cashless FS settlement) —
      // must NOT appear in cashless_deferred_profit_usd.
      const rc = db
        .prepare(
          `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
           VALUES (1, 'MTC', 'USD', 10, 8, 0, ?)`,
        )
        .run(D);
      const rcTxn = db
        .prepare(
          `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, created_at)
           VALUES (1, 'RECHARGE', 'ACTIVE', 'recharges', ?, 1, 10, 2, ?)`,
        )
        .run(Number(rc.lastInsertRowid), D);
      db.prepare(
        `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, transaction_id, covered_usd, created_at)
         VALUES (1, 1, 'Recharge Debt', 10, ?, 0, ?)`,
      ).run(Number(rcTxn.lastInsertRowid), D);

      const result = runWithTenant(1, () => repo.getDeferredProfit(FROM, TO));
      expect(result.cashless_deferred_profit_usd).toBe(0);
      expect(result.cashless_deferred_profit_lbp).toBe(0);
      // The ordinary debt-pending recharge profit still reaches the
      // pre-existing combined bucket, unaffected by this addition.
      expect(result.client_debt_profit_usd).toBe(2);
    });
  });

  it("getDeferredProfit: a cashless (non-BILL) settlement allocation still awaiting client repayment DOES populate cashless_deferred_profit_usd", () => {
    withDb((db, repo) => {
      const seeded = seedFs(db, {
        provider: "WHISH",
        serviceType: "SEND",
        amount: 100,
        commissionModel: 1,
        isSettled: 1,
        profitUsd: 0,
        userId: 1,
        clientName: "Cashless Client",
      });
      // The underlying transfer is itself debt-pending (client hasn't repaid).
      db.prepare(
        `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, transaction_id, covered_usd, created_at)
         VALUES (1, 1, 'Recharge Debt', 100, ?, 0, ?)`,
      ).run(seeded.txnId, D);
      db.prepare(
        `UPDATE financial_services SET settlement_id = 1 WHERE id = ?`,
      ).run(seeded.fsId);
      db.prepare(
        `INSERT INTO settlement_commission_allocations
           (tenant_id, settlement_ledger_id, financial_service_id, service_type, provider, commission_usd, commission_lbp, created_at)
         VALUES (1, 1, ?, 'SEND', 'WHISH', 3, 0, ?)`,
      ).run(seeded.fsId, D);

      const result = runWithTenant(1, () => repo.getDeferredProfit(FROM, TO));
      expect(result.cashless_deferred_profit_usd).toBe(3);
    });
  });
});

describe("PA-2.10 — reconciliation guards: Σ By Module = Overview gross per currency; Σ By Date net = Overview net", () => {
  // A deliberately diverse fixture — one row per source that now
  // contributes to getSummary's gross profit — all on the SAME calendar
  // day, so getByDate's single row is directly comparable to getSummary's
  // totals. Not a rule-17 regression proof (nothing here was ever RED as a
  // single mechanism — PA-2.10 is a NEW cross-check that only makes sense
  // once every other PA item in this lane is implemented; it proves the
  // SUM, not any one fix), but it is exactly what "prove the whole picture
  // agrees" means, and it exercises the real ProfitService (not a fake).
  //
  // LO-V3 (round 2 adversarial review): the ORIGINAL fixture (sale, OMT
  // commission, kept change, discount, bills-only settlement, buyback,
  // expense) omitted every source where the tabs actually disagreed —
  // recharge, mobile, custom, maintenance, loto, exchange, PM fee, a
  // cashless settlement allocation. This version adds one row per omitted
  // source, INCLUDING an off-currency kept change on the recharge, mobile
  // and loto rows (LO-V1's own fix target), per the LO-V1 finding's own
  // instruction ("Extend PA-2.10's fixture with a recharge and a loto row
  // carrying off-currency kept change") plus mobile and a cashless
  // allocation for full source coverage.
  //
  // LO-R2 (round 3 adversarial review): the round-2 fixture still
  // deliberately left out an off-currency kept change on an FS COMMISSION
  // row (OMT/WHISH's getFinancialSettledByCurrency, the Overview's own
  // bucket) — exactly the case that disagreed in practice, since By Module
  // (getFinancialSettledByProvider) and By Date (daily_commissions) already
  // carried it. getFinancialSettledByCurrency now emits kept_change_usd/
  // _lbp too (PA-3.1's last arm), so this fixture adds a model-1 OMT row
  // with LBP kept change on a USD-native commission (the D1 Whish-fee
  // shape) to prove the reconciliation actually holds for it, not just for
  // the sources that already agreed.
  it("Σ getByModule profit per currency (incl. kept_change_usd/_lbp) equals getSummary gross profit per currency, and Σ getByDate net equals getSummary net", () => {
    withDb((db, repo) => {
      // Sale: $10 revenue, $6 cost -> $4 profit_usd; 50,000 LBP kept change
      // (PA-3.1) -> profit_lbp.
      const sale = db
        .prepare(
          `INSERT INTO sales (tenant_id, status, final_amount_usd, paid_usd, paid_lbp, exchange_rate_snapshot, discount_usd, created_at)
           VALUES (1, 'completed', 10, 10, 0, 90000, 0, ?)`,
        )
        .run(D);
      const saleId = Number(sale.lastInsertRowid);
      db.prepare(
        `INSERT INTO sale_items (tenant_id, sale_id, product_id, sold_price_usd, cost_price_snapshot_usd, quantity, is_refunded)
         VALUES (1, ?, NULL, 10, 6, 1, 0)`,
      ).run(saleId);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, profit_lbp, created_at)
         VALUES (1, 'SALE', 'ACTIVE', 'sales', ?, 10, 4, 50000, ?)`,
      ).run(saleId, D);

      // Settled OMT commission: $3 profit (legacy model-0, no off-currency
      // stamp — see the describe block's own note on why FS commission
      // kept change is out of this fixture).
      seedFs(db, {
        provider: "OMT",
        serviceType: "SEND",
        amount: 20,
        commissionModel: 0,
        isSettled: 1,
        profitUsd: 3,
        userId: 1,
        clientName: "Commission Client",
      });

      // LO-R2 (round 3) — a model-1 OMT commission row carrying LBP kept
      // change on the SAME transaction (currency='USD', so t.profit_lbp is
      // the OTHER-currency component — exactly the D1 Whish-fee shape this
      // fixture previously, deliberately, left out, per the describe
      // block's now-superseded note: getFinancialSettledByCurrency now
      // carries kept_change_usd/_lbp, closing PA-3.1's last arm).
      seedFs(db, {
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 30,
        commissionModel: 1,
        isSettled: 1,
        profitUsd: 2, // own-currency (USD) commission
        profitLbp: 15000, // off-currency (LBP) kept change
        userId: 1,
        clientName: "Kept-Change Client",
      });

      // LO-V3 — a CASHLESS WHISH settlement commission ($6), via
      // settlement_commission_allocations (D17), settlement_ledger_id=2 to
      // avoid colliding with the bills-only settlement's source_id=1 below
      // (cashlessCommissionBatch keys on THAT id).
      const whish = seedFs(db, {
        provider: "WHISH",
        serviceType: "SEND",
        amount: 15,
        commissionModel: 1,
        isSettled: 1,
        profitUsd: 0,
        userId: 1,
        clientName: "Cashless Client",
      });
      db.prepare(`UPDATE financial_services SET settlement_id = 2 WHERE id = ?`).run(
        whish.fsId,
      );
      db.prepare(
        `INSERT INTO settlement_commission_allocations
           (tenant_id, settlement_ledger_id, financial_service_id, service_type, provider, commission_usd, commission_lbp, created_at)
         VALUES (1, 2, ?, 'SEND', 'WHISH', 6, 0, ?)`,
      ).run(whish.fsId, D);

      // LO-V3 — a mobile (iPick) LBP-native row: $20,000... 20,000 LBP own
      // margin, PLUS LO-V1's target: a $2 USD kept change stamped on the
      // SAME transaction (fs.currency = 'LBP', so t.profit_usd is the
      // OTHER-currency component).
      seedFs(db, {
        provider: "iPick",
        serviceType: "BILL",
        amount: 100000,
        cost: 80000,
        price: 100000,
        currency: "LBP",
        commissionModel: 1,
        isSettled: 1,
        profitUsd: 2, // off-currency (USD) kept change
        profitLbp: 20000, // own-currency (LBP) margin
        userId: 1,
        clientName: "Mobile Client",
      });

      // Kept change on a debt repayment: $1.
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, created_at)
         VALUES (1, 'DEBT_REPAYMENT', 'ACTIVE', 'debt_ledger', 1, 5, 1, ?)`,
      ).run(D);

      // Counterparty discount: -$2.
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, created_at)
         VALUES (1, 'COUNTERPARTY_DISCOUNT', 'ACTIVE', 'debt_ledger', 1, 0, -2, ?)`,
      ).run(D);

      // Bills-only supplier settlement: $5. source_id=1 doubles as its
      // settlement_ledger_id for cashlessCommissionBatch's purposes — kept
      // at 1 deliberately, distinct from the WHISH allocation's id=2 above.
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, created_at)
         VALUES (1, 'SUPPLIER_SETTLEMENT', 'ACTIVE', 'supplier_ledger', 1, 0, 5, ?)`,
      ).run(D);

      // Top-up/buyback: $3.
      const rc = db
        .prepare(
          `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
           VALUES (1, 'MTC', 'USD', 0, 0, 0, ?)`,
        )
        .run(D);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, created_at)
         VALUES (1, 'TELECOM_CREDIT_BUYBACK', 'ACTIVE', 'recharges', ?, 1, 9, 3, ?)`,
      ).run(Number(rc.lastInsertRowid), D);

      // LO-V3/LO-V1 — a PLAIN recharge (type='RECHARGE', distinct from the
      // TELECOM_CREDIT_BUYBACK row above — getRechargesByCarrier only joins
      // type='RECHARGE'): $5 own USD margin, PLUS a 30,000 LBP kept change
      // stamped on the SAME transaction (currency_code='USD', so
      // t.profit_lbp is the OTHER-currency component).
      const rc2 = db
        .prepare(
          `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
           VALUES (1, 'MTC', 'USD', 20, 15, 0, ?)`,
        )
        .run(D);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, profit_lbp, created_at)
         VALUES (1, 'RECHARGE', 'ACTIVE', 'recharges', ?, 1, 20, 5, 30000, ?)`,
      ).run(Number(rc2.lastInsertRowid), D);

      // LO-V3 — custom service: $3 profit_usd.
      const cs = db
        .prepare(
          `INSERT INTO custom_services (tenant_id, status, price_usd, price_lbp, cost_usd, cost_lbp, is_refunded, created_at)
           VALUES (1, 'completed', 8, 0, 5, 0, 0, ?)`,
        )
        .run(D);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, created_at)
         VALUES (1, 'CUSTOM_SERVICE', 'ACTIVE', 'custom_services', ?, 8, 3, ?)`,
      ).run(Number(cs.lastInsertRowid), D);

      // LO-V3 — maintenance: $5 profit_usd (no parts split, both 0).
      const m = db
        .prepare(
          `INSERT INTO maintenance (tenant_id, status, final_amount_usd, final_amount_lbp, cost_usd, cost_lbp, is_refunded, created_at)
           VALUES (1, 'Delivered_Paid', 12, 0, 7, 0, 0, ?)`,
        )
        .run(D);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, created_at)
         VALUES (1, 'MAINTENANCE', 'ACTIVE', 'maintenance', ?, 12, 5, ?)`,
      ).run(Number(m.lastInsertRowid), D);

      // LO-V3/LO-V1 — loto: 10,000 LBP own commission, PLUS a $1 USD kept
      // change on the SAME transaction (a loto ticket is always LBP-native
      // — see getLotoTotals' own comment).
      const lt = db
        .prepare(
          `INSERT INTO loto_tickets (tenant_id, sale_amount, is_refunded, created_at)
           VALUES (1, 200000, 0, ?)`,
        )
        .run(D);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, profit_lbp, created_at)
         VALUES (1, 'LOTO', 'ACTIVE', 'loto_tickets', ?, 0, 1, 10000, ?)`,
      ).run(Number(lt.lastInsertRowid), D);

      // LO-V3 — exchange: $4 profit_usd (leg1 + leg2).
      db.prepare(
        `INSERT INTO exchange_transactions (tenant_id, amount_in, leg1_profit_usd, leg2_profit_usd, is_refunded, created_at)
         VALUES (1, 40, 4, 0, 0, ?)`,
      ).run(D);

      // LO-V3 — a payment-method fee ($1.50). getPmFeeTotals reads
      // financial_services.payment_method_fee directly (no transactions
      // join), so this fs row needs no accompanying transaction row.
      db.prepare(
        `INSERT INTO financial_services (tenant_id, provider, service_type, amount, currency, commission, commission_model, cost, price, is_settled, is_refunded, payment_method_fee, created_at)
         VALUES (1, 'OMT_APP', 'RECEIVE', 10, 'USD', 0, 1, 0, 0, 1, 0, 1.5, ?)`,
      ).run(D);

      // Expenses: $2 (affects NET, not gross).
      db.prepare(
        `INSERT INTO expenses (tenant_id, status, amount_usd, amount_lbp, expense_date)
         VALUES (1, 'active', 2, 0, ?)`,
      ).run(D);

      const service = runWithTenant(1, () => new ProfitService(repo));
      const summary = runWithTenant(1, () =>
        service.getSummary(FROM_DATE, FROM_DATE),
      );
      const byModule = runWithTenant(1, () =>
        service.getByModule(FROM_DATE, FROM_DATE),
      );
      const byDate = runWithTenant(1, () =>
        service.getByDate(FROM_DATE, FROM_DATE),
      );

      // LO-V1 — a row's `kept_change_usd`/`_lbp` is ADDITIVE (not already
      // folded into `profit_usd`/`profit_lbp` — see ProfitByModule's own
      // doc comment), so the reconciliation sum must include both.
      const moduleProfitUsd = byModule.reduce(
        (s, r) => s + r.profit_usd + (r.kept_change_usd ?? 0),
        0,
      );
      const moduleProfitLbp = byModule.reduce(
        (s, r) => s + r.profit_lbp + (r.kept_change_lbp ?? 0),
        0,
      );
      expect(moduleProfitUsd).toBeCloseTo(summary.totals.gross_profit_usd, 6);
      expect(moduleProfitLbp).toBeCloseTo(summary.totals.gross_profit_lbp, 6);

      // Worked expectation, independent of the implementation (a second
      // method — rule 4's "recompute by a different method"):
      // USD: 4 (sale) + 3 (OMT commission) + 2 (OMT kept-change row's OWN
      //      USD commission) + 6 (cashless WHISH) + 1.5 (PM fee) +
      //      5 (recharge margin) + 3 (custom) + 5 (maint) + 4 (exchange) +
      //      2 (mobile kept change) + 1 (loto kept change) +
      //      1 (debt kept change) - 2 (discount) + 5 (bills) + 3 (topup)
      //      = 43.5
      // LBP: 50,000 (sale kept change) + 15,000 (OMT row's LBP kept change,
      //      LO-R2) + 20,000 (mobile margin) + 30,000 (recharge kept
      //      change) + 10,000 (loto margin) = 125,000
      expect(summary.totals.gross_profit_usd).toBeCloseTo(43.5, 6);
      expect(summary.totals.gross_profit_lbp).toBeCloseTo(125000, 6);
      expect(summary.totals.net_profit_usd).toBeCloseTo(41.5, 6); // 43.5 - 2 expense
      expect(summary.totals.net_profit_lbp).toBeCloseTo(125000, 6); // no LBP expense

      expect(byDate).toHaveLength(1);
      expect(byDate[0].net_profit_usd).toBeCloseTo(
        summary.totals.net_profit_usd,
        6,
      );
      expect(byDate[0].net_profit_lbp).toBeCloseTo(
        summary.totals.net_profit_lbp,
        6,
      );
    });
  });
});

describe("LO-V2 (round 2 adversarial review) — daily_commissions carries the SAME provider-recognition gate as getFinancialSettledByProvider", () => {
  it("getByDate: an UNSETTLED legacy BOB row is recognised (matching getFinancialSettledByProvider/getMobileServicesByCurrency), not silently dropped", () => {
    // OBSERVED RED (pre-fix): rows[0].profit_usd toBe(10) received 0 —
    // daily_commissions' WHERE was bare fsStampRecognized (no MOBILE_PROVIDERS
    // OR-clause), so an unsettled BOB row counted on the Overview and By
    // Module but not By Date (probe P2 in the round-2 review: Overview 10,
    // By Module 10, By Date 0).
    withDb((db, repo) => {
      seedFs(db, {
        provider: "BOB",
        serviceType: "BILL",
        amount: 90,
        cost: 80,
        price: 90,
        commissionModel: 0,
        isSettled: 0,
        profitUsd: 10,
        userId: 1,
        clientName: "Bob Client",
      });
      const rows = runWithTenant(1, () =>
        repo.getByDate(FROM_DATE, FROM_DATE, FROM, TO),
      );
      expect(rows[0].profit_usd).toBe(10);
    });
  });

  it("getFinancialSettledByProvider AND getByDate both exclude a provider outside the known 8 codes, matching the Overview (which has no bucket for it)", () => {
    // OBSERVED RED (pre-fix): getFinancialSettledByProvider's rows.find(...)
    // returned a row with profit_usd 4 (present); the Overview's own
    // getFinancialSettledByCurrency/getMobileServicesByCurrency have no
    // provider IN (...) match for 'SUYOOL' at all, so it showed $0 there —
    // a provider By Module could show money for and the Overview couldn't
    // (probe P3: Overview 0, By Module 4).
    withDb((db, repo) => {
      seedFs(db, {
        provider: "SUYOOL",
        serviceType: "SEND",
        amount: 40,
        commissionModel: 1, // model-1 -> would pass bare fsStampRecognized
        isSettled: 0,
        profitUsd: 4,
        userId: 1,
        clientName: "Unknown Provider Client",
      });
      const byProvider = runWithTenant(1, () =>
        repo.getFinancialSettledByProvider(FROM, TO),
      );
      expect(byProvider.find((r) => r.provider === "SUYOOL")).toBeUndefined();

      const byDate = runWithTenant(1, () =>
        repo.getByDate(FROM_DATE, FROM_DATE, FROM, TO),
      );
      expect(byDate[0].profit_usd).toBe(0);
    });
  });
});

describe("LO-V1 (round 2 adversarial review) — kept change stamped in the OTHER currency reaches recharges/mobile/loto (repo-level unit coverage)", () => {
  it("getRechargesByCurrency: a USD recharge's LBP kept change is exposed as kept_change on the USD row (not dropped)", () => {
    // OBSERVED RED (pre-fix): RechargeCurrencyRow had no `kept_change` field
    // at all — a USD recharge's LBP kept change (t.profit_lbp) was never
    // selected by this query.
    withDb((db, repo) => {
      const rc = db
        .prepare(
          `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
           VALUES (1, 'MTC', 'USD', 20, 15, 0, ?)`,
        )
        .run(D);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, profit_lbp, created_at)
         VALUES (1, 'RECHARGE', 'ACTIVE', 'recharges', ?, 1, 20, 5, 45000, ?)`,
      ).run(Number(rc.lastInsertRowid), D);

      const rows = runWithTenant(1, () =>
        repo.getRechargesByCurrency(FROM, TO),
      );
      const usdRow = rows.find((r) => r.currency_code === "USD");
      expect(usdRow?.profit).toBe(5);
      expect(usdRow?.kept_change).toBe(45000);
    });
  });

  it("getRechargesByCarrier: the same USD recharge's LBP kept change is exposed as kept_change_lbp", () => {
    withDb((db, repo) => {
      const rc = db
        .prepare(
          `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
           VALUES (1, 'MTC', 'USD', 20, 15, 0, ?)`,
        )
        .run(D);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, profit_lbp, created_at)
         VALUES (1, 'RECHARGE', 'ACTIVE', 'recharges', ?, 1, 20, 5, 45000, ?)`,
      ).run(Number(rc.lastInsertRowid), D);

      const rows = runWithTenant(1, () =>
        repo.getRechargesByCarrier(FROM, TO),
      );
      const mtc = rows.find((r) => r.carrier === "MTC");
      expect(mtc?.profit_usd).toBe(5);
      expect(mtc?.kept_change_lbp).toBe(45000);
    });
  });

  it("getByDate (daily_recharges): the same kept change reaches the day's profit_lbp/net_profit_lbp", () => {
    withDb((db, repo) => {
      const rc = db
        .prepare(
          `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
           VALUES (1, 'MTC', 'USD', 20, 15, 0, ?)`,
        )
        .run(D);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, profit_lbp, created_at)
         VALUES (1, 'RECHARGE', 'ACTIVE', 'recharges', ?, 1, 20, 5, 45000, ?)`,
      ).run(Number(rc.lastInsertRowid), D);

      const rows = runWithTenant(1, () =>
        repo.getByDate(FROM_DATE, FROM_DATE, FROM, TO),
      );
      expect(rows[0].profit_lbp).toBe(45000);
      expect(rows[0].net_profit_lbp).toBe(45000);
    });
  });

  it("getMobileServicesByCurrency: an LBP iPick row's USD kept change is exposed as kept_change on the LBP row", () => {
    withDb((db, repo) => {
      seedFs(db, {
        provider: "iPick",
        serviceType: "BILL",
        amount: 100000,
        cost: 80000,
        price: 100000,
        currency: "LBP",
        commissionModel: 1,
        isSettled: 1,
        profitUsd: 2,
        profitLbp: 20000,
        userId: 1,
        clientName: "Mobile Client",
      });
      const rows = runWithTenant(1, () =>
        repo.getMobileServicesByCurrency(FROM, TO),
      );
      const lbpRow = rows.find((r) => r.currency === "LBP");
      expect(lbpRow?.profit).toBe(20000);
      expect(lbpRow?.kept_change).toBe(2);
    });
  });

  it("getLotoTotals: a loto ticket's USD kept change is exposed as kept_change_usd", () => {
    // OBSERVED RED (pre-fix): LotoTotalsRow had no `kept_change_usd` field —
    // t.profit_usd on a loto transaction was never selected (probe: a $1
    // kept change on a loto sale showed gross_usd = 0).
    withDb((db, repo) => {
      const lt = db
        .prepare(
          `INSERT INTO loto_tickets (tenant_id, sale_amount, is_refunded, created_at)
           VALUES (1, 200000, 0, ?)`,
        )
        .run(D);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, profit_lbp, created_at)
         VALUES (1, 'LOTO', 'ACTIVE', 'loto_tickets', ?, 0, 1, 10000, ?)`,
      ).run(Number(lt.lastInsertRowid), D);

      const result = runWithTenant(1, () => repo.getLotoTotals(FROM, TO));
      expect(result.profit_lbp).toBe(10000);
      expect(result.kept_change_usd).toBe(1);
    });
  });

  it("getByDate (daily_loto): the loto USD kept change reaches the day's profit_usd/net_profit_usd", () => {
    withDb((db, repo) => {
      const lt = db
        .prepare(
          `INSERT INTO loto_tickets (tenant_id, sale_amount, is_refunded, created_at)
           VALUES (1, 200000, 0, ?)`,
        )
        .run(D);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, profit_lbp, created_at)
         VALUES (1, 'LOTO', 'ACTIVE', 'loto_tickets', ?, 0, 1, 10000, ?)`,
      ).run(Number(lt.lastInsertRowid), D);

      const rows = runWithTenant(1, () =>
        repo.getByDate(FROM_DATE, FROM_DATE, FROM, TO),
      );
      expect(rows[0].profit_usd).toBe(1);
      expect(rows[0].net_profit_usd).toBe(1);
    });
  });
});

describe("LO-V12 (round 2 adversarial review) — profit-only By Module rows report ZERO revenue, not revenue = profit", () => {
  it("getByModule: KEPT_CHANGE/COUNTERPARTY_DISCOUNT/SUPPLIER_COMMISSION/TOPUP_BUYBACK rows carry revenue_usd = 0 (not the profit amount duplicated)", () => {
    // OBSERVED RED (pre-fix): row.revenue_usd toBe(0) received 1 (equal to
    // profit_usd) for every one of these four rows — a By Module TOTAL
    // footer summing revenue_usd would double-count profit-only money as
    // both revenue AND profit, and computeMargin would report a
    // nonsensical 100% margin (or -100% for a forgiven discount).
    withDb((db, repo) => {
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, created_at)
         VALUES (1, 'DEBT_REPAYMENT', 'ACTIVE', 'debt_ledger', 1, 5, 1, ?)`,
      ).run(D);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, created_at)
         VALUES (1, 'COUNTERPARTY_DISCOUNT', 'ACTIVE', 'debt_ledger', 1, 0, -4, ?)`,
      ).run(D);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, created_at)
         VALUES (1, 'SUPPLIER_SETTLEMENT', 'ACTIVE', 'supplier_ledger', 1, 0, 7, ?)`,
      ).run(D);
      const rc = db
        .prepare(
          `INSERT INTO recharges (tenant_id, carrier, currency_code, price, cost, is_refunded, created_at)
           VALUES (1, 'MTC', 'USD', 0, 0, 0, ?)`,
        )
        .run(D);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, created_at)
         VALUES (1, 'TELECOM_CREDIT_BUYBACK', 'ACTIVE', 'recharges', ?, 1, 9, 3, ?)`,
      ).run(Number(rc.lastInsertRowid), D);

      const service = runWithTenant(1, () => new ProfitService(repo));
      const byModule = runWithTenant(1, () =>
        service.getByModule(FROM_DATE, FROM_DATE),
      );

      const keptChangeRow = byModule.find((r) => r.module === "KEPT_CHANGE");
      const discountRow = byModule.find(
        (r) => r.module === "COUNTERPARTY_DISCOUNT",
      );
      const supplierRow = byModule.find(
        (r) => r.module === "SUPPLIER_COMMISSION",
      );
      const topupRow = byModule.find((r) => r.module === "TOPUP_BUYBACK");

      expect(keptChangeRow?.revenue_usd).toBe(0);
      expect(keptChangeRow?.profit_usd).toBe(1);
      expect(discountRow?.revenue_usd).toBe(0);
      expect(discountRow?.profit_usd).toBe(-4);
      expect(supplierRow?.revenue_usd).toBe(0);
      expect(supplierRow?.profit_usd).toBe(7);
      expect(topupRow?.revenue_usd).toBe(0);
      expect(topupRow?.profit_usd).toBe(3);
    });
  });
});

describe("LO-V7 (round 2 adversarial review) — getLbpBuyRate treats a stored buy_rate of 0 as unconfigured", () => {
  // NOT RUN tonight — red/green proof pending (tomorrow). note #3
  // (2026-09-24, CLOSED "no change") removed combined_net_profit_lbp/
  // combined_rate_used entirely; this test now guards their absence and
  // keeps the substantive LO-V7 regression coverage (a stored buy_rate of 0
  // must degrade to `null`, never flow through as a real rate) on the
  // renamed lbp_buy_rate field, which getLbpBuyRate still backs unchanged.
  it("ProfitService.getSummary: totals.lbp_buy_rate is null (not 0) when the tenant's LBP buy_rate row is stored as 0; combined_net_profit_lbp/combined_rate_used stay absent", () => {
    withDb((db, repo) => {
      db.exec(`
        CREATE TABLE exchange_rates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER,
          to_code TEXT,
          market_rate REAL DEFAULT 0,
          buy_rate REAL,
          sell_rate REAL DEFAULT 0,
          is_stronger INTEGER DEFAULT 1,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO exchange_rates (tenant_id, to_code, buy_rate)
        VALUES (1, 'LBP', 0);
      `);
      db.prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, amount_usd, profit_usd, created_at)
         VALUES (1, 'DEBT_REPAYMENT', 'ACTIVE', 'debt_ledger', 1, 5, 10, ?)`,
      ).run(D);

      const service = runWithTenant(1, () => new ProfitService(repo));
      const summary = runWithTenant(1, () =>
        service.getSummary(FROM_DATE, FROM_DATE),
      );
      expect(summary.totals.lbp_buy_rate).toBeNull();
      expect(summary.totals).not.toHaveProperty("combined_rate_used");
      expect(summary.totals).not.toHaveProperty("combined_net_profit_lbp");
    });
  });
});
