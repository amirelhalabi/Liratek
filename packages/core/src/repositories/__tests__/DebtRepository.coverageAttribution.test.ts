/**
 * Repayment coverage attribution — what a repayment FIFO-covers (sales
 * `paid_usd`, module-charge `covered_usd/lbp`) must equal what it actually
 * applied to the debt, and a void must give back exactly that coverage.
 *
 * Bug 1 (KNOWN GAP, found 2026-10-07): an LBP tender against a USD debt fed
 * BOTH the caller-converted `amount_usd` fallback into sale coverage AND the
 * full LBP tender into module-charge coverage — one payment covered twice.
 * The void (which unwinds by the 'Repayment' row's own amounts) then left the
 * LBP half stuck as coverage forever.
 *
 * Bug 2 (found 2026-10-07): the void's give-back took from sales first,
 * newest-first, from ANY sale with `paid_usd > 0` — even when the voided
 * repayment's coverage had gone to a module charge, so it un-paid a sale the
 * repayment never touched and left the charge covered.
 *
 * Rule-17 classification (run against the unfixed code first, 2026-10-07):
 *   - "LBP tender vs USD debt across two sales" — INVARIANT, green pre-fix
 *     too (the $50 fallback already landed on sale 1 only); kept as a guard.
 *   - "does not ALSO cover an LBP module charge" — FAILING-FIRST on its
 *     forward assertion (covered_lbp was 4,500,000, expected 0). Its void
 *     half never ran pre-fix, so it is NOT independently proven failing-first.
 *   - "mixed tender" — FAILING-FIRST (sale paid 30, expected 50).
 *   - "covered a module charge" void — FAILING-FIRST (sale 1 went 40 → 20).
 *   - "cash at checkout" void — FAILING-FIRST (cash sale went 30 → 10).
 */

import Database from "better-sqlite3";
import { DebtRepository } from "../DebtRepository.js";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

const RATE = 90_000;
const CLIENT_ID = 1;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name) VALUES (${CLIENT_ID}, 'Repayment Client');

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (drawer_name, currency_code, balance, updated_at) VALUES ('General', 'USD', 0, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance, updated_at) VALUES ('General', 'LBP', 0, CURRENT_TIMESTAMP);

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      session_id INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      final_amount_usd REAL NOT NULL DEFAULT 0,
      paid_usd REAL NOT NULL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 0,
      status TEXT DEFAULT 'completed',
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1
    );

    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      is_refunded INTEGER DEFAULT 0,
      refunded_quantity INTEGER DEFAULT 0,
      tenant_id INTEGER DEFAULT 1
    );

    -- Supplier Stock Intake (LIRA-164): refundTransaction()'s sale branch
    -- unconditionally restores stock via StockBatchRepository.
    -- restoreForSaleItem, which queries/prepares against both tables even
    -- when the product has no batch history — the "refunding the SALE
    -- itself" case above dies in setup without these.
    CREATE TABLE product_stock_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      product_id INTEGER NOT NULL,
      supplier_id INTEGER,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      quantity_remaining INTEGER NOT NULL CHECK(quantity_remaining >= 0),
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      books_debt INTEGER NOT NULL DEFAULT 0,
      ledger_entry_id INTEGER,
      transaction_id INTEGER,
      is_opening INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
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



    CREATE TABLE stock_batch_consumptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      batch_id INTEGER NOT NULL,
      sale_item_id INTEGER,
      custom_service_id INTEGER,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL,
      reason TEXT NOT NULL DEFAULT 'SALE' CHECK(reason IN ('SALE','ADJUSTMENT','SERVICE')),
      is_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ,
  maintenance_part_id INTEGER REFERENCES maintenance_parts(id) ON DELETE SET NULL
);

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT DEFAULT 'BILL',
      amount REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_code TEXT NOT NULL DEFAULT 'USD',
      to_code TEXT NOT NULL,
      market_rate REAL NOT NULL,
      buy_rate REAL NOT NULL,
      sell_rate REAL NOT NULL,
      is_stronger INTEGER NOT NULL DEFAULT 1,
      tenant_id INTEGER DEFAULT 1
    );
    INSERT INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate, is_stronger)
    VALUES ('LBP', ${RATE}, ${RATE}, ${RATE}, 1);
  `);
  return db;
}

function seedCharge(
  db: Database.Database,
  type: string,
  usd: number,
  lbp = 0,
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, created_by)
         VALUES (?, ?, ?, ?, 1)`,
      )
      .run(CLIENT_ID, type, usd, lbp).lastInsertRowid,
  );
}

