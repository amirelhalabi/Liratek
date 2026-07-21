/**
 * LIRA-080 — Suppliers-page "Add Credit / Debt" paper (no-cash) entry.
 *
 * A manual supplier_ledger ADJUSTMENT with NO drawer_name posts a PAPER entry:
 * the supplier_ledger row + ONE visible unified-transaction row of the
 * dedicated type SUPPLIER_ADJUSTMENT, with ZERO payment legs and ZERO drawer
 * movement (mirrors PARTNER_ADJUSTMENT/ACCOUNT_ADJUSTMENT). Routing it through
 * SUPPLIER_PAYMENT (the pre-LIRA-080 behavior) would paint a misleading green
 * "in" badge on a row where no cash moved.
 *
 * The cash-moved side of the same UI action never reaches addLedgerEntry — it
 * goes through recordSupplierCashflow (→ SUPPLIER_PAYMENT), asserted here as a
 * regression so the two paths stay distinct.
 *
 * FAILING-FIRST (rule 17): the SUPPLIER_ADJUSTMENT type / blank-badge
 * assertions were proven to FAIL on pre-fix code by temporarily reverting the
 * typeMap entry `ADJUSTMENT: TRANSACTION_TYPES.SUPPLIER_ADJUSTMENT` back to
 * `SUPPLIER_PAYMENT` (see PR notes) — the paper row then re-appears as a
 * SUPPLIER_PAYMENT with an "in" cash badge.
 */

import Database from "better-sqlite3";
import { SupplierRepository } from "../SupplierRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      module_key TEXT,
      provider TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('TOP_UP','SALE_COST','PAYMENT','ADJUSTMENT','SETTLEMENT','CASH_PRIZE','SUPPLIER_PAYS_US')),
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
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

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      device_id TEXT,
      summary TEXT,
      metadata_json TEXT,
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

    CREATE TABLE supplier_purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      total_usd REAL NOT NULL,
      paid_usd REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_code TEXT NOT NULL,
      market_rate REAL NOT NULL,
      buy_rate REAL NOT NULL DEFAULT 0,
      sell_rate REAL NOT NULL DEFAULT 0,
      is_stronger INTEGER NOT NULL DEFAULT 1,
      tenant_id INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate) VALUES ('LBP', 89000, 89000, 89000);

    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 1000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 5000000);
  `);
  return db;
}

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

function seedSupplier(db: Database.Database, name = "Acme Corp"): number {
  const res = db
    .prepare("INSERT INTO suppliers (name, is_system) VALUES (?, 0)")
    .run(name);
  return Number(res.lastInsertRowid);
}

function countTransactions(db: Database.Database): number {
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
function ledgerSum(db: Database.Database, supplierId: number) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd),0) AS usd, COALESCE(SUM(amount_lbp),0) AS lbp
       FROM supplier_ledger WHERE supplier_id = ?`,
    )
    .get(supplierId) as { usd: number; lbp: number };
}

