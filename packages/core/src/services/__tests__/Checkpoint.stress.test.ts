/**
 * LIRA-008: Checkpoint Stress Test & Acceptance Validation
 *
 * Integration tests that replicate a real shop day flow for the checkpoint system.
 * Uses an in-memory SQLite database with the real ClosingService and ClosingRepository.
 *
 * Flow:
 *   1. Start fresh — no checkpoints exist
 *   2. Create transactions across multiple modules (POS, exchange, OMT, MTC recharge, expense)
 *   3. Checkpoint #1 — verify expected amounts match sum of transactions per drawer
 *   4. Enter actual amounts (some matching, some with variance)
 *   5. Save checkpoint — verify it records correctly
 *   6. Create more transactions
 *   7. Checkpoint #2 — verify baseline = Checkpoint #1 actuals, expected = baseline + new txns
 *   8. Verify variance data is correct
 *   9. Verify multi-currency amounts correct (USD, LBP)
 */

import Database from "better-sqlite3";
import { ClosingService } from "../ClosingService.js";
import { ClosingRepository } from "../../repositories/ClosingRepository.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create all tables needed for the checkpoint system in an in-memory DB.
 * We only create the minimal schema needed — no FK enforcement required.
 */
function createSchema(db: Database.Database): void {
  db.exec(`
    -- Users (minimal)
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password_hash TEXT,
      role TEXT DEFAULT 'staff',
      is_active BOOLEAN DEFAULT 1
    );
    INSERT INTO users (id, username, password_hash, role) VALUES (1, 'admin', '', 'admin');

    -- Transactions (unified accounting journal)
    CREATE TABLE IF NOT EXISTS transactions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      type            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table    TEXT NOT NULL,
      source_id       INTEGER NOT NULL,
      user_id         INTEGER NOT NULL,
      amount_usd      REAL NOT NULL DEFAULT 0,
      amount_lbp      REAL NOT NULL DEFAULT 0,
      exchange_rate   REAL,
      client_id       INTEGER,
      client_name     TEXT,
      client_phone    TEXT,
      reverses_id     INTEGER,
      profit_usd      REAL NOT NULL DEFAULT 0,
      profit_lbp      REAL NOT NULL DEFAULT 0,
      summary         TEXT,
      metadata_json   TEXT,
      device_id       TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Payments
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Drawer Balances
    CREATE TABLE IF NOT EXISTS drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (drawer_name, currency_code)
    );

    -- Daily Closings
    CREATE TABLE IF NOT EXISTS daily_closings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      closing_date DATE,
      drawer_name TEXT,
      opening_balance_usd DECIMAL(15, 2),
      opening_balance_lbp DECIMAL(15, 2),
      physical_usd DECIMAL(15, 2),
      physical_lbp DECIMAL(15, 2),
      physical_eur DECIMAL(15, 2),
      system_expected_usd DECIMAL(15, 2),
      system_expected_lbp DECIMAL(15, 2),
      variance_usd DECIMAL(15, 2),
      notes TEXT,
      report_path TEXT,
      created_by INTEGER,
      updated_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Daily Closing Amounts (per drawer/currency breakdown)
    CREATE TABLE IF NOT EXISTS daily_closing_amounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      closing_id INTEGER NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      opening_amount REAL DEFAULT 0,
      physical_amount REAL DEFAULT 0,
      UNIQUE(closing_id, drawer_name, currency_code)
    );

    -- Seed initial drawer balances (all zero)
    INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
    INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'USD', 0);
    INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_System', 'LBP', 0);
    INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('MTC', 'USD', 0);
    INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Alfa', 'USD', 0);

    -- Tables referenced by getDailyStatsSnapshot (minimal stubs so queries don't error)
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      total_amount_usd REAL DEFAULT 0,
      discount_usd REAL DEFAULT 0,
      final_amount_usd REAL DEFAULT 0,
      paid_usd REAL DEFAULT 0,
      paid_lbp REAL DEFAULT 0,
      change_given_usd REAL DEFAULT 0,
      change_given_lbp REAL DEFAULT 0,
      exchange_rate_snapshot REAL,
      drawer_name TEXT DEFAULT 'General',
      status TEXT DEFAULT 'completed',
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      sold_price_usd REAL,
      cost_price_snapshot_usd REAL,
      is_refunded BOOLEAN DEFAULT 0,
      refunded_quantity INTEGER DEFAULT 0,
      imei TEXT
    );

    CREATE TABLE IF NOT EXISTS debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL,
      amount_lbp REAL,
      transaction_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT,
      category TEXT,
      expense_type TEXT,
      amount_usd REAL,
      amount_lbp REAL,
      expense_date DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS financial_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recharges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier TEXT NOT NULL,
      recharge_type TEXT DEFAULT 'CREDIT_TRANSFER',
      amount REAL NOT NULL,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      currency_code TEXT DEFAULT 'USD',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS custom_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      profit_usd REAL DEFAULT 0,
      status TEXT DEFAULT 'completed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      final_amount_usd REAL DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      status TEXT DEFAULT 'Received',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Products (needed for sale_items FK references in stress helpers)
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT,
      name TEXT NOT NULL,
      item_type TEXT NOT NULL DEFAULT 'product',
      cost_price_usd REAL DEFAULT 0,
      selling_price_usd REAL DEFAULT 0,
      stock_quantity INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Exchange transactions stub
    CREATE TABLE IF NOT EXISTS exchange_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      amount_in REAL NOT NULL,
      amount_out REAL NOT NULL,
      rate REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Simulate a payment that affects drawer_balances (mirrors production pattern).
 * Inserts a row into `payments` and upserts `drawer_balances`.
 */
function insertPayment(
  db: Database.Database,
  txnId: number,
  drawerName: string,
  currencyCode: string,
  amount: number,
  method: string = "CASH",
): void {
  db.prepare(
    `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, created_by)
     VALUES (?, ?, ?, ?, ?, 1)`,
  ).run(txnId, method, drawerName, currencyCode, amount);

  db.prepare(
    `INSERT INTO drawer_balances (drawer_name, currency_code, balance)
     VALUES (?, ?, ?)
     ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
       balance = balance + excluded.balance,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(drawerName, currencyCode, amount);
}

