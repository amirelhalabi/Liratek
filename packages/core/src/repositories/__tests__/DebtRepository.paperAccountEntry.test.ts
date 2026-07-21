/**
 * LIRA-080 — Accounts (Debts) page "Add Credit / Debt" with the "Cash moved"
 * toggle.
 *
 * Default ON (move_cash omitted/true) is byte-identical to today: a
 * CREDIT_CASH_IN / DEBT_CASH_OUT transaction with a CASH payment leg and a
 * drawer movement. Toggle OFF (move_cash: false) posts a PAPER entry: the
 * SAME debt_ledger row (CREDIT_DEPOSIT / Manual Debt, same sign), but the
 * wrapping transaction is ACCOUNT_ADJUSTMENT with ZERO payment legs and ZERO
 * drawer movement.
 *
 * FAILING-FIRST (rule 17): the paper-path assertions (type ACCOUNT_ADJUSTMENT,
 * zero legs, drawer unchanged) were proven to FAIL on pre-fix code by
 * temporarily forcing `moveCash = true` in
 * DebtRepository.addAccountCashEntry (see PR notes) — the row then reverts to
 * CREDIT_CASH_IN/DEBT_CASH_OUT with a payment leg and a drawer delta.
 */

import Database from "better-sqlite3";
import { DebtRepository } from "../DebtRepository";
import { resetTransactionRepository } from "../TransactionRepository";

const RATE = 90_000;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone TEXT,
      tenant_id INTEGER DEFAULT 1
    );
    INSERT INTO clients (id, full_name) VALUES (1, 'Paper Client');

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
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 1000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 5000000);

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

function countTxns(db: Database.Database): number {
  return (
    db.prepare("SELECT COUNT(*) AS c FROM transactions").get() as { c: number }
  ).c;
}
function countPayments(db: Database.Database): number {
  return (
    db.prepare("SELECT COUNT(*) AS c FROM payments").get() as { c: number }
  ).c;
}
function drawer(db: Database.Database, name: string, ccy: string): number {
  const r = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(name, ccy) as { balance: number } | undefined;
  return r?.balance ?? 0;
}
function ledgerSum(db: Database.Database, clientId: number) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd),0) AS usd, COALESCE(SUM(amount_lbp),0) AS lbp
       FROM debt_ledger WHERE client_id = ?`,
    )
    .get(clientId) as { usd: number; lbp: number };
}

describe("LIRA-080 — DebtRepository paper (no-cash) Add Credit/Debt", () => {
  let db: Database.Database;
  let repo: DebtRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetTransactionRepository();
    repo = new DebtRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
  });

  describe("paper CREDIT (move_cash: false)", () => {
    it("writes ONE ACCOUNT_ADJUSTMENT txn, a CREDIT_DEPOSIT ledger row, zero legs, no drawer movement", () => {
      const beforeUsd = drawer(db, "General", "USD");
      const beforeLbp = drawer(db, "General", "LBP");

      repo.addAccountCashEntry({
        direction: "credit",
        client_id: 1,
        amount_usd: 50,
        amount_lbp: 0,
        created_by: 1,
        move_cash: false,
      });

      expect(countTxns(db)).toBe(1);
      const txn = db.prepare("SELECT * FROM transactions").get() as {
        type: string;
        amount_usd: number;
        metadata_json: string;
      };
      // FAILING-FIRST: pre-fix (moveCash forced true) this is CREDIT_CASH_IN.
      expect(txn.type).toBe("ACCOUNT_ADJUSTMENT");
      // SIGNED: credit ledger is negative (shop owes the client)
      expect(txn.amount_usd).toBe(-50);
      const meta = JSON.parse(txn.metadata_json);
      expect(meta.counterparty.method).toBe("LEDGER");
      expect(meta.counterparty.flow).toBe("IN");

      // debt_ledger row written the same as today (CREDIT_DEPOSIT, sign −)
      const ledgerRow = db
        .prepare("SELECT transaction_type, amount_usd FROM debt_ledger")
        .get() as { transaction_type: string; amount_usd: number };
      expect(ledgerRow.transaction_type).toBe("CREDIT_DEPOSIT");
      expect(ledgerRow.amount_usd).toBe(-50);
      expect(ledgerSum(db, 1).usd).toBe(-50);

      // ZERO legs, drawer UNCHANGED
      expect(countPayments(db)).toBe(0);
      expect(drawer(db, "General", "USD")).toBe(beforeUsd);
      expect(drawer(db, "General", "LBP")).toBe(beforeLbp);
    });
  });

  describe("paper DEBT (move_cash: false)", () => {
    it("writes ONE ACCOUNT_ADJUSTMENT txn with the positive Manual Debt sign and OUT flow, still no legs/drawer", () => {
      const beforeUsd = drawer(db, "General", "USD");

      repo.addAccountCashEntry({
        direction: "debt",
        client_id: 1,
        amount_usd: 30,
        amount_lbp: 0,
        created_by: 1,
        move_cash: false,
      });

      expect(countTxns(db)).toBe(1);
      const txn = db.prepare("SELECT * FROM transactions").get() as {
        type: string;
        amount_usd: number;
        metadata_json: string;
      };
      expect(txn.type).toBe("ACCOUNT_ADJUSTMENT");
      expect(txn.amount_usd).toBe(30);
      expect(JSON.parse(txn.metadata_json).counterparty.flow).toBe("OUT");
      expect(countPayments(db)).toBe(0);
      expect(drawer(db, "General", "USD")).toBe(beforeUsd);
      expect(ledgerSum(db, 1).usd).toBe(30);
    });
  });

  describe("cash-moved regression (default ON — move_cash omitted)", () => {
    it("CREDIT posts a CREDIT_CASH_IN txn with a CASH leg and moves the drawer IN", () => {
      const beforeUsd = drawer(db, "General", "USD");

      repo.addAccountCashEntry({
        direction: "credit",
        client_id: 1,
        amount_usd: 50,
        amount_lbp: 0,
        created_by: 1,
      });

      const txn = db.prepare("SELECT * FROM transactions").get() as {
        type: string;
        amount_usd: number;
      };
      expect(txn.type).toBe("CREDIT_CASH_IN");
      // cash-moved amount is abs (direction lives in the type)
      expect(txn.amount_usd).toBe(50);
      expect(countPayments(db)).toBe(1);
      // credit = customer hands the shop cash → drawer up
      expect(drawer(db, "General", "USD")).toBe(beforeUsd + 50);
    });

    it("DEBT posts a DEBT_CASH_OUT txn with a CASH leg and moves the drawer OUT", () => {
      const beforeUsd = drawer(db, "General", "USD");

      repo.addAccountCashEntry({
        direction: "debt",
        client_id: 1,
        amount_usd: 20,
        amount_lbp: 0,
        created_by: 1,
      });

      const txn = db.prepare("SELECT * FROM transactions").get() as {
        type: string;
      };
      expect(txn.type).toBe("DEBT_CASH_OUT");
      expect(countPayments(db)).toBe(1);
      // debt = shop hands the client cash → drawer down
      expect(drawer(db, "General", "USD")).toBe(beforeUsd - 20);
    });
  });
});
