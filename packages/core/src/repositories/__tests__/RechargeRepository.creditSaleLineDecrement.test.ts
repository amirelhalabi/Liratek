/**
 * BUG REPRO — owner report #22 (2026-09-23, web app): "set mtc drawer
 * amount -> sell credits -> check dashboard [affected correctly], check
 * settings-shop lines, the shop line that should be affected, is not
 * affected, the amount is showing the old amount and not deduced by the
 * sold credits — same in mtc page. make sure this fix is applied on alfa
 * shop line too."
 *
 * Root cause (traced in source before this fix): `RechargeRepository
 * .processRecharge` debits the MTC/Alfa provider DRAWER for every credit-
 * consuming sale (`telecomStockLeg`) but, before this fix, NEVER touched
 * the shop's own `carrier_lines.credits` for a CREDIT_TRANSFER/VOUCHER/
 * TOP_UP/ALFA_GIFT sale — only the DAYS arm (LIRA-113) moved anything on
 * the line, and that only moved *validity*, never credits. The §0.1 sum
 * invariant (`drawer_balances[carrier][USD] == Σ credits of that carrier's
 * active lines`) was therefore never built for a credit sale — plan §0.6
 * explicitly grandfathered this gap "until multi-line ships." This ticket
 * closes it.
 *
 * This is the DIRECT cause of owner report #10 (`RechargeRepository
 * .creditBuyback.driftAttribution.test.ts`) — every unrecorded credit sale
 * left the line's balance too HIGH relative to the drawer, and the buy-back
 * path folded that accumulated drift into the customer's own transaction.
 *
 * Harness copied from `RechargeRepository.daysChargeValidityDecrement
 * .test.ts` (same hand-rolled schema, same `__LIRATEK_TEST_DB__` global
 * this repo's `BaseRepository`/`getDatabase()` picks up in test mode).
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

    -- Needed by the void path (_cancelDebt / _markSourceRefunded); empty here.
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

describe("RechargeRepository — a credit sale must decrement the shop's OWN carrier line credits (owner report #22, 2026-09-23)", () => {
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

  it("selling $3 of MTC credits decrements the shop's primary MTC line from 50 to 47", () => {
    const shopLine = carrierLineRepo.createLine({
      carrier: "mtc",
      phone_number: "03999999", // the SHOP'S OWN line
      credits: 50,
      validity_expires_at: FUTURE_EXPIRY,
    });
    expect(shopLine.is_primary).toBe(1);
    expect(getLineCredits(db, shopLine.id)).toBe(50);

    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 3,
      cost: 2.5,
      price: 3,
      currency: "USD",
      paid_by_method: "CASH",
      phoneNumber: "03123456", // the CUSTOMER's own phone
      userId: 1,
    });
    expect(result.success).toBe(true);

    // THE BUG (pre-fix): this read 50, unchanged — Settings → Shop Lines and
    // the MTC Recharge-tab panel kept showing the line's original balance no
    // matter how many credits were sold.
    expect(getLineCredits(db, shopLine.id)).toBe(47);
  });

  it("selling $5 of Alfa credits decrements the shop's primary Alfa line from 50 to 45", () => {
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

    expect(getLineCredits(db, shopLine.id)).toBe(45);
  });

  it("voiding a credit sale restores the line's credits AND the drawer to their pre-sale values", () => {
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
    expect(getLineCredits(db, shopLine.id)).toBe(47);
    // -3 for the credit value + -0.16 for the 1-message SMS transfer fee
    // (ceil(3/3) messages * SMS_TRANSFER_FEE_USD) the CREDIT_TRANSFER also
    // books as its own sibling expense against the same MTC drawer.
    expect(drawerBalance(db, "MTC")).toBeCloseTo(beforeDrawer - 3 - 0.16, 6);

    const txn = db
      .prepare(`SELECT id FROM transactions WHERE type = 'RECHARGE'`)
      .get() as { id: number };
    getTransactionRepository().voidTransaction(txn.id, 1);

    expect(getLineCredits(db, shopLine.id)).toBe(50);
    expect(drawerBalance(db, "MTC")).toBeCloseTo(beforeDrawer, 6);
    expect(drawerBalance(db, "General")).toBeCloseTo(beforeGeneral, 6);

    const movement = db
      .prepare(
        `SELECT * FROM carrier_line_movements WHERE carrier_line_id = ?`,
      )
      .get(shopLine.id) as { is_reversed: number };
    expect(movement.is_reversed).toBe(1);
  });

  it("no primary line configured: the sale still succeeds (drawer leg posts) and only logs a warning — mirrors the DAYS arm's established convention", () => {
    // No carrier_lines row created at all for MTC.
    const result = repo.processRecharge({
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 3,
      cost: 2.5,
      price: 3,
      currency: "USD",
      paid_by_method: "CASH",
      phoneNumber: "03123459",
      userId: 1,
    });
    expect(result.success).toBe(true);
    expect(
      (db.prepare(`SELECT COUNT(*) c FROM carrier_line_movements`).get() as {
        c: number;
      }).c,
    ).toBe(0);
  });
});
