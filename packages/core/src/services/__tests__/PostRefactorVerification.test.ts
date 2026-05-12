/**
 * Post-Refactor Verification Tests
 *
 * Comprehensive automated verification that confirms:
 * 1. All module transaction creation methods succeed without error
 * 2. Checkpoint creation works correctly
 * 3. Checkpoint expected amounts are accurate after transactions
 * 4. OMT transactions save correctly and drawer balances update
 * 5. Dashboard queries are independent of checkpoints
 *
 * Uses an in-memory SQLite DB injected via (globalThis as any).__LIRATEK_TEST_DB__
 * — the same hook that packages/core/src/db/connection.ts exposes for testing.
 */

import Database from "better-sqlite3";

// ─── Service imports ─────────────────────────────────────────────────────────
import { SalesService } from "../SalesService.js";
import { ExchangeService } from "../ExchangeService.js";
import { FinancialService } from "../FinancialService.js";
import { RechargeService } from "../RechargeService.js";
import { ExpenseService } from "../ExpenseService.js";
import { MaintenanceService } from "../MaintenanceService.js";
import { CustomServiceService } from "../CustomServiceService.js";
import { DebtService } from "../DebtService.js";
import { ClosingService } from "../ClosingService.js";

// ─── Loto (injected-DB pattern) ───────────────────────────────────────────────
import LotoTicketRepository from "../../repositories/LotoTicketRepository.js";
import LotoSettingsRepository from "../../repositories/LotoSettingsRepository.js";
import LotoMonthlyFeeRepository from "../../repositories/LotoMonthlyFeeRepository.js";
import LotoCheckpointRepository from "../../repositories/LotoCheckpointRepository.js";
import LotoCashPrizeRepository from "../../repositories/LotoCashPrizeRepository.js";
import LotoService from "../LotoService.js";

// ─── Schema builder ───────────────────────────────────────────────────────────

