/**
 * SupplierRepository.getAccountExpectedStatement() — LIRA-255 ("check
 * against OMT's statement").
 *
 * OMT texts the shop a balance figure that already has the shop's
 * commission deducted ("INCLUDES INTRA SHARES"); the app books OMT GROSS
 * (FEATURE_GUIDE.md §7/§8.1 — transfer + fee, commission settles
 * separately). This file proves, with REAL writers (`FinancialService
 * Repository.createTransaction`, not hand-inserted rows), that:
 *
 *   expected = gross_owed − unsettled_commission, per currency,
 *
 * reusing the account rollup's own gross figure (`getAccountBalances`,
 * rule 14 — never re-derived) and the Settle tab's own pending-settlement
 * row set (`getUnsettledBySupplier`, rule 14), summing ALL commission
 * types/models (owner, 2026-10-03 — not split by type yet, LIRA-256) with
 * NO sign flip (the app's own balance sign is already "positive = shop
 * owes", the same convention OMT's SMS uses).
 *
 * Schema mirrors `OmtSystemFeeCharacterization.test.ts` (every table the
 * OMT SEND/RECEIVE write path touches) PLUS the OMT_OPEN_CREDIT_ACCOUNT
 * columns `SupplierRepository.accountRollup.test.ts` adds
 * (`suppliers.account_supplier_id`, `supplier_ledger.is_refunded`) so
 * `getAccountBalances`/`getAccountExpectedStatement` resolve without
 * throwing "no such column".
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import { SupplierRepository } from "../SupplierRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetSupplierRepository } from "../SupplierRepository";
import {
  resetFinancialServiceRepository,
} from "../FinancialServiceRepository";
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
      tenant_id INTEGER DEFAULT 1, id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, role TEXT DEFAULT 'staff');
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
      receive_fee_model INTEGER NOT NULL DEFAULT 0,
      edited_by INTEGER,
      edited_at TEXT
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

    -- OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-187/188) column, migration v176 —
    -- required for getAccountBalances/getAccountExpectedStatement to see
    -- this schema as account-rollup-capable at all.
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
      account_supplier_id INTEGER REFERENCES suppliers(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- is_refunded (v120) required by ledgerNotRefunded() — _ledgerBalanceQuery
    -- (getAccountBalances' balance projection) references it unconditionally.
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
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at TEXT,
      source_ref_table TEXT,
      source_ref_id INTEGER,
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
    INSERT INTO drawer_balances VALUES (1, 'OMT_System',   'LBP', 500000000,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_System', 'USD', 500,  CURRENT_TIMESTAMP);

    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT', 'OMT', 1);
    -- An account CHILD (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md, LIRA-188) is
    -- required for the parent to register as an account at all —
    -- getAccountBalances' accountMemberWhere only picks up a supplier that
    -- EITHER has account_supplier_id set OR has a child pointing at it.
    INSERT INTO suppliers (name, provider, is_system, account_supplier_id) VALUES ('OMT App', 'OMT_APP', 0, 1);
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');
  `);

  return db;
}

describe("SupplierRepository.getAccountExpectedStatement() — LIRA-255", () => {
  let db: Database.Database;
  let financialServiceRepo: FinancialServiceRepository;
  let supplierRepo: SupplierRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetFinancialServiceRepository();
    resetTransactionRepository();
    financialServiceRepo = new FinancialServiceRepository();
    supplierRepo = new SupplierRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetFinancialServiceRepository();
    resetTransactionRepository();
  });

  const OMT_ACCOUNT_ID = 1; // 'OMT' supplier row inserted first above.

  it("SEND USD ($207 + $1 fee, $0.25 commission) plus an LBP transfer: expected = gross − unsettled commission, per currency, in OMT's sign", () => {
    // USD leg — real writer, fee-on-top, commission explicitly the shop's
    // $0.25 cut (not auto-calculated — OMT's own published rate is beside
    // the point here; what matters is that THIS number is what gets
    // subtracted).
    financialServiceRepo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 207,
      currency: "USD",
      commission: 0.25,
      omtFee: 1,
      paidByMethod: "CASH",
      includingFees: false,
      exchangeRate: 90000,
    });

    // LBP leg — another real writer, same shape, different currency.
    financialServiceRepo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 1_000_000,
      currency: "LBP",
      commission: 5_000,
      omtFee: 50_000,
      paidByMethod: "CASH",
      includingFees: false,
      exchangeRate: 90000,
    });

    const statement = supplierRepo.getAccountExpectedStatement(
      OMT_ACCOUNT_ID,
    );

    // Gross owed (SEND, fee-on-top): +(x+f). USD: 207+1=208. LBP: 1,000,000+50,000=1,050,000.
    expect(statement.gross_owed_usd).toBeCloseTo(208, 5);
    expect(statement.gross_owed_lbp).toBeCloseTo(1_050_000, 5);

    // Unsettled commission — the real per-row figure the Settle tab would
    // also show for these two still-pending rows.
    expect(statement.unsettled_commission_usd).toBeCloseTo(0.25, 5);
    expect(statement.unsettled_commission_lbp).toBeCloseTo(5_000, 5);

    // Expected on OMT's statement = gross − commission, OMT's OWN sign
    // (plus = shop owes OMT) — the same sign the app's own gross figure
    // already uses, so this is a plain subtraction, never negated.
    expect(statement.expected_usd).toBeCloseTo(207.75, 5);
    expect(statement.expected_lbp).toBeCloseTo(1_045_000, 5);

    // Both are still POSITIVE here — "the shop owes OMT" in OMT's own sign
    // convention. See the next test for the opposite direction.
    expect(statement.expected_usd).toBeGreaterThan(0);
    expect(statement.expected_lbp).toBeGreaterThan(0);
  });

  it("RECEIVE large payout: gross goes NEGATIVE (OMT owes the shop) and the expected figure stays negative after subtracting commission", () => {
    // RECEIVE: the OMT SYSTEM never takes a fee from the customer on a
    // RECEIVE (D1, FEATURE_GUIDE §8.1/OmtSystemFeeCharacterization CASE 1)
    // — `omtFee` still drives the commission estimate but posts no leg and
    // does not reduce what OMT owes. Gross owed = −x exactly: x=500 ⇒
    // gross = −500. commission (the shop's own cut, still real) = 0.5.
    financialServiceRepo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 500,
      currency: "USD",
      commission: 0.5,
      omtFee: 5,
      cashoutMethod: "CASH",
      exchangeRate: 90000,
    });

    const statement = supplierRepo.getAccountExpectedStatement(
      OMT_ACCOUNT_ID,
    );

    expect(statement.gross_owed_usd).toBeCloseTo(-500, 5);
    expect(statement.unsettled_commission_usd).toBeCloseTo(0.5, 5);
    // expected = gross − commission = −500 − 0.5 = −500.5: OMT owes the
    // shop EVEN MORE once its own commission deduction is accounted for —
    // this is the "minus = OMT owes the shop" direction the owner named.
    expect(statement.expected_usd).toBeCloseTo(-500.5, 5);
    expect(statement.expected_usd).toBeLessThan(0);
  });

  it("zeroed statement for an unknown account id (no account members) — never throws", () => {
    const statement = supplierRepo.getAccountExpectedStatement(999);
    expect(statement).toEqual({
      account_supplier_id: 999,
      gross_owed_usd: 0,
      gross_owed_lbp: 0,
      unsettled_commission_usd: 0,
      unsettled_commission_lbp: 0,
      expected_usd: 0,
      expected_lbp: 0,
    });
  });
});
