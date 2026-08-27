/**
 * BUG 3 repro — owner report: "Refund of a service txn where customer paid
 * 1010$, cost 1008$, is adding back into drawer 1008$ not 1010$."
 *
 * Scenario: a cost/price-flow financial service (iPick/Katsh/WHISH_APP/
 * OMT_APP/BINANCE catalog item) sold for `price` USD, costing the shop
 * `cost` USD from its provider drawer. At SALE time
 * (`FinancialServiceRepository.createTransaction`, `useCostPriceFlow`
 * branch):
 *   - Cost outflow:  providerDrawer -= cost   (payments row, note "Cost: X")
 *   - Price inflow:  customerDrawer += price  (payments row, method=paidBy)
 *
 * Rule 20 (reversal symmetry): create + reverse must net every drawer to 0,
 * per currency. This file proves whether `TransactionRepository.
 * refundTransaction` (both the plain path and the LIRA-078 method-override
 * path) actually reverses the PRICE leg (what the customer paid, 1010) or
 * mistakenly reverses only the COST leg (1008).
 *
 * Harness: same in-memory schema as
 * TransactionRepository.refundFeeOnTopReceive.test.ts (financial_services +
 * transactions + payments + drawer_balances + payment_methods + suppliers +
 * supplier_ledger + system_settings + debt_ledger + sales/sale_items/
 * products — the last three only because refundTransaction's generic SALE
 * step touches them when source_table = 'sales', unused here).
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  TransactionRepository,
  resetTransactionRepository,
  type RefundLegOverride,
} from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";

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
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
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
      transaction_time DATETIME,
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

    CREATE TABLE payment_methods (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      affects_drawer INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO payment_methods (code, label, drawer_name, affects_drawer, is_active, is_system) VALUES
      ('CASH', 'Cash', 'General', 1, 1, 1),
      ('OMT', 'OMT Wallet', 'OMT_App', 1, 1, 0),
      ('WHISH', 'Whish Wallet', 'Whish_App', 1, 1, 0),
      ('CUSTOMER_ACCOUNT', 'Customer Account', 'General', 0, 1, 1);

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
      source_ref_table TEXT,
      source_ref_id INTEGER,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      settlement_id INTEGER,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    -- Needed only because refundTransaction's generic SALE-specific step
    -- checks source_table = 'sales'; unused here (source_table is
    -- 'financial_services'), kept for schema completeness with the sibling
    -- fixture this file was adapted from.
    CREATE TABLE sales (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT DEFAULT 'completed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE sale_items (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER,
      quantity INTEGER NOT NULL DEFAULT 1,
      is_refunded INTEGER DEFAULT 0
    );
    CREATE TABLE products (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      stock_quantity INTEGER NOT NULL DEFAULT 0
    );

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

    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 5000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'LBP', 100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'iPick',   'USD', 5000, CURRENT_TIMESTAMP);
  `);

  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function balance(
  db: Database.Database,
  drawer: string,
  currency: string,
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row ? row.balance : 0;
}

function snapshot(db: Database.Database): { general: number; iPick: number } {
  return {
    general: balance(db, "General", "USD"),
    iPick: balance(db, "iPick", "USD"),
  };
}

function txnIdForFsRow(db: Database.Database, fsId: number): number {
  const row = db
    .prepare(
      "SELECT id FROM transactions WHERE source_table = 'financial_services' AND source_id = ?",
    )
    .get(fsId) as { id: number } | undefined;
  if (!row)
    throw new Error(`No transaction row found for financial_services #${fsId}`);
  return row.id;
}

function paymentsFor(
  db: Database.Database,
  transactionId: number,
): Array<{
  method: string;
  drawer_name: string;
  amount: number;
  note: string | null;
}> {
  return db
    .prepare(
      `SELECT method, drawer_name, amount, note FROM payments WHERE transaction_id = ? ORDER BY id ASC`,
    )
    .all(transactionId) as Array<{
    method: string;
    drawer_name: string;
    amount: number;
    note: string | null;
  }>;
}

describe("BUG 3 repro — refund of a cost/price-flow financial service (price=1010, cost=1008)", () => {
  let db: Database.Database;
  let fsRepo: FinancialServiceRepository;
  let txnRepo: TransactionRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    resetPaymentMethodRepository();
    fsRepo = new FinancialServiceRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetTransactionRepository();
    resetPaymentMethodRepository();
  });

  /** iPick catalog item: shop pays cost=1008 to its iPick provider drawer,
   *  customer pays price=1010 cash. Margin = $2. */
  function createCostPriceSale(): number {
    const { id: fsId } = fsRepo.createTransaction({
      provider: "iPick",
      serviceType: "SEND",
      amount: 1010,
      currency: "USD",
      commission: 0,
      cost: 1008,
      price: 1010,
      paidByMethod: "CASH",
    });
    return fsId;
  }

  it("SANITY: sale time moves General +1010 (price) and iPick -1008 (cost)", () => {
    const before = snapshot(db);
    createCostPriceSale();
    const after = snapshot(db);

    expect(after.general - before.general).toBeCloseTo(1010, 2);
    expect(after.iPick - before.iPick).toBeCloseTo(-1008, 2);
  });

  it("(a) DEFAULT refund (no method override): every drawer nets to 0 across create+refund — the customer gets back 1010, not 1008", () => {
    const before = snapshot(db);

    const fsId = createCostPriceSale();
    const txnId = txnIdForFsRow(db, fsId);

    const refundId = txnRepo.refundTransaction(txnId, 1);

    const after = snapshot(db);
    // Rule 20: create + reverse nets to 0 per drawer per currency.
    expect(after.general - before.general).toBeCloseTo(0, 5);
    expect(after.iPick - before.iPick).toBeCloseTo(0, 5);

    // Pin down exactly which leg carried which amount, so a failure here
    // names the actual defect instead of just "not zero".
    const refundLegs = paymentsFor(db, refundId);
    const generalLeg = refundLegs.find((p) => p.drawer_name === "General");
    const iPickLeg = refundLegs.find((p) => p.drawer_name === "iPick");
    expect(generalLeg?.amount).toBeCloseTo(-1010, 2); // give back what the customer paid
    expect(iPickLeg?.amount).toBeCloseTo(1008, 2); // unwind the cost outflow
  });

  it("(b) LIRA-078 method-override refund (operator picks CASH, full 1010): every drawer nets to 0", () => {
    const before = snapshot(db);

    const fsId = createCostPriceSale();
    const txnId = txnIdForFsRow(db, fsId);

    const refundLegs: RefundLegOverride[] = [
      { method: "CASH", currencyCode: "USD", amount: 1010 },
    ];
    txnRepo.refundTransaction(txnId, 1, { refundLegs });

    const after = snapshot(db);
    expect(after.general - before.general).toBeCloseTo(0, 5);
    expect(after.iPick - before.iPick).toBeCloseTo(0, 5);
  });

  it("(c) profit nets to 0 across create+refund (rule 20, profit ledger too)", () => {
    const fsId = createCostPriceSale();
    const txnId = txnIdForFsRow(db, fsId);

    const saleProfit = db
      .prepare("SELECT profit_usd FROM transactions WHERE id = ?")
      .get(txnId) as { profit_usd: number };
    expect(saleProfit.profit_usd).toBeCloseTo(2, 2); // price - cost margin

    const refundId = txnRepo.refundTransaction(txnId, 1);
    const refundProfit = db
      .prepare("SELECT profit_usd FROM transactions WHERE id = ?")
      .get(refundId) as { profit_usd: number };
    expect(refundProfit.profit_usd).toBeCloseTo(-2, 2);
  });
});
