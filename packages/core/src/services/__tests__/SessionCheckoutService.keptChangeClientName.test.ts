/**
 * LIRA-230 — a named walk-in's kept change lands in the unnamed "Walk-in"
 * bucket on Profits → By Client.
 *
 * Root cause (found by reading, confirmed by this test): the KEPT_CHANGE
 * `createTransaction` call in `SessionCheckoutService.checkout()` stamps
 * `client_id` but never `client_name` — unlike every OTHER cart item in the
 * same basket, which gets `sessionCustomerName` injected into its own
 * formData a few lines earlier (`checkout()`'s "Inject session customer into
 * cart items lacking a client name" block). `ProfitRepository.getByClient`
 * groups walk-ins (client_id NULL) by `COALESCE(t.client_name, orig.client_name, '')`
 * — an empty string is the SAME group as every other unnamed walk-in, so a
 * named walk-in's kept-change profit silently lands there instead of under
 * their own name. `ProfitRepository.ts`'s own `getByClient` doc comment
 * (search "LCC-walkin-keptchange-name") already documents this exact gap as
 * "flagged for the owner / the session-checkout lane, not fixed here" — this
 * is that fix.
 *
 * RULE 17 (failing-first): the "named walk-in" case in each describe block
 * below was run against the pre-fix code (the KEPT_CHANGE `createTransaction`
 * call with no `client_name`/`client_phone` fields) and observed RED before
 * the fix — see the task's final report for the exact command + output.
 *
 * This test drives the REAL `SessionCheckoutService.checkout()` end to end
 * (not a hand-inserted transactions row) — session → cart item → kept
 * change → the real KEPT_CHANGE `createTransaction` call — then reads the
 * SAME database with the REAL `ProfitRepository.getByClient` to prove the
 * write-path fix actually changes the report grouping, not just the row's
 * raw column value.
 *
 * Schema: `SessionPaymentService.feeOnTopReceive.moneyProof.test.ts`'s money
 * schema (proven to support `FinancialServiceRepository.createTransaction`
 * end to end) plus `ProfitRepository.round3.laneLCC.test.ts`'s module tables
 * (proven to support `getByClient` end to end, rule 14 — reused, not
 * re-derived) plus `customer_sessions`/`customer_session_transactions`
 * (`SessionPaymentService.basket.test.ts`'s shape) for the real session
 * lifecycle. `payments` is deliberately never populated — the checkout
 * request omits `payments` entirely, so `recordBasketPayment` never runs;
 * this ticket is about the `client_name` STAMP, not drawer/leg arithmetic,
 * and every module service call below already books its own ledger/profit
 * rows unconditionally under `deferPayment: true` (see
 * `FinancialServiceRepository` — "these are not payment-collection facts").
 */

import Database from "better-sqlite3";
import { SessionCheckoutService } from "../SessionCheckoutService";
import { CustomerSessionRepository } from "../../repositories/CustomerSessionRepository";
import { ProfitRepository } from "../../repositories/ProfitRepository";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import { resetFinancialServiceRepository } from "../../repositories/FinancialServiceRepository";
import { resetSupplierRepository } from "../../repositories/SupplierRepository";
import { resetSettingsRepository } from "../../repositories/SettingsRepository";
import { resetCustomerSessionRepository } from "../../repositories/CustomerSessionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";

