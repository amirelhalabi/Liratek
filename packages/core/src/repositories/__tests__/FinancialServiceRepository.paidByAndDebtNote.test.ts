/**
 * LIRA-349 A4 — a financial service's stored `paid_by` and its on-account
 * debt note (test-tenant review, finding 4; ground truth tx 13105).
 *
 * (a) An OMT SEND of $20 + $1 fee put fully on the customer's account wrote
 *     the debt note "OMT SEND (INTRA) — $20" while $21 was owed — the fee
 *     lived only in the detail popup. The client-facing line must show the
 *     amount owed and that it includes the fee.
 * (b) The same transaction was stored with `paid_by` = CASH although its
 *     payment snapshot was CUSTOMER_ACCOUNT: the walk-in Services screen
 *     sends `payments[]` and no `paidByMethod`, and the repository fell back
 *     to "CASH". `paid_by` must follow the IN legs actually used — one leg's
 *     method, "MULTI" for two or more (the rule `derivePaidByMethod` and
 *     every other money module already follow). OUT (change) legs are not
 *     a way the customer paid (rule 16).
 *
 * The payloads below are the REAL Services/index.tsx walk-in SEND shape
 * (payments[] via toCamelLegs, no paidByMethod), not the legacy
 * `paidByMethod` shape that already stored CUSTOMER_ACCOUNT.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetTransactionRepository } from "../TransactionRepository";

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

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, role TEXT DEFAULT 'staff');
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD' NOT NULL,
      commission REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      paid_by TEXT DEFAULT 'CASH',
      client_id INTEGER REFERENCES clients(id),
      client_name TEXT,
      reference_number TEXT,
      phone_number TEXT,
      omt_service_type TEXT,
      omt_fee REAL DEFAULT 0,
      whish_fee REAL DEFAULT 0,
      profit_rate REAL,
      pay_fee INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      payment_method_fee_rate REAL,
      item_key TEXT,
      note TEXT,
      sender_name TEXT,
      sender_phone TEXT,
      receiver_name TEXT,
      receiver_phone TEXT,
      sender_client_id INTEGER,
      receiver_client_id INTEGER,
      is_settled INTEGER NOT NULL DEFAULT 1,
      settled_at TEXT,
      settlement_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER REFERENCES partners(id),
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
      commission_model INTEGER NOT NULL DEFAULT 0,
      receive_fee_model INTEGER NOT NULL DEFAULT 0
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      transaction_type TEXT NOT NULL,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT,
      user_id INTEGER REFERENCES users(id),
      settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      provider TEXT,
      is_active INTEGER DEFAULT 1,
      is_system INTEGER DEFAULT 0,
      module_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_name TEXT NOT NULL UNIQUE,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    -- Included for schema completeness; NOT queried on this code path since
    -- every call below passes an explicit exchangeRate (getUsdLbpSellRate,
    -- the only reader, is short-circuited by the ?? operator).
    CREATE TABLE currencies (
      tenant_id INTEGER DEFAULT 1,
      code TEXT PRIMARY KEY,
      name TEXT
    );
    CREATE TABLE currency_drawers (
      tenant_id INTEGER DEFAULT 1,
      currency_code TEXT NOT NULL,
      drawer_name TEXT NOT NULL
    );

    INSERT INTO drawer_balances VALUES (1, 'General',      'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',      'LBP', 100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_App',      'USD', 500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_App',    'USD', 500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System',   'USD', 500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_System', 'USD', 500,  CURRENT_TIMESTAMP);

    -- Primary (base) system supplier row — required for the supplier-ledger
    -- auto-booking block to fire at all (getByProvider lookup).
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT', 'OMT', 1);
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');
  `);

  return db;
}

interface StoredRow {
  fsPaidBy: string;
  metaPaidBy: string;
}

function storedPaidBy(db: Database.Database, txnId: number): StoredRow {
  const t = db
    .prepare(`SELECT source_id, metadata_json FROM transactions WHERE id = ?`)
    .get(txnId) as { source_id: number; metadata_json: string };
  const fs = db
    .prepare(`SELECT paid_by FROM financial_services WHERE id = ?`)
    .get(t.source_id) as { paid_by: string };
  const meta = JSON.parse(t.metadata_json) as { paid_by: string };
  return { fsPaidBy: fs.paid_by, metaPaidBy: meta.paid_by };
}

function debtRows(
  db: Database.Database,
  txnId: number,
): Array<{ amount_usd: number; note: string }> {
  return db
    .prepare(
      `SELECT amount_usd, note FROM debt_ledger WHERE transaction_id = ? ORDER BY id`,
    )
    .all(txnId) as Array<{ amount_usd: number; note: string }>;
}

describe("LIRA-349 A4 — financial service paid_by + on-account debt note", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    repo = new FinancialServiceRepository();
    db.prepare(
      `INSERT INTO clients (id, full_name, phone_number) VALUES (9927, 'Review Client 26-10', '03261026')`,
    ).run();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  // The exact tx 13105 shape: $20 INTRA + $1 fee, all on account.
  const omtSend = (payments: Array<Record<string, unknown>>) =>
    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 0.1,
      omtFee: 1,
      omtServiceType: "INTRA",
      referenceNumber: "OMT-REF-2610",
      clientId: 9927,
      clientName: "Review Client 26-10",
      phoneNumber: "03261026",
      senderName: "Review Client 26-10",
      senderPhone: "03261026",
      includingFees: false,
      exchangeRate: 89000,
      payments: payments as never,
    });

  it("OMT SEND fully on account: paid_by is CUSTOMER_ACCOUNT (was CASH)", () => {
    const res = omtSend([
      { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 21 },
    ]);
    expect(storedPaidBy(db, res.id)).toEqual({
      fsPaidBy: "CUSTOMER_ACCOUNT",
      metaPaidBy: "CUSTOMER_ACCOUNT",
    });
  });

  it("OMT SEND fully on account: the debt note shows the $21 owed and the fee", () => {
    const res = omtSend([
      { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 21 },
    ]);
    const rows = debtRows(db, res.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_usd).toBeCloseTo(21, 5);
    expect(rows[0].note).toBe("OMT send $20 + $1 fee = $21, ref OMT-REF-2610");
  });

  it("split CASH + account: paid_by is MULTI; the note still names the full charge", () => {
    const res = omtSend([
      { method: "CASH", currencyCode: "USD", amount: 11 },
      { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 10 },
    ]);
    expect(storedPaidBy(db, res.id)).toEqual({
      fsPaidBy: "MULTI",
      metaPaidBy: "MULTI",
    });
    const rows = debtRows(db, res.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_usd).toBeCloseTo(10, 5);
    expect(rows[0].note).toBe(
      "OMT send $20 + $1 fee = $21, ref OMT-REF-2610 — $10 on account",
    );
  });

  it("cash with change returned: an OUT leg is not a way the customer paid — stays CASH", () => {
    const res = omtSend([
      { method: "CASH", currencyCode: "USD", amount: 25 },
      { method: "CASH", currencyCode: "USD", amount: 4, direction: "OUT" },
    ]);
    expect(storedPaidBy(db, res.id)).toEqual({
      fsPaidBy: "CASH",
      metaPaidBy: "CASH",
    });
  });

  it("legacy single-method on-account SEND (paidByMethod, no legs): same note", () => {
    const res = repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 0.1,
      omtFee: 1,
      omtServiceType: "INTRA",
      referenceNumber: "OMT-REF-2610",
      clientName: "Review Client 26-10",
      phoneNumber: "03261026",
      includingFees: false,
      exchangeRate: 89000,
      paidByMethod: "CUSTOMER_ACCOUNT",
    });
    expect(storedPaidBy(db, res.id).fsPaidBy).toBe("CUSTOMER_ACCOUNT");
    const rows = debtRows(db, res.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_usd).toBeCloseTo(21, 5);
    expect(rows[0].note).toBe("OMT send $20 + $1 fee = $21, ref OMT-REF-2610");
  });

  it("zero-fee SEND on account: no fee clause", () => {
    const res = repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 0,
      omtFee: 0,
      clientId: 9927,
      clientName: "Review Client 26-10",
      phoneNumber: "03261026",
      includingFees: false,
      exchangeRate: 89000,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 20 },
      ] as never,
    });
    expect(debtRows(db, res.id)[0].note).toBe("OMT send $20");
  });

  it("the same rule covers app-wallet sends: Whish App SEND on account stores CUSTOMER_ACCOUNT", () => {
    const res = repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 2,
      clientId: 9927,
      clientName: "Review Client 26-10",
      phoneNumber: "03261026",
      exchangeRate: 89000,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 22 },
      ] as never,
    });
    expect(storedPaidBy(db, res.id)).toEqual({
      fsPaidBy: "CUSTOMER_ACCOUNT",
      metaPaidBy: "CUSTOMER_ACCOUNT",
    });
  });
});
