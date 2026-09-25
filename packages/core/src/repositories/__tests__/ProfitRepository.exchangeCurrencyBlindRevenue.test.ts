/**
 * Owner ticket #27 (2026-09-23, verbatim): "in profits page, i see total
 * revenue 68,022,024$ which is a huge number. where did that number come
 * from?"
 *
 * ROOT CAUSE (found by execution, not inspection — rule 28): NOT the debts
 * account page. `getPendingSaleProfit` (the Pending tab) is scoped strictly
 * to `sales`/`sale_items`, and `DebtRepository.addAccountCashEntry` (the
 * Debts page's manual cash-advance/credit entry) writes a `transactions` row
 * typed `DEBT_CASH_OUT`/`CREDIT_CASH_IN`/`ACCOUNT_ADJUSTMENT` — none of which
 * appear in `PROFIT_TXN_TYPES`, so it was already excluded from every
 * Profits query (see `ProfitRepository.debtAccountEntriesExcluded.test.ts`
 * for the direct proof of that half of the ticket).
 *
 * The REAL mechanism: `getExchangeTotals` (Overview tile) and `getByDate`'s
 * `daily_exchange` CTE (By Date tab) both summed `exchange_transactions
 * .amount_in` directly into `revenue_usd` with NO currency check.
 * `amount_in` is denominated in `from_currency` — for the shop's own most
 * common trade direction, a client selling LBP for USD
 * (`from_currency = 'LBP'`), `amount_in` is an LBP-scale number (millions)
 * that landed straight into a field the UI formats with a `$` sign
 * (`Profits.tsx` "Total Revenue" tile: `formatAmount(summary.totals
 * .gross_revenue_usd, "USD")`).
 *
 * Reproduction below uses realistic numbers: a client sells 8,950,000 LBP
 * for $100 at a 89,500 LBP/USD rate (a single, very ordinary exchange). RED
 * (pre-fix): revenue_usd came out as 8,950,000 — Beirut's LBP-scale figure
 * literally reported as $8,950,000. GREEN (post-fix): revenue_usd is the
 * real dollar leg, $100.
 *
 * getByDate's fixture is the union-of-tables schema
 * (`ProfitRepository.partnerProportional.byProviderAndDate.test.ts`'s
 * documented, proven `getByDate` fixture) plus the three new currency
 * columns on `exchange_transactions` alone — every other table stays
 * byte-for-byte identical to that proven fixture (rule 14: reuse, don't
 * re-derive a second copy of a schema that already works).
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const D = "2026-09-23 10:00:00";
const FROM = "2026-09-23 00:00:00";
const TO = "2026-09-23 23:59:59";

function createMinimalSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE exchange_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      amount_in REAL NOT NULL DEFAULT 0,
      amount_out REAL NOT NULL DEFAULT 0,
      leg1_profit_usd REAL DEFAULT 0,
      leg2_profit_usd REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL,
      created_at TEXT
    );

    -- Referenced by partnerCoverageRatio; left empty (no for-partner rows)
    -- so every row here recognises at its full, unweighted amount.
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
  `);
}

/**
 * Union-of-tables schema getByDate always touches, reused verbatim from
 * `ProfitRepository.partnerProportional.byProviderAndDate.test.ts`'s proven
 * fixture — only `exchange_transactions` gains the 3 new currency columns.
 */
function createGetByDateSchema(db: Database.Database): void {
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
      receive_fee_model INTEGER NOT NULL DEFAULT 0,
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
      expense_date TEXT,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE exchange_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      from_currency TEXT NOT NULL DEFAULT 'USD',
      to_currency TEXT NOT NULL DEFAULT 'LBP',
      amount_in REAL DEFAULT 0,
      amount_out REAL DEFAULT 0,
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

describe("ProfitRepository — exchange revenue is currency-blind (owner #27)", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  it("getExchangeTotals: an LBP->USD trade reports its real USD leg, not the raw LBP amount_in", () => {
    db = new Database(":memory:");
    createMinimalSchema(db);
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ =
      db;
    repo = new ProfitRepository();

    // Client hands over 8,950,000 LBP, receives $100 (rate 89,500).
    db.prepare(
      `INSERT INTO exchange_transactions
         (tenant_id, from_currency, to_currency, amount_in, amount_out, leg1_profit_usd, leg2_profit_usd, is_refunded, created_at)
       VALUES (1, 'LBP', 'USD', 8950000, 100, 2, 0, 0, ?)`,
    ).run(D);

    const totals = runWithTenant(1, () => repo.getExchangeTotals(FROM, TO));

    // GREEN: the real dollar figure ($100), not the LBP-scale amount_in.
    expect(totals.revenue_usd).toBeCloseTo(100, 2);
    expect(totals.revenue_usd).not.toBeCloseTo(8950000, 2);
    expect(totals.count).toBe(1);
  });

  it("getExchangeTotals: a USD->LBP trade (the shop's other common direction) still reports the USD leg correctly", () => {
    db = new Database(":memory:");
    createMinimalSchema(db);
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ =
      db;
    repo = new ProfitRepository();

    // Client hands over $50, receives 4,475,000 LBP.
    db.prepare(
      `INSERT INTO exchange_transactions
         (tenant_id, from_currency, to_currency, amount_in, amount_out, leg1_profit_usd, leg2_profit_usd, is_refunded, created_at)
       VALUES (1, 'USD', 'LBP', 50, 4475000, 1, 0, 0, ?)`,
    ).run(D);

    const totals = runWithTenant(1, () => repo.getExchangeTotals(FROM, TO));

    expect(totals.revenue_usd).toBeCloseTo(50, 2);
  });

  it("getByDate: the daily_exchange CTE (By Date tab) applies the same currency-aware fix", () => {
    db = new Database(":memory:");
    createGetByDateSchema(db);
    (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ =
      db;
    repo = new ProfitRepository();

    db.prepare(
      `INSERT INTO exchange_transactions
         (tenant_id, from_currency, to_currency, amount_in, amount_out, leg1_profit_usd, leg2_profit_usd, is_refunded, created_at)
       VALUES (1, 'LBP', 'USD', 8950000, 100, 2, 0, 0, ?)`,
    ).run(D);

    const rows = runWithTenant(1, () =>
      repo.getByDate("2026-09-23", "2026-09-23", FROM, TO),
    );
    const day = rows.find((r) => r.date === "2026-09-23");
    expect(day).toBeDefined();
    expect(day!.revenue_usd).toBeCloseTo(100, 2);
    expect(day!.revenue_usd).not.toBeCloseTo(8950000, 2);
    // cost_usd is derived as revenue_usd - profit_usd for exchange rows, so
    // it self-corrects once revenue_usd is fixed: 100 - 2 = 98, not
    // 8,950,000 - 2.
    expect(day!.cost_usd).toBeCloseTo(98, 2);
  });
});