// DebtService/VoucherRepository are only reached by recordBasketPayment,
// which this file never calls (no `payments` in the checkout request) — but
// SessionCheckoutService imports SessionPaymentService unconditionally, so
// mock the two leaf dependencies the same way the sibling money-proof file
// does, to keep this fixture minimal.
jest.mock("../DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));
jest.mock("../../repositories/VoucherRepository", () => ({
  getVoucherRepository: () => ({ redeemByCode: jest.fn() }),
  resetVoucherRepository: jest.fn(),
}));

const FROM = "2026-01-01 00:00:00";
const TO = "2026-12-31 23:59:59";

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

    -- Real session lifecycle (CustomerSessionRepository/CustomerSessionService).
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
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Empty — getSessionSaleRows joins it unconditionally; ProfitRepository
    -- .getByClient also reads it directly for SALE rows (none seeded here).
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

    -- Referenced by ProfitRepository.getByClient's per-module UNION branches
    -- (all empty here — only the KEPT_CHANGE row this test creates matters).
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
    CREATE TABLE maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT,
      final_amount_usd REAL DEFAULT 0,
      final_amount_lbp REAL DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      cost_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT,
      parts_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      parts_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0
    );
    CREATE TABLE loto_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      sale_amount REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT
    );
    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      status TEXT DEFAULT 'active',
      amount_usd REAL DEFAULT 0,
      amount_lbp REAL DEFAULT 0,
      expense_date TEXT,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );
    CREATE TABLE exchange_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      amount_in REAL DEFAULT 0,
      leg1_profit_usd REAL DEFAULT 0,
      leg2_profit_usd REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      created_at TEXT,
      refunded_at TEXT DEFAULT NULL
    );

    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'USD', 0);
    INSERT INTO suppliers (name, provider, is_system) VALUES ('WHISH', 'WHISH', 1);
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'WHISH');
  `);

  return db;
}

/** One minimal RECEIVE cart item — mirrors SessionCheckoutService.processCartItem's
 *  'financial:create' dispatch. No fee (whishFee 0) — this test cares about
 *  client_name attribution, not fee-split arithmetic. */
function financialCartItem(): {
  id: string;
  module: string;
  label: string;
  amount: number;
  currency: string;
  formData: Record<string, unknown>;
  ipcChannel: string;
} {
  return {
    id: "cart-1",
    module: "whish_app",
    label: "WHISH Receive",
    amount: 100,
    currency: "USD",
    formData: {
      provider: "WHISH",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      whishFee: 0,
      cashoutMethod: "CASH",
      includingFees: true,
    },
    ipcChannel: "financial:create",
  };
}

describe("LIRA-230 — SessionCheckoutService KEPT_CHANGE client_name stamping", () => {
  let db: Database.Database;
  let service: SessionCheckoutService;
  let sessionRepo: CustomerSessionRepository;
  let profitRepo: ProfitRepository;

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
    profitRepo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
    resetTenantContext();
  });

  function keptChangeRow(sessionId: number): {
    client_id: number | null;
    client_name: string | null;
    client_phone: string | null;
    profit_usd: number;
  } {
    return db
      .prepare(
        `SELECT client_id, client_name, client_phone, profit_usd FROM transactions
          WHERE type = 'KEPT_CHANGE' AND source_table = 'customer_sessions' AND source_id = ?`,
      )
      .get(sessionId) as {
      client_id: number | null;
      client_name: string | null;
      client_phone: string | null;
      profit_usd: number;
    };
  }

  it("a named walk-in (no client_id) keeps its name on the KEPT_CHANGE row, and By Client groups it under that name — not the unnamed Walk-in bucket", async () => {
    const sessionId = sessionRepo.createSession({
      customer_name: "Jean Dupont",
      started_by: "admin",
      user_id: 1,
    });

    const result = await service.checkout(
      {
        sessionId,
        cartItems: [financialCartItem()],
        exchangeRate: 90000,
        userId: 1,
        kept_change_usd: 5,
      },
      { username: "admin" },
    );

    expect(result.success).toBe(true);

    const row = keptChangeRow(sessionId);
    // THE reproduction: pre-fix this is null (the bug); post-fix it must
    // equal the session's walk-in name.
    expect(row.client_name).toBe("Jean Dupont");
    expect(row.client_id).toBeNull();
    expect(row.profit_usd).toBeCloseTo(5, 5);

    const rows = runWithTenant(1, () => profitRepo.getByClient(FROM, TO, 50));
    const named = rows.find((r) => r.client_name === "Jean Dupont");
    const unnamedWalkin = rows.find(
      (r) =>
        r.client_id === null &&
        (!r.client_name || r.client_name === "" || r.client_name === "Walk-in"),
    );

    expect(named).toBeDefined();
    expect(named!.profit_usd).toBeCloseTo(5, 5);
    // The unnamed Walk-in bucket must NOT carry this named walk-in's profit.
    expect(unnamedWalkin?.profit_usd ?? 0).toBeCloseTo(0, 5);
  });

  it("a saved client (client_id resolved by phone) propagates client_id onto the KEPT_CHANGE row", async () => {
    const clientId = Number(
      db
        .prepare(
          `INSERT INTO clients (full_name, phone_number, tenant_id) VALUES (?, ?, 1)`,
        )
        .run("Amir Halabi", "71000001").lastInsertRowid,
    );

    const sessionId = sessionRepo.createSession({
      customer_name: "Amir Halabi",
      customer_phone: "71000001",
      started_by: "admin",
      user_id: 1,
    });

    const result = await service.checkout(
      {
        sessionId,
        cartItems: [financialCartItem()],
        exchangeRate: 90000,
        userId: 1,
        kept_change_usd: 3,
      },
      { username: "admin" },
    );

    expect(result.success).toBe(true);

    const row = keptChangeRow(sessionId);
    expect(row.client_id).toBe(clientId);
    expect(row.client_name).toBe("Amir Halabi");

    const rows = runWithTenant(1, () => profitRepo.getByClient(FROM, TO, 50));
    const linked = rows.find((r) => r.client_id === clientId);
    expect(linked).toBeDefined();
    expect(linked!.profit_usd).toBeCloseTo(3, 5);
  });

  it("an anonymous walk-in (no name at all) stays in the unnamed Walk-in group", async () => {
    const sessionId = sessionRepo.createSession({
      started_by: "admin",
      user_id: 1,
    });

    const result = await service.checkout(
      {
        sessionId,
        cartItems: [financialCartItem()],
        exchangeRate: 90000,
        userId: 1,
        kept_change_usd: 2,
      },
      { username: "admin" },
    );

    expect(result.success).toBe(true);

    const row = keptChangeRow(sessionId);
    expect(row.client_id).toBeNull();
    expect(row.client_name).toBeNull();

    const rows = runWithTenant(1, () => profitRepo.getByClient(FROM, TO, 50));
    const unnamedWalkin = rows.find(
      (r) =>
        r.client_id === null &&
        (!r.client_name || r.client_name === "" || r.client_name === "Walk-in"),
    );
    expect(unnamedWalkin).toBeDefined();
    expect(unnamedWalkin!.profit_usd).toBeCloseTo(2, 5);
  });
});
