/**
 * LIRA-313 (owner decision 2026-10-12) — Debts → Cash Out above the credit.
 *
 * "If we are paying more than what we owe, the second party owes us the
 * extra." A cash-out used to be refused above the client's credit (page
 * alert + DebtService guard). Now the part up to the credit clears it
 * (CREDIT_USED) and the rest is booked, in the SAME transaction, as a
 * 'Manual Debt' row — so a client holding $50 credit who is handed $80 owes
 * $30 afterwards. Per currency, never on a converted total.
 *
 * CREDIT_CASH_OUT is NON_REVERSIBLE, so the extra debt row needs no void
 * owner (rule 20) — asserted below so a future change cannot quietly make
 * the type reversible without also reversing this row.
 *
 * Rule 17: written after the fix — not proven failing-first. Not run yet
 * (owner asked for write-only on 2026-10-12).
 */

import Database from "better-sqlite3";
import { DebtService } from "../../services/DebtService.js";
import { NON_REVERSIBLE_TRANSACTION_TYPES } from "../../constants/transactionTypes.js";
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
      extra_usd REAL NOT NULL DEFAULT 0,
      extra_lbp REAL NOT NULL DEFAULT 0,
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

// ── Fixture helpers ──────────────────────────────────────────────────────────

/** A raw manual debt charge — no transaction link needed: neither
 *  _coverServiceDebtsFIFO/_unwindServiceDebtCoverageFifo require one. */
function seedCharge(
  db: Database.Database,
  clientId: number,
  type: string,
  usd: number,
  lbp = 0,
): void {
  db.prepare(
    `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, created_by)
     VALUES (?, ?, ?, ?, 1)`,
  ).run(clientId, type, usd, lbp);
}

function drawer(db: Database.Database, name: string, ccy: string): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(name, ccy) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function balance(db: Database.Database): { usd: number; lbp: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM debt_ledger WHERE client_id = ?`,
    )
    .get(CLIENT_ID) as { usd: number; lbp: number };
}

/** A client holding a prepaid credit (negative balance). */
function seedCredit(db: Database.Database, usd: number, lbp = 0): void {
  seedCharge(db, CLIENT_ID, "CREDIT_DEPOSIT", -usd, -lbp);
}

describe("LIRA-313 Debts — cash out above the credit becomes debt", () => {
  let db: Database.Database;
  let debtRepo: DebtRepository;
  let service: DebtService;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    debtRepo = new DebtRepository();
    service = new DebtService(debtRepo);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  it("$50 credit, $80 handed out: the client owes $30 and the drawer moves −80", () => {
    seedCredit(db, 50);
    const drawerBefore = drawer(db, "General", "USD");
    const result = service.cashOut({
      clientId: CLIENT_ID,
      amountUSD: 80,
      amountLBP: 0,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 80 }],
      tender_exchange_rate: RATE,
      userId: 1,
    });
    expect(result.success).toBe(true);
    expect(balance(db).usd).toBeCloseTo(30, 6);
    expect(drawer(db, "General", "USD")).toBeCloseTo(drawerBefore - 80, 6);

    const rows = db
      .prepare(
        `SELECT transaction_type, amount_usd, transaction_id FROM debt_ledger
         WHERE client_id = ? AND transaction_type IN ('CREDIT_USED', 'Manual Debt')
         ORDER BY id`,
      )
      .all(CLIENT_ID) as {
      transaction_type: string;
      amount_usd: number;
      transaction_id: number;
    }[];
    expect(rows.map((r) => [r.transaction_type, r.amount_usd])).toEqual([
      ["CREDIT_USED", 50],
      ["Manual Debt", 30],
    ]);
    // Both rows belong to the one CREDIT_CASH_OUT transaction.
    expect(rows[0].transaction_id).toBe(rows[1].transaction_id);
  });

  it("a cash-out within the credit writes no debt row (unchanged)", () => {
    seedCredit(db, 50);
    service.cashOut({
      clientId: CLIENT_ID,
      amountUSD: 50,
      amountLBP: 0,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 50 }],
      tender_exchange_rate: RATE,
      userId: 1,
    });
    expect(balance(db).usd).toBeCloseTo(0, 6);
    const debtRows = db
      .prepare(
        `SELECT COUNT(*) AS c FROM debt_ledger WHERE transaction_type = 'Manual Debt'`,
      )
      .get() as { c: number };
    expect(debtRows.c).toBe(0);
  });

  it("splits per currency: USD credit, extra paid in LBP becomes LBP debt", () => {
    seedCredit(db, 50);
    const result = service.cashOut({
      clientId: CLIENT_ID,
      amountUSD: 50,
      amountLBP: 900_000,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 50 },
        { method: "CASH", currencyCode: "LBP", amount: 900_000 },
      ],
      tender_exchange_rate: RATE,
      userId: 1,
    });
    expect(result.success).toBe(true);
    expect(balance(db).usd).toBeCloseTo(0, 6);
    expect(balance(db).lbp).toBeCloseTo(900_000, 0);
  });

  it("still refuses a cash-out when the client has no credit at all", () => {
    const result = service.cashOut({
      clientId: CLIENT_ID,
      amountUSD: 10,
      amountLBP: 0,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }],
      tender_exchange_rate: RATE,
      userId: 1,
    });
    expect(result.success).toBe(false);
  });

  it("CREDIT_CASH_OUT stays non-reversible, so the extra debt row needs no void owner", () => {
    expect(NON_REVERSIBLE_TRANSACTION_TYPES.has("CREDIT_CASH_OUT")).toBe(true);
  });
});
