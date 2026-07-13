/**
 * TransactionRepository — refund/void reverses ALL module debt, both currencies
 * (owner-reported, 2026-07-12)
 *
 * Refunding a transaction paid by CUSTOMER_ACCOUNT left the client's debt
 * standing: an MTC recharge for 600,000 LBP charged to account, refunded from
 * the Transactions table, kept its 'Recharge Debt' ledger row — the client
 * still owed 600,000 LBP for refunded credits. Three stacked gaps:
 *
 *   1. _cancelDebt ran only inside the source_table === 'sales' branch of
 *      refundTransaction/voidTransaction.
 *   2. It matched transaction_type = 'Sale Debt' only — 'Recharge Debt',
 *      'Service Debt', 'Custom Service Debt', 'Loto Debt' and
 *      'Maintenance Debt' were invisible to it.
 *   3. It selected/negated amount_usd only — per-currency module debts (this
 *      bug is pure LBP) would have cancelled $0 even if matched.
 *
 * Fix: MODULE_DEBT_TRANSACTION_TYPES whitelist (constants/transactionTypes),
 * _cancelDebt negates BOTH currencies and runs unconditionally on refund and
 * void. The whitelist is load-bearing: 'Repayment' rows are back-linked to a
 * transaction_id too and must NOT be negated by a module reversal; voucher
 * 'CREDIT_DEPOSIT' rows carry transaction_id = NULL.
 *
 * Companion fix proven here too: CustomServiceRepository.deleteService used
 * to hard-DELETE its 'Custom Service Debt' rows AFTER calling the generic
 * voidTransaction — once void inserts a −X reversal, keeping the DELETE would
 * over-credit the client by X (reversal survives, original charge gone).
 *
 * Every "pre-fix" case here FAILS on the pre-fix code (CLAUDE.md rule 17).
 */

import Database from "better-sqlite3";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import { CustomServiceRepository } from "../CustomServiceRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

