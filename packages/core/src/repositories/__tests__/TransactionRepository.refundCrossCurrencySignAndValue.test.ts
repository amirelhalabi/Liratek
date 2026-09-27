/**
 * REFUND_EXCHANGE_RATE_PLAN.md (LIRA-236) round-3 review finding F1 (BLOCKER):
 * a cross-currency refund-leg override picked its posting DIRECTION per
 * currency (defaulting to "subtract" whenever that one currency's own
 * original net was 0 or pointed the "wrong" way in isolation) and the
 * value-based validator summed each currency's original net as an ABSOLUTE
 * value before adding them together, instead of summing the SIGNED nets
 * first. Both bugs hand back the wrong amount, in the wrong direction, or
 * accept a mismatched refund outright.
 *
 * Real writers used throughout (no hand-built `payments` rows), per the
 * task's harness requirement: `FinancialServiceRepository.createTransaction`
 * (OMT SYSTEM RECEIVE), `SalesRepository.processSale` (change-leg sale),
 * `SalesRepository.refundSaleItem` (POS item refund), and
 * `ExchangeRepository.createExchange`.
 *
 * NOTE ON RULE 17 (this file's own honesty disclosure): the sign-resolution
 * fix (`refundLegReversalSign`) and the validator's signed-sum fix were
 * written immediately after the bug was fully traced by inspection (exact
 * arithmetic matched every measured symptom in the finding — see each test's
 * comment for the hand-worked numbers), before this test file existed. Per
 * rule 17's own guidance for this exact situation ("if [a guard] was written
 * after its fix, say so plainly; do not re-break the code to prove it"),
 * these cases are NOT proven failing-first by an actual red run — they are
 * proven correct by matching the finding's measured pre-fix numbers exactly
 * (documented inline) and by passing now. Every OTHER finding in this task
 * (F3 onward) follows the proper write-test-first-see-it-fail order.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import { SalesRepository } from "../SalesRepository";
import { ExchangeRepository } from "../ExchangeRepository";
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
  db.pragma("foreign_keys = OFF");

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

    CREATE TABLE sales (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      total_amount_usd REAL NOT NULL DEFAULT 0,
      discount_usd REAL NOT NULL DEFAULT 0,
      final_amount_usd REAL NOT NULL DEFAULT 0,
      paid_usd REAL NOT NULL DEFAULT 0,
      paid_lbp REAL NOT NULL DEFAULT 0,
      change_given_usd REAL NOT NULL DEFAULT 0,
      change_given_lbp REAL NOT NULL DEFAULT 0,
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
      sold_price_usd REAL NOT NULL DEFAULT 0,
      cost_price_snapshot_usd REAL,
      imei TEXT,
      warranty_until TEXT,
      is_refunded INTEGER DEFAULT 0,
      refunded_quantity INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE products (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      barcode TEXT,
      cost_price_usd REAL NOT NULL DEFAULT 0,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      warranty_months INTEGER
    );
    CREATE TABLE product_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      product_id INTEGER NOT NULL,
      imei TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'IN_STOCK',
      sale_item_id INTEGER,
      is_defective INTEGER NOT NULL DEFAULT 0,
      warranty_override_until TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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

    CREATE TABLE currencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      symbol TEXT NOT NULL DEFAULT '',
      decimal_places INTEGER NOT NULL DEFAULT 2,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE currency_drawers (
      tenant_id INTEGER DEFAULT 1,
      currency_code TEXT NOT NULL,
      drawer_name TEXT NOT NULL
    );

    CREATE TABLE exchange_rates (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_code TEXT NOT NULL,
      buy_rate REAL,
      sell_rate REAL,
      market_rate REAL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO exchange_rates (tenant_id, to_code, buy_rate, sell_rate, market_rate) VALUES (1, 'LBP', 89000, 90000, 89500);

    CREATE TABLE exchange_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      type TEXT CHECK(type IN ('BUY', 'SELL')) NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      amount_in REAL NOT NULL,
      amount_out REAL NOT NULL,
      rate REAL NOT NULL,
      base_rate REAL,
      profit_usd REAL,
      leg1_rate REAL,
      leg1_market_rate REAL,
      leg1_profit_usd REAL,
      leg2_rate REAL,
      leg2_market_rate REAL,
      leg2_profit_usd REAL,
      via_currency TEXT,
      client_name TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      edited_by TEXT DEFAULT NULL,
      edited_at TEXT DEFAULT NULL,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE product_stock_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      product_id INTEGER NOT NULL,
      supplier_id INTEGER,
      quantity INTEGER NOT NULL,
      quantity_remaining INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
      books_debt INTEGER NOT NULL DEFAULT 0,
      ledger_entry_id INTEGER,
      transaction_id INTEGER,
      is_opening INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE stock_batch_consumptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      batch_id INTEGER NOT NULL,
      sale_item_id INTEGER,
      custom_service_id INTEGER,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost_usd DECIMAL(10,2) NOT NULL,
      reason TEXT NOT NULL DEFAULT 'SALE',
      is_restored INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      maintenance_part_id INTEGER
    );

    INSERT INTO drawer_balances VALUES (1, 'General',      'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',      'LBP', 100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_App',      'USD', 500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System',   'USD', 500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System',   'LBP', 0,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_App',    'USD', 500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_System', 'USD', 500,  CURRENT_TIMESTAMP);

    -- OMT is the primary/base system for this file's RECEIVE fixtures.
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT', 'OMT', 1);
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');
  `);

  return db;
}

function balance(db: Database.Database, drawer: string, currency: string): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row ? row.balance : 0;
}

describe("LIRA-236 F1 — refund cross-currency direction + value (round-3 review, BLOCKER)", () => {
  let db: Database.Database;
  let fsRepo: FinancialServiceRepository;
  let salesRepo: SalesRepository;
  let exchangeRepo: ExchangeRepository;
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
    salesRepo = new SalesRepository();
    exchangeRepo = new ExchangeRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetTransactionRepository();
    resetPaymentMethodRepository();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Case A — OMT SYSTEM RECEIVE, refunded cross-currency in LBP.
  //
  // Measured (finding F1): "$100 refunded as 8,950,000 LBP at 89,500 → leg
  // posted −8,950,000 (should be +8,950,000); OMT_System USD −100 AND
  // LBP −8.95M (customer paid twice)".
  //
  // Original: a $100 RECEIVE payout debits OMT_System USD by -100 (net
  // USD = -100, no LBP net at all). Pre-fix, `reversalSign` looked up
  // `originalNetByCurrency['LBP']` directly — 0, since LBP was never
  // touched — and defaulted to -1 (subtract), so the LBP refund leg
  // SUBTRACTED 8,950,000 from OMT_System instead of adding it back. Fixed:
  // `refundLegReversalSign` falls back to the OVERALL value's sign (USD
  // -100 ⇒ negative ⇒ +1/add) when the leg's own currency has no net of
  // its own.
  // ═══════════════════════════════════════════════════════════════════════
  it("A: a $100 OMT SYSTEM RECEIVE refunded fully in LBP ADDS the LBP equivalent back (not subtracts)", () => {
    const { id: fsId } = fsRepo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      cashoutMethod: "CASH",
      exchangeRate: 89500,
    } as Parameters<typeof fsRepo.createTransaction>[0]);

    const txnId = (
      db
        .prepare(
          `SELECT id FROM transactions WHERE source_table = 'financial_services' AND source_id = ?`,
        )
        .get(fsId) as { id: number }
    ).id;

    const omtSystemUsdAfterCreate = balance(db, "OMT_System", "USD");
    expect(omtSystemUsdAfterCreate).toBeCloseTo(500 - 100, 5); // payout left the till

    const refundLegs: RefundLegOverride[] = [
      { method: "CASH", currencyCode: "LBP", amount: 8950000 },
    ];
    txnRepo.refundTransaction(txnId, 1, {
      refundLegs,
      exchangeRate: 89500,
    });

    // OMT_System USD is untouched by the refund (the original USD leg was
    // an overridable leg, skipped and replaced — not mirrored).
    expect(balance(db, "OMT_System", "USD")).toBeCloseTo(
      omtSystemUsdAfterCreate,
      5,
    );
    // The LBP the customer handed back is ADDED to the till, not subtracted.
    expect(balance(db, "OMT_System", "LBP")).toBeCloseTo(8950000, 2);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Case B — a sale paid in one currency with change in another, refunded
  // cross-currency. Exercises BOTH the validator's signed-sum fix and the
  // sign-resolution fix.
  //
  // Measured (finding F1): "$90 sale paid with $100 + 895,000 LBP change:
  // $90 USD refund rejected ('original value $110'), $110 accepted
  // (shop −$20); 9,845,000 LBP accepted and posted INTO the drawer."
  //
  // $90 sale, tendered $100 cash, 895,000 LBP change (rate 89,500 ⇒ $10).
  // Original net: USD +100 (payment), LBP -895,000 (change) — a real
  // customer-facing value of $90 (100 - 10), never $110 (|100| + |-10|).
  // ═══════════════════════════════════════════════════════════════════════
  describe("B: a $90 sale tendered $100 cash + 895,000 LBP change (rate 89,500)", () => {
    function createChangeSale(): number {
      const result = salesRepo.processSale(
        {
          client_id: null,
          items: [{ product_id: 1, quantity: 1, price: 90 }],
          total_amount: 90,
          discount: 0,
          final_amount: 90,
          payment_usd: 100,
          payment_lbp: 0,
          payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
          change_given_lbp: 895000,
          exchange_rate: 89500,
          status: "completed",
        },
        1,
      );
      if (!result.success || result.id == null) {
        throw new Error(`processSale failed: ${result.error}`);
      }
      return result.id;
    }

    beforeEach(() => {
      db.prepare(
        `INSERT INTO products (id, name, cost_price_usd, stock_quantity) VALUES (1, 'Widget', 10, 100)`,
      ).run();
    });

    it("B1: the correct $90 USD refund is ACCEPTED (not the $110 magnitude-sum bug)", () => {
      const saleId = createChangeSale();
      const before = { usd: balance(db, "General", "USD"), lbp: balance(db, "General", "LBP") };

      expect(() =>
        txnRepo.refundBySaleId(saleId, 1, {
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 90 }],
          exchangeRate: 89500,
        }),
      ).not.toThrow();

      // $90 leaves the drawer (customer's real net value), not $110.
      expect(balance(db, "General", "USD") - before.usd).toBeCloseTo(-90, 5);
      expect(balance(db, "General", "LBP") - before.lbp).toBeCloseTo(0, 2);
    });

    it("B2: a $110 USD refund (the old magnitude-sum bug's accepted value) is now REJECTED", () => {
      const saleId = createChangeSale();
      expect(() =>
        txnRepo.refundBySaleId(saleId, 1, {
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 110 }],
          exchangeRate: 89500,
        }),
      ).toThrow(/do not match/i);
    });

    it("B3: refunding the correct value entirely in LBP (8,055,000 = 90 × 89,500) SUBTRACTS from the drawer, not adds", () => {
      const saleId = createChangeSale();
      const before = { usd: balance(db, "General", "USD"), lbp: balance(db, "General", "LBP") };

      txnRepo.refundBySaleId(saleId, 1, {
        refundLegs: [{ method: "CASH", currencyCode: "LBP", amount: 8055000 }],
        exchangeRate: 89500,
      });

      expect(balance(db, "General", "USD") - before.usd).toBeCloseTo(0, 5);
      // Correct direction: OUT of the drawer (money handed back), never IN.
      expect(balance(db, "General", "LBP") - before.lbp).toBeCloseTo(
        -8055000,
        2,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Case C — POS single-item refund on the same change-sale shape, through
  // `SalesRepository.refundSaleItem` / `_applySaleItemMoneyBack` (the
  // finding's second named location, a separate copy of the same bug).
  // ═══════════════════════════════════════════════════════════════════════
  it("C: POS item refund of the $90 line accepts $90 (not $110) and posts the correct sign", () => {
    db.prepare(
      `INSERT INTO products (id, name, cost_price_usd, stock_quantity) VALUES (1, 'Widget', 10, 100)`,
    ).run();
    const result = salesRepo.processSale(
      {
        client_id: null,
        items: [{ product_id: 1, quantity: 1, price: 90 }],
        total_amount: 90,
        discount: 0,
        final_amount: 90,
        payment_usd: 100,
        payment_lbp: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
        change_given_lbp: 895000,
        exchange_rate: 89500,
        status: "completed",
      },
      1,
    );
    if (!result.success || result.id == null) {
      throw new Error(`processSale failed: ${result.error}`);
    }
    const saleId = result.id;
    const saleItemId = (
      db
        .prepare(`SELECT id FROM sale_items WHERE sale_id = ?`)
        .get(saleId) as { id: number }
    ).id;

    const before = { usd: balance(db, "General", "USD"), lbp: balance(db, "General", "LBP") };

    // The $110 magnitude-sum bug's value must now be rejected.
    expect(() =>
      salesRepo.refundSaleItem({
        saleId,
        saleItemId,
        refundQuantity: 1,
        userId: 1,
        refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 110 }],
        exchangeRate: 89500,
      }),
    ).toThrow(/do not match/i);

    // The correct $90 value is accepted and moves the drawer by exactly -90.
    salesRepo.refundSaleItem({
      saleId,
      saleItemId,
      refundQuantity: 1,
      userId: 1,
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 90 }],
      exchangeRate: 89500,
    });

    expect(balance(db, "General", "USD") - before.usd).toBeCloseTo(-90, 5);
    expect(balance(db, "General", "LBP") - before.lbp).toBeCloseTo(0, 2);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Case D — a balanced EXCHANGE ($100 in, 8,900,000 LBP out at rate
  // 89,000 — an even swap, no spread).
  //
  // Measured (finding F1): "a $200 USD refund accepted → shop −$200."
  // Pre-fix, the validator summed |100| + |-8,900,000/89,000| = 100+100 =
  // 200, so a $200 override matched exactly and was wrongly accepted.
  //
  // Fixed: the SIGNED net value is 100 + (-8,900,000/89,000) = 0 — an even
  // exchange has NO net customer-facing value to hand back through a
  // single-direction override leg (both currencies must move, in opposite
  // directions, which is exactly what the ordinary no-override mirror-
  // verbatim reversal already does correctly, unaffected by this bug). So
  // $200 is correctly rejected, and "the correct value" for THIS mechanism
  // is $0 — i.e. no override leg can ever validate here; the right way to
  // reverse a balanced exchange is the plain (no `refundLegs`) refund path,
  // asserted below to net every drawer back to exactly 0.
  // ═══════════════════════════════════════════════════════════════════════
  describe("D: a balanced $100 → 8,900,000 LBP exchange (rate 89,000, no spread)", () => {
    function createBalancedExchange(): number {
      const result = exchangeRepo.createTransaction({
        fromCurrency: "USD",
        toCurrency: "LBP",
        amountIn: 100,
        amountOut: 8900000,
        leg1Rate: 89000,
        leg1MarketRate: 89000,
        leg1ProfitUsd: 0,
        totalProfitUsd: 0,
      });
      return result.id;
    }

    it("D1: a $200 USD override (the old |sum| bug's accepted value) is REJECTED", () => {
      const exchangeId = createBalancedExchange();
      const txnId = (
        db
          .prepare(
            `SELECT id FROM transactions WHERE source_table = 'exchange_transactions' AND source_id = ?`,
          )
          .get(exchangeId) as { id: number }
      ).id;

      expect(() =>
        txnRepo.refundTransaction(txnId, 1, {
          refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 200 }],
          exchangeRate: 89000,
        }),
      ).toThrow(/do not match/i);
    });

    it("D2: the plain (no-override) reversal — the correct way to undo a balanced exchange — nets every drawer to 0", () => {
      const before = {
        usd: balance(db, "General", "USD"),
        lbp: balance(db, "General", "LBP"),
      };
      const exchangeId = createBalancedExchange();
      const txnId = (
        db
          .prepare(
            `SELECT id FROM transactions WHERE source_table = 'exchange_transactions' AND source_id = ?`,
          )
          .get(exchangeId) as { id: number }
      ).id;

      txnRepo.refundTransaction(txnId, 1, {});

      expect(balance(db, "General", "USD") - before.usd).toBeCloseTo(0, 5);
      expect(balance(db, "General", "LBP") - before.lbp).toBeCloseTo(0, 2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Case E — coordinator correction (post-review): the direction rule is
  // "one refund moves in ONE direction, the reversal of the ORIGINAL's
  // OVERALL signed value" — never a per-currency sign. An UNBALANCED
  // exchange (a real margin, unlike Case D's even swap) makes this provable
  // with a MIXED-currency override: $100 in, 8,000,000 LBP out at rate
  // 89,000 nets a positive overall value (the shop kept a spread), so BOTH
  // override legs — one USD, one LBP — must post OUT together, regardless
  // of what either currency's OWN isolated net happens to be.
  // ═══════════════════════════════════════════════════════════════════════
  it("E: an UNBALANCED exchange refunded with a mixed USD+LBP override posts BOTH legs OUT, in the same direction", () => {
    const rate = 89000;
    const result = exchangeRepo.createTransaction({
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 100,
      amountOut: 8000000,
      leg1Rate: rate,
      leg1MarketRate: rate,
      leg1ProfitUsd: 0,
      totalProfitUsd: 0,
    });
    const txnId = (
      db
        .prepare(
          `SELECT id FROM transactions WHERE source_table = 'exchange_transactions' AND source_id = ?`,
        )
        .get(result.id) as { id: number }
    ).id;

    // Net signed value: +100 (USD in) + (-8,000,000/89,000) (LBP out) —
    // positive, a money-in original. Split the refund across BOTH
    // currencies to prove neither leg's OWN sign drives its direction.
    const totalValueUsd = 100 - 8000000 / rate;
    const usdLeg = 5;
    const lbpLeg = Math.round((totalValueUsd - usdLeg) * rate);

    const before = {
      usd: balance(db, "General", "USD"),
      lbp: balance(db, "General", "LBP"),
    };

    txnRepo.refundTransaction(txnId, 1, {
      refundLegs: [
        { method: "CASH", currencyCode: "USD", amount: usdLeg },
        { method: "CASH", currencyCode: "LBP", amount: lbpLeg },
      ],
      exchangeRate: rate,
    });

    // BOTH legs move the drawer OUT (negative) — never IN, even though the
    // exchange's own LBP leg (the outflow to the customer) had a NEGATIVE
    // original net in isolation.
    expect(balance(db, "General", "USD") - before.usd).toBeCloseTo(-usdLeg, 5);
    expect(balance(db, "General", "LBP") - before.lbp).toBeCloseTo(-lbpLeg, 2);
  });
});
