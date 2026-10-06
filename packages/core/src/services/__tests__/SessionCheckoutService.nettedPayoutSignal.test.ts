/**
 * Round-3 review finding F4 (HIGH) — a netted Binance/USDT cash-out cart
 * item is invisible to the session payout guard because
 * `SessionCheckoutService.checkout()`'s `repo.linkTransaction(...)` call
 * only recognizes `item.currency === "USD"` / `"LBP"` — a USDT cart item's
 * `item.currency` is "USDT", so BOTH branches of the ternary miss it and
 * `customer_session_transactions.amount_usd`/`amount_lbp` are stamped 0/0
 * regardless of the item's real (negative, netted) value. Every OTHER
 * reader of that row (`isSessionPayoutMember`, `_assertNoNettedPayoutMembers`,
 * `getRecent`'s `is_session_payout`) is sign-based, so a netted USDT
 * cash-out silently reads as "not a payout at all" and an item refund on a
 * DIFFERENT basket member is wrongly allowed (measured: "$100 sale + netted
 * $30 USDT cash-out, paid $70 → item refund allowed, pays $70").
 *
 * This file proves the STAMPING half of the fix with the REAL
 * `SessionCheckoutService.checkout()` end to end (a real
 * `FinancialServiceRepository.createTransaction` Binance RECEIVE underneath
 * it) — the guard/flag half (that a correctly-negative cst row then
 * actually blocks/allows the right refunds) is proven separately in
 * `TransactionRepository.refundSessionBasketItem.test.ts`'s "F4/F6" suite.
 *
 * RULE 17 (failing-first): run against the pre-fix ternary
 * (`item.currency === "USD" ? item.amount : 0`) and observed RED — the
 * assertion on `amount_usd` failed with `Received: 0` instead of the
 * expected negative value (see the task's final report for the exact
 * command + output).
 *
 * Schema: `SessionCheckoutService.keptChangeClientName.test.ts`'s proven
 * money schema (supports `FinancialServiceRepository.createTransaction` +
 * the real session lifecycle end to end), reused verbatim (rule 14 — not
 * re-derived).
 */

import Database from "better-sqlite3";
import { SessionCheckoutService } from "../SessionCheckoutService";
import { CustomerSessionRepository } from "../../repositories/CustomerSessionRepository";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import { resetFinancialServiceRepository } from "../../repositories/FinancialServiceRepository";
import { resetSupplierRepository } from "../../repositories/SupplierRepository";
import { resetSettingsRepository } from "../../repositories/SettingsRepository";
import { resetCustomerSessionRepository } from "../../repositories/CustomerSessionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

