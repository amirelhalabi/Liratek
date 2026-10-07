/**
 * G42 (POSTING_MAP) — session basket checkout booked a client-sent kept
 * change as a standalone KEPT_CHANGE profit row with NO server check: a
 * hand-built payload could book any kept amount as profit, even on an exact
 * payment or with no payment lines at all.
 *
 * The fix runs the ONE kept-change helper (`resolveKeptChange`, payer
 * "customer") over the basket's NET charge before anything is written:
 *
 *   IN − CHANGE − kept = netCharge
 *   netCharge = gross charge − gross payout + Σ(kind:"PAYOUT" OUT legs)
 *
 * PAYOUT legs (the shop paying the customer for a cash-out item) are never
 * counted as change — they enter the net charge instead, so a basket whose
 * payout is routed to a wallet/account (gross, not netted) reconciles the
 * same as one whose cash payout was netted against the charge.
 *
 * Booking is unchanged (standalone KEPT_CHANGE row) — its void/refund
 * netting is already pinned by
 * `TransactionRepository.sessionBasketReversalOwners.test.ts` ("nets every
 * ledger to 0 per currency … and the KEPT_CHANGE profit").
 *
 * RULE 17: the three "rejected" cases were run against the unchanged code
 * first and observed RED (see the task report for the exact output).
 *
 * Schema: `SessionCheckoutService.nettedPayoutSignal.test.ts`'s proven
 * money schema, reused verbatim.
 */

import Database from "better-sqlite3";
import {
  SessionCheckoutService,
  type CheckoutRequest,
} from "../SessionCheckoutService";
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

type CartItem = {
  id: string;
  module: string;
  label: string;
  amount: number;
  currency: string;
  formData: Record<string, unknown>;
  ipcChannel: string;
};