describe("LIRA-080 — SupplierRepository paper (no-cash) Add Credit/Debt", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new SupplierRepository();
  });

  afterEach(() => {
    db.close();
    resetTransactionRepository();
    resetTenantContext();
  });

  describe("paper CREDIT (positive ADJUSTMENT, no drawer_name)", () => {
    it("writes exactly ONE SUPPLIER_ADJUSTMENT transaction, zero payment legs, no drawer movement", () => {
      const supplierId = seedSupplier(db);
      const beforeUsd = drawer(db, "General", "USD");
      const beforeLbp = drawer(db, "General", "LBP");

      repo.addLedgerEntry({
        supplier_id: supplierId,
        entry_type: "ADJUSTMENT",
        amount_usd: 50,
        amount_lbp: 0,
        note: "opening balance",
        created_by: 1,
      });

      // exactly one transaction, of the dedicated paper type
      expect(countTransactions(db)).toBe(1);
      const txn = db.prepare("SELECT * FROM transactions").get() as {
        type: string;
        amount_usd: number;
        amount_lbp: number;
        metadata_json: string;
      };
      // FAILING-FIRST: pre-fix this was 'SUPPLIER_PAYMENT'.
      expect(txn.type).toBe("SUPPLIER_ADJUSTMENT");
      // SIGNED amount (CREDIT = +) for report-readability, no badge to carry it
      expect(txn.amount_usd).toBe(50);
      // journal-only marker, no real payment method
      const meta = JSON.parse(txn.metadata_json);
      expect(meta.counterparty.method).toBe("LEDGER");
      expect(meta.counterparty.flow).toBe("IN");

      // ZERO payment legs
      expect(countPayments(db)).toBe(0);

      // drawer UNCHANGED
      expect(drawer(db, "General", "USD")).toBe(beforeUsd);
      expect(drawer(db, "General", "LBP")).toBe(beforeLbp);

      // ledger recorded the +50
      expect(ledgerSum(db, supplierId).usd).toBe(50);
    });
  });

  describe("paper DEBIT (negative ADJUSTMENT, no drawer_name)", () => {
    it("stamps a SUPPLIER_ADJUSTMENT with the SIGNED negative amount and OUT flow, still no drawer/legs", () => {
      const supplierId = seedSupplier(db);
      const beforeUsd = drawer(db, "General", "USD");

      repo.addLedgerEntry({
        supplier_id: supplierId,
        entry_type: "ADJUSTMENT",
        amount_usd: -30,
        amount_lbp: 0,
        created_by: 1,
      });

      expect(countTransactions(db)).toBe(1);
      const txn = db.prepare("SELECT * FROM transactions").get() as {
        type: string;
        amount_usd: number;
        metadata_json: string;
      };
      expect(txn.type).toBe("SUPPLIER_ADJUSTMENT");
      expect(txn.amount_usd).toBe(-30);
      expect(JSON.parse(txn.metadata_json).counterparty.flow).toBe("OUT");
      expect(countPayments(db)).toBe(0);
      expect(drawer(db, "General", "USD")).toBe(beforeUsd);
      expect(ledgerSum(db, supplierId).usd).toBe(-30);
    });
  });

  describe("cash-moved regression — recordSupplierCashflow stays SUPPLIER_PAYMENT + moves the drawer", () => {
    it("RECEIVE (credit) posts a SUPPLIER_PAYMENT with a payment leg and a drawer increase", () => {
      const supplierId = seedSupplier(db);
      const beforeUsd = drawer(db, "General", "USD");

      repo.recordSupplierCashflow({
        supplier_id: supplierId,
        direction: "RECEIVE",
        payments: [{ method: "CASH", currency_code: "USD", amount: 40 }],
        created_by: 1,
      });

      const txn = db.prepare("SELECT * FROM transactions").get() as {
        type: string;
      };
      // NOT a paper adjustment — the cash-moved path keeps SUPPLIER_PAYMENT
      expect(txn.type).toBe("SUPPLIER_PAYMENT");
      expect(countPayments(db)).toBe(1);
      // RECEIVE = cash IN → drawer up
      expect(drawer(db, "General", "USD")).toBe(beforeUsd + 40);
    });

    it("PAY (debit) posts a SUPPLIER_PAYMENT with a payment leg and a drawer decrease", () => {
      const supplierId = seedSupplier(db);
      const beforeUsd = drawer(db, "General", "USD");

      repo.recordSupplierCashflow({
        supplier_id: supplierId,
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 25 }],
        created_by: 1,
      });

      const txn = db.prepare("SELECT * FROM transactions").get() as {
        type: string;
      };
      expect(txn.type).toBe("SUPPLIER_PAYMENT");
      expect(countPayments(db)).toBe(1);
      expect(drawer(db, "General", "USD")).toBe(beforeUsd - 25);
    });
  });
});
