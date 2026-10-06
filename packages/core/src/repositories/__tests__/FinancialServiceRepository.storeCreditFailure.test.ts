/**
 * FinancialServiceRepository — a failed store-credit write must roll the
 * whole transaction back (LIRA-258, POSTING_INTEGRITY_PLAN.md item 2.3,
 * POSTING_MAP.md §7 gap G13).
 *
 * Every money-to-the-customer's-account posting in createTransaction (a
 * RECEIVE paid out to the account, one CUSTOMER_ACCOUNT leg of a split
 * payout, change kept as store credit) used `DebtService.addCredit`, which
 * CATCHES any error and returns `{ success: false }` — a result nobody
 * read. So when the credit write failed, the drawer/supplier postings still
 * committed and the customer silently lost the money. The fix switches each
 * site to `addCreditOrThrow`, so the failure aborts `db.transaction(...)`.
 *
 * The failure is forced at the database level (a BEFORE INSERT trigger on
 * CREDIT_DEPOSIT rows), so DebtService and DebtRepository run for real —
 * nothing in the path is mocked. Each case also has a control run proving
 * the credit really is posted when nothing fails.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import type { CreateFinancialServiceData } from "../FinancialServiceRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { expectPostings, snapshotLedgers } from "../testHelpers/postingAssert";

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
    INSERT INTO clients (id, full_name) VALUES (1, 'Test Client');

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
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      source_ref_table TEXT DEFAULT NULL,
      source_ref_id INTEGER DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       TEXT,
      session_id       INTEGER,
      tenant_id        INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT DEFAULT NULL
    );

    CREATE TABLE system_settings (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_name TEXT NOT NULL UNIQUE,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');

    INSERT INTO drawer_balances VALUES (1, 'General',    'USD', 1000,        CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',    'LBP', 100000000,   CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'USD', 500,         CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System', 'LBP', 100000000,   CURRENT_TIMESTAMP);
  `);

  return db;
}

interface Case {
  name: string;
  payload: CreateFinancialServiceData;
  /** Customer-account delta the control run must post ("1|USD" etc.). */
  credit: Record<string, number>;
}

const CASES: Case[] = [
  {
    name: "OMT RECEIVE paid out entirely to the customer's account",
    payload: {
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      omtServiceType: "INTRA",
      cashoutMethod: "CUSTOMER_ACCOUNT",
      clientId: 1,
    },
    credit: { "1|USD": -100 },
  },
  {
    name: "OMT RECEIVE split payout — the CUSTOMER_ACCOUNT leg",
    payload: {
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      omtServiceType: "INTRA",
      cashoutMethod: "CASH",
      clientId: 1,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 60 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 40 },
      ],
      exchangeRate: 89000,
    },
    credit: { "1|USD": -40 },
  },
  {
    name: "Whish App RECEIVE paid out entirely to the customer's account",
    payload: {
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      cashoutMethod: "CUSTOMER_ACCOUNT",
      clientId: 1,
    },
    credit: { "1|USD": -100 },
  },
  {
    name: "Whish App RECEIVE split payout — the CUSTOMER_ACCOUNT leg",
    payload: {
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      cashoutMethod: "CASH",
      clientId: 1,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 70 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 30 },
      ],
      exchangeRate: 89000,
    },
    credit: { "1|USD": -30 },
  },
  {
    name: "OMT SEND with change kept as store credit",
    payload: {
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      omtServiceType: "INTRA",
      omtFee: 5,
      clientId: 1,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 110 },
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 5,
          direction: "OUT",
        },
      ],
      exchangeRate: 89000,
    },
    credit: { "1|USD": -5 },
  },
];

describe("FinancialServiceRepository — store credit cannot be silently dropped (G13)", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;

  const resetSingletons = () => {
    resetTransactionRepository();
    resetSupplierRepository();
    resetDebtRepository();
    resetDebtService();
  };

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetSingletons();
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetSingletons();
    resetTenantContext();
  });

  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  for (const c of CASES) {
    describe(c.name, () => {
      it("control: the credit is posted to the customer's account", () => {
        const before = snapshotLedgers(db);
        // createTransaction partitions `payments` in place — always hand it
        // a fresh copy so one run cannot change the next one's payload.
        repo.createTransaction(structuredClone(c.payload));
        const after = snapshotLedgers(db);
        for (const [key, delta] of Object.entries(c.credit)) {
          expect((after.debt[key] ?? 0) - (before.debt[key] ?? 0)).toBeCloseTo(
            delta,
            2,
          );
        }
      });

      it("rolls the whole transaction back when the credit write fails", () => {
        db.exec(`
          CREATE TRIGGER fail_credit_deposit BEFORE INSERT ON debt_ledger
          WHEN NEW.transaction_type = 'CREDIT_DEPOSIT'
          BEGIN SELECT RAISE(ABORT, 'simulated credit write failure'); END;
        `);
        const before = snapshotLedgers(db);
        const fsBefore = count("financial_services");
        const txnsBefore = count("transactions");
        const paymentsBefore = count("payments");

        expect(() =>
          repo.createTransaction(structuredClone(c.payload)),
        ).toThrow(/simulated credit write failure/);

        // Nothing committed: no drawer, supplier, partner or debt movement,
        // no service row, no journal row, no payment row.
        expectPostings(before, snapshotLedgers(db), {});
        expect(count("financial_services")).toBe(fsBefore);
        expect(count("transactions")).toBe(txnsBefore);
        expect(count("payments")).toBe(paymentsBefore);
      });
    });
  }
});
