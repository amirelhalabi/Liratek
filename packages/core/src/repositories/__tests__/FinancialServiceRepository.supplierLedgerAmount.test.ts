/**
 * FinancialServiceRepository — C3: supplier ledger books the TRANSACTION amount
 *
 * The auto supplier_ledger entry written for an OMT/WHISH system transaction
 * must equal the transfer amount — NOT the customer-paid total. Pre-C3 the
 * entry added the provider fee (SEND: amount + omtFee) or the commission
 * (RECEIVE: amount + commission), i.e. exactly what the customer paid, which
 * left a phantom fee/commission residue on the supplier balance after every
 * settlement (the Settle tab nets `owed − commission = amount`).
 *
 * Cost/price-flow sales are unchanged: they book the sale `cost`.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetTransactionRepository } from "../TransactionRepository";

// ─── Mock DB connection (shared by all sub-repositories) ─────────────────────

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

// ─── Mock DebtService (unused here, but imported by the repo) ────────────────

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

// ─── In-memory schema (mirrors the systemLedger test) ────────────────────────

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
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR'))
    );

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
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT', 'OMT', 1);

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
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');

    INSERT INTO drawer_balances VALUES (1, 'General',    'USD', 1000,      CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',    'LBP', 100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'USD', 500,       CURRENT_TIMESTAMP);
  `);

  return db;
}

function omtLedgerEntries(db: Database.Database) {
  return db
    .prepare(
      `SELECT sl.entry_type, sl.amount_usd, sl.amount_lbp
         FROM supplier_ledger sl
         JOIN suppliers s ON s.id = sl.supplier_id
        WHERE s.provider = 'OMT'
        ORDER BY sl.id ASC`,
    )
    .all() as Array<{
    entry_type: string;
    amount_usd: number;
    amount_lbp: number;
  }>;
}

describe("FinancialServiceRepository — C3: supplier ledger = transaction amount", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    // Sub-repositories are singletons bound to getDatabase() at first use —
    // reset them so they attach to THIS test's in-memory DB, not a closed one.
    resetSupplierRepository();
    resetTransactionRepository();
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetTransactionRepository();
  });

  it("SEND: books the transfer amount, NOT amount + provider fee (customer-paid)", () => {
    // Customer pays 100 + 5 fee = 105; the ledger must record 100.
    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      omtServiceType: "INTRA",
      omtFee: 5,
      paidByMethod: "CASH",
      exchangeRate: 90000,
    });

    const entries = omtLedgerEntries(db);
    expect(entries).toHaveLength(1);
    expect(entries[0].entry_type).toBe("TOP_UP");
    expect(entries[0].amount_usd).toBeCloseTo(100, 2); // pre-C3: 105
    expect(entries[0].amount_lbp).toBe(0);
  });

  it("RECEIVE: books the transfer amount, NOT amount + commission", () => {
    repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 1,
      omtServiceType: "INTRA",
      cashoutMethod: "CASH",
      exchangeRate: 90000,
    });

    const entries = omtLedgerEntries(db);
    expect(entries).toHaveLength(1);
    expect(entries[0].entry_type).toBe("PAYMENT");
    // PAYMENT entries are stored negative by convention; the MAGNITUDE must be
    // the transfer amount (pre-C3: −101 = −(amount + commission)).
    expect(entries[0].amount_usd).toBeCloseTo(-100, 2);
    expect(entries[0].amount_lbp).toBeCloseTo(0, 2);
  });

  it("SEND split-pay: ledger stays the transfer amount even when the paid legs total differs", () => {
    // $50 transfer + $2 fee; customer split-pays $30 cash + 1,980,000 LBP —
    // a paid total unrelated to the TRANSFER amount (data.amount = $50) even
    // though it reconciles exactly against the TRUE customer-owed total
    // (transfer + fee = $52 = $30 + 1,980,000/90,000). The repository now
    // hard-rejects legs that don't cover the customer's real total (S2,
    // Payment-Legs Integrity plan); 1,980,000 (not the original 2,000,000,
    // which was $0.22 short of $52 at this rate) is the number that both
    // reconciles AND keeps this test's point intact: the ledger books $50
    // (the bare transfer), never $52 (transfer + fee) or $30 (one leg).
    repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 50,
      currency: "USD",
      commission: 0,
      omtServiceType: "INTRA",
      omtFee: 2,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 30 },
        { method: "CASH", currencyCode: "LBP", amount: 1_980_000 },
      ],
      exchangeRate: 90000,
    });

    const entries = omtLedgerEntries(db);
    expect(entries).toHaveLength(1);
    expect(entries[0].entry_type).toBe("TOP_UP");
    expect(entries[0].amount_usd).toBeCloseTo(50, 2); // never the paid total
    expect(entries[0].amount_lbp).toBe(0);
  });
});
