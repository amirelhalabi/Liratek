/**
 * Regression guard: top-up summary/note strings must format their amounts
 * with the SAME thousands-separator convention the transactions-table
 * cash-flow badge uses (`frontend/src/features/audit/pages/TransactionsViewer
 * .tsx`'s `formatAmount` — `$${usd.toLocaleString()}` / `${lbp.toLocaleString()}
 * LBP`), not a raw interpolated number.
 *
 * Owner-observed live bug: a row's badge showed "↓ 700,579 LBP" while the
 * SAME row's stored summary read "Katsh supplier top-up → Katsh: 700579 LBP"
 * — comma-formatted next to raw, on one row. Four RechargeRepository builders
 * had this defect: topUpFromSupplier, topUpApp (the "OMT App top-up" shape),
 * topUpFromPartner, topUpFromClient. Each of the four tests below asserts NO
 * raw (comma-less) multi-digit amount reaches the recharges.note,
 * transactions.summary, or supplier_ledger.note column, using amounts large
 * enough that a raw-vs-formatted mismatch cannot be mistaken for coincidence
 * (rule 17 — these fail on the pre-fix code; see the recorded failure output
 * in the task report, not asserted here).
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

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

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE recharges (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier TEXT NOT NULL,
      recharge_type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      paid_by TEXT NOT NULL,
      phone_number TEXT,
      client_id INTEGER,
      client_name TEXT,
      note TEXT,
      created_by INTEGER NOT NULL DEFAULT 1,
      edited_by TEXT,
      edited_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

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

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL UNIQUE,
      phone              TEXT,
      notes              TEXT,
      is_active          INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL REFERENCES partners(id),
      transaction_type  TEXT,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      covered_amount    REAL NOT NULL DEFAULT 0,
      notes             TEXT,
      user_id           INTEGER,
      settlement_method TEXT,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL,
      profit_lbp REAL,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Seed provider drawers with enough balance to fund from-drawer top-ups
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katsh', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Katsh', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_App', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_App', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_App', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_App', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 5_000_000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 5_000_000_000);
  `);

  return db;
}

describe("RechargeRepository top-up summary/note amount formatting", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new RechargeRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  function txnSummary(): string {
    return (
      db
        .prepare(
          "SELECT summary FROM transactions WHERE type = 'RECHARGE_TOPUP'",
        )
        .get() as { summary: string }
    ).summary;
  }

  function rechargeNote(): string {
    return (
      db.prepare("SELECT note FROM recharges").get() as { note: string }
    ).note;
  }

  it("topUpFromSupplier: no raw comma-less amount in recharges.note, transactions.summary, or supplier_ledger.note", () => {
    const supplierRes = db
      .prepare(
        "INSERT INTO suppliers (name, provider, is_active) VALUES (?, ?, 1)",
      )
      .run("Katsh Supplier", "Katsh");
    const supplierId = Number(supplierRes.lastInsertRowid);

    const result = repo.topUpFromSupplier({
      provider: "Katsh",
      amount: 1_000_000,
      currency: "LBP",
      userId: 1,
    });
    expect(result.success).toBe(true);

    const ledgerNote = (
      db
        .prepare("SELECT note FROM supplier_ledger WHERE supplier_id = ?")
        .get(supplierId) as { note: string }
    ).note;

    for (const text of [txnSummary(), rechargeNote(), ledgerNote]) {
      expect(text).not.toContain("1000000");
      expect(text).toContain("1,000,000 LBP");
    }
  });

  it('topUpApp ("OMT App top-up" shape): no raw comma-less amount in recharges.note or transactions.summary', () => {
    const result = repo.topUpApp({
      provider: "OMT_APP",
      amount: 700_579,
      currency: "LBP",
      sourceDrawer: "General",
      userId: 1,
    });
    expect(result.success).toBe(true);

    for (const text of [txnSummary(), rechargeNote()]) {
      expect(text).not.toContain("700579");
      expect(text).toContain("700,579 LBP");
    }
    // The exact shape the owner saw live: "OMT App top-up: General → OMT_App: <amount>"
    expect(txnSummary()).toBe(
      "OMT App top-up: General → OMT_App: 700,579 LBP",
    );
  });

  it("topUpFromPartner: no raw comma-less USD amount in recharges.note or transactions.summary", () => {
    const partnerId = Number(
      db
        .prepare("INSERT INTO partners (name, is_active) VALUES (?, 1)")
        .run("Whish Partner").lastInsertRowid,
    );

    const result = repo.topUpFromPartner({
      provider: "WHISH_APP",
      partnerId,
      amount: 123_456,
      currency: "USD",
      userId: 1,
    });
    expect(result.success).toBe(true);

    for (const text of [txnSummary(), rechargeNote()]) {
      expect(text).not.toContain("123456");
      expect(text).toContain("$123,456");
    }
  });

  it("topUpFromClient: no raw comma-less amount in recharges.note or transactions.summary (credits AND cash sides)", () => {
    const result = repo.topUpFromClient({
      amount: 700_579,
      cashPaid: 650_321,
      currency: "LBP",
      userId: 1,
    });
    expect(result.success).toBe(true);

    for (const text of [txnSummary(), rechargeNote()]) {
      expect(text).not.toContain("700579");
      expect(text).not.toContain("650321");
      expect(text).toContain("700,579 credits");
      expect(text).toContain("650,321 LBP cash");
    }
  });
});
