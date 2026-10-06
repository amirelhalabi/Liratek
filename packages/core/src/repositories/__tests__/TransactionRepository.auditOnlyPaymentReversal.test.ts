/**
 * TransactionRepository._reversePayments — audit-only payment rows
 * (LIRA-258, POSTING_MAP.md gap G34).
 *
 * The OMT/WHISH system SEND writes a `PM_FEE` payments row for the
 * payment-method fee WITHOUT a drawer delta: the fee is already inside the
 * wallet leg that was credited in full. The generic void/refund mirrored
 * every payments row AND applied its negated amount as a drawer delta, so it
 * took back a fee that was never added on its own — measured: a WHISH-wallet
 * OMT SEND with a $0.50 pm fee left Whish_App -0.5 after create + void.
 *
 * Failing-first on the pre-fix code (rule 17) — see the report for the
 * recorded failure. Rule 20: create + reverse must net every ledger to 0.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { ClosingRepository } from "../ClosingRepository";
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

describe("TransactionRepository — reversal of audit-only PM_FEE rows (G34)", () => {
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

  const pmFeeRows = () =>
    db
      .prepare(
        "SELECT transaction_id, drawer_name, amount FROM payments WHERE method = 'PM_FEE' ORDER BY id",
      )
      .all() as { transaction_id: number; drawer_name: string; amount: number }[];

  const payloads = [
    {
      name: "single WHISH-wallet payment",
      extra: { paidByMethod: "WHISH" },
    },
    {
      name: "split leg [{WHISH, 105.5}] (fee baked into the leg)",
      extra: {
        payments: [{ method: "WHISH", currencyCode: "USD", amount: 105.5 }],
      },
    },
  ];

  const createSend = (extra: Record<string, unknown>) => {
    const { id } = repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 0,
      omtFee: 5,
      paymentMethodFee: 0.5,
      paymentMethodFeeRate: 0.005,
      ...extra,
    } as Parameters<FinancialServiceRepository["createTransaction"]>[0]);
    const parent = getTransactionRepository().getBySourceId(
      "financial_services",
      id,
    );
    expect(parent).not.toBeNull();
    // Precondition: the flow under test really writes the audit-only row.
    expect(pmFeeRows()).toEqual([
      expect.objectContaining({ transaction_id: parent!.id, amount: 0.5 }),
    ]);
    return parent!.id;
  };

  it.each(payloads)(
    "void of an OMT SEND paid by $name nets every ledger to zero",
    ({ extra }) => {
      const before = snapshotLedgers(db);
      const txnId = createSend(extra);
      const reversalId = getTransactionRepository().voidTransaction(txnId, 1);
      expectPostings(before, snapshotLedgers(db), {});
      // The audit trail still mirrors the PM_FEE row on the reversal.
      expect(pmFeeRows()).toEqual([
        expect.objectContaining({ transaction_id: txnId, amount: 0.5 }),
        expect.objectContaining({ transaction_id: reversalId, amount: -0.5 }),
      ]);
      // The payments journal (what ClosingRepository.recalculateDrawerBalances
      // sums) also nets to zero across create + void.
      const journal = db
        .prepare(
          "SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE method != 'CUSTOMER_ACCOUNT' AND transaction_id IN (?, ?) AND drawer_name = 'Whish_App'",
        )
        .get(txnId, reversalId) as { s: number };
      expect(journal.s).toBeCloseTo(0, 6);
    },
  );

  it.each(payloads)(
    "refund of an OMT SEND paid by $name nets every ledger to zero",
    ({ extra }) => {
      const before = snapshotLedgers(db);
      const txnId = createSend(extra);
      getTransactionRepository().refundTransaction(txnId, 1);
      expectPostings(before, snapshotLedgers(db), {});
    },
  );
  // G35 (LIRA-258): ClosingRepository.recalculateDrawerBalances rebuilds each
  // drawer as SUM(payments.amount), so an audit-only PM_FEE row (which never
  // moved a drawer) inflated the rebuilt wallet balance by the fee. Same
  // single definition as the reversal fix: AUDIT_ONLY_PAYMENT_METHODS.
  test.each(payloads)(
    "drawer recalculation leaves the wallet unchanged after a $name SEND with a pm fee (G35)",
    ({ extra }) => {
      createSend(extra);
      const whish = () =>
        (
          db
            .prepare(
              "SELECT balance FROM drawer_balances WHERE drawer_name = 'Whish_App' AND currency_code = 'USD'",
            )
            .get() as { balance: number }
        ).balance;
      const live = whish();
      expect(new ClosingRepository().recalculateDrawerBalances()).toEqual({
        success: true,
      });
      expect(whish()).toBeCloseTo(live, 6);
    },
  );
});