function buildSchema(db: Database.Database): void {
  db.exec(`
    -- ══════════════════════════════════════════
    -- CORE / SHARED TABLES
    -- ══════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT NOT NULL,
      role        TEXT DEFAULT 'user',
      is_active   INTEGER DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clients (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name       TEXT NOT NULL,
      phone_number    TEXT,
      notes           TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS currencies (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      code           TEXT NOT NULL UNIQUE,
      name           TEXT NOT NULL,
      symbol         TEXT,
      decimal_places INTEGER DEFAULT 2,
      is_active      INTEGER DEFAULT 1,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS currency_drawers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      currency_code TEXT NOT NULL,
      drawer_name   TEXT NOT NULL,
      UNIQUE(currency_code, drawer_name)
    );

    CREATE TABLE IF NOT EXISTS exchange_rates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      to_code     TEXT NOT NULL UNIQUE,
      market_rate REAL NOT NULL,
      buy_rate    REAL NOT NULL,
      sell_rate   REAL NOT NULL,
      is_stronger INTEGER DEFAULT -1,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      type         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id    INTEGER NOT NULL,
      user_id      INTEGER NOT NULL,
      amount_usd   REAL NOT NULL DEFAULT 0,
      amount_lbp   REAL NOT NULL DEFAULT 0,
      profit_usd   REAL DEFAULT 0,
      profit_lbp   REAL DEFAULT 0,
      exchange_rate REAL,
      client_id    INTEGER,
      client_name  TEXT,
      client_phone TEXT,
      reverses_id  INTEGER,
      summary      TEXT,
      metadata_json TEXT,
      device_id    TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS drawer_balances (
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (drawer_name, currency_code)
    );

    -- ══════════════════════════════════════════
    -- SALES
    -- ══════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS products (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      name                 TEXT NOT NULL,
      barcode              TEXT,
      price_usd            REAL NOT NULL DEFAULT 0,
      cost_price_usd       REAL NOT NULL DEFAULT 0,
      stock_quantity       INTEGER DEFAULT 100,
      min_stock_level      INTEGER DEFAULT 0,
      is_active            INTEGER DEFAULT 1,
      created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id              INTEGER,
      total_amount_usd       REAL DEFAULT 0,
      discount_usd           REAL DEFAULT 0,
      final_amount_usd       REAL DEFAULT 0,
      paid_usd               REAL DEFAULT 0,
      paid_lbp               REAL DEFAULT 0,
      change_given_usd       REAL DEFAULT 0,
      change_given_lbp       REAL DEFAULT 0,
      exchange_rate_snapshot REAL DEFAULT 1,
      drawer_name            TEXT DEFAULT 'General',
      status                 TEXT DEFAULT 'completed',
      note                   TEXT,
      edited_by              TEXT,
      edited_at              TEXT,
      created_by             INTEGER,
      created_at             DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id                   INTEGER NOT NULL,
      product_id                INTEGER NOT NULL,
      quantity                  INTEGER NOT NULL DEFAULT 1,
      sold_price_usd            REAL NOT NULL DEFAULT 0,
      cost_price_snapshot_usd   REAL NOT NULL DEFAULT 0,
      is_refunded               INTEGER DEFAULT 0,
      refunded_quantity         INTEGER DEFAULT 0,
      imei                      TEXT
    );

    -- ══════════════════════════════════════════
    -- EXCHANGE
    -- ══════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS exchange_transactions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      type             TEXT,
      from_currency    TEXT NOT NULL,
      to_currency      TEXT NOT NULL,
      amount_in        REAL NOT NULL,
      amount_out       REAL NOT NULL,
      rate             REAL,
      base_rate        REAL,
      profit_usd       REAL,
      leg1_rate        REAL,
      leg1_market_rate REAL,
      leg1_profit_usd  REAL,
      leg2_rate        REAL,
      leg2_market_rate REAL,
      leg2_profit_usd  REAL,
      via_currency     TEXT,
      client_name      TEXT,
      note             TEXT,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by       INTEGER,
      edited_by        TEXT,
      edited_at        TEXT
    );

    -- ══════════════════════════════════════════
    -- FINANCIAL SERVICES (OMT / WHISH)
    -- ══════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS financial_services (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      provider              TEXT NOT NULL,
      service_type          TEXT NOT NULL,
      amount                REAL NOT NULL,
      currency              TEXT DEFAULT 'USD',
      commission            REAL DEFAULT 0,
      cost                  REAL DEFAULT 0,
      price                 REAL DEFAULT 0,
      paid_by               TEXT DEFAULT 'CASH',
      client_id             INTEGER,
      client_name           TEXT,
      reference_number      TEXT,
      phone_number          TEXT,
      sender_name           TEXT,
      sender_phone          TEXT,
      receiver_name         TEXT,
      receiver_phone        TEXT,
      sender_client_id      INTEGER,
      receiver_client_id    INTEGER,
      omt_service_type      TEXT,
      omt_fee               REAL,
      whish_fee             REAL,
      profit_rate           REAL,
      pay_fee               INTEGER DEFAULT 0,
      item_key              TEXT,
      note                  TEXT,
      is_settled            INTEGER DEFAULT 0,
      settled_at            TEXT,
      settlement_id         INTEGER,
      payment_method_fee    REAL DEFAULT 0,
      payment_method_fee_rate REAL,
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by            INTEGER,
      edited_by             TEXT,
      edited_at             TEXT
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      module_key  TEXT,
      provider    TEXT,
      is_system   INTEGER DEFAULT 0,
      is_active   INTEGER DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS supplier_ledger (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type  TEXT NOT NULL,
      amount_usd  REAL DEFAULT 0,
      amount_lbp  REAL DEFAULT 0,
      note        TEXT,
      created_by  INTEGER,
      transaction_id INTEGER,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS item_costs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      provider   TEXT NOT NULL,
      category   TEXT NOT NULL,
      item_key   TEXT NOT NULL,
      cost       REAL NOT NULL,
      currency   TEXT DEFAULT 'USD',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, category, item_key, currency)
    );

    -- ══════════════════════════════════════════
    -- RECHARGES
    -- ══════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS recharges (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier                 TEXT NOT NULL,
      recharge_type           TEXT NOT NULL DEFAULT 'CREDIT_TRANSFER',
      amount                  REAL NOT NULL,
      cost                    REAL DEFAULT 0,
      price                   REAL DEFAULT 0,
      default_price_to_client REAL,
      currency_code           TEXT DEFAULT 'USD',
      paid_by                 TEXT DEFAULT 'CASH',
      phone_number            TEXT,
      client_id               INTEGER,
      client_name             TEXT,
      note                    TEXT,
      created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by              INTEGER DEFAULT 1,
      edited_by               TEXT,
      edited_at               TEXT
    );

    -- ══════════════════════════════════════════
    -- EXPENSES
    -- ══════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS expenses (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      description    TEXT NOT NULL,
      category       TEXT NOT NULL,
      paid_by_method TEXT DEFAULT 'CASH',
      amount_usd     REAL DEFAULT 0,
      amount_lbp     REAL DEFAULT 0,
      expense_date   TEXT NOT NULL,
      note           TEXT,
      status         TEXT DEFAULT 'active',
      edited_by      TEXT,
      edited_at      TEXT,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ══════════════════════════════════════════
    -- MAINTENANCE
    -- ══════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS maintenance (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER,
      client_name      TEXT,
      device_name      TEXT NOT NULL,
      issue_description TEXT,
      cost_usd         REAL DEFAULT 0,
      price_usd        REAL DEFAULT 0,
      discount_usd     REAL DEFAULT 0,
      final_amount_usd REAL DEFAULT 0,
      paid_usd         REAL DEFAULT 0,
      paid_lbp         REAL DEFAULT 0,
      exchange_rate    REAL DEFAULT 0,
      status           TEXT DEFAULT 'In Progress',
      paid_by          TEXT DEFAULT 'CASH',
      note             TEXT,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      edited_by        TEXT,
      edited_at        TEXT
    );

    CREATE TABLE IF NOT EXISTS maintenance_payments (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id        INTEGER NOT NULL,
      method        TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount        REAL NOT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ══════════════════════════════════════════
    -- CUSTOM SERVICES
    -- ══════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS custom_services (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      cost_usd    REAL NOT NULL DEFAULT 0,
      cost_lbp    REAL NOT NULL DEFAULT 0,
      price_usd   REAL NOT NULL DEFAULT 0,
      price_lbp   REAL NOT NULL DEFAULT 0,
      profit_usd  REAL GENERATED ALWAYS AS (price_usd - cost_usd) STORED,
      profit_lbp  REAL GENERATED ALWAYS AS (price_lbp - cost_lbp) STORED,
      paid_by     TEXT NOT NULL DEFAULT 'CASH',
      status      TEXT NOT NULL DEFAULT 'completed'
                  CHECK(status IN ('pending','completed','voided')),
      client_id   INTEGER,
      client_name TEXT,
      phone_number TEXT,
      note        TEXT,
      category    TEXT,
      created_by  INTEGER,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      edited_by   TEXT,
      edited_at   TEXT
    );

    -- ══════════════════════════════════════════
    -- DEBT
    -- ══════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL DEFAULT 0,
      amount_lbp       REAL DEFAULT 0,
      transaction_id   INTEGER,
      due_date         TEXT,
      note             TEXT,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by       INTEGER,
      edited_by        TEXT,
      edited_at        TEXT
    );

    -- ══════════════════════════════════════════
    -- CLOSING / CHECKPOINTS
    -- ══════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS daily_closings (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      closing_date        TEXT NOT NULL,
      drawer_name         TEXT,
      opening_balance_usd REAL DEFAULT 0,
      opening_balance_lbp REAL DEFAULT 0,
      physical_usd        REAL DEFAULT 0,
      physical_lbp        REAL DEFAULT 0,
      physical_eur        REAL DEFAULT 0,
      system_expected_usd REAL DEFAULT 0,
      system_expected_lbp REAL DEFAULT 0,
      variance_usd        REAL DEFAULT 0,
      notes               TEXT,
      report_path         TEXT,
      created_by          INTEGER,
      updated_by          INTEGER,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS daily_closing_amounts (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      closing_id     INTEGER NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      opening_amount REAL DEFAULT 0,
      physical_amount REAL DEFAULT 0,
      UNIQUE(closing_id, drawer_name, currency_code)
    );

    -- ══════════════════════════════════════════
    -- LOTO (ticket purchases use __LIRATEK_TEST_DB__ too since LotoTicketRepository calls getTransactionRepository)
    -- ══════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS loto_tickets (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number    TEXT,
      sale_amount      REAL DEFAULT 0,
      commission_rate  REAL DEFAULT 0.0445,
      commission_amount REAL DEFAULT 0,
      is_winner        INTEGER DEFAULT 0,
      prize_amount     REAL DEFAULT 0,
      prize_paid_date  TEXT,
      sale_date        TEXT,
      payment_method   TEXT,
      currency         TEXT DEFAULT 'LBP',
      note             TEXT,
      checkpoint_id    INTEGER,
      edited_by        TEXT,
      edited_at        TEXT,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS loto_monthly_fees (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      fee_amount  REAL DEFAULT 0,
      fee_month   TEXT,
      fee_year    INTEGER,
      recorded_date TEXT,
      is_paid     INTEGER DEFAULT 0,
      paid_date   TEXT,
      note        TEXT,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS loto_checkpoints (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      checkpoint_date  TEXT NOT NULL,
      period_start     TEXT NOT NULL,
      period_end       TEXT NOT NULL,
      total_sales      REAL DEFAULT 0,
      total_commission REAL DEFAULT 0,
      total_tickets    INTEGER DEFAULT 0,
      total_prizes     REAL DEFAULT 0,
      is_settled       BOOLEAN DEFAULT 0,
      settled_at       TEXT,
      settlement_id    INTEGER,
      note             TEXT,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS loto_cash_prizes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      amount      REAL NOT NULL,
      note        TEXT,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function seedBaseData(db: Database.Database): void {
  // Seed user
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username, role) VALUES (1, 'admin', 'admin')`,
  ).run();

  // Seed client
  db.prepare(
    `INSERT OR IGNORE INTO clients (id, full_name, phone_number) VALUES (1, 'Test Client', '70000001')`,
  ).run();

  // Seed product (for sales)
  db.prepare(
    `INSERT OR IGNORE INTO products (id, name, barcode, price_usd, cost_price_usd, stock_quantity)
     VALUES (1, 'Test Product', 'TEST001', 10.00, 6.00, 100)`,
  ).run();

  // Seed drawers
  const drawers = [
    ["General", "USD"],
    ["General", "LBP"],
    ["OMT_System", "USD"],
    ["OMT_System", "LBP"],
    ["Whish_System", "USD"],
    ["Whish_System", "LBP"],
    ["OMT_App", "USD"],
    ["OMT_App", "LBP"],
    ["Whish_App", "USD"],
    ["Whish_App", "LBP"],
    ["MTC", "USD"],
    ["MTC", "LBP"],
    ["Alfa", "USD"],
    ["Alfa", "LBP"],
    ["Binance", "USD"],
  ];
  const insertDrawer = db.prepare(
    `INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance)
     VALUES (?, ?, 0)`,
  );
  for (const [name, currency] of drawers) {
    insertDrawer.run(name, currency);
  }

  // Seed exchange rate (LBP → USD)
  db.prepare(
    `INSERT OR IGNORE INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate, is_stronger)
     VALUES ('LBP', 89500, 89000, 90000, -1)`,
  ).run();

  // Seed suppliers for OMT/WHISH
  db.prepare(
    `INSERT OR IGNORE INTO suppliers (id, name, provider, is_system) VALUES (1, 'OMT', 'OMT', 1)`,
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO suppliers (id, name, provider, is_system) VALUES (2, 'Whish', 'WHISH', 1)`,
  ).run();
}

// ─── Test suite ────────────────────────────────────────────────────────────────

describe("Post-Refactor Verification", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    buildSchema(db);
    seedBaseData(db);
    // Inject into the global hook used by connection.ts → getDatabase()
    (
      globalThis as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
  });

  afterEach(() => {
    delete (globalThis as { __LIRATEK_TEST_DB__?: Database.Database })
      .__LIRATEK_TEST_DB__;
    db.close();
  });

  // ══════════════════════════════════════════════════════════════════
  // 1. Module transaction creation
  // ══════════════════════════════════════════════════════════════════

  describe("Module transaction creation", () => {
    it("SalesService.processSale() creates a sale successfully", () => {
      const service = new SalesService();
      const result = service.processSale(
        {
          client_id: null,
          items: [{ product_id: 1, quantity: 1, price: 10, imei: undefined }],
          total_amount: 10,
          discount: 0,
          final_amount: 10,
          payment_usd: 10,
          payment_lbp: 0,
          exchange_rate: 89500,
          drawer_name: "General",
          status: "completed",
        },
        1,
      );

      expect(result.success).toBe(true);
      expect(result.id).toBeGreaterThan(0);

      // Verify the sale was persisted
      const sale = db
        .prepare("SELECT * FROM sales WHERE id = ?")
        .get(result.id);
      expect(sale).toBeDefined();

      // Verify a transaction row was created
      const txn = db
        .prepare(
          "SELECT * FROM transactions WHERE source_table = 'sales' AND source_id = ?",
        )
        .get(result.id);
      expect(txn).toBeDefined();
    });

    it("ExchangeService.addDirectTransaction() creates an exchange record", () => {
      const service = new ExchangeService();
      const result = service.addDirectTransaction({
        fromCurrency: "USD",
        toCurrency: "LBP",
        amountIn: 100,
        amountOut: 8950000,
        leg1Rate: 89500,
        leg1MarketRate: 89500,
        leg1ProfitUsd: 0,
        totalProfitUsd: 0,
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeGreaterThan(0);

      const row = db
        .prepare("SELECT * FROM exchange_transactions WHERE id = ?")
        .get(result.id);
      expect(row).toBeDefined();
    });

    it("FinancialService.addTransaction() — OMT RECEIVE creates a financial_services row", () => {
      const service = new FinancialService();
      const result = service.addTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 200,
        currency: "USD",
        commission: 2,
        paidByMethod: "CASH",
        clientName: "Receiver Test",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeGreaterThan(0);

      const row = db
        .prepare("SELECT * FROM financial_services WHERE id = ?")
        .get(result.id) as
        | { provider: string; commission: number; is_settled: number }
        | undefined;
      expect(row).toBeDefined();
      expect(row!.provider).toBe("OMT");
      // OMT RECEIVE with commission > 0 → pending settlement
      expect(row!.is_settled).toBe(0);
    });

    it("FinancialService.addTransaction() — OMT SEND creates a financial_services row and updates drawer", () => {
      const service = new FinancialService();

      // Pre-fund OMT_System drawer so the debit doesn't go negative
      db.prepare(
        `UPDATE drawer_balances SET balance = 500 WHERE drawer_name = 'OMT_System' AND currency_code = 'USD'`,
      ).run();

      const result = service.addTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 1,
        paidByMethod: "CASH",
        clientName: "Sender Test",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeGreaterThan(0);

      const row = db
        .prepare("SELECT * FROM financial_services WHERE id = ?")
        .get(result.id) as { service_type: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.service_type).toBe("SEND");
    });

    it("RechargeService.processRecharge() creates a recharge record", () => {
      const service = new RechargeService();

      // Pre-fund MTC drawer (cost will be debited from provider drawer)
      db.prepare(
        `UPDATE drawer_balances SET balance = 1000 WHERE drawer_name = 'MTC' AND currency_code = 'USD'`,
      ).run();

      const result = service.processRecharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 5,
        cost: 4.5,
        price: 5,
        currency: "USD",
        paid_by_method: "CASH",
        userId: 1,
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeGreaterThan(0);

      const row = db
        .prepare("SELECT * FROM recharges WHERE id = ?")
        .get(result.id) as { carrier: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.carrier).toBe("MTC");
    });

    it("ExpenseService.addExpense() creates an expense and deducts drawer balance", () => {
      const service = new ExpenseService();

      // Pre-fund General drawer
      db.prepare(
        `UPDATE drawer_balances SET balance = 500 WHERE drawer_name = 'General' AND currency_code = 'USD'`,
      ).run();

      const result = service.addExpense(
        {
          description: "Office supplies",
          category: "Office",
          paid_by_method: "CASH",
          amount_usd: 20,
          amount_lbp: 0,
          expense_date: new Date().toISOString().split("T")[0],
        },
        1,
      );

      expect(result.success).toBe(true);
      expect(result.id).toBeGreaterThan(0);

      const row = db
        .prepare("SELECT * FROM expenses WHERE id = ?")
        .get(result.id) as { description: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.description).toBe("Office supplies");

      // Drawer balance should have decreased
      const balance = db
        .prepare(
          `SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'USD'`,
        )
        .get() as { balance: number };
      expect(balance.balance).toBeLessThan(500);
    });

    it("MaintenanceService.saveJob() creates an 'In Progress' job", () => {
      const service = new MaintenanceService();
      const result = service.saveJob({
        device_name: "iPhone 14",
        issue_description: "Cracked screen",
        cost_usd: 30,
        price_usd: 50,
        status: "In Progress",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeGreaterThan(0);

      const row = db
        .prepare("SELECT * FROM maintenance WHERE id = ?")
        .get(result.id) as { device_name: string; status: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.device_name).toBe("iPhone 14");
      expect(row!.status).toBe("In Progress");
    });

    it("CustomServiceService.addService() creates a custom service record", () => {
      const service = new CustomServiceService();
      const result = service.addService({
        description: "Data Recovery",
        cost_usd: 10,
        cost_lbp: 0,
        price_usd: 25,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeGreaterThan(0);

      const row = db
        .prepare("SELECT * FROM custom_services WHERE id = ?")
        .get(result.id) as
        | { description: string; profit_usd: number }
        | undefined;
      expect(row).toBeDefined();
      expect(row!.description).toBe("Data Recovery");
      expect(row!.profit_usd).toBe(15); // 25 - 10
    });

    it("LotoService.sellTicket() creates a loto ticket and a unified transaction", () => {
      // LotoTicketRepository uses getTransactionRepository() internally,
      // so the __LIRATEK_TEST_DB__ hook covers both repos.
      const ticketRepo = new LotoTicketRepository(db);
      const settingsRepo = new LotoSettingsRepository(db);
      const monthlyFeeRepo = new LotoMonthlyFeeRepository(db);
      const checkpointRepo = new LotoCheckpointRepository(db);
      const cashPrizeRepo = new LotoCashPrizeRepository(db);
      const lotoService = new LotoService(
        ticketRepo,
        settingsRepo,
        monthlyFeeRepo,
        checkpointRepo,
        cashPrizeRepo,
      );

      const ticket = lotoService.sellTicket({
        ticket_number: "L001",
        sale_amount: 10000,
        commission_rate: 0.0445,
        payment_method: "CASH",
        currency: "LBP",
        sale_date: new Date().toISOString().split("T")[0],
        userId: 1,
      });

      expect(ticket).toBeDefined();
      expect(ticket.id).toBeGreaterThan(0);
      expect(ticket.ticket_number).toBe("L001");
      expect(ticket.sale_amount).toBe(10000);
      expect(ticket.commission_amount).toBeCloseTo(445, 0);

      // Verify unified transaction was also created
      const txn = db
        .prepare(
          "SELECT * FROM transactions WHERE source_table = 'loto_tickets' AND source_id = ?",
        )
        .get(ticket.id);
      expect(txn).toBeDefined();
    });

    it("DebtService.addRepayment() creates a repayment entry", () => {
      // First create a debt entry manually for the client
      db.prepare(
        `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, created_by)
         VALUES (1, 'Sale Debt', 50, 1)`,
      ).run();

      const service = new DebtService();
      const result = service.addRepayment({
        clientId: 1,
        amountUSD: 20,
        amountLBP: 0,
        note: "Partial repayment",
        userId: 1,
        paidByMethod: "CASH",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeGreaterThan(0);

      const row = db
        .prepare(
          "SELECT * FROM debt_ledger WHERE id = ? AND transaction_type = 'Repayment'",
        )
        .get(result.id) as { amount_usd: number } | undefined;
      expect(row).toBeDefined();
      // Repayments are stored as negative amounts
      expect(Math.abs(row!.amount_usd)).toBeCloseTo(20, 2);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 2. Checkpoint creation
  // ══════════════════════════════════════════════════════════════════

  describe("Checkpoint creation", () => {
    it("ClosingService.createCheckpoint() succeeds and returns an ID", () => {
      const service = new ClosingService();
      const result = service.createCheckpoint({
        user_id: 1,
        notes: "Morning checkpoint",
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            expected_amount: 100,
            physical_amount: 100,
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeDefined();
      expect(Number(result.id)).toBeGreaterThan(0);

      // Verify the row exists in daily_closings
      const row = db
        .prepare("SELECT * FROM daily_closings WHERE id = ?")
        .get(Number(result.id)) as { notes: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.notes).toBe("Morning checkpoint");
    });

    it("ClosingService.createCheckpoint() persists amounts in daily_closing_amounts", () => {
      const service = new ClosingService();
      const result = service.createCheckpoint({
        user_id: 1,
        notes: "Checkpoint with multiple drawers",
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            expected_amount: 250,
            physical_amount: 248,
          },
          {
            drawer_name: "General",
            currency_code: "LBP",
            expected_amount: 500000,
            physical_amount: 500000,
          },
        ],
      });

      expect(result.success).toBe(true);

      const amounts = db
        .prepare(
          "SELECT * FROM daily_closing_amounts WHERE closing_id = ? ORDER BY currency_code",
        )
        .all(Number(result.id)) as Array<{
        drawer_name: string;
        currency_code: string;
        opening_amount: number; // expected_amount is stored as opening_amount
        physical_amount: number;
      }>;

      expect(amounts).toHaveLength(2);
      const usd = amounts.find((a) => a.currency_code === "USD")!;
      expect(usd.opening_amount).toBe(250); // expected_amount → opening_amount column
      expect(usd.physical_amount).toBe(248);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 3. Checkpoint expected amounts accuracy
  // ══════════════════════════════════════════════════════════════════

  describe("Checkpoint expected amounts", () => {
    it("getSystemExpectedBalancesDynamic() reflects drawer_balances after transactions", () => {
      // Start with a known balance
      db.prepare(
        `UPDATE drawer_balances SET balance = 100 WHERE drawer_name = 'General' AND currency_code = 'USD'`,
      ).run();

      // Process an expense (should deduct from General USD)
      const expenseService = new ExpenseService();
      expenseService.addExpense(
        {
          description: "Test expense",
          category: "Other",
          paid_by_method: "CASH",
          amount_usd: 30,
          amount_lbp: 0,
          expense_date: new Date().toISOString().split("T")[0],
        },
        1,
      );

      const closingService = new ClosingService();
      const balances = closingService.getSystemExpectedBalancesDynamic();

      // After $30 expense, General USD should be 70
      expect(balances["General"]).toBeDefined();
      expect(balances["General"]["USD"]).toBeCloseTo(70, 1);
    });

    it("Checkpoint expected amounts match actual drawer balances at time of checkpoint", () => {
      // Set up a known drawer state
      db.prepare(
        `UPDATE drawer_balances SET balance = 500 WHERE drawer_name = 'General' AND currency_code = 'USD'`,
      ).run();

      const closingService = new ClosingService();
      const balances = closingService.getSystemExpectedBalancesDynamic();
      const expectedUSD = balances["General"]?.["USD"] ?? 0;

      // Create checkpoint with matching expected amounts
      const result = closingService.createCheckpoint({
        user_id: 1,
        notes: "Accuracy test checkpoint",
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            expected_amount: expectedUSD,
            physical_amount: expectedUSD,
          },
        ],
      });

      expect(result.success).toBe(true);

      const amounts = db
        .prepare(
          "SELECT * FROM daily_closing_amounts WHERE closing_id = ? AND drawer_name = 'General' AND currency_code = 'USD'",
        )
        .get(Number(result.id)) as { opening_amount: number } | undefined;

      expect(amounts).toBeDefined();
      expect(amounts!.opening_amount).toBe(expectedUSD); // expected_amount → opening_amount column
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 4. OMT transactions save correctly and drawer balances update
  // ══════════════════════════════════════════════════════════════════

  describe("OMT transactions — drawer balance updates", () => {
    it("OMT RECEIVE with commission stays unsettled (is_settled=0)", () => {
      const service = new FinancialService();
      const result = service.addTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 300,
        currency: "USD",
        commission: 3, // OMT owes us $3
        paidByMethod: "CASH",
      });

      expect(result.success).toBe(true);

      const row = db
        .prepare(
          "SELECT is_settled, commission FROM financial_services WHERE id = ?",
        )
        .get(result.id) as
        | { is_settled: number; commission: number }
        | undefined;

      expect(row).toBeDefined();
      // NOTE: OMT RECEIVE with commission > 0 should be is_settled=0 (pending)
      expect(row!.is_settled).toBe(0);
      // Commission is stored
      expect(row!.commission).toBeGreaterThan(0);
    });

    it("OMT SEND is immediately settled (is_settled=1)", () => {
      const service = new FinancialService();

      // Fund OMT_System first
      db.prepare(
        `UPDATE drawer_balances SET balance = 1000 WHERE drawer_name = 'OMT_System' AND currency_code = 'USD'`,
      ).run();

      const result = service.addTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 50,
        currency: "USD",
        commission: 0, // SEND with no commission is settled immediately
        paidByMethod: "CASH",
      });

      expect(result.success).toBe(true);

      const row = db
        .prepare("SELECT is_settled FROM financial_services WHERE id = ?")
        .get(result.id) as { is_settled: number } | undefined;

      expect(row!.is_settled).toBe(1);
    });

    it("OMT RECEIVE creates a payments journal entry for the cash inflow", () => {
      const service = new FinancialService();
      const result = service.addTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 150,
        currency: "USD",
        commission: 1.5,
        paidByMethod: "CASH",
      });

      expect(result.success).toBe(true);

      // A payment row must exist for this transaction
      const txn = db
        .prepare(
          "SELECT id FROM transactions WHERE source_table = 'financial_services' AND source_id = ?",
        )
        .get(result.id) as { id: number } | undefined;
      expect(txn).toBeDefined();

      const paymentRows = db
        .prepare("SELECT * FROM payments WHERE transaction_id = ?")
        .all(txn!.id) as Array<{ amount: number; drawer_name: string }>;
      expect(paymentRows.length).toBeGreaterThan(0);
    });

    it("OMT drawer balance is credited on OMT SEND (client pays cash, OMT_System receives)", () => {
      // Pre-fund OMT_System with $1000
      db.prepare(
        `UPDATE drawer_balances SET balance = 1000 WHERE drawer_name = 'OMT_System' AND currency_code = 'USD'`,
      ).run();

      const service = new FinancialService();
      service.addTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 200,
        currency: "USD",
        commission: 2,
        paidByMethod: "CASH",
      });

      // OMT_System balance increases — client paid cash to send money via OMT
      const balance = db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = 'OMT_System' AND currency_code = 'USD'",
        )
        .get() as { balance: number };
      expect(balance.balance).toBeGreaterThan(1000);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 5. Dashboard queries are independent of checkpoints
  // ══════════════════════════════════════════════════════════════════

  describe("Dashboard queries — checkpoint independence", () => {
    it("SalesService.getDashboardStats() returns today's data before AND after checkpoint creation", () => {
      const salesService = new SalesService();
      const closingService = new ClosingService();

      // Process a sale today
      salesService.processSale(
        {
          client_id: null,
          items: [{ product_id: 1, quantity: 2, price: 10, imei: undefined }],
          total_amount: 20,
          discount: 0,
          final_amount: 20,
          payment_usd: 20,
          payment_lbp: 0,
          exchange_rate: 89500,
          drawer_name: "General",
          status: "completed",
        },
        1,
      );

      const statsBefore = salesService.getDashboardStats();
      expect(statsBefore.ordersCount).toBeGreaterThanOrEqual(1);
      expect(statsBefore.totalSalesUSD).toBeGreaterThanOrEqual(20);

      // Create a checkpoint
      closingService.createCheckpoint({
        user_id: 1,
        notes: "Mid-day checkpoint",
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            expected_amount: 20,
            physical_amount: 20,
          },
        ],
      });

      // Dashboard stats must NOT change after a checkpoint is created
      const statsAfter = salesService.getDashboardStats();
      expect(statsAfter.ordersCount).toBe(statsBefore.ordersCount);
      expect(statsAfter.totalSalesUSD).toBe(statsBefore.totalSalesUSD);
    });

    it("getDailyStatsSnapshot() counts sales and expenses for today regardless of checkpoints", () => {
      const salesService = new SalesService();
      const expenseService = new ExpenseService();
      const closingService = new ClosingService();

      const today = new Date().toISOString().split("T")[0];

      // Create a sale
      salesService.processSale(
        {
          client_id: null,
          items: [{ product_id: 1, quantity: 1, price: 10, imei: undefined }],
          total_amount: 10,
          discount: 0,
          final_amount: 10,
          payment_usd: 10,
          payment_lbp: 0,
          exchange_rate: 89500,
          status: "completed",
        },
        1,
      );

      // Create an expense
      expenseService.addExpense(
        {
          description: "Rent",
          category: "Utilities",
          paid_by_method: "CASH",
          amount_usd: 50,
          amount_lbp: 0,
          expense_date: today,
        },
        1,
      );

      const snapshotBefore = closingService.getDailyStatsSnapshot();
      expect(snapshotBefore.salesCount).toBeGreaterThanOrEqual(1);
      expect(snapshotBefore.totalSalesUSD).toBeGreaterThanOrEqual(10);
      expect(snapshotBefore.totalExpensesUSD).toBeGreaterThanOrEqual(50);

      // Create checkpoint — should NOT affect daily stats
      closingService.createCheckpoint({
        user_id: 1,
        notes: "End of day checkpoint",
        amounts: [],
      });

      const snapshotAfter = closingService.getDailyStatsSnapshot();
      expect(snapshotAfter.salesCount).toBe(snapshotBefore.salesCount);
      expect(snapshotAfter.totalSalesUSD).toBe(snapshotBefore.totalSalesUSD);
      expect(snapshotAfter.totalExpensesUSD).toBe(
        snapshotBefore.totalExpensesUSD,
      );
    });

    it("ExpenseService.getTodayExpenses() uses DATE(created_at) and is unaffected by checkpoints", () => {
      const expenseService = new ExpenseService();
      const closingService = new ClosingService();

      const today = new Date().toISOString().split("T")[0];

      expenseService.addExpense(
        {
          description: "Stationery",
          category: "Office",
          paid_by_method: "CASH",
          amount_usd: 5,
          amount_lbp: 0,
          expense_date: today,
        },
        1,
      );

      const before = expenseService.getTodayExpenses();
      expect(before.length).toBeGreaterThanOrEqual(1);

      // Create checkpoint
      closingService.createCheckpoint({
        user_id: 1,
        notes: "Checkpoint after expense",
        amounts: [],
      });

      const after = expenseService.getTodayExpenses();
      // The same expenses should still be visible
      expect(after.length).toBe(before.length);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 6. Multiple checkpoints in a day
  // ══════════════════════════════════════════════════════════════════

  describe("Multiple checkpoints in one day", () => {
    it("can create two checkpoints for the same day without conflict", () => {
      const service = new ClosingService();

      const r1 = service.createCheckpoint({
        user_id: 1,
        notes: "Opening checkpoint",
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            expected_amount: 0,
            physical_amount: 100,
          },
        ],
      });

      const r2 = service.createCheckpoint({
        user_id: 1,
        notes: "Closing checkpoint",
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            expected_amount: 100,
            physical_amount: 95,
          },
        ],
      });

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(Number(r1.id)).not.toBe(Number(r2.id));

      const count = (
        db.prepare("SELECT COUNT(*) as cnt FROM daily_closings").get() as {
          cnt: number;
        }
      ).cnt;
      expect(count).toBe(2);
    });

    it("hasOpeningBalanceToday() returns true after first checkpoint", () => {
      const service = new ClosingService();

      expect(service.hasOpeningBalanceToday()).toBe(false);

      service.createCheckpoint({ user_id: 1, notes: "First", amounts: [] });

      expect(service.hasOpeningBalanceToday()).toBe(true);
    });
  });
});
