/**
 * Backdated OMT/Whish entry whose store credit goes on the customer's
 * account (follow-up to the 2026-10-28 backdated account-charge fix).
 *
 * The five `addCreditOrThrow` calls in FinancialServiceRepository (change
 * returned as store credit, RECEIVE cashed out to the account, …) passed
 * the transaction's id but not its custom time, so the CREDIT_DEPOSIT row
 * was stamped with the save time while the transaction carried the custom
 * time. `DebtRepository.addCredit` now takes the linked transaction's own
 * time (debt_ledger's canonical 'YYYY-MM-DD HH:MM:SS' UTC) — one derivation
 * for every caller, the same as `bookClientDebtCharge`.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import { TransactionRepository } from "../TransactionRepository";
import { getDebtService, resetDebtService } from "../../services/DebtService";
import { resetDebtRepository } from "../DebtRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

const CLIENT_ID = 501;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role     TEXT DEFAULT 'staff'
    );
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name    TEXT NOT NULL,
      phone_number TEXT,
      notes        TEXT,
      tenant_id    INTEGER DEFAULT 1,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name, phone_number, tenant_id)
      VALUES (${CLIENT_ID}, 'Store Credit Client', '70000000', 1);

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
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER,
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
      commission_model INTEGER NOT NULL DEFAULT 0,
      receive_fee_model INTEGER NOT NULL DEFAULT 0
    );

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
      extra_usd REAL NOT NULL DEFAULT 0,
      extra_lbp REAL NOT NULL DEFAULT 0,
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
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General',    'USD', 1000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General',    'LBP', 100000000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'OMT_System', 'USD', 5000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'OMT_App',    'USD', 500);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Binance',    'USDT', 500);

    -- LIRA-258 (owner D2): the OMT/WHISH auto supplier posting is no longer
    -- wrapped in a swallowing try/catch — without these tables every OMT
    -- transaction here now rolls back. Columns mirror
    -- FinancialServiceRepository.partner.test.ts (contact_name/phone/note/
    -- module_key: SupplierRepository.getColumns() selects them; is_auto/
    -- is_refunded/refunded_at/source_ref_*: the auto-posting INSERT and the
    -- void/refund supplier-sibling cascade need them). Rows are seeded so
    -- ensureSystemSupplier never reaches the real-schema seed path.
    CREATE TABLE suppliers (
      tenant_id    INTEGER DEFAULT 1,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      contact_name TEXT,
      phone        TEXT,
      note         TEXT,
      provider     TEXT,
      is_active    INTEGER DEFAULT 1,
      is_system    INTEGER DEFAULT 0,
      module_key   TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT',   'OMT',   1);
    INSERT INTO suppliers (name, provider, is_system) VALUES ('WHISH', 'WHISH', 1);

    CREATE TABLE supplier_ledger (
      tenant_id        INTEGER DEFAULT 1,
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id      INTEGER NOT NULL,
      entry_type       TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      note             TEXT,
      created_by       INTEGER,
      transaction_id   INTEGER,
      is_auto          INTEGER NOT NULL DEFAULT 0,
      is_refunded      INTEGER NOT NULL DEFAULT 0,
      refunded_at      DATETIME,
      source_ref_table TEXT DEFAULT NULL,
      source_ref_id    INTEGER DEFAULT NULL,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);
  `);
  return db;
}

function setTestDb(db: Database.Database): void {
  (
    globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
  ).__LIRATEK_TEST_DB__ = db;
}

function clearTestDb(): void {
  delete (globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database })
    .__LIRATEK_TEST_DB__;
}

function drawer(db: Database.Database, name: string, currency: string): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(name, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function clientBalance(
  db: Database.Database,
  clientId: number,
): { usd: number; lbp: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM debt_ledger WHERE client_id = ?`,
    )
    .get(clientId) as { usd: number; lbp: number };
  return row;
}

function creditRows(
  db: Database.Database,
  clientId: number,
): Array<{
  transaction_type: string;
  amount_usd: number;
  amount_lbp: number;
  transaction_id: number | null;
}> {
  return db
    .prepare(
      `SELECT transaction_type, amount_usd, amount_lbp, transaction_id
       FROM debt_ledger WHERE client_id = ? ORDER BY id ASC`,
    )
    .all(clientId) as Array<{
    transaction_type: string;
    amount_usd: number;
    amount_lbp: number;
    transaction_id: number | null;
  }>;
}

/** The unified transactions.id for a given financial_services row — createTransaction()
 *  returns the financial_services.id, not the unified transaction id. */
function txnIdFor(db: Database.Database, financialServiceId: number): number {
  const row = db
    .prepare(
      `SELECT id FROM transactions WHERE source_table = 'financial_services' AND source_id = ?`,
    )
    .get(financialServiceId) as { id: number };
  return row.id;
}

describe("backdated financial service — store credit takes the transaction's time", () => {
  let db: Database.Database;
  let fsRepo: FinancialServiceRepository;
  let txnRepo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    initFixedTenantContext(1);
    resetDebtService();
    resetDebtRepository();
    fsRepo = new FinancialServiceRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    clearTestDb();
    db.close();
    resetDebtService();
    resetDebtRepository();
    resetTenantContext();
  });

  // ── (a) RECEIVE cashed out to CUSTOMER_ACCOUNT (OMT, useSystemDrawerFlow) ──
  const creditAt = (txnId: number) =>
    (
      db
        .prepare(
          `SELECT created_at FROM debt_ledger WHERE transaction_id = ? AND transaction_type = 'CREDIT_DEPOSIT'`,
        )
        .get(txnId) as { created_at: string }
    ).created_at;

  it("OMT RECEIVE cashed to the customer's account with a custom time: the credit row carries that time", () => {
    const { id: fsId } = fsRepo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      cashoutMethod: "CUSTOMER_ACCOUNT",
      clientId: CLIENT_ID,
      exchangeRate: 90000,
      userId: 1,
      transaction_time: "2026-10-24T18:03:00.000Z",
    });
    expect(creditAt(txnIdFor(db, fsId))).toBe("2026-10-24 18:03:00");
  });

  it("OMT_APP SEND with change kept on the account and a custom time: the credit row carries that time", () => {
    const { id: fsId } = fsRepo.createTransaction({
      provider: "OMT_APP",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 0,
      clientId: CLIENT_ID,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 25 },
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 5,
          direction: "OUT",
        },
      ],
      exchangeRate: 90000,
      userId: 1,
      transaction_time: "2026-10-24T18:03:00.000Z",
    });
    expect(creditAt(txnIdFor(db, fsId))).toBe("2026-10-24 18:03:00");
  });
});