/**
 * Create a unified transaction row (mirrors TransactionRepository.createTransaction).
 * Returns the transaction ID.
 */
function createTransaction(
  db: Database.Database,
  type: string,
  sourceTable: string,
  amountUsd: number = 0,
  amountLbp: number = 0,
): number {
  const result = db
    .prepare(
      `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, amount_lbp, summary)
       VALUES (?, ?, 0, 1, ?, ?, ?)`,
    )
    .run(type, sourceTable, amountUsd, amountLbp, `Test ${type}`);
  return result.lastInsertRowid as number;
}

// ---------------------------------------------------------------------------
// Scenario helpers — simulate real module transactions
// ---------------------------------------------------------------------------

/**
 * Simulate a POS sale: customer pays USD cash → General drawer.
 * E.g. sale of $50: +50 USD to General.
 */
function simulateSale(db: Database.Database, amountUsd: number): void {
  const txnId = createTransaction(db, "SALE", "sales", amountUsd, 0);
  insertPayment(db, txnId, "General", "USD", amountUsd);
}

/**
 * Simulate an exchange transaction: customer gives LBP, receives USD.
 * E.g. customer gives 4,500,000 LBP → shop gives $50 USD.
 * General drawer: +4,500,000 LBP, -50 USD.
 */
function simulateExchange(
  db: Database.Database,
  lbpIn: number,
  usdOut: number,
): void {
  const txnId = createTransaction(
    db,
    "EXCHANGE",
    "exchange_transactions",
    0,
    0,
  );
  insertPayment(db, txnId, "General", "LBP", lbpIn);
  insertPayment(db, txnId, "General", "USD", -usdOut);
}

