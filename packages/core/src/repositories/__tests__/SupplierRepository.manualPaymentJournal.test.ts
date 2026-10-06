/**
 * LIRA-258 G8 (POSTING_INTEGRITY_PLAN.md item 2.5, POSTING_MAP.md §7):
 * a manual supplier PAYMENT out of a drawer that pays BOTH currencies at once
 * moved both drawer balances but wrote only ONE `payments` row (USD if USD
 * was non-zero, else LBP). The payments journal is the drawer's source of
 * truth — `ClosingRepository.recalculateDrawerBalances` rebuilds balances
 * from it and `_reversePayments` voids by mirroring it — so the LBP move was
 * invisible to both: a recalc silently gave the LBP back, and a void left the
 * LBP drawer debited forever.
 *
 * Guard (plan §2.5): after the operation, recalculating drawer balances from
 * the journal changes nothing; and create + void nets every ledger to 0 per
 * currency (rule 20). Drawers start at 0 so the journal is the whole story.
 */

import Database from "better-sqlite3";
import { SupplierRepository } from "../SupplierRepository";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { ClosingRepository } from "../ClosingRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  snapshotLedgers,
  expectPostings,
} from "../testHelpers/postingAssert";

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("Test DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      provider TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      module_key TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (name, provider) VALUES ('Acme', NULL);

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

    -- _cancelDebt runs unconditionally on every void/refund (module-debt
    -- reversal fix, 2026-07-12) — the fixture needs the table it scans.
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      session_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
  `);
  return db;
}

const SUPPLIER_ID = 1;

function payTxnId(db: Database.Database, ledgerId: number): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE source_table='supplier_ledger' AND source_id=? ORDER BY id LIMIT 1`,
      )
      .get(ledgerId) as { id: number }
  ).id;
}

function journalByCurrency(
  db: Database.Database,
  txnId: number,
): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT currency_code, SUM(amount) AS total FROM payments
        WHERE transaction_id = ? AND drawer_name = 'General'
        GROUP BY currency_code`,
    )
    .all(txnId) as { currency_code: string; total: number }[];
  return Object.fromEntries(rows.map((r) => [r.currency_code, r.total]));
}

describe("SupplierRepository.addLedgerEntry — manual PAYMENT journal, one payments row per currency (G8)", () => {
  let db: Database.Database;
  let suppliers: SupplierRepository;
  let txns: TransactionRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    suppliers = new SupplierRepository();
    txns = new TransactionRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetTransactionRepository();
  });

  it("a USD + LBP payment journals BOTH currencies, matching the drawer moves", () => {
    const before = snapshotLedgers(db);
    const paid = suppliers.addLedgerEntry({
      supplier_id: SUPPLIER_ID,
      entry_type: "PAYMENT",
      amount_usd: 60,
      amount_lbp: 900000,
      drawer_name: "General",
      created_by: 1,
    });
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": -60, "General|LBP": -900000 },
      supplier: { [`${SUPPLIER_ID}|USD`]: -60, [`${SUPPLIER_ID}|LBP`]: -900000 },
    });
    expect(journalByCurrency(db, payTxnId(db, paid.id))).toEqual({
      USD: -60,
      LBP: -900000,
    });
  });

  it("recalculateDrawerBalances from the payments journal changes nothing afterwards", () => {
    suppliers.addLedgerEntry({
      supplier_id: SUPPLIER_ID,
      entry_type: "PAYMENT",
      amount_usd: 60,
      amount_lbp: 900000,
      drawer_name: "General",
      created_by: 1,
    });
    const afterPay = snapshotLedgers(db);
    expect(new ClosingRepository().recalculateDrawerBalances()).toEqual({
      success: true,
    });
    expectPostings(afterPay, snapshotLedgers(db), {});
  });

  it("create + void nets every ledger to 0 in BOTH currencies (rule 20)", () => {
    const before = snapshotLedgers(db);
    const paid = suppliers.addLedgerEntry({
      supplier_id: SUPPLIER_ID,
      entry_type: "PAYMENT",
      amount_usd: 60,
      amount_lbp: 900000,
      drawer_name: "General",
      created_by: 1,
    });
    txns.voidTransaction(payTxnId(db, paid.id), 1);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("single-currency payments still write exactly one payments row (no zero-amount row)", () => {
    const usdOnly = suppliers.addLedgerEntry({
      supplier_id: SUPPLIER_ID,
      entry_type: "PAYMENT",
      amount_usd: 25,
      amount_lbp: 0,
      drawer_name: "General",
      created_by: 1,
    });
    const lbpOnly = suppliers.addLedgerEntry({
      supplier_id: SUPPLIER_ID,
      entry_type: "PAYMENT",
      amount_usd: 0,
      amount_lbp: 450000,
      drawer_name: "General",
      created_by: 1,
    });
    const count = (txnId: number) =>
      (
        db
          .prepare(`SELECT COUNT(*) AS n FROM payments WHERE transaction_id = ?`)
          .get(txnId) as { n: number }
      ).n;
    expect(count(payTxnId(db, usdOnly.id))).toBe(1);
    expect(journalByCurrency(db, payTxnId(db, usdOnly.id))).toEqual({ USD: -25 });
    expect(count(payTxnId(db, lbpOnly.id))).toBe(1);
    expect(journalByCurrency(db, payTxnId(db, lbpOnly.id))).toEqual({ LBP: -450000 });
  });
});
