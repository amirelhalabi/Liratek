/**
 * BUG 3 repro (session-basket variant) — owner report: "Refund of a service
 * txn where customer paid 1010$, cost 1008$, is adding back into drawer
 * 1008$ not 1010$."
 *
 * `TransactionRepository.refundCostPriceFlow.test.ts` proves the DIRECT
 * (non-basket) cost/price-flow refund is byte-correct: `_reversePayments`
 * mirrors every row in `payments` WHERE `transaction_id = <the item's own
 * txn id>`, and at direct-sale time BOTH the cost leg (-1008, note "Cost:
 * X") and the price leg (+1010, method=paidBy) are written with that same
 * `transaction_id` — so both get reversed.
 *
 * This file reproduces the SAME price/cost numbers sold through a SESSION
 * BASKET instead (`deferPayment: true` — the Services page's session-cart
 * flow, docs comments in SessionPaymentService.ts lines 4-6):
 *
 *   "Each cart item is created in `deferPayment` mode (the item's own
 *   customer-cash legs are skipped), then this recorder [SessionPaymentService
 *   .recordBasketPayment] posts the single customer-facing payment for the
 *   whole basket... Inserts each customer-cash IN/OUT leg into `payments`
 *   with `session_id` set and `transaction_id` NULL."
 *
 * So for a session-basket item:
 *   - Cost leg:  written by FinancialServiceRepository with `transaction_id
 *                = <item's own txn id>` (unchanged — internal legs are
 *                still written directly, per its own comment).
 *   - Price leg: written by SessionPaymentService with `transaction_id =
 *                NULL`, `session_id = <the basket's session id>` — POOLED
 *                across every item in the basket, never linked to this
 *                item's own transaction id.
 *
 * `TransactionRepository._reversePayments` (called by `refundTransaction`)
 * queries ONLY `payments WHERE transaction_id = ?` — the exact single-item
 * id. It has no session-aware fallback (that enrichment exists ONLY on the
 * READ side, `TransactionRepository.ts` lines ~734-835, for display in the
 * Transactions table — never on the reversal path). Refunding ONE item out
 * of a session basket therefore reverses the cost leg (correctly giving back
 * 1008 to the provider drawer) but can NEVER reverse the customer's actual
 * 1010 cash payment — that leg belongs to the session, not this item.
 *
 * This is the exact owner-reported shape: the only drawer movement the
 * refund produces is +1008 (into the provider drawer); the customer's 1010
 * is never returned anywhere.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetCustomerSessionRepository } from "../CustomerSessionRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetSalesRepository } from "../SalesRepository";
import { resetSessionPaymentRepository } from "../SessionPaymentRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import {
  SessionPaymentService,
  resetSessionPaymentService,
} from "../../services/SessionPaymentService";

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));
jest.mock("../VoucherRepository", () => ({
  getVoucherRepository: () => ({ redeemByCode: jest.fn() }),
  resetVoucherRepository: jest.fn(),
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
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');

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
      covered_lbp REAL NOT NULL DEFAULT 0,
      session_id INTEGER
    );

    CREATE TABLE sales (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      total_amount_usd REAL,
      discount_usd REAL DEFAULT 0,
      final_amount_usd REAL,
      paid_usd REAL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      change_given_usd REAL DEFAULT 0,
      change_given_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL,
      drawer_name TEXT DEFAULT 'General',
      status TEXT DEFAULT 'completed',
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    -- Session-basket tables (SessionPaymentService / CustomerSessionRepository /
    -- SessionPaymentRepository.getSessionCashSplitContext).
    CREATE TABLE customer_sessions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT,
      customer_phone TEXT,
      customer_notes TEXT,
      user_id INTEGER,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT,
      started_by TEXT NOT NULL,
      closed_by TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE customer_session_transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      transaction_id INTEGER NOT NULL,
      unified_transaction_id INTEGER,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

describe("BUG 3 repro (session-basket variant) — refunding ONE cost/price item out of a session basket", () => {
  let db: Database.Database;
  let fsRepo: FinancialServiceRepository;
  let txnRepo: TransactionRepository;
  let sessionPaymentService: SessionPaymentService;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    resetPaymentMethodRepository();
    resetCustomerSessionRepository();
    resetClientRepository();
    resetSalesRepository();
    resetSessionPaymentRepository();
    resetSettingsRepository();
    resetSessionPaymentService();
    fsRepo = new FinancialServiceRepository();
    txnRepo = new TransactionRepository();
    sessionPaymentService = new SessionPaymentService();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    resetSupplierRepository();
    resetTransactionRepository();
    resetPaymentMethodRepository();
    resetCustomerSessionRepository();
    resetClientRepository();
    resetSalesRepository();
    resetSessionPaymentRepository();
    resetSettingsRepository();
    resetSessionPaymentService();
  });

  function seedSession(): number {
    return Number(
      db
        .prepare(
          "INSERT INTO customer_sessions (started_by) VALUES ('admin')",
        )
        .run().lastInsertRowid,
    );
  }

  /** iPick catalog item sold through a session basket: shop's cost is 1008
   *  (drawn from the iPick provider drawer), customer owes 1010, but the
   *  ITEM'S OWN transaction carries no customer-cash leg — deferPayment
   *  defers that to the basket's single pooled payment. */
  function createCostPriceSaleInSession(sessionId: number): {
    fsId: number;
    txnId: number;
  } {
    const { id: fsId } = fsRepo.createTransaction({
      provider: "iPick",
      serviceType: "SEND",
      amount: 1010,
      currency: "USD",
      commission: 0,
      cost: 1008,
      price: 1010,
      deferPayment: true,
      exchangeRate: 90000,
    });
    const txnId = txnIdForFsRow(db, fsId);
    db.prepare(
      `INSERT INTO customer_session_transactions
        (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (?, 'financial_service', ?, ?, 1010, 0)`,
    ).run(sessionId, fsId, txnId);
    return { fsId, txnId };
  }

  it("SANITY: after the basket pays, General is +1010 and iPick is -1008 (matches the owner's numbers)", () => {
    const before = snapshot(db);
    const sessionId = seedSession();
    createCostPriceSaleInSession(sessionId);

    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [{ method: "CASH", currencyCode: "USD", amount: 1010, direction: "IN" }],
      exchangeRate: 90000,
      userId: 1,
    });

    const after = snapshot(db);
    expect(after.general - before.general).toBeCloseTo(1010, 2);
    expect(after.iPick - before.iPick).toBeCloseTo(-1008, 2);
  });

  it("BUG: refunding the item alone reverses the COST leg (+1008 to iPick) but NEVER reverses the customer's 1010 cash — General is untouched by the refund", () => {
    const sessionId = seedSession();
    const { txnId } = createCostPriceSaleInSession(sessionId);

    sessionPaymentService.recordBasketPayment(sessionId, {
      legs: [{ method: "CASH", currencyCode: "USD", amount: 1010, direction: "IN" }],
      exchangeRate: 90000,
      userId: 1,
    });

    const beforeRefund = snapshot(db);

    const refundId = txnRepo.refundTransaction(txnId, 1);

    const afterRefund = snapshot(db);

    // What SHOULD happen (rule 20 — create + reverse nets every drawer to 0):
    // refunding this item should give the customer their 1010 back (General
    // -1010) and unwind the cost (iPick +1008).
    //
    // What ACTUALLY happens: only the cost leg is reversible from this
    // item's own transaction_id — the price leg lives on the session
    // (transaction_id NULL, session_id set) and is invisible to
    // `_reversePayments`'s `WHERE transaction_id = ?` query.
    expect(afterRefund.iPick - beforeRefund.iPick).toBeCloseTo(1008, 2); // cost DOES unwind

    // Pin the exact defect: the refund transaction's own payment rows should
    // contain a General leg of -1010 (the customer's money going back), but
    // the ONLY row `_reversePayments` ever wrote is the iPick +1008 cost
    // reversal — reproduced verbatim from a real run:
    //   REFUND LEGS: [{"method":"iPick","drawer_name":"iPick","amount":1008,"note":"Reversal"}]
    // i.e. the exact owner-reported number (1008, not 1010) and nothing else.
    const refundLegs = paymentsFor(db, refundId);
    const generalLeg = refundLegs.find((p) => p.drawer_name === "General");
    expect(generalLeg).toBeDefined(); // FAILS: no General leg was ever written
    expect(generalLeg?.amount).toBeCloseTo(-1010, 2);

    expect(afterRefund.general - beforeRefund.general).toBeCloseTo(-1010, 2); // FAILS: actually 0
  });
});