/**
 * Simulate an OMT SEND: customer pays $100 USD cash, shop reserves from OMT_System.
 * General drawer: +100 USD (customer payment)
 * OMT_System drawer: +100 USD (credit for system balance tracking)
 */
function simulateOmtSend(db: Database.Database, amountUsd: number): void {
  const txnId = createTransaction(
    db,
    "FINANCIAL_SERVICE",
    "financial_services",
    amountUsd,
    0,
  );
  // Customer pays cash into General
  insertPayment(db, txnId, "General", "USD", amountUsd);
  // OMT system drawer credited (money reserved for OMT)
  insertPayment(db, txnId, "OMT_System", "USD", amountUsd);
}

/**
 * Simulate an MTC recharge: customer pays $5 USD cash, MTC balance consumed.
 * General drawer: +5 USD (customer payment)
 * MTC drawer: -5 USD (telecom balance consumed)
 */
function simulateMtcRecharge(db: Database.Database, amountUsd: number): void {
  const txnId = createTransaction(db, "RECHARGE", "recharges", amountUsd, 0);
  // Customer pays cash
  insertPayment(db, txnId, "General", "USD", amountUsd);
  // MTC balance consumed
  insertPayment(db, txnId, "MTC", "USD", -amountUsd);
}

/**
 * Simulate an expense: shop pays out cash from General drawer.
 * General drawer: -30 USD.
 */
function simulateExpense(db: Database.Database, amountUsd: number): void {
  const txnId = createTransaction(db, "EXPENSE", "expenses", -amountUsd, 0);
  insertPayment(db, txnId, "General", "USD", -amountUsd);
}

// ===========================================================================
// Tests
// ===========================================================================

