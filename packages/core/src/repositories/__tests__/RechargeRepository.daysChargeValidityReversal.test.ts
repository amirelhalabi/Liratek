/**
 * LIRA-113 rule-20 proof: void/refund of a DAYS-type recharge must restore
 * the shop's OWN carrier line's `validity_expires_at` to its EXACT
 * pre-transaction value, not just the credit-cost drawer leg.
 *
 * `RechargeRepository.daysChargeValidityDecrement.test.ts` proves the
 * CREATE half (a DAYS sale decrements the shop's line validity). This file
 * proves the REVERSE half: `TransactionRepository._reverseCarrierLineMovements`
 * — already the type-agnostic rule-20 owner for every OTHER carrier-line
 * movement (self-charge, ONLY_DAYS_RETURN, CREDIT_BUYBACK; see
 * `TransactionRepository.carrierLineReversal.test.ts`) — also correctly
 * undoes THIS call site's movement with no new reversal code, because the
 * movement is tied to the sale's own `transactions.id` exactly like every
 * other caller of `CarrierLineService.applyMovement`.
 *
 * Per CLAUDE.md rule 17, this was run against the pre-fix
 * `RechargeRepository.processRecharge` (the DAYS-only `applyMovement` call
 * removed) and observed to FAIL — voiding left `validity_expires_at`
 * unrestored because no movement row existed for the reversal path to find
 * in the first place. Restored before committing.
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetDebtService } from "../../services/DebtService";
import { resetDebtRepository } from "../DebtRepository";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
} from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineService } from "../../services/CarrierLineService";

const DAYS_PER_BLOCK = 10;
const COST_PER_BLOCK_USD = 0.3;
const CREDIT_COST_RATE_LBP = 85_000;

function daysCostUsd(days: number): number {
  return (days / DAYS_PER_BLOCK) * COST_PER_BLOCK_USD;
}

/** Far enough out that it is never "already expired" for as long as this
 *  file exists. */