jest.mock("../DebtService", () => ({
  getDebtService: () => ({ addCreditOrThrow: jest.fn() }),
  resetDebtService: jest.fn(),
}));
jest.mock("../../repositories/VoucherRepository", () => ({
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
      whatsapp_opt_in INTEGER DEFAULT 0,
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
      omt_service_type TEXT,
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount REAL NOT NULL DEFAULT 0
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

    CREATE TABLE supplier_settlements (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      ledger_entry_id INTEGER NOT NULL,
      gross_usd REAL NOT NULL DEFAULT 0,
      gross_lbp REAL NOT NULL DEFAULT 0,
      commission_usd REAL NOT NULL DEFAULT 0,
      commission_lbp REAL NOT NULL DEFAULT 0,
      entry_mode TEXT NOT NULL DEFAULT 'LUMP',
      model INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      session_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL,
      covered_usd REAL NOT NULL DEFAULT 0, covered_lbp REAL NOT NULL DEFAULT 0);

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

    CREATE TABLE customer_sessions (
      tenant_id           INTEGER DEFAULT 1,
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name       TEXT,
      customer_phone      TEXT,
      customer_notes      TEXT,
      user_id             INTEGER,
      started_at          TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at           TEXT,
      started_by          TEXT NOT NULL,
      closed_by           TEXT,
      is_active           INTEGER NOT NULL DEFAULT 1,
      checkout_at         TEXT,
      checkout_total      REAL,
      checkout_currency   TEXT,
      checkout_total_usd  REAL,
      checkout_total_lbp  REAL,
      checkout_profit_usd REAL,
      checkout_profit_lbp REAL
    );

    CREATE TABLE customer_session_transactions (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id             INTEGER NOT NULL,
      transaction_type       TEXT NOT NULL,
      transaction_id         INTEGER NOT NULL,
      unified_transaction_id INTEGER,
      amount_usd             REAL NOT NULL DEFAULT 0,
      amount_lbp             REAL NOT NULL DEFAULT 0,
      profit_usd             REAL NOT NULL DEFAULT 0,
      profit_lbp             REAL NOT NULL DEFAULT 0,
      paid_exchange_rate      REAL,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      status                 TEXT DEFAULT 'completed',
      final_amount_usd       REAL DEFAULT 0,
      paid_usd               REAL DEFAULT 0,
      paid_lbp               REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 90000,
      created_at             TEXT
    );
    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      sale_id INTEGER,
      product_id INTEGER,
      sold_price_usd REAL DEFAULT 0,
      cost_price_snapshot_usd REAL DEFAULT 0,
      quantity INTEGER DEFAULT 1,
      is_refunded INTEGER DEFAULT 0
    );
    CREATE TABLE recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      carrier TEXT,
      currency_code TEXT DEFAULT 'USD',
      price REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT,
      refunded_at TEXT DEFAULT NULL
    );
    CREATE TABLE custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      price_usd REAL DEFAULT 0,
      price_lbp REAL DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );

    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'USD', 0);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Binance', 'USDT', 0);
    INSERT INTO suppliers (name, provider, is_system) VALUES ('WHISH', 'WHISH', 1);
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'WHISH');
  `);

  return db;
}

/** A netted Binance RECEIVE (USDT in, USD payout) cart item — mirrors
 *  SessionCheckoutService.processCartItem's 'financial:create' dispatch for
 *  module 'binance_receive'. `amount`/`currency` at the TOP level (not
 *  formData) are what `checkout()`'s own `repo.linkTransaction` call reads
 *  — set to the netted USD-equivalent value (negative: a cash-out), in
 *  currency "USDT", the exact shape the finding names. */
function binanceReceiveCartItem(netUsdEquivalent: number): {
  id: string;
  module: string;
  label: string;
  amount: number;
  currency: string;
  formData: Record<string, unknown>;
  ipcChannel: string;
} {
  return {
    id: "cart-usdt-1",
    module: "binance_receive",
    label: "Binance Receive",
    amount: netUsdEquivalent,
    currency: "USDT",
    formData: {
      provider: "BINANCE",
      serviceType: "RECEIVE",
      amount: 30,
      currency: "USDT",
      commission: 0,
      cashoutMethod: "CASH",
    },
    ipcChannel: "financial:create",
  };
}

describe("LIRA-236 F4 — SessionCheckoutService stamps a netted USDT cash-out's real value, not 0/0", () => {
  let db: Database.Database;
  let service: SessionCheckoutService;
  let sessionRepo: CustomerSessionRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);

    resetTransactionRepository();
    resetClientRepository();
    resetFinancialServiceRepository();
    resetSupplierRepository();
    resetSettingsRepository();
    resetCustomerSessionRepository();

    service = new SessionCheckoutService();
    sessionRepo = new CustomerSessionRepository(db);
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
    resetTenantContext();
  });

  it("a netted $30 USDT cash-out stamps cst.amount_usd = -30, never 0/0", async () => {
    const sessionId = sessionRepo.createSession({
      customer_name: "Walk-in",
      started_by: "admin",
      user_id: 1,
    });

    const result = await service.checkout(
      {
        sessionId,
        cartItems: [binanceReceiveCartItem(-30)],
        exchangeRate: 90000,
        userId: 1,
      },
      { username: "admin" },
    );

    expect(result.success).toBe(true);

    const row = db
      .prepare(
        `SELECT amount_usd, amount_lbp FROM customer_session_transactions WHERE session_id = ?`,
      )
      .get(sessionId) as { amount_usd: number; amount_lbp: number };

    // THE reproduction: pre-fix this is {0, 0} (the bug — item.currency
    // "USDT" matches neither "USD" nor "LBP"); post-fix it must carry the
    // real, negative, netted USD-equivalent value.
    expect(row.amount_usd).toBeCloseTo(-30, 6);
    expect(row.amount_lbp).toBe(0);
  });
});