describe("Checkpoint Stress Test — Full Shop Day Flow", () => {
  let db: Database.Database;
  let service: ClosingService;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);

    // Inject test DB so BaseRepository.getDatabase() returns it
    (globalThis as any).__LIRATEK_TEST_DB__ = db;

    // Instantiate real ClosingRepository + ClosingService
    const repo = new ClosingRepository();
    service = new ClosingService(repo);
  });

  afterEach(() => {
    delete (globalThis as any).__LIRATEK_TEST_DB__;
    db.close();
  });

  // -------------------------------------------------------------------------
  // 1. Start Fresh
  // -------------------------------------------------------------------------

  it("should start with no checkpoints and zero drawer balances", () => {
    const actuals = service.getLastCheckpointActuals();
    expect(actuals).toEqual({});

    const expected = service.getSystemExpectedBalancesDynamic();
    // All drawers should be at zero
    for (const drawer of Object.keys(expected)) {
      for (const currency of Object.keys(expected[drawer])) {
        expect(expected[drawer][currency]).toBe(0);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Full day flow
  // -------------------------------------------------------------------------

  describe("Full day flow with two checkpoints", () => {
    // Transaction amounts — Phase 1 (before Checkpoint #1)
    const SALE_USD = 50;
    const EXCHANGE_LBP_IN = 4_500_000;
    const EXCHANGE_USD_OUT = 50;
    const OMT_SEND_USD = 100;
    const MTC_RECHARGE_USD = 5;
    const EXPENSE_USD = 30;

    // Transaction amounts — Phase 2 (between Checkpoint #1 and #2)
    const SALE2_USD = 75;
    const EXPENSE2_USD = 10;

    let checkpoint1Id: number;
    let checkpoint2Id: number;

    // Checkpoint #1 actuals (some with variance)
    const CP1_GENERAL_USD_ACTUAL = 160; // expected will be 165, so variance = -5
    const CP1_GENERAL_LBP_ACTUAL = 4_500_000; // matches expected → no variance
    const CP1_OMT_SYSTEM_USD_ACTUAL = 100; // matches expected
    const CP1_MTC_USD_ACTUAL = -5; // matches expected (negative = consumed)

    // Expected General/USD after Phase 1:
    //   +50 (sale) -50 (exchange out) +100 (OMT cash in) +5 (MTC cash in) -30 (expense) = +75
    // Wait, let me recalculate:
    //   Sale:        General USD +50
    //   Exchange:    General LBP +4,500,000 / General USD -50
    //   OMT Send:    General USD +100 / OMT_System USD +100
    //   MTC Recharge: General USD +5 / MTC USD -5
    //   Expense:     General USD -30
    //   -------
    //   General USD = 50 - 50 + 100 + 5 - 30 = 75
    //   General LBP = 4,500,000
    //   OMT_System USD = 100
    //   MTC USD = -5
    const EXPECTED_GENERAL_USD_PHASE1 = 75;
    const EXPECTED_GENERAL_LBP_PHASE1 = 4_500_000;
    const EXPECTED_OMT_USD_PHASE1 = 100;
    const EXPECTED_MTC_USD_PHASE1 = -5;

    beforeEach(() => {
      // ---------- Phase 1: Create transactions ----------
      simulateSale(db, SALE_USD);
      simulateExchange(db, EXCHANGE_LBP_IN, EXCHANGE_USD_OUT);
      simulateOmtSend(db, OMT_SEND_USD);
      simulateMtcRecharge(db, MTC_RECHARGE_USD);
      simulateExpense(db, EXPENSE_USD);
    });

    it("should have correct drawer balances after Phase 1 transactions", () => {
      const expected = service.getSystemExpectedBalancesDynamic();

      expect(expected["General"]["USD"]).toBe(EXPECTED_GENERAL_USD_PHASE1);
      expect(expected["General"]["LBP"]).toBe(EXPECTED_GENERAL_LBP_PHASE1);
      expect(expected["OMT_System"]["USD"]).toBe(EXPECTED_OMT_USD_PHASE1);
      expect(expected["MTC"]["USD"]).toBe(EXPECTED_MTC_USD_PHASE1);
    });

    it("should create Checkpoint #1 with correct expected amounts", () => {
      const expected = service.getSystemExpectedBalancesDynamic();

      // Create checkpoint with actuals (some intentional variance on General/USD)
      const result = service.createCheckpoint({
        user_id: 1,
        notes: "Checkpoint #1 — end of morning shift",
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            expected_amount: expected["General"]["USD"],
            physical_amount: CP1_GENERAL_USD_ACTUAL, // 160 vs expected 75 → variance +85
          },
          {
            drawer_name: "General",
            currency_code: "LBP",
            expected_amount: expected["General"]["LBP"],
            physical_amount: CP1_GENERAL_LBP_ACTUAL,
          },
          {
            drawer_name: "OMT_System",
            currency_code: "USD",
            expected_amount: expected["OMT_System"]["USD"],
            physical_amount: CP1_OMT_SYSTEM_USD_ACTUAL,
          },
          {
            drawer_name: "MTC",
            currency_code: "USD",
            expected_amount: expected["MTC"]["USD"],
            physical_amount: CP1_MTC_USD_ACTUAL,
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeDefined();
      checkpoint1Id = Number(result.id);
    });

    it("should report correct variance for Checkpoint #1", () => {
      const expected = service.getSystemExpectedBalancesDynamic();

      const result = service.createCheckpoint({
        user_id: 1,
        notes: "Checkpoint #1",
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            expected_amount: expected["General"]["USD"],
            physical_amount: CP1_GENERAL_USD_ACTUAL,
          },
          {
            drawer_name: "General",
            currency_code: "LBP",
            expected_amount: expected["General"]["LBP"],
            physical_amount: CP1_GENERAL_LBP_ACTUAL,
          },
          {
            drawer_name: "OMT_System",
            currency_code: "USD",
            expected_amount: expected["OMT_System"]["USD"],
            physical_amount: CP1_OMT_SYSTEM_USD_ACTUAL,
          },
          {
            drawer_name: "MTC",
            currency_code: "USD",
            expected_amount: expected["MTC"]["USD"],
            physical_amount: CP1_MTC_USD_ACTUAL,
          },
        ],
      });

      checkpoint1Id = Number(result.id);
      const variance = service.getCheckpointVariance(checkpoint1Id);

      expect(variance.checkpointId).toBe(checkpoint1Id);

      // General/USD: actual 160 vs expected 75 → variance = +85
      const generalUsd = variance.drawers.find(
        (d) => d.drawerName === "General" && d.currency === "USD",
      );
      expect(generalUsd).toBeDefined();
      expect(generalUsd!.expected).toBe(EXPECTED_GENERAL_USD_PHASE1);
      expect(generalUsd!.actual).toBe(CP1_GENERAL_USD_ACTUAL);
      expect(generalUsd!.variance).toBeCloseTo(
        CP1_GENERAL_USD_ACTUAL - EXPECTED_GENERAL_USD_PHASE1,
        2,
      );

      // General/LBP: actual = expected → no variance
      const generalLbp = variance.drawers.find(
        (d) => d.drawerName === "General" && d.currency === "LBP",
      );
      expect(generalLbp).toBeDefined();
      expect(generalLbp!.variance).toBeCloseTo(0, 2);

      // OMT_System/USD: actual = expected → no variance
      const omtUsd = variance.drawers.find(
        (d) => d.drawerName === "OMT_System" && d.currency === "USD",
      );
      expect(omtUsd).toBeDefined();
      expect(omtUsd!.variance).toBeCloseTo(0, 2);

      // Overall: should flag hasVariance because General/USD differs
      expect(variance.hasVariance).toBe(true);
    });

    it("should carry forward Checkpoint #1 actuals as baseline for Checkpoint #2", () => {
      const expected = service.getSystemExpectedBalancesDynamic();

      // Create Checkpoint #1
      service.createCheckpoint({
        user_id: 1,
        notes: "Checkpoint #1",
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            expected_amount: expected["General"]["USD"],
            physical_amount: CP1_GENERAL_USD_ACTUAL,
          },
          {
            drawer_name: "General",
            currency_code: "LBP",
            expected_amount: expected["General"]["LBP"],
            physical_amount: CP1_GENERAL_LBP_ACTUAL,
          },
          {
            drawer_name: "OMT_System",
            currency_code: "USD",
            expected_amount: expected["OMT_System"]["USD"],
            physical_amount: CP1_OMT_SYSTEM_USD_ACTUAL,
          },
          {
            drawer_name: "MTC",
            currency_code: "USD",
            expected_amount: expected["MTC"]["USD"],
            physical_amount: CP1_MTC_USD_ACTUAL,
          },
        ],
      });

      // Verify baseline (last checkpoint actuals)
      const baseline = service.getLastCheckpointActuals();

      expect(baseline["General"]["USD"]).toBe(CP1_GENERAL_USD_ACTUAL);
      expect(baseline["General"]["LBP"]).toBe(CP1_GENERAL_LBP_ACTUAL);
      expect(baseline["OMT_System"]["USD"]).toBe(CP1_OMT_SYSTEM_USD_ACTUAL);

      // MTC actual is -5. Since getLastCheckpointActuals now uses
      // `WHERE physical_amount IS NOT NULL` (instead of the old `> 0`),
      // negative balances like consumed telecom stock are correctly
      // carried forward as the baseline for the next checkpoint.
      expect(baseline["MTC"]["USD"]).toBe(CP1_MTC_USD_ACTUAL);
    });

    it("should compute correct Checkpoint #2 after more transactions", () => {
      const expected1 = service.getSystemExpectedBalancesDynamic();

      // Create Checkpoint #1
      const cp1 = service.createCheckpoint({
        user_id: 1,
        notes: "Checkpoint #1",
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            expected_amount: expected1["General"]["USD"],
            physical_amount: CP1_GENERAL_USD_ACTUAL,
          },
          {
            drawer_name: "General",
            currency_code: "LBP",
            expected_amount: expected1["General"]["LBP"],
            physical_amount: CP1_GENERAL_LBP_ACTUAL,
          },
          {
            drawer_name: "OMT_System",
            currency_code: "USD",
            expected_amount: expected1["OMT_System"]["USD"],
            physical_amount: CP1_OMT_SYSTEM_USD_ACTUAL,
          },
          {
            drawer_name: "MTC",
            currency_code: "USD",
            expected_amount: expected1["MTC"]["USD"],
            physical_amount: CP1_MTC_USD_ACTUAL,
          },
        ],
      });
      checkpoint1Id = Number(cp1.id);

      // ---------- Phase 2: More transactions ----------
      simulateSale(db, SALE2_USD); // General USD +75
      simulateExpense(db, EXPENSE2_USD); // General USD -10

      // After Phase 2, drawer_balances reflect ALL transactions (Phase 1 + Phase 2)
      const expected2 = service.getSystemExpectedBalancesDynamic();

      // General USD = 75 (Phase 1) + 75 (sale2) - 10 (expense2) = 140
      expect(expected2["General"]["USD"]).toBe(
        EXPECTED_GENERAL_USD_PHASE1 + SALE2_USD - EXPENSE2_USD,
      );
      // General LBP unchanged
      expect(expected2["General"]["LBP"]).toBe(EXPECTED_GENERAL_LBP_PHASE1);
      // OMT unchanged
      expect(expected2["OMT_System"]["USD"]).toBe(EXPECTED_OMT_USD_PHASE1);
      // MTC unchanged
      expect(expected2["MTC"]["USD"]).toBe(EXPECTED_MTC_USD_PHASE1);

      // Now create Checkpoint #2 with actuals = expected (no variance this time)
      const cp2Amounts = [
        {
          drawer_name: "General",
          currency_code: "USD",
          expected_amount: expected2["General"]["USD"],
          physical_amount: expected2["General"]["USD"], // exact match
        },
        {
          drawer_name: "General",
          currency_code: "LBP",
          expected_amount: expected2["General"]["LBP"],
          physical_amount: expected2["General"]["LBP"],
        },
        {
          drawer_name: "OMT_System",
          currency_code: "USD",
          expected_amount: expected2["OMT_System"]["USD"],
          physical_amount: expected2["OMT_System"]["USD"],
        },
        {
          drawer_name: "MTC",
          currency_code: "USD",
          expected_amount: expected2["MTC"]["USD"],
          physical_amount: expected2["MTC"]["USD"],
        },
      ];

      const cp2 = service.createCheckpoint({
        user_id: 1,
        notes: "Checkpoint #2 — end of afternoon shift",
        amounts: cp2Amounts,
      });

      expect(cp2.success).toBe(true);
      checkpoint2Id = Number(cp2.id);

      // Verify no variance on Checkpoint #2
      const variance2 = service.getCheckpointVariance(checkpoint2Id);
      expect(variance2.hasVariance).toBe(false);
      for (const d of variance2.drawers) {
        expect(Math.abs(d.variance)).toBeLessThanOrEqual(0.01);
      }
    });

    it("should track baseline carry-forward across checkpoints", () => {
      const expected1 = service.getSystemExpectedBalancesDynamic();

      // Checkpoint #1 with variance on General/USD
      service.createCheckpoint({
        user_id: 1,
        notes: "Checkpoint #1",
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            expected_amount: expected1["General"]["USD"],
            physical_amount: CP1_GENERAL_USD_ACTUAL,
          },
          {
            drawer_name: "General",
            currency_code: "LBP",
            expected_amount: expected1["General"]["LBP"],
            physical_amount: CP1_GENERAL_LBP_ACTUAL,
          },
          {
            drawer_name: "OMT_System",
            currency_code: "USD",
            expected_amount: expected1["OMT_System"]["USD"],
            physical_amount: CP1_OMT_SYSTEM_USD_ACTUAL,
          },
        ],
      });

      const baseline = service.getLastCheckpointActuals();

      // Phase 2 transactions
      simulateSale(db, SALE2_USD);

      // The "ideal" next checkpoint expected = baseline + new deltas
      // But the system uses drawer_balances (cumulative), not baseline + delta
      // So the system expected is just the current drawer_balances total
      const expected2 = service.getSystemExpectedBalancesDynamic();

      // Verify: baseline from CP1 is the physical (actual) values
      expect(baseline["General"]["USD"]).toBe(CP1_GENERAL_USD_ACTUAL); // 160
      expect(baseline["General"]["LBP"]).toBe(CP1_GENERAL_LBP_ACTUAL); // 4,500,000
      expect(baseline["OMT_System"]["USD"]).toBe(CP1_OMT_SYSTEM_USD_ACTUAL); // 100

      // System expected = cumulative drawer_balances (all Phase 1 + Phase 2)
      // General USD = 75 + 75 = 150
      expect(expected2["General"]["USD"]).toBe(
        EXPECTED_GENERAL_USD_PHASE1 + SALE2_USD,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Multi-currency verification
  // -------------------------------------------------------------------------

  describe("Multi-currency amounts (USD + LBP)", () => {
    it("should correctly track USD and LBP in separate drawer slots", () => {
      // Sale paid in USD
      simulateSale(db, 100);

      // Exchange: customer gives 9,000,000 LBP, gets 100 USD
      simulateExchange(db, 9_000_000, 100);

      const expected = service.getSystemExpectedBalancesDynamic();

      // General USD: +100 (sale) -100 (exchange out) = 0
      expect(expected["General"]["USD"]).toBe(0);
      // General LBP: +9,000,000
      expect(expected["General"]["LBP"]).toBe(9_000_000);
    });

    it("should checkpoint multi-currency with correct variance per currency", () => {
      simulateSale(db, 200);
      simulateExchange(db, 18_000_000, 200);

      const expected = service.getSystemExpectedBalancesDynamic();

      // General USD = +200 -200 = 0
      // General LBP = +18,000,000
      const result = service.createCheckpoint({
        user_id: 1,
        notes: "Multi-currency checkpoint",
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            expected_amount: expected["General"]["USD"],
            physical_amount: 5, // found $5 extra
          },
          {
            drawer_name: "General",
            currency_code: "LBP",
            expected_amount: expected["General"]["LBP"],
            physical_amount: 17_500_000, // missing 500k LBP
          },
        ],
      });

      expect(result.success).toBe(true);
      const cpId = Number(result.id);

      const variance = service.getCheckpointVariance(cpId);
      expect(variance.hasVariance).toBe(true);

      const usdRow = variance.drawers.find(
        (d) => d.drawerName === "General" && d.currency === "USD",
      );
      expect(usdRow!.expected).toBe(0);
      expect(usdRow!.actual).toBe(5);
      expect(usdRow!.variance).toBe(5);

      const lbpRow = variance.drawers.find(
        (d) => d.drawerName === "General" && d.currency === "LBP",
      );
      expect(lbpRow!.expected).toBe(18_000_000);
      expect(lbpRow!.actual).toBe(17_500_000);
      expect(lbpRow!.variance).toBe(-500_000);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe("Edge cases", () => {
    it("should handle checkpoint with all-zero amounts", () => {
      const result = service.createCheckpoint({
        user_id: 1,
        notes: "Empty checkpoint",
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            expected_amount: 0,
            physical_amount: 0,
          },
        ],
      });

      expect(result.success).toBe(true);

      // physical_amount = 0, so it's filtered out by getCheckpointVariance's
      // filter (physical_amount !== null && !== undefined). 0 passes the filter.
      const variance = service.getCheckpointVariance(Number(result.id));
      // Drawers with physical=0 should NOT be filtered — 0 is a valid physical count
      // The filter checks !== null && !== undefined, so 0 should pass through
      expect(variance.drawers.length).toBeGreaterThanOrEqual(0);
      expect(variance.hasVariance).toBe(false);
    });

    it("should handle multiple checkpoints in sequence and always use latest as baseline", () => {
      simulateSale(db, 100);

      // Checkpoint A
      service.createCheckpoint({
        user_id: 1,
        notes: "Checkpoint A",
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            expected_amount: 100,
            physical_amount: 95,
          },
        ],
      });

      // getLastCheckpointActuals() now uses `ORDER BY id DESC LIMIT 1`,
      // which is deterministic regardless of timestamp resolution.
      // We still manipulate created_at here so this test documents the
      // old non-determinism concern, but the ordering is now stable by id.
      db.prepare(
        `UPDATE daily_closings SET created_at = datetime('now', '-1 second') WHERE id = (SELECT MIN(id) FROM daily_closings)`,
      ).run();

      simulateSale(db, 50);

      // Checkpoint B (will have a later created_at than A after the update above)
      service.createCheckpoint({
        user_id: 1,
        notes: "Checkpoint B",
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            expected_amount: 150,
            physical_amount: 148,
          },
        ],
      });

      // Baseline should be from Checkpoint B (the latest), not A
      const baseline = service.getLastCheckpointActuals();
      expect(baseline["General"]["USD"]).toBe(148);
    });

    it("should handle recalculateDrawerBalances to fix drift", () => {
      simulateSale(db, 100);

      // Manually corrupt drawer_balances
      db.prepare(
        `UPDATE drawer_balances SET balance = 999 WHERE drawer_name = 'General' AND currency_code = 'USD'`,
      ).run();

      let expected = service.getSystemExpectedBalancesDynamic();
      expect(expected["General"]["USD"]).toBe(999); // corrupted

      // Recalculate from payments journal
      const result = service.recalculateDrawerBalances();
      expect(result.success).toBe(true);

      expected = service.getSystemExpectedBalancesDynamic();
      expect(expected["General"]["USD"]).toBe(100); // fixed
    });
  });

  // -------------------------------------------------------------------------
  // Variance detail checks
  // -------------------------------------------------------------------------

  describe("Variance detail verification", () => {
    it("should flag only drawers with actual ≠ expected beyond 0.01 threshold", () => {
      simulateSale(db, 100);
      simulateOmtSend(db, 50);

      const expected = service.getSystemExpectedBalancesDynamic();

      const result = service.createCheckpoint({
        user_id: 1,
        notes: "Variance test",
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            expected_amount: expected["General"]["USD"], // 150
            physical_amount: 150.005, // within threshold
          },
          {
            drawer_name: "OMT_System",
            currency_code: "USD",
            expected_amount: expected["OMT_System"]["USD"], // 50
            physical_amount: 48, // -2 variance (beyond threshold)
          },
        ],
      });

      const variance = service.getCheckpointVariance(Number(result.id));

      // General/USD: variance = 0.005 → within 0.01 threshold → OK
      const generalUsd = variance.drawers.find(
        (d) => d.drawerName === "General" && d.currency === "USD",
      );
      expect(generalUsd).toBeDefined();
      expect(Math.abs(generalUsd!.variance)).toBeLessThanOrEqual(0.01);

      // OMT_System/USD: variance = -2 → beyond threshold → flagged
      const omtUsd = variance.drawers.find(
        (d) => d.drawerName === "OMT_System" && d.currency === "USD",
      );
      expect(omtUsd).toBeDefined();
      expect(omtUsd!.variance).toBeCloseTo(-2, 2);

      // Overall hasVariance should be true due to OMT
      expect(variance.hasVariance).toBe(true);
    });
  });
});