const SHOP_LINE_EXPIRY = "2099-01-01";

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

    CREATE TABLE carrier_lines (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER DEFAULT 1,
      carrier             TEXT NOT NULL CHECK(carrier IN ('alfa','mtc')),
      phone_number        TEXT NOT NULL,
      label               TEXT,
      credits             REAL NOT NULL DEFAULT 0,
      validity_expires_at TEXT,
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

function setCreditCostRate(db: Database.Database, rateLbp: number): void {
  db.prepare(
    `INSERT INTO system_settings (tenant_id, key_name, value)
     VALUES (1, 'alfa_credit_cost_lbp', ?)
     ON CONFLICT(tenant_id, key_name) DO UPDATE SET value = excluded.value`,
  ).run(String(rateLbp));
}

function getLineById(
  db: Database.Database,
  id: number,
): { credits: number; validity_expires_at: string | null } {
  return db
    .prepare(
      `SELECT credits, validity_expires_at FROM carrier_lines WHERE id = ?`,
    )
    .get(id) as { credits: number; validity_expires_at: string | null };
}

function drawer(db: Database.Database, name: string, currency: string): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(name, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function txnIdFor(
  db: Database.Database,
  sourceTable: string,
  sourceId: number,
): number {
  const row = db
    .prepare(
      `SELECT id FROM transactions WHERE source_table = ? AND source_id = ?`,
    )
    .get(sourceTable, sourceId) as { id: number };
  return row.id;
}

describe("RechargeRepository — DAYS sale validity movement is reversible (LIRA-113, rule 20)", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  let txnRepo: TransactionRepository;
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
    txnRepo = new TransactionRepository();
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

  it("VOID restores the shop's line validity to its EXACT pre-sale expiry, alongside the credits/drawer leg", () => {
    setCreditCostRate(db, CREDIT_COST_RATE_LBP);

    const shopLine = carrierLineRepo.createLine({
      carrier: "mtc",
      phone_number: "03999999",
      credits: 100,
      validity_expires_at: SHOP_LINE_EXPIRY,
    });
    const mtcDrawerBefore = drawer(db, "MTC", "USD");

    const result = repo.processRecharge({
      provider: "MTC",
      type: "DAYS",
      amount: 10,
      cost: daysCostUsd(10) * CREDIT_COST_RATE_LBP,
      price: 100_000,
      currency: "LBP",
      paid_by_method: "CASH",
      phoneNumber: "03123456",
      userId: 1,
    });
    expect(result.success).toBe(true);

    // Sanity: the sale actually moved both ledgers before we void it.
    const afterSale = getLineById(db, shopLine.id);
    expect(afterSale.validity_expires_at).not.toBe(SHOP_LINE_EXPIRY);
    expect(drawer(db, "MTC", "USD")).toBeCloseTo(mtcDrawerBefore - 0.3, 6);

    const txnId = txnIdFor(db, "recharges", result.id as number);
    txnRepo.voidTransaction(txnId, 1);

    // Every ledger this sale touched nets back to its pre-sale value.
    const afterVoid = getLineById(db, shopLine.id);
    expect(afterVoid.validity_expires_at).toBe(SHOP_LINE_EXPIRY);
    expect(drawer(db, "MTC", "USD")).toBeCloseTo(mtcDrawerBefore, 6);

    // The movement itself is flipped is_reversed = 1 — the mechanism
    // `_reverseCarrierLineMovements` uses to guarantee idempotence.
    const movement = db
      .prepare(
        `SELECT is_reversed, validity_days_delta, previous_validity_expires_at
         FROM carrier_line_movements WHERE transaction_id = ?`,
      )
      .get(txnId) as {
      is_reversed: number;
      validity_days_delta: number;
      previous_validity_expires_at: string;
    };
    expect(movement.is_reversed).toBe(1);
    expect(movement.validity_days_delta).toBe(-10);
    expect(movement.previous_validity_expires_at).toBe(SHOP_LINE_EXPIRY);
  });

  it("REFUND restores the shop's line validity the same way", () => {
    setCreditCostRate(db, CREDIT_COST_RATE_LBP);

    const shopLine = carrierLineRepo.createLine({
      carrier: "alfa",
      phone_number: "70999999",
      credits: 100,
      validity_expires_at: SHOP_LINE_EXPIRY,
    });

    const result = repo.processRecharge({
      provider: "Alfa",
      type: "DAYS",
      amount: 30,
      cost: daysCostUsd(30) * CREDIT_COST_RATE_LBP,
      price: 250_000,
      currency: "LBP",
      paid_by_method: "CASH",
      phoneNumber: "71123456",
      userId: 1,
    });
    expect(result.success).toBe(true);
    expect(getLineById(db, shopLine.id).validity_expires_at).not.toBe(
      SHOP_LINE_EXPIRY,
    );

    const txnId = txnIdFor(db, "recharges", result.id as number);
    txnRepo.refundTransaction(txnId, 1);

    expect(getLineById(db, shopLine.id).validity_expires_at).toBe(
      SHOP_LINE_EXPIRY,
    );
    const movement = db
      .prepare(
        `SELECT is_reversed FROM carrier_line_movements WHERE transaction_id = ?`,
      )
      .get(txnId) as { is_reversed: number };
    expect(movement.is_reversed).toBe(1);
  });

  it("a DOUBLE-void throws and does not double-restore the line beyond its already-reversed state", () => {
    setCreditCostRate(db, CREDIT_COST_RATE_LBP);

    const shopLine = carrierLineRepo.createLine({
      carrier: "mtc",
      phone_number: "03999997",
      credits: 100,
      validity_expires_at: SHOP_LINE_EXPIRY,
    });

    const result = repo.processRecharge({
      provider: "MTC",
      type: "DAYS",
      amount: 10,
      cost: daysCostUsd(10) * CREDIT_COST_RATE_LBP,
      price: 100_000,
      currency: "LBP",
      paid_by_method: "CASH",
      phoneNumber: "03123499",
      userId: 1,
    });
    const txnId = txnIdFor(db, "recharges", result.id as number);

    txnRepo.voidTransaction(txnId, 1);
    expect(getLineById(db, shopLine.id).validity_expires_at).toBe(
      SHOP_LINE_EXPIRY,
    );

    expect(() => txnRepo.voidTransaction(txnId, 1)).toThrow(/already voided/i);
    // Still exactly the restored value — no double-restore snuck in.
    expect(getLineById(db, shopLine.id).validity_expires_at).toBe(
      SHOP_LINE_EXPIRY,
    );
  });
});
