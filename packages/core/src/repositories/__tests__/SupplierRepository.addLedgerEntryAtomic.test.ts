/**
 * LIRA-258 G11, supplier half (POSTING_INTEGRITY_PLAN.md item 2.4,
 * POSTING_MAP.md §7): `SupplierRepository.addLedgerEntry` writes the
 * supplier_ledger row, a unified transaction, the ledger→transaction link,
 * the drawer move(s) and the payments row as separate statements with no
 * db.transaction of its own. Called straight from IPC/REST (SupplierService),
 * a failure part-way committed whatever came before it — e.g. a supplier
 * debt reduced and a drawer debited with no payments journal row.
 *
 * Guard (plan §2.4): force a LATE write to throw (a SQLite trigger — no
 * mocks), then assert NOTHING was written: every ledger unchanged and no new
 * supplier_ledger / transactions / payments rows. Also: the operation must
 * still nest inside a caller's outer db.transaction (savepoint semantics).
 */

import Database from "better-sqlite3";
import { SupplierRepository } from "../SupplierRepository";
import { resetTransactionRepository } from "../TransactionRepository";
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

function rowCounts(db: Database.Database): Record<string, number> {
  const n = (t: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return {
    supplier_ledger: n("supplier_ledger"),
    transactions: n("transactions"),
    payments: n("payments"),
  };
}

describe("SupplierRepository.addLedgerEntry — atomic (G11, supplier half)", () => {
  let db: Database.Database;
  let suppliers: SupplierRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    suppliers = new SupplierRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetTransactionRepository();
  });

  it("drawer PAYMENT: a failure on the final payments write leaves nothing behind", () => {
    db.exec(
      `CREATE TRIGGER boom_payments BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT, 'boom: payments'); END;`,
    );
    const before = snapshotLedgers(db);
    const countsBefore = rowCounts(db);

    expect(() =>
      suppliers.addLedgerEntry({
        supplier_id: SUPPLIER_ID,
        entry_type: "PAYMENT",
        amount_usd: 60,
        amount_lbp: 0,
        drawer_name: "General",
        created_by: 1,
      }),
    ).toThrow();

    expectPostings(before, snapshotLedgers(db), {});
    expect(rowCounts(db)).toEqual(countsBefore);
  });

  it("no-drawer entry: a failure on the ledger→transaction link leaves nothing behind", () => {
    db.exec(
      `CREATE TRIGGER boom_link BEFORE UPDATE OF transaction_id ON supplier_ledger BEGIN SELECT RAISE(ABORT, 'boom: link'); END;`,
    );
    const before = snapshotLedgers(db);
    const countsBefore = rowCounts(db);

    expect(() =>
      suppliers.addLedgerEntry({
        supplier_id: SUPPLIER_ID,
        entry_type: "TOP_UP",
        amount_usd: 100,
        amount_lbp: 0,
        created_by: 1,
      }),
    ).toThrow();

    expectPostings(before, snapshotLedgers(db), {});
    expect(rowCounts(db)).toEqual(countsBefore);
  });

  it("still nests inside a caller's outer db.transaction: commits with it, rolls back with it", () => {
    const before = snapshotLedgers(db);
    db.transaction(() => {
      suppliers.addLedgerEntry({
        supplier_id: SUPPLIER_ID,
        entry_type: "PAYMENT",
        amount_usd: 40,
        amount_lbp: 0,
        drawer_name: "General",
        created_by: 1,
      });
    })();
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": -40 },
      supplier: { [`${SUPPLIER_ID}|USD`]: -40 },
    });

    const mid = snapshotLedgers(db);
    const countsMid = rowCounts(db);
    expect(() =>
      db.transaction(() => {
        suppliers.addLedgerEntry({
          supplier_id: SUPPLIER_ID,
          entry_type: "PAYMENT",
          amount_usd: 15,
          amount_lbp: 0,
          drawer_name: "General",
          created_by: 1,
        });
        throw new Error("outer caller fails after the ledger entry");
      })(),
    ).toThrow("outer caller fails");
    expectPostings(mid, snapshotLedgers(db), {});
    expect(rowCounts(db)).toEqual(countsMid);
  });
});
