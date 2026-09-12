/**
 * RechargeRepository — SMS transfer fee for CREDIT_TRANSFER
 *
 * Owner decision 2026-09-06: the SMS transfer fee no longer nets against
 * recharge profit — it is booked as its own `SMS_Transfer_Fee` expense
 * (ExpenseRepository.createExpense, LIRA-145 Line_Usage precedent).
 *
 * Verifies that processRecharge() correctly:
 *   - Computes smsCount = ceil(amount / 3) for CREDIT_TRANSFER
 *   - Deducts smsCount × $0.16 from the provider (MTC/Alfa) drawer EXACTLY
 *     ONCE — via the SMS expense's own drawer_override leg, not a payment
 *     leg on the recharge's own transaction (the pre-cutover shape)
 *   - Records the deduction as an SMS_COST payment leg in the payments table
 *   - Books an `SMS_Transfer_Fee` expense row linked back to the recharge
 *     via source_ref_table/source_ref_id (migration v166, rule 20)
 *   - Stores the FULL GROSS commission in profit_usd/profit_lbp — the SMS
 *     fee no longer reduces it
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
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetCarrierLineRepository } from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineService } from "../../services/CarrierLineService";

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
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

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

    -- carrier_lines/carrier_line_movements (v140, LIRA-090) — matching
    -- create_db.sql's definition exactly. Needed because a DAYS sale now
    -- looks up the shop's primary carrier line (LIRA-113); no row is
    -- inserted here on purpose, so getPrimary() returns null and the
    -- "no primary carrier line configured" warn+skip branch runs (this
    -- file only asserts SMS-cost/drawer behaviour, not validity).
    CREATE TABLE carrier_lines (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER DEFAULT 1,
      carrier             TEXT NOT NULL CHECK(carrier IN ('alfa', 'mtc')),
      phone_number        TEXT NOT NULL,
      label               TEXT,
      credits             REAL NOT NULL DEFAULT 0,
      validity_expires_at TEXT,
      notes               TEXT,
      is_active           INTEGER NOT NULL DEFAULT 1,
      is_primary          INTEGER NOT NULL DEFAULT 0,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_carrier_lines_carrier ON carrier_lines(carrier);
    CREATE INDEX idx_carrier_lines_tenant_id ON carrier_lines(tenant_id);
    CREATE UNIQUE INDEX idx_carrier_lines_one_primary_per_carrier
      ON carrier_lines(tenant_id, carrier)
      WHERE is_primary = 1;

    -- expenses (migration v166 shape) — needed because the SMS transfer fee
    -- now books through ExpenseRepository.createExpense instead of a bare
    -- payment leg on the recharge's own transaction.
    CREATE TABLE expenses (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id         INTEGER DEFAULT 1,
      description       TEXT,
      category          TEXT,
      expense_type      TEXT,
      amount_usd        DECIMAL(10, 2),
      amount_lbp        DECIMAL(15, 2),
      paid_by_method    TEXT DEFAULT 'CASH',
      status            TEXT NOT NULL DEFAULT 'active',
      expense_date      DATETIME DEFAULT CURRENT_TIMESTAMP,
      note              TEXT DEFAULT NULL,
      edited_by         TEXT DEFAULT NULL,
      edited_at         TEXT DEFAULT NULL,
      is_refunded       INTEGER DEFAULT 0,
      refunded_at       TEXT DEFAULT NULL,
      source_ref_table  TEXT DEFAULT NULL,
      source_ref_id     INTEGER DEFAULT NULL,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE carrier_line_movements (
      id                           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                    INTEGER DEFAULT 1,
      carrier_line_id              INTEGER NOT NULL,
      transaction_id               INTEGER,
      credits_delta                REAL NOT NULL DEFAULT 0,
      validity_days_delta          INTEGER NOT NULL DEFAULT 0,
      previous_validity_expires_at TEXT,
      reason                       TEXT NOT NULL,
      is_reversed                  INTEGER NOT NULL DEFAULT 0,
      created_at                   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at                   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_carrier_line_movements_tenant_id ON carrier_line_movements(tenant_id);
    CREATE INDEX idx_carrier_line_movements_carrier_line_id ON carrier_line_movements(carrier_line_id);
    CREATE INDEX idx_carrier_line_movements_transaction_id ON carrier_line_movements(transaction_id);

    INSERT INTO drawer_balances VALUES (1, 'MTC',     'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Alfa',    'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General', 'USD', 5000, CURRENT_TIMESTAMP);

    -- Void-path support tables (empty in every test — only present so
    -- TransactionRepository's generic void/refund queries against them
    -- don't fail with "no such table"). Same shape as
    -- ModuleStoreCreditReversal.test.ts, which already exercises void on a
    -- CREDIT_TRANSFER recharge with this exact table set.
    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      session_id       INTEGER,
      note             TEXT,
      due_date         TEXT,
      created_by       INTEGER,
      is_refunded      INTEGER DEFAULT 0,
      refunded_at      TEXT,
      covered_usd      REAL NOT NULL DEFAULT 0,
      covered_lbp      REAL NOT NULL DEFAULT 0,
      tenant_id        INTEGER DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      provider  TEXT
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id              INTEGER DEFAULT 1,
      final_amount_usd       REAL NOT NULL DEFAULT 0,
      paid_usd               REAL NOT NULL DEFAULT 0,
      paid_lbp               REAL NOT NULL DEFAULT 0,
      exchange_rate_snapshot REAL,
      status                 TEXT NOT NULL DEFAULT 'completed',
      created_at             TEXT DEFAULT CURRENT_TIMESTAMP
    );
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
  // The RECHARGE transaction, not the SMS expense's own EXPENSE transaction
  // (which is created afterward and would otherwise be "latest").
  return db
    .prepare(
      "SELECT profit_usd, profit_lbp FROM transactions WHERE type = 'RECHARGE' ORDER BY id DESC LIMIT 1",
    )
    .get() as { profit_usd: number; profit_lbp: number };
}

function smsExpenses(db: Database.Database): Array<{
  amount_usd: number;
  amount_lbp: number;
  category: string;
  source_ref_table: string | null;
  source_ref_id: number | null;
}> {
  return db
    .prepare(
      "SELECT amount_usd, amount_lbp, category, source_ref_table, source_ref_id FROM expenses WHERE category = 'SMS_Transfer_Fee'",
    )
    .all() as Array<{
    amount_usd: number;
    amount_lbp: number;
    category: string;
    source_ref_table: string | null;
    source_ref_id: number | null;
  }>;
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
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    repo = new RechargeRepository();
  });

  afterEach(() => {
    resetTenantContext();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
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

  describe("CREDIT_TRANSFER — profit_usd in transactions table (GROSS, owner decision 2026-09-06)", () => {
    it("stores the FULL gross commission for a 1-SMS transfer — SMS fee no longer nets against it", () => {
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
      // gross commission: 3.00 − 2.50 = 0.50 (was 0.34 net pre-cutover)
      expect(latestTxnProfit(db).profit_usd).toBeCloseTo(0.5, 4);
    });

    it("stores the FULL gross commission for a 2-SMS transfer — SMS fee no longer nets against it", () => {
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
      // gross: 1.00 (was 0.68 net pre-cutover)
      expect(latestTxnProfit(db).profit_usd).toBeCloseTo(1.0, 4);
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

  describe("CREDIT_TRANSFER — SMS fee books as its own expense (rule 20 link)", () => {
    it("creates an SMS_Transfer_Fee expense for $0.16, linked to the recharge", () => {
      repo.processRecharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 3,
        cost: 2.5,
        price: 3.0,
        paid_by_method: "CASH",
        phoneNumber: "03000023",
        userId: 1,
      });
      const rechargeId = (
        db
          .prepare("SELECT id FROM recharges ORDER BY id DESC LIMIT 1")
          .get() as {
          id: number;
        }
      ).id;
      const expenses = smsExpenses(db);
      expect(expenses).toHaveLength(1);
      expect(expenses[0].amount_usd).toBeCloseTo(0.16, 4);
      expect(expenses[0].amount_lbp).toBe(0);
      expect(expenses[0].source_ref_table).toBe("recharges");
      expect(expenses[0].source_ref_id).toBe(rechargeId);
    });

    it("does not create an SMS_Transfer_Fee expense for a non-CREDIT_TRANSFER type", () => {
      repo.processRecharge({
        provider: "MTC",
        type: "DAYS",
        amount: 10,
        cost: 0.3 * 85_000,
        price: 100_000,
        currency: "LBP",
        paid_by_method: "CASH",
        phoneNumber: "03000024",
        userId: 1,
      });
      expect(smsExpenses(db)).toHaveLength(0);
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
  // LBP-priced CREDIT_TRANSFER — the SMS fee is a USD figure; it is booked to
  // its OWN expense (still USD, never converted/mixed into profit_lbp) rather
  // than netted against the LBP commission. Owner decision 2026-09-06
  // superseded the older "convert before subtracting" fix — the conversion
  // question no longer applies because nothing is subtracted from profit_lbp
  // at all.
  // ═══════════════════════════════════════════════════════════════════════════

  describe("CREDIT_TRANSFER — LBP-priced transfer: gross profit_lbp, SMS fee expensed in USD", () => {
    it("stores the FULL gross commission in profit_lbp, with the SMS fee booked as a separate USD expense", () => {
      // 6 USD credits sent, priced 600,000 LBP, cost 540,000 LBP.
      // smsCount = ceil(6/3) = 2 → $0.32.
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
      // gross 600,000 − 540,000 = 60,000 LBP, untouched by the SMS fee.
      expect(profit.profit_lbp).toBeCloseTo(60_000, 2);
      expect(profit.profit_usd).toBe(0);

      const expenses = smsExpenses(db);
      expect(expenses).toHaveLength(1);
      expect(expenses[0].amount_usd).toBeCloseTo(0.32, 4);
      expect(expenses[0].amount_lbp).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Drawer-moves-exactly-once guard (owner's explicit ask): the SMS expense's
  // own drawer_override leg must move the provider drawer by the EXACT same
  // magnitude the pre-cutover direct payment leg used to — not on top of it.
  // ═══════════════════════════════════════════════════════════════════════════

  describe("CREDIT_TRANSFER — provider drawer moves by the SAME magnitude as the pre-cutover leg (double-debit guard)", () => {
    it("MTC drawer moves by exactly -3.16 for a $3 transfer (stock -3.00 + SMS -0.16), never -3.32", () => {
      const before = drawerBalance(db, "MTC", "USD");
      repo.processRecharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 3,
        cost: 2.5,
        price: 3.0,
        paid_by_method: "CASH",
        phoneNumber: "03000030",
        userId: 1,
      });
      const delta = drawerBalance(db, "MTC", "USD") - before;
      // This is the exact magnitude the pre-cutover direct
      // insertPayment/upsertBalanceDelta pair produced (see the deleted
      // "deducts $0.16 (1 SMS) for a $3.00 transfer" assertion this test
      // reproduces) — proving the money moves through the expense's own leg
      // INSTEAD OF the old leg, not IN ADDITION TO it.
      expect(delta).toBeCloseTo(-3.16, 4);
      // Exactly ONE SMS_COST leg posted against the MTC drawer — a
      // double-debit would show 2.
      const smsLegs = db
        .prepare(
          `SELECT COUNT(*) AS n FROM payments WHERE drawer_name = 'MTC' AND method = 'SMS_COST'`,
        )
        .get() as { n: number };
      expect(smsLegs.n).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Rule 20 proof: create → void nets every touched ledger to exactly zero,
  // per currency. This is the executable proof that
  // TransactionRepository._cascadeExpenseSiblingVoid actually reverses the
  // SMS expense sibling when the recharge is voided — not just that the
  // expense was created.
  // ═══════════════════════════════════════════════════════════════════════════

  describe("CREDIT_TRANSFER — create then void nets every ledger to zero (rule 20)", () => {
    function rechargeTxnId(db: Database.Database): number {
      return (
        db
          .prepare(
            `SELECT id FROM transactions WHERE type = 'RECHARGE' AND status = 'ACTIVE' ORDER BY id DESC LIMIT 1`,
          )
          .get() as { id: number }
      ).id;
    }

    function expenseRow(db: Database.Database): {
      id: number;
      is_refunded: number;
      amount_usd: number;
    } {
      return db
        .prepare(
          `SELECT id, is_refunded, amount_usd FROM expenses WHERE category = 'SMS_Transfer_Fee' ORDER BY id DESC LIMIT 1`,
        )
        .get() as { id: number; is_refunded: number; amount_usd: number };
    }

    it("MTC $6 CREDIT_TRANSFER (2 SMS): void nets the MTC drawer to 0 and refunds the SMS expense", () => {
      const mtcBefore = drawerBalance(db, "MTC", "USD");
      const generalBefore = drawerBalance(db, "General", "USD");

      const result = repo.processRecharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 6,
        cost: 5.0,
        price: 6.0,
        paid_by_method: "CASH",
        phoneNumber: "03000040",
        userId: 1,
      });
      expect(result.success).toBe(true);

      // Sanity: the create side did move money and did book the expense —
      // otherwise "nets to zero" would be trivially true for the wrong
      // reason (nothing moved in the first place).
      expect(drawerBalance(db, "MTC", "USD")).not.toBeCloseTo(mtcBefore, 4);
      expect(drawerBalance(db, "General", "USD")).not.toBeCloseTo(
        generalBefore,
        4,
      );
      const expenseBeforeVoid = expenseRow(db);
      expect(expenseBeforeVoid.is_refunded).toBe(0);
      expect(expenseBeforeVoid.amount_usd).toBeCloseTo(0.32, 4);

      const txnRepo = new TransactionRepository();
      txnRepo.voidTransaction(rechargeTxnId(db), 1);

      // Every drawer touched by create() is back to its pre-create balance —
      // MTC (stock + SMS fee) AND General (customer cash), per currency.
      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(mtcBefore, 4);
      expect(drawerBalance(db, "General", "USD")).toBeCloseTo(generalBefore, 4);

      // The SMS expense sibling was cascade-voided (rule 20) — soft-voided
      // via the SAME _markSourceRefunded machinery every other expense void
      // uses.
      const expenseAfterVoid = expenseRow(db);
      expect(expenseAfterVoid.is_refunded).toBe(1);

      // Every payments leg tied to the MTC drawer nets to zero: the original
      // stock (-6) + SMS (-0.32) + their two void-reversal legs (+6 + 0.32).
      const mtcLegSum = db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE drawer_name = 'MTC' AND currency_code = 'USD'`,
        )
        .get() as { total: number };
      expect(mtcLegSum.total).toBeCloseTo(0, 4);

      // Void does NOT negate profit_usd on a reversal row (only refund
      // does — the real invariant, matching ProfitRepository's own
      // aggregate queries which all filter `status = 'ACTIVE'`, e.g.
      // `getCounterpartyDiscountTotals` — see ProfitRepository.ts:1378): the
      // VOIDED original still carries its stamped 1.00, but no longer
      // contributes to any ACTIVE-only profit read.
      const activeProfitSum = db
        .prepare(
          `SELECT COALESCE(SUM(profit_usd), 0) AS total FROM transactions WHERE source_table = 'recharges' AND source_id = ? AND status = 'ACTIVE'`,
        )
        .get(
          (
            db
              .prepare(`SELECT id FROM recharges ORDER BY id DESC LIMIT 1`)
              .get() as { id: number }
          ).id,
        ) as { total: number };
      expect(activeProfitSum.total).toBeCloseTo(0, 4);
    });

    it("LBP-priced MTC CREDIT_TRANSFER: void nets General LBP, MTC USD, and profit_lbp all to 0", () => {
      const mtcBefore = drawerBalance(db, "MTC", "USD");

      const result = repo.processRecharge({
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 6,
        cost: 540_000,
        price: 600_000,
        currency: "LBP",
        paid_by_method: "CASH",
        phoneNumber: "03000041",
        userId: 1,
      });
      expect(result.success).toBe(true);
      expect(drawerBalance(db, "MTC", "USD")).not.toBeCloseTo(mtcBefore, 4);

      const txnRepo = new TransactionRepository();
      txnRepo.voidTransaction(rechargeTxnId(db), 1);

      expect(drawerBalance(db, "MTC", "USD")).toBeCloseTo(mtcBefore, 4);
      expect(expenseRow(db).is_refunded).toBe(1);

      // Same ACTIVE-only invariant as the USD case above.
      const activeProfitSum = db
        .prepare(
          `SELECT COALESCE(SUM(profit_lbp), 0) AS total FROM transactions WHERE source_table = 'recharges' AND source_id = ? AND status = 'ACTIVE'`,
        )
        .get(
          (
            db
              .prepare(`SELECT id FROM recharges ORDER BY id DESC LIMIT 1`)
              .get() as { id: number }
          ).id,
        ) as { total: number };
      expect(activeProfitSum.total).toBeCloseTo(0, 4);
    });
  });
});