const CLIENT_ID = 7;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL
    );
    INSERT INTO users (id, username) VALUES (1, 'cashier');

    CREATE TABLE clients (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name    TEXT NOT NULL,
      phone_number TEXT,
      tenant_id    INTEGER DEFAULT 1,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name, phone_number) VALUES (${CLIENT_ID}, 'Debt Client', '76000000');

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT,
      source_id     INTEGER,
      user_id       INTEGER,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      tenant_id     INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      tenant_id      INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'USD', 500);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'LBP', 20000000);

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      session_id       INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      tenant_id        INTEGER DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE recharges (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier     TEXT,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT,
      tenant_id   INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE sales (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      status     TEXT DEFAULT 'completed',
      tenant_id  INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sale_items (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id           INTEGER NOT NULL,
      product_id        INTEGER NOT NULL,
      quantity          INTEGER NOT NULL DEFAULT 1,
      is_refunded       INTEGER DEFAULT 0,
      refunded_quantity INTEGER DEFAULT 0,
      tenant_id         INTEGER DEFAULT 1
    );

    CREATE TABLE products (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      tenant_id      INTEGER DEFAULT 1
    );

    CREATE TABLE custom_services (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER,
      description  TEXT NOT NULL,
      cost_usd     REAL DEFAULT 0,
      cost_lbp     REAL DEFAULT 0,
      price_usd    REAL DEFAULT 0,
      price_lbp    REAL DEFAULT 0,
      profit_usd   REAL DEFAULT 0,
      profit_lbp   REAL DEFAULT 0,
      paid_by      TEXT DEFAULT 'CASH',
      status       TEXT DEFAULT 'completed',
      client_id    INTEGER,
      client_name  TEXT,
      phone_number TEXT,
      note         TEXT,
      category     TEXT,
      is_refunded  INTEGER DEFAULT 0,
      refunded_at  TEXT,
      created_by   INTEGER,
      edited_by    TEXT,
      edited_at    TEXT,
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function clientBalance(db: Database.Database): { usd: number; lbp: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM debt_ledger WHERE client_id = ?`,
    )
    .get(CLIENT_ID) as { usd: number; lbp: number };
  return row;
}

function reversalRows(db: Database.Database) {
  return db
    .prepare(
      `SELECT client_id, amount_usd, amount_lbp, transaction_id
       FROM debt_ledger WHERE transaction_type = 'Refund Reversal' ORDER BY id ASC`,
    )
    .all() as Array<{
    client_id: number;
    amount_usd: number;
    amount_lbp: number;
    transaction_id: number | null;
  }>;
}

function drawer(db: Database.Database, name: string, currency: string): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(name, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

describe("TransactionRepository — module-debt reversal on refund/void", () => {
  let db: Database.Database;
  let repo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new TransactionRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  /** Recharge on account, wired the way RechargeRepository does it: recharge
   *  row → RECHARGE transaction → 'Recharge Debt' ledger row (transaction_id
   *  = unified txn id) → telecom stock leg. NO cash leg — the customer paid
   *  nothing at the till. */
  function seedRechargeOnAccount(lbp: number): number {
    db.prepare(`INSERT INTO recharges (id, carrier) VALUES (1, 'MTC')`).run();
    const txnId = repo.createTransaction({
      type: "RECHARGE",
      source_table: "recharges",
      source_id: 1,
      user_id: 1,
      amount_usd: 0,
      amount_lbp: lbp,
      exchange_rate: 90_000,
      client_id: CLIENT_ID,
      summary: "Recharge: MTC Credits $6",
    });
    db.prepare(
      `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, transaction_id, created_by, due_date)
       VALUES (?, 'Recharge Debt', 0, ?, ?, 1, datetime('now', '+30 days'))`,
    ).run(CLIENT_ID, lbp, txnId);
    // Telecom balance consumed (shop stock drawer, always USD credits)
    db.prepare(
      `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount)
       VALUES (?, 'MTC', 'MTC', 'USD', -6)`,
    ).run(txnId);
    db.prepare(
      `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'MTC', 'USD', -6)`,
    ).run();
    return txnId;
  }

  it("REFUND of an account-charged recharge books a 'Refund Reversal' in LBP — balance nets to 0, no cash leaves the till (pre-fix: debt survived)", () => {
    const txnId = seedRechargeOnAccount(600_000);
    expect(clientBalance(db)).toEqual({ usd: 0, lbp: 600_000 });
    const generalUsdBefore = drawer(db, "General", "USD");
    const generalLbpBefore = drawer(db, "General", "LBP");

    repo.refundTransaction(txnId, 1);

    const reversals = reversalRows(db);
    expect(reversals).toHaveLength(1);
    expect(reversals[0].client_id).toBe(CLIENT_ID);
    expect(reversals[0].amount_lbp).toBeCloseTo(-600_000, 2);
    expect(reversals[0].amount_usd).toBeCloseTo(0, 2);
    expect(reversals[0].transaction_id).toBe(txnId);

    const balance = clientBalance(db);
    expect(balance.usd).toBeCloseTo(0, 2);
    expect(balance.lbp).toBeCloseTo(0, 2);

    // Telecom stock restored by the payment-leg reversal…
    expect(drawer(db, "MTC", "USD")).toBeCloseTo(0, 2);
    // …and NOT a single lira/dollar of cash handed out: the customer never
    // paid cash, so the refund must be account-only.
    expect(drawer(db, "General", "USD")).toBeCloseTo(generalUsdBefore, 2);
    expect(drawer(db, "General", "LBP")).toBeCloseTo(generalLbpBefore, 2);
  });

  it("VOID of an account-charged recharge cancels the debt the same way (pre-fix: debt survived)", () => {
    const txnId = seedRechargeOnAccount(600_000);

    repo.voidTransaction(txnId, 1);

    const original = db
      .prepare(`SELECT status FROM transactions WHERE id = ?`)
      .get(txnId) as { status: string };
    expect(original.status).toBe("VOIDED");

    const reversals = reversalRows(db);
    expect(reversals).toHaveLength(1);
    expect(reversals[0].amount_lbp).toBeCloseTo(-600_000, 2);

    const balance = clientBalance(db);
    expect(balance.lbp).toBeCloseTo(0, 2);
  });

  it("whitelist guard: 'Repayment' rows (back-linked to a transaction) and 'CREDIT_DEPOSIT' rows are NOT negated", () => {
    const txnId = seedRechargeOnAccount(600_000);
    // Worst case: a repayment row carrying the SAME transaction_id (real
    // repayments back-link to their own DEBT_REPAYMENT txn, but the reversal
    // must be type-scoped, not txn-scoped).
    db.prepare(
      `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, transaction_id, created_by)
       VALUES (?, 'Repayment', -20, 0, ?, 1)`,
    ).run(CLIENT_ID, txnId);
    db.prepare(
      `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, transaction_id, created_by)
       VALUES (?, 'CREDIT_DEPOSIT', 0, -100000, NULL, 1)`,
    ).run(CLIENT_ID);

    repo.refundTransaction(txnId, 1);

    // Exactly ONE reversal — the recharge debt. The repayment and the credit
    // deposit are untouched.
    const reversals = reversalRows(db);
    expect(reversals).toHaveLength(1);
    expect(reversals[0].amount_lbp).toBeCloseTo(-600_000, 2);
    expect(reversals[0].amount_usd).toBeCloseTo(0, 2);

    const repayment = db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(amount_usd), 0) AS usd FROM debt_ledger WHERE transaction_type = 'Repayment'`,
      )
      .get() as { n: number; usd: number };
    expect(repayment).toEqual({ n: 1, usd: -20 });

    const deposit = db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(amount_lbp), 0) AS lbp FROM debt_ledger WHERE transaction_type = 'CREDIT_DEPOSIT'`,
      )
      .get() as { n: number; lbp: number };
    expect(deposit).toEqual({ n: 1, lbp: -100_000 });
  });

  it("sale-on-debt refund still reverses the USD debt and restores stock (existing behavior, regression)", () => {
    db.prepare(
      `INSERT INTO products (id, name, stock_quantity) VALUES (1, 'Cable', 3)`,
    ).run();
    db.prepare(`INSERT INTO sales (id, status) VALUES (1, 'completed')`).run();
    db.prepare(
      `INSERT INTO sale_items (sale_id, product_id, quantity) VALUES (1, 1, 2)`,
    ).run();
    const txnId = repo.createTransaction({
      type: "SALE",
      source_table: "sales",
      source_id: 1,
      user_id: 1,
      amount_usd: 50,
      client_id: CLIENT_ID,
      summary: "Sale #1",
    });
    db.prepare(
      `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount)
       VALUES (?, 'CASH', 'General', 'USD', 35)`,
    ).run(txnId);
    db.prepare(
      `UPDATE drawer_balances SET balance = balance + 35 WHERE drawer_name = 'General' AND currency_code = 'USD'`,
    ).run();
    db.prepare(
      `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, transaction_id, created_by, due_date)
       VALUES (?, 'Sale Debt', 15, ?, 1, datetime('now', '+30 days'))`,
    ).run(CLIENT_ID, txnId);
    const generalBefore = drawer(db, "General", "USD");

    repo.refundTransaction(txnId, 1);

    expect(clientBalance(db).usd).toBeCloseTo(0, 2);
    // Cash leg reversed (customer gets their $35 back), debt leg reversed on
    // the ledger only.
    expect(drawer(db, "General", "USD")).toBeCloseTo(generalBefore - 35, 2);
    const sale = db.prepare(`SELECT status FROM sales WHERE id = 1`).get() as {
      status: string;
    };
    expect(sale.status).toBe("refunded");
    const product = db
      .prepare(`SELECT stock_quantity FROM products WHERE id = 1`)
      .get() as { stock_quantity: number };
    expect(product.stock_quantity).toBe(5);
  });

  it("deleteService on an account-charged custom service nets the client balance to 0 — reversal row, no double credit", () => {
    const services = new CustomServiceRepository();
    const res = services.createService(
      {
        description: "on-account install",
        cost_usd: 0,
        cost_lbp: 0,
        price_usd: 40,
        price_lbp: 0,
        paid_by: "CUSTOMER_ACCOUNT",
        status: "completed",
        client_id: CLIENT_ID,
        payments: [
          { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 40 },
        ],
      },
      1,
    );
    expect(res.success).toBe(true);
    expect(clientBalance(db).usd).toBeCloseTo(40, 2);

    const del = services.deleteService(res.id!);
    expect(del.success).toBe(true);

    // The charge is reversed exactly once: +40 charge + (−40) reversal = 0.
    // With the generic reversal active, keeping deleteService's own DELETE
    // would leave the client over-credited at −40.
    const balance = clientBalance(db);
    expect(balance.usd).toBeCloseTo(0, 2);
    expect(balance.lbp).toBeCloseTo(0, 2);

    const service = db
      .prepare(`SELECT status FROM custom_services WHERE id = ?`)
      .get(res.id) as { status: string };
    expect(service.status).toBe("voided");
  });
});