/** A sale wired the way _markSalesPaidFIFO's JOIN expects. `paidUsd` > 0
 *  models what checkout itself stamped (a cash-paid or part-paid sale). */
function seedSale(
  db: Database.Database,
  finalAmountUsd: number,
  paidUsd = 0,
  createdAt = "2026-10-01 10:00:00",
): number {
  const saleId = Number(
    db
      .prepare(
        `INSERT INTO sales (final_amount_usd, paid_usd, status, created_at) VALUES (?, ?, 'completed', ?)`,
      )
      .run(finalAmountUsd, paidUsd, createdAt).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, client_id, summary)
     VALUES ('SALE', 'sales', ?, 1, ?, ?, 'Sale')`,
  ).run(saleId, finalAmountUsd, CLIENT_ID);
  return saleId;
}

function salePaid(db: Database.Database, saleId: number): number {
  return (
    db.prepare(`SELECT paid_usd FROM sales WHERE id = ?`).get(saleId) as {
      paid_usd: number;
    }
  ).paid_usd;
}

function covered(
  db: Database.Database,
  ledgerId: number,
): { usd: number; lbp: number } {
  return db
    .prepare(
      `SELECT covered_usd AS usd, covered_lbp AS lbp FROM debt_ledger WHERE id = ?`,
    )
    .get(ledgerId) as { usd: number; lbp: number };
}

function ledgerSum(db: Database.Database): { usd: number; lbp: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM debt_ledger WHERE client_id = ?`,
    )
    .get(CLIENT_ID) as { usd: number; lbp: number };
}

function repaymentTxnId(db: Database.Database, repaymentId: number): number {
  return (
    db
      .prepare(`SELECT transaction_id FROM debt_ledger WHERE id = ?`)
      .get(repaymentId) as { transaction_id: number }
  ).transaction_id;
}

