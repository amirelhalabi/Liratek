/**
 * RechargeRepository — SMS cost deduction for CREDIT_TRANSFER
 *
 * Verifies that processRecharge() correctly:
 *   - Computes smsCount = ceil(amount / 3) for CREDIT_TRANSFER
 *   - Deducts smsCount × $0.16 from the provider (MTC/Alfa) drawer
 *   - Records the deduction as an SMS_COST payment leg in the payments table
 *   - Reduces profit_usd in the unified transaction by the SMS cost
 *   - Does NOT deduct SMS cost for non-CREDIT_TRANSFER types (DAYS, ALFA_GIFT)
 *
 * All tests run against an in-memory SQLite database. DebtService is mocked.
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetTransactionRepository } from "../TransactionRepository";

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

// ─── Mock DebtService (not exercised in cash-only tests) ─────────────────────

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

// ─── In-memory schema ────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE recharges (
      tenant_id INTEGER DEFAULT 1,
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier                TEXT NOT NULL,
      recharge_type          TEXT NOT NULL,
      amount                 REAL NOT NULL,
      cost                   REAL NOT NULL DEFAULT 0,
      price                  REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL,
      currency_code          TEXT DEFAULT 'USD',
      paid_by                TEXT DEFAULT 'CASH',
      phone_number           TEXT,
      client_id              INTEGER,
      client_name            TEXT,
      note                   TEXT,
      created_by             INTEGER DEFAULT 1,
      created_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
      edited_by              TEXT,
      edited_at              TEXT
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      type         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id    INTEGER NOT NULL,
      user_id      INTEGER NOT NULL DEFAULT 1,
      amount_usd   REAL NOT NULL DEFAULT 0,
      amount_lbp   REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id    INTEGER,
      client_name  TEXT,
      client_phone TEXT,
      reverses_id  INTEGER,
      profit_usd   REAL NOT NULL DEFAULT 0,
      profit_lbp   REAL NOT NULL DEFAULT 0,
      summary      TEXT,
      metadata_json TEXT,
      device_id    TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name    TEXT NOT NULL,
      phone_number TEXT,
      balance_usd  REAL DEFAULT 0,
      balance_lbp  REAL DEFAULT 0,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO drawer_balances VALUES (1, 'MTC',     'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Alfa',    'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 5000, CURRENT_TIMESTAMP);
  `);

  return db;
}

// ─── Query helpers ────────────────────────────────────────────────────────────

function drawerBalance(
  db: Database.Database,
  drawer: string,
  currency: string,
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function smsCostPayments(
  db: Database.Database,
): Array<{ amount: number; drawer_name: string; note: string }> {
  return db
    .prepare(
      "SELECT amount, drawer_name, note FROM payments WHERE method = 'SMS_COST'",
    )
    .all() as Array<{ amount: number; drawer_name: string; note: string }>;
}

function latestTxnProfit(db: Database.Database): {
  profit_usd: number;
  profit_lbp: number;
} {
  return db
    .prepare(
      "SELECT profit_usd, profit_lbp FROM transactions ORDER BY id DESC LIMIT 1",
    )
    .get() as { profit_usd: number; profit_lbp: number };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("RechargeRepository — SMS cost deduction for CREDIT_TRANSFER", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    repo = new RechargeRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SMS cost formula: ceil(amount / 3) × $0.16
  // ═══════════════════════════════════════════════════════════════════════════

  describe("CREDIT_TRANSFER — MTC drawer effects", () => {
    it("deducts $0.16 (1 SMS) for a $3.00 transfer", () => {
      const before = drawerBalance(db, "MTC", "USD");
      repo.processRecharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 3,
        cost: 2.5,
        price: 3.0,
        paid_by_method: "CASH",
        phoneNumber: "03000001",
        userId: 1,
      });
      // stockDelta (-3) + smsCost (-0.16) = -3.16 from MTC drawer
      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(before - 3.16, 4);
    });

    it("deducts $0.32 (2 SMSes) for a $6.00 transfer", () => {
      const before = drawerBalance(db, "MTC", "USD");
      repo.processRecharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 6,
        cost: 5.0,
        price: 6.0,
        paid_by_method: "CASH",
        phoneNumber: "03000002",
        userId: 1,
      });
      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(before - 6.32, 4);
    });

    it("deducts $0.16 (1 SMS, ceiling) for a $1.50 transfer", () => {
      const before = drawerBalance(db, "MTC", "USD");
      repo.processRecharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 1.5,
        cost: 1.2,
        price: 1.5,
        paid_by_method: "CASH",
        phoneNumber: "03000003",
        userId: 1,
      });
      // ceil(1.5 / 3) = 1 SMS
      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(before - 1.66, 4);
    });

    it("deducts $0.48 (3 SMSes) for a $9.00 transfer", () => {
      const before = drawerBalance(db, "MTC", "USD");
      repo.processRecharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 9,
        cost: 7.5,
        price: 9.0,
        paid_by_method: "CASH",
        phoneNumber: "03000004",
        userId: 1,
      });
      // ceil(9 / 3) = 3 SMSes → $0.48
      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(before - 9.48, 4);
    });
  });

  describe("CREDIT_TRANSFER — Alfa drawer effects", () => {
    it("routes the SMS_COST leg to the Alfa drawer for an Alfa transfer", () => {
      const before = drawerBalance(db, "Alfa", "USD");
      repo.processRecharge({
        provider: "Alfa",
        type: "CREDIT_TRANSFER",
        amount: 3,
        cost: 2.5,
        price: 3.0,
        paid_by_method: "CASH",
        phoneNumber: "70000001",
        userId: 1,
      });
      expect(drawerBalance(db, "Alfa", "USD")).toBeCloseTo(before - 3.16, 4);
      const legs = smsCostPayments(db);
      expect(legs).toHaveLength(1);
      expect(legs[0].drawer_name).toBe("Alfa");
    });
  });

  describe("CREDIT_TRANSFER — payments table audit trail", () => {
    it("inserts an SMS_COST payment leg with a negative amount", () => {
      repo.processRecharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 6,
        cost: 5.0,
        price: 6.0,
        paid_by_method: "CASH",
        phoneNumber: "03000010",
        userId: 1,
      });
      const legs = smsCostPayments(db);
      expect(legs).toHaveLength(1);
      expect(legs[0].amount).toBeCloseTo(-0.32, 4);
      expect(legs[0].drawer_name).toBe("MTC");
    });

    it("SMS_COST note includes the SMS count", () => {
      repo.processRecharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 6,
        cost: 5.0,
        price: 6.0,
        paid_by_method: "CASH",
        phoneNumber: "03000011",
        userId: 1,
      });
      const legs = smsCostPayments(db);
      expect(legs[0].note).toContain("2"); // "2 × $0.16"
    });
  });

  describe("CREDIT_TRANSFER — profit_usd in transactions table", () => {
    it("reduces profit_usd by $0.16 for a 1-SMS transfer", () => {
      repo.processRecharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 3,
        cost: 2.5,
        price: 3.0,
        paid_by_method: "CASH",
        phoneNumber: "03000020",
        userId: 1,
      });
      // gross commission: 3.00 − 2.50 = 0.50; net: 0.50 − 0.16 = 0.34
      expect(latestTxnProfit(db).profit_usd).toBeCloseTo(0.34, 4);
    });

    it("reduces profit_usd by $0.32 for a 2-SMS transfer", () => {
      repo.processRecharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 6,
        cost: 5.0,
        price: 6.0,
        paid_by_method: "CASH",
        phoneNumber: "03000021",
        userId: 1,
      });
      // gross: 1.00; net: 1.00 − 0.32 = 0.68
      expect(latestTxnProfit(db).profit_usd).toBeCloseTo(0.68, 4);
    });

    it("leaves profit_lbp at 0 (CREDIT_TRANSFER is USD)", () => {
      repo.processRecharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 3,
        cost: 2.5,
        price: 3.0,
        paid_by_method: "CASH",
        phoneNumber: "03000022",
        userId: 1,
      });
      expect(latestTxnProfit(db).profit_lbp).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Non-CREDIT_TRANSFER types: no SMS deduction
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Non-CREDIT_TRANSFER types: no SMS deduction", () => {
    // A DAYS sale posts no SMS_COST leg AND does not consume its `amount` as
    // credit — `amount` is a DAY COUNT there, so the drawer moves by the days
    // cost only (CARRIER_LINES_VALIDITY_PLAN.md Phase 0). Pre-fix this read
    // `before - 10` for a 10-day sale: the day count charged as dollars.
    // Full coverage of the days-cost leg lives in
    // RechargeRepository.daysStockCost.test.ts.
    it("charges a DAYS recharge the days cost, with no SMS_COST leg", () => {
      const before = drawerBalance(db, "MTC", "USD");
      repo.processRecharge({
        provider: "MTC",
        type: "DAYS",
        amount: 10,
        // What the Days tab submits for 10 days at $0.30: LBP, at the
        // `alfa_credit_cost_lbp` rate (85,000 — this DB has no
        // system_settings table, so the named fallback applies).
        cost: 0.3 * 85_000,
        price: 100_000,
        currency: "LBP",
        paid_by_method: "CASH",
        phoneNumber: "03111111",
        userId: 1,
      });
      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(before - 0.3, 4);
      expect(smsCostPayments(db)).toHaveLength(0);
    });

    it("does NOT deduct SMS cost for ALFA_GIFT", () => {
      const before = drawerBalance(db, "Alfa", "USD");
      repo.processRecharge({
        provider: "Alfa",
        type: "ALFA_GIFT",
        amount: 3.5,
        cost: 3.0,
        price: 3.5,
        paid_by_method: "CASH",
        phoneNumber: "70111111",
        userId: 1,
      });
      expect(drawerBalance(db, "Alfa", "USD")).toBeCloseTo(before - 3.5, 4);
      expect(smsCostPayments(db)).toHaveLength(0);
    });

    it("does NOT deduct SMS cost for TOP_UP", () => {
      const before = drawerBalance(db, "MTC", "USD");
      repo.processRecharge({
        provider: "MTC",
        type: "TOP_UP",
        amount: 5,
        cost: 4.0,
        price: 5.0,
        paid_by_method: "CASH",
        phoneNumber: "03222222",
        userId: 1,
      });
      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(before - 5, 4);
      expect(smsCostPayments(db)).toHaveLength(0);
    });

    it("stores the full gross commission in profit_usd for a DAYS recharge", () => {
      repo.processRecharge({
        provider: "MTC",
        type: "DAYS",
        amount: 10,
        cost: 8.0,
        price: 10.0,
        paid_by_method: "CASH",
        phoneNumber: "03333333",
        userId: 1,
      });
      // No SMS deduction → full gross profit stored
      expect(latestTxnProfit(db).profit_usd).toBeCloseTo(2.0, 4);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LBP-priced CREDIT_TRANSFER — SMS cost must be CONVERTED before subtracting
  // (profit-audit fix 3). Pre-fix the USD SMS cost was subtracted from the LBP
  // commission verbatim: 60,000 LBP − $0.32 = 59,999.68 "LBP" — the deduction
  // effectively vanished (understated cost, overstated profit).
  // ═══════════════════════════════════════════════════════════════════════════

  describe("CREDIT_TRANSFER — LBP-priced transfer converts the SMS cost", () => {
    it("subtracts smsCostUsd × sellRate from profit_lbp (2 SMS at fallback 89,500)", () => {
      // 6 USD credits sent, priced 600,000 LBP, cost 540,000 LBP.
      // smsCount = ceil(6/3) = 2 → $0.32 → × 89,500 = 28,640 LBP.
      repo.processRecharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 6,
        cost: 540_000,
        price: 600_000,
        currency: "LBP",
        paid_by_method: "CASH",
        phoneNumber: "03444444",
        userId: 1,
      });
      const profit = latestTxnProfit(db);
      // gross 60,000 LBP − 28,640 LBP = 31,360 LBP
      expect(profit.profit_lbp).toBeCloseTo(60_000 - 0.32 * 89_500, 2);
      expect(profit.profit_usd).toBe(0);
    });
  });
});
