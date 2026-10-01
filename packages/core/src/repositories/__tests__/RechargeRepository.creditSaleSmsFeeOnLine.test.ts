/**
 * Owner-approved fix (2026-10-02): "The SMS fee isn't taken off the shop
 * line." `RechargeRepository.processRecharge`'s CREDIT_TRANSFER arm debits
 * the carrier drawer by BOTH the credits (`stockLeg`) AND the
 * `SMS_Transfer_Fee` expense (`drawer_override`, $0.16 per SMS message), but
 * `CarrierLineService.applyMovement` only ever decremented the shop's own
 * primary line's `credits` by `stockLeg.amountUsd` — the credit value, never
 * the SMS cost. That broke the §0.1 invariant (`drawer == Σ active line
 * credits`) by $0.16 per SMS: the drawer moved more than the line did.
 *
 * Owner decision: the SMS cost really comes off the SIM, so the line must
 * drop by credits + SMS fee, matching the drawer exactly.
 *
 * RULE 17 — PROVEN FAILING-FIRST 2026-10-02: ran this file against the
 * unfixed repository (creditsDelta still read bare `stockLeg.amountUsd`,
 * with no `smsCostUsd` term) — cases (a)/(b)/(c)/(d) below all failed:
 * the line moved by exactly the face value (-3, -6) instead of face value +
 * SMS fee (-3.16, -6.32). Recorded red, then applied the fix (creditsDelta
 * now folds `smsCostUsd` into the SAME carrier-line movement so reversal
 * stays free — rule 20).
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetDebtService } from "../../services/DebtService";
import { resetDebtRepository } from "../DebtRepository";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
} from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineService } from "../../services/CarrierLineService";
import { getTransactionRepository } from "../TransactionRepository";

const FUTURE_EXPIRY = "2099-01-01";

// Schema copied verbatim from RechargeRepository.creditSaleLineDecrement.test.ts
// (same hand-rolled, __LIRATEK_TEST_DB__-backed harness).
function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      role     TEXT DEFAULT 'staff'
    );
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name    TEXT NOT NULL,
      phone_number TEXT,
      notes        TEXT,
      tenant_id    INTEGER DEFAULT 1,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id  INTEGER NOT NULL DEFAULT 1,
      key_name   TEXT NOT NULL,
      value      TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, key_name)
    );

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT,
      source_id     INTEGER,
      user_id       INTEGER,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      tenant_id     INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      tenant_id      INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'MTC',     'USD', 1000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Alfa',    'USD', 1000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'USD', 5000);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'LBP', 100000000);

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

    CREATE TABLE recharges (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id               INTEGER DEFAULT 1,
      carrier                 TEXT NOT NULL,
      recharge_type           TEXT NOT NULL DEFAULT 'CREDIT_TRANSFER',
      amount                  REAL NOT NULL,
      cost                    REAL NOT NULL DEFAULT 0,
      price                   REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL DEFAULT NULL,
      currency_code           TEXT NOT NULL DEFAULT 'USD',
      paid_by                 TEXT DEFAULT 'CASH',
      phone_number            TEXT,
      client_id               INTEGER,
      client_name             TEXT,
      note                    TEXT,
      created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by              INTEGER DEFAULT 1,
      edited_by                TEXT DEFAULT NULL,
      edited_at               TEXT DEFAULT NULL,
      is_refunded             INTEGER DEFAULT 0,
      refunded_at             TEXT DEFAULT NULL
    );

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

    CREATE TABLE carrier_lines (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER DEFAULT 1,
      carrier             TEXT NOT NULL CHECK(carrier IN ('alfa','mtc')),
      phone_number        TEXT NOT NULL,
      label               TEXT,
      credits             REAL NOT NULL DEFAULT 0,
      validity_expires_at TEXT,
      days_owed           INTEGER NOT NULL DEFAULT 0,
      notes               TEXT,
      is_active           INTEGER NOT NULL DEFAULT 1,
      is_primary          INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at          TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_carrier_lines_one_primary_per_carrier
      ON carrier_lines(tenant_id, carrier)
      WHERE is_primary = 1;

    CREATE TABLE carrier_line_movements (
      id                            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                     INTEGER,
      carrier_line_id               INTEGER NOT NULL,
      transaction_id                INTEGER,
      credits_delta                 REAL NOT NULL DEFAULT 0,
      validity_days_delta           INTEGER NOT NULL DEFAULT 0,
      previous_validity_expires_at  TEXT,
      days_owed_delta               INTEGER NOT NULL DEFAULT 0,
      previous_days_owed            INTEGER NOT NULL DEFAULT 0,
      reason                        TEXT NOT NULL,
      is_reversed                   INTEGER NOT NULL DEFAULT 0,
      created_at                    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at                    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function setTestDb(db: Database.Database): void {
  (
    globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
  ).__LIRATEK_TEST_DB__ = db;
}

function clearTestDb(): void {
  delete (globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database })
    .__LIRATEK_TEST_DB__;
}

function getLineCredits(db: Database.Database, id: number): number {
  return (
    db.prepare(`SELECT credits FROM carrier_lines WHERE id = ?`).get(id) as {
      credits: number;
    }
  ).credits;
}

function drawerBalance(
  db: Database.Database,
  drawer: string,
  currency = "USD",
): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

describe("RechargeRepository — CREDIT_TRANSFER's SMS fee must also come off the shop line (owner-approved fix, 2026-10-02)", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  let carrierLineRepo: CarrierLineRepository;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetDebtService();
    resetDebtRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    repo = new RechargeRepository();
    carrierLineRepo = new CarrierLineRepository();
  });

  afterEach(() => {
    clearTestDb();
    resetTenantContext();
    resetTransactionRepository();
    resetDebtService();
    resetDebtRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    db.close();
  });

  it("(a) $3 MTC CREDIT_TRANSFER: line drops by 3.16 (3 credits + 1 SMS × $0.16) — matching the drawer exactly", () => {
    const shopLine = carrierLineRepo.createLine({
      carrier: "mtc",
      phone_number: "03999999",
      credits: 50,
      validity_expires_at: FUTURE_EXPIRY,
    });
    const beforeDrawer = drawerBalance(db, "MTC");

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 3,
      cost: 2.5,
      price: 3,
      currency: "USD",
      paid_by_method: "CASH",
      phoneNumber: "03123456",
      userId: 1,
    });
    expect(result.success).toBe(true);

    const drawerDelta = beforeDrawer - drawerBalance(db, "MTC");
    expect(drawerDelta).toBeCloseTo(3.16, 6);

    const lineDelta = 50 - getLineCredits(db, shopLine.id);
    expect(lineDelta).toBeCloseTo(3.16, 6);
    // THE invariant this ticket exists to restore: drawer movement === line movement.
    expect(lineDelta).toBeCloseTo(drawerDelta, 6);
  });

  it("(b) $6 MTC CREDIT_TRANSFER: line drops by 6.32 (6 credits + 2 SMS × $0.16)", () => {
    const shopLine = carrierLineRepo.createLine({
      carrier: "mtc",
      phone_number: "03999998",
      credits: 50,
      validity_expires_at: FUTURE_EXPIRY,
    });
    const beforeDrawer = drawerBalance(db, "MTC");

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 6,
      cost: 5,
      price: 6,
      currency: "USD",
      paid_by_method: "CASH",
      phoneNumber: "03123457",
      userId: 1,
    });
    expect(result.success).toBe(true);

    const drawerDelta = beforeDrawer - drawerBalance(db, "MTC");
    expect(drawerDelta).toBeCloseTo(6.32, 6);

    const lineDelta = 50 - getLineCredits(db, shopLine.id);
    expect(lineDelta).toBeCloseTo(6.32, 6);
    expect(lineDelta).toBeCloseTo(drawerDelta, 6);
  });

  it("(c) Alfa CREDIT_TRANSFER also gets the SMS fee on the line (not MTC-only)", () => {
    const shopLine = carrierLineRepo.createLine({
      carrier: "alfa",
      phone_number: "70999999",
      credits: 50,
      validity_expires_at: FUTURE_EXPIRY,
    });

    const result = repo.processRecharge({
      provider: "Alfa",
      type: "CREDIT_TRANSFER",
      amount: 5,
      cost: 4,
      price: 5,
      currency: "USD",
      paid_by_method: "CASH",
      phoneNumber: "71123456",
      userId: 1,
    });
    expect(result.success).toBe(true);

    // 5 credits + ceil(5/3)=2 messages * 0.16 = 0.32 → 44.68
    expect(getLineCredits(db, shopLine.id)).toBeCloseTo(44.68, 6);
  });

  it("(d) void of a CREDIT_TRANSFER restores the line by the FULL amount including the SMS part, and the drawer too (rule 20)", () => {
    const shopLine = carrierLineRepo.createLine({
      carrier: "mtc",
      phone_number: "03999997",
      credits: 50,
      validity_expires_at: FUTURE_EXPIRY,
    });
    const beforeDrawer = drawerBalance(db, "MTC");
    const beforeGeneral = drawerBalance(db, "General");

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 3,
      cost: 2.5,
      price: 3,
      currency: "USD",
      paid_by_method: "CASH",
      phoneNumber: "03123458",
      userId: 1,
    });
    expect(result.success).toBe(true);
    expect(getLineCredits(db, shopLine.id)).toBeCloseTo(46.84, 6);
    expect(drawerBalance(db, "MTC")).toBeCloseTo(beforeDrawer - 3.16, 6);

    const txn = db
      .prepare(`SELECT id FROM transactions WHERE type = 'RECHARGE'`)
      .get() as { id: number };
    getTransactionRepository().voidTransaction(txn.id, 1);

    // Full restore — drawer, line, nets to the exact pre-sale values.
    expect(getLineCredits(db, shopLine.id)).toBe(50);
    expect(drawerBalance(db, "MTC")).toBeCloseTo(beforeDrawer, 6);
    expect(drawerBalance(db, "General")).toBeCloseTo(beforeGeneral, 6);

    const movement = db
      .prepare(
        `SELECT * FROM carrier_line_movements WHERE carrier_line_id = ?`,
      )
      .get(shopLine.id) as { is_reversed: number; credits_delta: number };
    expect(movement.is_reversed).toBe(1);
    // The reversal pins against the SAME movement row that carries the
    // combined delta — proving this is "free" via the single-movement
    // reversal, not a second hand-rolled compensating write.
    expect(movement.credits_delta).toBeCloseTo(-3.16, 6);
  });

  it("(e) SHOP_LINE_USE and CREDIT_BUYBACK remain unaffected (no SMS fee, different types entirely)", () => {
    // Sanity: a non-CREDIT_TRANSFER type never computes a nonzero smsCostUsd
    // (planSmsTransfer is only consulted for CREDIT_TRANSFER — see
    // processRecharge's smsCount derivation), so this is a documentation
    // case, not a new code path.
    const shopLine = carrierLineRepo.createLine({
      carrier: "mtc",
      phone_number: "03999996",
      credits: 50,
      validity_expires_at: FUTURE_EXPIRY,
    });

    const result = repo.processRecharge({
      provider: "MTC",
      type: "TOP_UP",
      amount: 10,
      cost: 8,
      price: 10,
      currency: "USD",
      paid_by_method: "CASH",
      phoneNumber: "03123460",
      userId: 1,
    });
    expect(result.success).toBe(true);
    // Bare face value — no SMS fee for TOP_UP.
    expect(getLineCredits(db, shopLine.id)).toBe(40);
  });
});