/** A $100 charge-side financial item (same shape as the LIRA-230 test). */
function chargeItem(): CartItem {
  return {
    id: "cart-charge",
    module: "whish_app",
    label: "WHISH app",
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

/** A $30 Binance cash-out (a General-drawer payout item, negative amount). */
function payoutItem(cashoutMethod: string): CartItem {
  return {
    id: "cart-payout",
    module: "binance_receive",
    label: "Binance Receive",
    amount: -30,
    currency: "USDT",
    formData: {
      provider: "BINANCE",
      serviceType: "RECEIVE",
      amount: 30,
      currency: "USDT",
      commission: 0,
      cashoutMethod,
    },
    ipcChannel: "financial:create",
  };
}

type Leg = NonNullable<CheckoutRequest["payments"]>[number];
const IN = (method: string, currency_code: string, amount: number): Leg => ({
  method,
  currency_code,
  amount,
  direction: "IN",
});

describe("G42 — session checkout kept change is checked server-side", () => {
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

  function newSession(): number {
    return sessionRepo.createSession({
      customer_name: "Walk-in",
      started_by: "admin",
      user_id: 1,
    });
  }

  function checkout(
    sessionId: number,
    cartItems: CartItem[],
    extra: Partial<CheckoutRequest>,
  ) {
    return service.checkout(
      { sessionId, cartItems, exchangeRate: 90000, userId: 1, ...extra },
      { username: "admin" },
    );
  }

  function keptRows(sessionId: number) {
    return db
      .prepare(
        `SELECT profit_usd, profit_lbp FROM transactions
          WHERE type = 'KEPT_CHANGE' AND source_id = ?`,
      )
      .all(sessionId) as Array<{ profit_usd: number; profit_lbp: number }>;
  }

  function writtenRows() {
    const t = db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as {
      n: number;
    };
    const p = db.prepare(`SELECT COUNT(*) AS n FROM payments`).get() as {
      n: number;
    };
    return t.n + p.n;
  }

  function sessionIsActive(sessionId: number): boolean {
    const r = db
      .prepare(`SELECT is_active FROM customer_sessions WHERE id = ?`)
      .get(sessionId) as { is_active: number };
    return r.is_active === 1;
  }

  // ── Rejected (failing-first) ────────────────────────────────────────────

  it("refuses kept change on an EXACT payment — nothing written, session stays open", async () => {
    const sessionId = newSession();
    const result = await checkout(sessionId, [chargeItem()], {
      payments: [IN("CASH", "USD", 100)],
      kept_change_usd: 5,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/do not reconcile|more than the change/);
    expect(keptRows(sessionId)).toHaveLength(0);
    expect(writtenRows()).toBe(0);
    expect(sessionIsActive(sessionId)).toBe(true);
  });

  it("refuses kept change larger than the real overpayment", async () => {
    const sessionId = newSession();
    const result = await checkout(sessionId, [chargeItem()], {
      payments: [IN("CASH", "USD", 102)],
      kept_change_usd: 5,
    });

    expect(result.success).toBe(false);
    expect(keptRows(sessionId)).toHaveLength(0);
    expect(writtenRows()).toBe(0);
  });

  it("refuses a phantom kept change that hides inside the reconcile epsilon", async () => {
    const sessionId = newSession();
    // Exact payment; a $0.04 claim fits the $0.05 reconcile epsilon but is
    // more than the (zero) change actually due.
    const result = await checkout(sessionId, [chargeItem()], {
      payments: [IN("CASH", "USD", 100)],
      kept_change_usd: 0.04,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/more than the change actually due/);
    expect(keptRows(sessionId)).toHaveLength(0);
  });

  it("refuses kept change with no payment lines at all", async () => {
    const sessionId = newSession();
    const result = await checkout(sessionId, [chargeItem()], {
      kept_change_usd: 5,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nothing to keep it from/);
    expect(keptRows(sessionId)).toHaveLength(0);
    expect(writtenRows()).toBe(0);
  });

  it("refuses kept change on a basket with a payout whose kept exceeds the overpay", async () => {
    const sessionId = newSession();
    // Net charge $70 (cash payout netted); $75 paid → $5 overpay, $10 claimed.
    const result = await checkout(
      sessionId,
      [chargeItem(), payoutItem("CASH")],
      {
        payments: [IN("CASH", "USD", 75)],
        kept_change_usd: 10,
      },
    );

    expect(result.success).toBe(false);
    expect(keptRows(sessionId)).toHaveLength(0);
  });

  // ── Accepted (regression guards — pass before and after) ────────────────

  it("books a real overpayment's kept change (USD) as the KEPT_CHANGE profit", async () => {
    const sessionId = newSession();
    const result = await checkout(sessionId, [chargeItem()], {
      payments: [IN("CASH", "USD", 105)],
      kept_change_usd: 5,
    });

    expect(result.success).toBe(true);
    const rows = keptRows(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].profit_usd).toBeCloseTo(5, 6);
    expect(rows[0].profit_lbp).toBe(0);
  });

  it("books LBP kept change from a mixed USD + LBP tender, per currency, unconverted", async () => {
    const sessionId = newSession();
    const result = await checkout(sessionId, [chargeItem()], {
      payments: [IN("CASH", "USD", 100), IN("CASH", "LBP", 450000)],
      kept_change_lbp: 450000,
    });

    expect(result.success).toBe(true);
    const rows = keptRows(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].profit_usd).toBe(0);
    expect(rows[0].profit_lbp).toBe(450000);
  });

  it("change returned AND kept: IN − CHANGE − kept = charge", async () => {
    const sessionId = newSession();
    // $120 paid on $100: $15 handed back, $5 kept.
    const result = await checkout(sessionId, [chargeItem()], {
      payments: [
        IN("CASH", "USD", 120),
        {
          method: "CASH",
          currency_code: "USD",
          amount: 15,
          direction: "OUT",
          kind: "CHANGE",
        },
      ],
      kept_change_usd: 5,
    });

    expect(result.success).toBe(true);
    expect(keptRows(sessionId)[0].profit_usd).toBeCloseTo(5, 6);
  });

  it("a cash payout netted against the charge: kept is checked against the NET charge", async () => {
    const sessionId = newSession();
    // $100 charge + $30 cash-out netted → $70 due; $75 paid, $5 kept.
    const result = await checkout(
      sessionId,
      [chargeItem(), payoutItem("CASH")],
      {
        payments: [IN("CASH", "USD", 75)],
        kept_change_usd: 5,
      },
    );

    expect(result.success).toBe(true);
    expect(keptRows(sessionId)[0].profit_usd).toBeCloseTo(5, 6);
  });

  it("a gross PAYOUT leg (wallet-routed cash-out) is NOT counted as change", async () => {
    const sessionId = newSession();
    // Wallet payout stays gross: $100 due from the customer, the shop pays
    // $30 out of the WHISH wallet as a separate PAYOUT leg. $105 paid, $5
    // kept. Counting the PAYOUT leg as change would read $105 − $30 − $5 =
    // $70 against a $100 charge and refuse a valid basket.
    const result = await checkout(
      sessionId,
      [chargeItem(), payoutItem("WHISH")],
      {
        payments: [
          IN("CASH", "USD", 105),
          {
            method: "WHISH",
            currency_code: "USD",
            amount: 30,
            direction: "OUT",
            kind: "PAYOUT",
            payoutOrigin: "GENERAL",
          },
        ],
        kept_change_usd: 5,
      },
    );

    expect(result.success).toBe(true);
    expect(keptRows(sessionId)[0].profit_usd).toBeCloseTo(5, 6);
  });

  it("a basket with no kept change is not newly reconciled (scope: G42 only)", async () => {
    const sessionId = newSession();
    // Overpaid with no change row and no kept claim — accepted today; this
    // change must not start refusing it (full-basket reconcile is a
    // separate owner question).
    const result = await checkout(sessionId, [chargeItem()], {
      payments: [IN("CASH", "USD", 103)],
    });

    expect(result.success).toBe(true);
    expect(keptRows(sessionId)).toHaveLength(0);
  });

  // ── LIRA-270 — nothing to collect means no customer payment leg ─────────
  //
  // When a cash payout cancels the whole charge, the modal hides its payment
  // input; a stale IN leg left in its state used to be sent and POSTED (a
  // phantom cash payment into the drawer). With no kept claim the G42 check
  // never ran, so nothing refused it.

  function payoutItemOf(amount: number, cashoutMethod: string): CartItem {
    const item = payoutItem(cashoutMethod);
    item.amount = -amount;
    item.formData = { ...item.formData, amount };
    return item;
  }
  const PAYOUT = (amount: number, origin: "GENERAL" | "SYSTEM"): Leg => ({
    method: "CASH",
    currency_code: "USD",
    amount,
    direction: "OUT",
    kind: "PAYOUT",
    payoutOrigin: origin,
  });

  it("LIRA-270: refuses a customer payment leg when the basket has nothing left to collect", async () => {
    const sessionId = newSession();
    // $100 charge, $130 cash payout netted: nothing due, $30 excess paid out.
    const result = await checkout(
      sessionId,
      [chargeItem(), payoutItemOf(130, "CASH")],
      { payments: [IN("CASH", "USD", 105), PAYOUT(30, "GENERAL")] },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nothing (left )?to collect/i);
    expect(writtenRows()).toBe(0);
    expect(sessionIsActive(sessionId)).toBe(true);
  });

  it("LIRA-270: still accepts a nothing-to-collect basket that sends only its payout leg", async () => {
    const sessionId = newSession();
    const result = await checkout(
      sessionId,
      [chargeItem(), payoutItemOf(130, "CASH")],
      { payments: [PAYOUT(30, "GENERAL")] },
    );

    expect(result.success).toBe(true);
    expect(sessionIsActive(sessionId)).toBe(false);
  });

  // ── LIRA-271 — one fee-on-top rule for the modal and the server ─────────
  //
  // An honest kept claim is built from the charge the modal shows. These are
  // the legs the modal sends under the shared rule (only a WHISH system
  // RECEIVE with the fee on top adds its fee to the charge — top level or
  // inside a batch). The server must agree, or it refuses the kept claim.

  function omtSystemReceive(amount: number, omtFee: number): CartItem {
    return {
      id: "cart-omt-receive",
      module: "omt_system",
      label: "OMT RECEIVE",
      amount: -amount,
      currency: "USD",
      formData: {
        provider: "OMT",
        serviceType: "RECEIVE",
        omtServiceType: "INTRA",
        amount,
        currency: "USD",
        omtFee,
        includingFees: false,
        cashoutMethod: "CASH",
      },
      ipcChannel: "financial:create",
    };
  }
  function whishAppReceive(amount: number, whishFee: number): CartItem {
    return {
      id: "cart-whish-app-receive",
      module: "whish_app",
      label: "Whish App RECEIVE",
      amount: -amount,
      currency: "USD",
      formData: {
        provider: "WHISH_APP",
        serviceType: "RECEIVE",
        amount: amount + whishFee,
        currency: "USD",
        commission: whishFee,
        whishFee,
        includingFees: false,
        cashoutMethod: "CASH",
      },
      ipcChannel: "financial:create",
    };
  }
  function whishSystemReceiveSub(amount: number, whishFee: number) {
    return {
      provider: "WHISH",
      serviceType: "RECEIVE",
      amount,
      currency: "USD",
      whishFee,
      cashoutMethod: "CASH",
    };
  }

  it("LIRA-271: OMT system RECEIVE — its fee is never collected, an honest kept claim is accepted", async () => {
    // OMT must be the shop's base system for a walk-in OMT RECEIVE.
    db.exec(
      `INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT', 'OMT', 1);
       UPDATE system_settings SET value = 'OMT' WHERE key_name = 'shop_base_system';`,
    );
    const binanceSend: CartItem = {
      id: "cart-binance-send",
      module: "binance_send",
      label: "Binance Send",
      amount: 100,
      currency: "USDT",
      formData: {
        provider: "BINANCE",
        serviceType: "SEND",
        amount: 100,
        currency: "USDT",
        commission: 0,
      },
      ipcChannel: "financial:create",
    };
    const sessionId = newSession();
    // Charge $100; the $100 OMT payout is its own SYSTEM leg. $105 paid on
    // $100, $5 kept. (The old modal asked for $101 — the OMT fee on top.)
    const result = await checkout(
      sessionId,
      [binanceSend, omtSystemReceive(100, 1)],
      {
        payments: [IN("CASH", "USD", 105), PAYOUT(100, "SYSTEM")],
        kept_change_usd: 5,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(keptRows(sessionId)[0].profit_usd).toBeCloseTo(5, 6);
  });

  it("LIRA-271: Whish App RECEIVE — the fee arrives in the wallet, an honest kept claim is accepted", async () => {
    const sessionId = newSession();
    // Charge $100, $40 cash payout netted → $60 due; $65 paid, $5 kept.
    const result = await checkout(
      sessionId,
      [chargeItem(), whishAppReceive(40, 1)],
      {
        payments: [IN("CASH", "USD", 65)],
        kept_change_usd: 5,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(keptRows(sessionId)[0].profit_usd).toBeCloseTo(5, 6);
  });

  it("LIRA-271: a WHISH RECEIVE inside a batch — its fee on top is collected, an honest kept claim is accepted", async () => {
    const sessionId = newSession();
    const batch: CartItem = {
      id: "cart-batch",
      module: "whish_system",
      label: "Whish batch",
      amount: -100,
      currency: "USD",
      formData: { _batch: true, items: [whishSystemReceiveSub(100, 2)] },
      ipcChannel: "financial:create",
    };
    // Charge $100 + the $2 fee; $100 SYSTEM payout leg. $107 paid, $5 kept.
    const result = await checkout(sessionId, [chargeItem(), batch], {
      payments: [IN("CASH", "USD", 107), PAYOUT(100, "SYSTEM")],
      kept_change_usd: 5,
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(keptRows(sessionId)[0].profit_usd).toBeCloseTo(5, 6);
  });
});
