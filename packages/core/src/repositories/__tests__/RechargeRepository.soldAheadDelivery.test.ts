/**
 * NOT RUN — proven at the end-of-batch gate.
 *
 * #28 (LIRA-218, v184) — `RechargeRepository`'s DAYS-sale path writes a
 * `carrier_line_owed_deliveries` row ("days still to send") when a sale
 * outruns the shop line's real remaining days. This file is the gap the
 * 2026-09-24 adversarial review found: no RechargeRepository test covered
 * that write at all, so the m2 client_name bug (the row stored the raw,
 * unresolved `data.clientName` instead of the name looked up from
 * `clients` when only a `clientId` was sent — a sale sent with only a
 * clientId showed "Walk-in" on the "days still to send" list) shipped with
 * nothing catching it.
 *
 * Per CLAUDE.md rule 17, "resolves the client name from clientId" is proven
 * against the pre-fix code (`client_name: data.clientName ?? null`) and
 * observed to FAIL (it stored NULL instead of the looked-up name) before
 * being fixed to use the already-resolved `clientName` local.
 *
 * Harness copied from `RechargeRepository.daysChargeValidityDecrement
 * .test.ts` (same hand-rolled schema), with a `clients` row and the
 * `carrier_line_owed_deliveries` table (v184) added.
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
import { resetCarrierLineOwedDeliveryRepository } from "../CarrierLineOwedDeliveryRepository";

const CREDIT_COST_RATE_LBP = 85_000;
const DAYS_PER_BLOCK = 10;
const COST_PER_BLOCK_USD = 0.3;

function daysCostUsd(days: number): number {
  return (days / DAYS_PER_BLOCK) * COST_PER_BLOCK_USD;
}

/** Computed relative to the REAL clock (not a hardcoded calendar date) so
 *  this test stays correct no matter when it is actually run: 5 days out is
 *  always few enough that a 30-day sale oversells it, and always in the
 *  future so the line is never "already expired". */
function daysFromRealTodayISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const SHOP_LINE_EXPIRY_NEAR = daysFromRealTodayISO(5);
const SHOP_LINE_EXPIRY_FAR = daysFromRealTodayISO(180);

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
    INSERT INTO clients (id, full_name, phone_number, tenant_id)
      VALUES (1, 'Jean Fixture', '70000001', 1);

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

    CREATE TABLE carrier_line_owed_deliveries (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id       INTEGER,
      carrier_line_id INTEGER NOT NULL,
      transaction_id  INTEGER,
      client_id       INTEGER,
      client_name     TEXT,
      days_owed       INTEGER NOT NULL,
      status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT')),
      sent_at         DATETIME,
      sent_by         INTEGER,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
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

describe("RechargeRepository — DAYS sold-ahead sale writes a carrier_line_owed_deliveries row (#28, LIRA-218)", () => {
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
    resetCarrierLineOwedDeliveryRepository();
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
    resetCarrierLineOwedDeliveryRepository();
    db.close();
  });

  it("m2: resolves client_name from clientId, not the raw (possibly stale/absent) data.clientName", () => {
    setCreditCostRate(db, CREDIT_COST_RATE_LBP);
    carrierLineRepo.createLine({
      carrier: "mtc",
      phone_number: "03999999",
      credits: 100,
      validity_expires_at: SHOP_LINE_EXPIRY_NEAR, // 5 real days left from today
    });

    const result = repo.processRecharge({
      provider: "MTC",
      type: "DAYS",
      amount: 30, // oversells the ~5 real days left
      cost: daysCostUsd(30) * CREDIT_COST_RATE_LBP,
      price: 300_000,
      currency: "LBP",
      paid_by_method: "CASH",
      phoneNumber: "70000001",
      clientId: 1, // ONLY clientId sent, no clientName — the m2 trap
      userId: 1,
    });
    expect(result.success).toBe(true);

    const delivery = db
      .prepare(
        `SELECT client_id, client_name, days_owed FROM carrier_line_owed_deliveries WHERE tenant_id = 1`,
      )
      .get() as { client_id: number; client_name: string | null; days_owed: number };

    expect(delivery).toBeDefined();
    expect(delivery.client_id).toBe(1);
    // Pre-fix: this was NULL (data.clientName ?? null, and no clientName was
    // sent) — the "days still to send" list showed "Walk-in" for a known
    // client.
    expect(delivery.client_name).toBe("Jean Fixture");
    expect(delivery.days_owed).toBeGreaterThan(0);
  });

  it("writes NO delivery row when the sale stays within the line's real remaining days", () => {
    setCreditCostRate(db, CREDIT_COST_RATE_LBP);
    carrierLineRepo.createLine({
      carrier: "mtc",
      phone_number: "03999998",
      credits: 100,
      validity_expires_at: SHOP_LINE_EXPIRY_FAR, // comfortably more than 10 days out
    });

    const result = repo.processRecharge({
      provider: "MTC",
      type: "DAYS",
      amount: 10,
      cost: daysCostUsd(10) * CREDIT_COST_RATE_LBP,
      price: 100_000,
      currency: "LBP",
      paid_by_method: "CASH",
      phoneNumber: "70000002",
      userId: 1,
    });
    expect(result.success).toBe(true);

    const count = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM carrier_line_owed_deliveries WHERE tenant_id = 1`,
        )
        .get() as { n: number }
    ).n;
    expect(count).toBe(0);
  });
});
