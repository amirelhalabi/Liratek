/**
 * FinancialServiceRepository — payment-method fee on the catalog (cost/price)
 * and app-wallet transfer flows (LIRA-258, POSTING_INTEGRITY_PLAN.md item
 * 4.5, POSTING_MAP.md §7 gap G28).
 *
 * A payment-method fee (`pmFee`) is the surcharge for paying by a wallet; it
 * stays in that wallet's drawer as shop profit, and the Profits page counts
 * it from `financial_services.payment_method_fee` on EVERY flow.
 *
 *   - Single payment: the paying drawer must be credited amount + pmFee (the
 *     system SEND's `totalCustomerPays` rule). The catalog and wallet flows
 *     credited the amount only, so profit said +pmFee while the drawer never
 *     got it. FAILING-FIRST on the pre-fix code: Whish_App +10 (expected
 *     10.1) and +102 (expected 103.02).
 *   - Split legs: the caller bakes the fee into the wallet leg and the legs
 *     are credited in full — already right before the fix (characterization).
 *   - No PM_FEE audit row on these flows: nothing reads it for a number (the
 *     Profits page reads `payment_method_fee`), so it would only be noise.
 *     (It was originally left off because the generic void mirrored it as a
 *     real drawer movement; since G34 `_reversePayments` skips
 *     AUDIT_ONLY_PAYMENT_METHODS, so that is no longer a hazard.) The void
 *     tests below guard rule 20.
 *
 * Reachability: no shipped form sends a pm fee on these flows today (only the
 * OMT/WHISH Services page does), so this guards the API contract
 * (`paymentMethodFee` is accepted by the shared financial schema for every
 * provider), not a live user path.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  expectPostings,
  ledgerDeltas,
  snapshotLedgers,
} from "../testHelpers/postingAssert";

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

describe("FinancialServiceRepository — payment-method fee on catalog and wallet flows (G28)", () => {
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
        "SELECT drawer_name, currency_code, amount FROM payments WHERE method = 'PM_FEE' ORDER BY id",
      )
      .all() as {
      drawer_name: string;
      currency_code: string;
      amount: number;
    }[];

  describe("catalog (iPick cost $9 / price $10), $0.10 pm fee", () => {
    it("single wallet payment: the wallet drawer gets price + pm fee, failing-first", () => {
      const before = snapshotLedgers(db);
      repo.createTransaction({
        provider: "iPick",
        serviceType: "SEND",
        amount: 10,
        cost: 9,
        price: 10,
        currency: "USD",
        commission: 0,
        paidByMethod: "WHISH",
        paymentMethodFee: 0.1,
        paymentMethodFeeRate: 0.01,
      });
      const delta = ledgerDeltas(before, snapshotLedgers(db));
      expect(delta.drawers["Whish_App|USD"] ?? 0).toBeCloseTo(10.1, 2);
      // No PM_FEE audit row — see the header (void would mirror it).
      expect(pmFeeRows()).toEqual([]);
    });

    it("split legs (fee baked into the wallet leg): legs credited in full — characterization, already right before the fix", () => {
      const before = snapshotLedgers(db);
      repo.createTransaction({
        provider: "iPick",
        serviceType: "SEND",
        amount: 10,
        cost: 9,
        price: 10,
        currency: "USD",
        commission: 0,
        payments: [{ method: "WHISH", currencyCode: "USD", amount: 10.1 }],
        paymentMethodFee: 0.1,
        paymentMethodFeeRate: 0.01,
      });
      const delta = ledgerDeltas(before, snapshotLedgers(db));
      expect(delta.drawers["Whish_App|USD"] ?? 0).toBeCloseTo(10.1, 2);
      // No PM_FEE audit row — see the header (void would mirror it).
      expect(pmFeeRows()).toEqual([]);
    });
  });

  describe("app-wallet transfer (OMT_APP SEND $100, fee $2), $1.02 pm fee", () => {
    it("single wallet payment: the wallet drawer gets amount + fee + pm fee, failing-first", () => {
      const before = snapshotLedgers(db);
      repo.createTransaction({
        provider: "OMT_APP",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 2,
        paidByMethod: "WHISH",
        paymentMethodFee: 1.02,
        paymentMethodFeeRate: 0.01,
      });
      const delta = ledgerDeltas(before, snapshotLedgers(db));
      expect(delta.drawers["Whish_App|USD"] ?? 0).toBeCloseTo(103.02, 2);
      expect(delta.drawers["OMT_App|USD"] ?? 0).toBeCloseTo(-100, 2);
      // No PM_FEE audit row — see the header (void would mirror it).
      expect(pmFeeRows()).toEqual([]);
    });

    it("split legs (fee baked into the wallet leg): legs credited in full — characterization, already right before the fix", () => {
      const before = snapshotLedgers(db);
      repo.createTransaction({
        provider: "OMT_APP",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 2,
        payments: [{ method: "WHISH", currencyCode: "USD", amount: 103.02 }],
        paymentMethodFee: 1.02,
        paymentMethodFeeRate: 0.01,
      });
      const delta = ledgerDeltas(before, snapshotLedgers(db));
      expect(delta.drawers["Whish_App|USD"] ?? 0).toBeCloseTo(103.02, 2);
      // No PM_FEE audit row — see the header (void would mirror it).
      expect(pmFeeRows()).toEqual([]);
    });
  });
  // Rule 20 guard (not failing-first — written after the fix; it would
  // also hold on the pre-fix code, which posted no pm fee at all):
  // the pm fee rides inside the real leg, so the generic void must net
  // every ledger back to zero.
  it.each([
    {
      name: "catalog",
      payload: {
        provider: "iPick" as const,
        serviceType: "SEND" as const,
        amount: 10,
        cost: 9,
        price: 10,
      },
    },
    {
      name: "app-wallet transfer",
      payload: {
        provider: "OMT_APP" as const,
        serviceType: "SEND" as const,
        amount: 100,
        commission: 2,
      },
    },
  ])(
    "void of a $name sale with a pm fee nets every ledger to zero",
    ({ payload }) => {
      const before = snapshotLedgers(db);
      const { id } = repo.createTransaction({
        commission: 0,
        ...payload,
        currency: "USD",
        paidByMethod: "WHISH",
        paymentMethodFee: 0.5,
        paymentMethodFeeRate: 0.01,
      });
      const parent = getTransactionRepository().getBySourceId(
        "financial_services",
        id,
      );
      expect(parent).not.toBeNull();
      getTransactionRepository().voidTransaction(parent!.id, 1);
      expectPostings(before, snapshotLedgers(db), {});
    },
  );
});