describe("repayment coverage equals the amount applied to the debt", () => {
  let db: Database.Database;
  let debtRepo: DebtRepository;
  let txnRepo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    debtRepo = new DebtRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  // Bug 1 — the Debts page's exact payload for "USD debt, paid in LBP":
  // amountUSD = the converted reduction ($50), amountLBP = 0, one LBP leg.
  const lbpTenderAgainstUsdDebt = {
    client_id: CLIENT_ID,
    amount_usd: 50,
    amount_lbp: 0,
    created_by: 1,
    payments: [{ method: "CASH", currencyCode: "LBP", amount: 4_500_000 }],
    tender_exchange_rate: RATE,
  };

  it("LBP tender vs USD debt across two sales: $50 of sale coverage, second sale untouched; void unwinds exactly", () => {
    const sale1 = seedSale(db, 50, 0, "2026-10-01 10:00:00");
    const sale2 = seedSale(db, 50, 0, "2026-10-02 10:00:00");
    seedCharge(db, "Sale Debt", 50);
    seedCharge(db, "Sale Debt", 50);

    const { id } = debtRepo.addRepayment(lbpTenderAgainstUsdDebt);
    expect(salePaid(db, sale1)).toBeCloseTo(50, 2);
    expect(salePaid(db, sale2)).toBeCloseTo(0, 2);
    expect(ledgerSum(db).usd).toBeCloseTo(50, 2);

    txnRepo.voidTransaction(repaymentTxnId(db, id), 1);
    expect(salePaid(db, sale1)).toBeCloseTo(0, 2);
    expect(salePaid(db, sale2)).toBeCloseTo(0, 2);
    expect(ledgerSum(db).usd).toBeCloseTo(100, 2);
  });

  it("the same $50 does not ALSO cover an LBP module charge (no double coverage); void leaves no stuck coverage", () => {
    const sale1 = seedSale(db, 50, 0, "2026-10-01 10:00:00");
    const sale2 = seedSale(db, 50, 0, "2026-10-02 10:00:00");
    seedCharge(db, "Sale Debt", 50);
    seedCharge(db, "Sale Debt", 50);
    const recharge = seedCharge(db, "Recharge Debt", 0, 9_000_000);

    const { id } = debtRepo.addRepayment(lbpTenderAgainstUsdDebt);
    // $50 applied → $50 of coverage, all of it on the oldest sale.
    expect(salePaid(db, sale1)).toBeCloseTo(50, 2);
    expect(salePaid(db, sale2)).toBeCloseTo(0, 2);
    expect(covered(db, recharge).lbp).toBeCloseTo(0, 0);
    expect(covered(db, recharge).usd).toBeCloseTo(0, 2);

    txnRepo.voidTransaction(repaymentTxnId(db, id), 1);
    expect(salePaid(db, sale1)).toBeCloseTo(0, 2);
    expect(covered(db, recharge).lbp).toBeCloseTo(0, 0);
    expect(ledgerSum(db).usd).toBeCloseTo(100, 2);
    expect(ledgerSum(db).lbp).toBeCloseTo(9_000_000, 0);
  });

  it("mixed tender ($30 + 1,800,000 LBP = $50) against USD debt covers the full $50, not just the USD leg", () => {
    const sale1 = seedSale(db, 50, 0, "2026-10-01 10:00:00");
    seedCharge(db, "Sale Debt", 50);
    const recharge = seedCharge(db, "Recharge Debt", 0, 9_000_000);

    debtRepo.addRepayment({
      client_id: CLIENT_ID,
      amount_usd: 50,
      amount_lbp: 0,
      created_by: 1,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 30 },
        { method: "CASH", currencyCode: "LBP", amount: 1_800_000 },
      ],
      tender_exchange_rate: RATE,
    });
    expect(salePaid(db, sale1)).toBeCloseTo(50, 2);
    expect(covered(db, recharge).lbp).toBeCloseTo(0, 0);
  });

  // Bug 2 — the void gives back what THIS repayment covered, not sales first.
  it("voiding a repayment that covered a module charge un-covers the charge, not an earlier fully-paid sale", () => {
    const sale1 = seedSale(db, 40, 0, "2026-10-01 10:00:00");
    seedCharge(db, "Sale Debt", 40);
    debtRepo.addRepayment({
      client_id: CLIENT_ID,
      amount_usd: 40,
      amount_lbp: 0,
      created_by: 1,
    });
    expect(salePaid(db, sale1)).toBeCloseTo(40, 2);

    const recharge = seedCharge(db, "Recharge Debt", 20);
    const { id: r2 } = debtRepo.addRepayment({
      client_id: CLIENT_ID,
      amount_usd: 20,
      amount_lbp: 0,
      created_by: 1,
    });
    expect(covered(db, recharge).usd).toBeCloseTo(20, 2);

    txnRepo.voidTransaction(repaymentTxnId(db, r2), 1);
    expect(salePaid(db, sale1)).toBeCloseTo(40, 2);
    expect(covered(db, recharge).usd).toBeCloseTo(0, 2);
  });

  it("voiding a repayment never un-pays a sale the customer paid in cash at checkout", () => {
    const cashSale = seedSale(db, 30, 30, "2026-10-03 10:00:00");
    const recharge = seedCharge(db, "Recharge Debt", 20);
    const { id } = debtRepo.addRepayment({
      client_id: CLIENT_ID,
      amount_usd: 20,
      amount_lbp: 0,
      created_by: 1,
    });
    expect(covered(db, recharge).usd).toBeCloseTo(20, 2);

    txnRepo.voidTransaction(repaymentTxnId(db, id), 1);
    expect(salePaid(db, cashSale)).toBeCloseTo(30, 2);
    expect(covered(db, recharge).usd).toBeCloseTo(0, 2);
  });
});
