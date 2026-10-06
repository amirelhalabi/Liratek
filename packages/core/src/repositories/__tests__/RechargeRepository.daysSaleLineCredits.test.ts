/**
 * LIRA-258 / POSTING_INTEGRITY_PLAN 4.3 / POSTING_MAP G15 — the LIRA-252
 * invariant "MTC/Alfa drawer (USD) == Σ that carrier's active line credits"
 * must survive a DAYS sale and its void/refund.
 *
 * Owner decision D4 (2026-10-06): "when we sell days, we pay an amount per
 * 1 month, and yes in real life that amount is reduced from our credits."
 * A DAYS sale already debits the MTC/Alfa drawer by the days' cost
 * (`VALIDITY_DAYS_COST` leg); the primary line's `credits` must drop by the
 * SAME figure, on the SAME `DAYS_SALE` movement row that carries the
 * validity decrement — so the generic `_reverseCarrierLineMovements`
 * restores credits, validity and days_owed together on void (rule 20).
 *
 * Also guards the `topUpApp` half of G15: a drawer-to-drawer top-up INTO
 * MTC/Alfa would raise the drawer with no line movement. The UI never
 * offers it (Recharge page, Phase 8.2) — line credits are added through
 * Settings → Shop Lines (LIRA-252 B) or the buy-back flip — so the
 * repository refuses MTC/Alfa as a `topUpApp` target on both transports.
 *
 * Rule 17: written and run against the pre-fix code first; the failures
 * observed there are recorded in the LIRA-258 ticket notes.
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
import { resetCarrierLineOwedDeliveryRepository } from "../CarrierLineOwedDeliveryRepository";

const CREDIT_COST_RATE_LBP = 85_000;
const DAYS_PER_BLOCK = 10;
const COST_PER_BLOCK_USD = 0.3;

function daysCostUsd(days: number): number {
  return (days / DAYS_PER_BLOCK) * COST_PER_BLOCK_USD;
}

/** Fixed request day (rule 27 — the client supplies it). */
const TODAY = "2026-10-06";
const FAR_EXPIRY = "2027-04-04"; // ~180 days after TODAY
const NEAR_EXPIRY = "2026-10-11"; // 5 days after TODAY — a 30-day sale oversells it

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

function drawer(db: Database.Database, name: string, currency = "USD"): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(name, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function lineCreditsSum(db: Database.Database, carrier: "mtc" | "alfa"): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(credits), 0) AS total FROM carrier_lines WHERE carrier = ? AND is_active = 1`,
    )
    .get(carrier) as { total: number };
  return row.total;
}

interface LineState {
  credits: number;
  validity_expires_at: string | null;
  days_owed: number;
}

function line(db: Database.Database, id: number): LineState {
  return db
    .prepare(
      `SELECT credits, validity_expires_at, days_owed FROM carrier_lines WHERE id = ?`,
    )
    .get(id) as LineState;
}

function txnIdFor(db: Database.Database, rechargeId: number): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'recharges' AND source_id = ?`,
      )
      .get(rechargeId) as { id: number }
  ).id;
}

describe("RechargeRepository — DAYS sale keeps drawer == Σ line credits (LIRA-258, G15, D4)", () => {
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
    resetCarrierLineOwedDeliveryRepository();
    setCreditCostRate(db, CREDIT_COST_RATE_LBP);
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
    resetCarrierLineOwedDeliveryRepository();
    db.close();
  });

  it.each([
    ["MTC", "mtc", "LBP"] as const,
    ["Alfa", "alfa", "USD"] as const,
  ])(
    "%s (%s-priced): the DAYS sale moves the primary line's credits by exactly the drawer delta; void nets drawer, credits and validity to 0",
    (provider, carrier, currency) => {
      const shopLine = carrierLineRepo.createLine(
        {
          carrier,
          phone_number: carrier === "mtc" ? "03999999" : "70999999",
          credits: 100,
          validity_expires_at: FAR_EXPIRY,
        },
        1,
      );
      const drawerName = provider;
      const drawerBefore = drawer(db, drawerName);
      const sumBefore = lineCreditsSum(db, carrier);
      const lineBefore = line(db, shopLine.id);

      const cost =
        currency === "LBP"
          ? daysCostUsd(30) * CREDIT_COST_RATE_LBP
          : daysCostUsd(30);
      const result = repo.processRecharge({
        provider,
        type: "DAYS",
        amount: 30,
        cost,
        price: currency === "LBP" ? 300_000 : 3,
        currency,
        paid_by_method: "CASH",
        phoneNumber: "03123456",
        userId: 1,
        client_day: TODAY,
      });
      expect(result.success).toBe(true);

      const drawerDelta = drawer(db, drawerName) - drawerBefore;
      const sumDelta = lineCreditsSum(db, carrier) - sumBefore;
      // Sanity: the drawer moved by the days' cost ($0.90 for 30 days).
      expect(drawerDelta).toBeCloseTo(-0.9, 6);
      // THE INVARIANT (LIRA-252): the lines move by the same amount.
      expect(sumDelta).toBeCloseTo(drawerDelta, 6);
      expect(line(db, shopLine.id).credits).toBeCloseTo(100 - 0.9, 6);

      // ONE movement row carries both halves (rule 20 — one reversal).
      const movements = db
        .prepare(
          `SELECT reason, credits_delta, validity_days_delta FROM carrier_line_movements WHERE transaction_id = ?`,
        )
        .all(txnIdFor(db, result.id as number)) as {
        reason: string;
        credits_delta: number;
        validity_days_delta: number;
      }[];
      expect(movements).toHaveLength(1);
      expect(movements[0].reason).toBe("DAYS_SALE");
      expect(movements[0].credits_delta).toBeCloseTo(-0.9, 6);
      expect(movements[0].validity_days_delta).toBe(-30);

      txnRepo.voidTransaction(txnIdFor(db, result.id as number), 1);

      expect(drawer(db, drawerName)).toBeCloseTo(drawerBefore, 6);
      expect(lineCreditsSum(db, carrier)).toBeCloseTo(sumBefore, 6);
      const lineAfter = line(db, shopLine.id);
      expect(lineAfter.credits).toBeCloseTo(lineBefore.credits, 6);
      expect(lineAfter.validity_expires_at).toBe(lineBefore.validity_expires_at);
      expect(lineAfter.days_owed).toBe(lineBefore.days_owed);
    },
  );

  it("a sold-ahead DAYS sale (days_owed banked) still drops credits by the full cost, and REFUND restores credits, validity and days_owed", () => {
    const shopLine = carrierLineRepo.createLine(
      {
        carrier: "mtc",
        phone_number: "03999998",
        credits: 50,
        validity_expires_at: NEAR_EXPIRY,
      },
      1,
    );
    const drawerBefore = drawer(db, "MTC");
    const lineBefore = line(db, shopLine.id);

    const result = repo.processRecharge({
      provider: "MTC",
      type: "DAYS",
      amount: 30,
      cost: daysCostUsd(30) * CREDIT_COST_RATE_LBP,
      price: 300_000,
      currency: "LBP",
      paid_by_method: "CASH",
      phoneNumber: "03123457",
      userId: 1,
      client_day: TODAY,
    });
    expect(result.success).toBe(true);

    const afterSale = line(db, shopLine.id);
    expect(afterSale.days_owed).toBeGreaterThan(0); // sanity: it oversold
    expect(drawer(db, "MTC") - drawerBefore).toBeCloseTo(-0.9, 6);
    expect(afterSale.credits - lineBefore.credits).toBeCloseTo(-0.9, 6);

    txnRepo.refundTransaction(txnIdFor(db, result.id as number), 1);

    const afterRefund = line(db, shopLine.id);
    expect(drawer(db, "MTC")).toBeCloseTo(drawerBefore, 6);
    expect(afterRefund.credits).toBeCloseTo(lineBefore.credits, 6);
    expect(afterRefund.validity_expires_at).toBe(lineBefore.validity_expires_at);
    expect(afterRefund.days_owed).toBe(lineBefore.days_owed);
  });

  it("no primary line: the sale still succeeds and the drawer leg posts (same convention as credit sales)", () => {
    const drawerBefore = drawer(db, "Alfa");
    const result = repo.processRecharge({
      provider: "Alfa",
      type: "DAYS",
      amount: 10,
      cost: daysCostUsd(10),
      price: 1,
      currency: "USD",
      paid_by_method: "CASH",
      phoneNumber: "71123456",
      userId: 1,
      client_day: TODAY,
    });
    expect(result.success).toBe(true);
    expect(drawer(db, "Alfa") - drawerBefore).toBeCloseTo(-0.3, 6);
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) AS n FROM carrier_line_movements`)
          .get() as { n: number }
      ).n,
    ).toBe(0);
  });
});

describe("RechargeRepository.topUpApp — MTC/Alfa are not drawer top-up targets (LIRA-258, G15)", () => {
  let db: Database.Database;
  let repo: RechargeRepository;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    repo = new RechargeRepository();
  });

  afterEach(() => {
    clearTestDb();
    resetTenantContext();
    resetTransactionRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetCarrierLineService();
    db.close();
  });

  it.each(["MTC", "Alfa"] as const)(
    "%s: refused with a clear error; no drawer, recharge or transaction row moves",
    (provider) => {
      const generalBefore = drawer(db, "General");
      const destBefore = drawer(db, provider);

      const result = repo.topUpApp({
        provider,
        amount: 50,
        currency: "USD",
        sourceDrawer: "General",
        userId: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/shop lines/i);
      expect(drawer(db, "General")).toBeCloseTo(generalBefore, 6);
      expect(drawer(db, provider)).toBeCloseTo(destBefore, 6);
      expect(
        (db.prepare(`SELECT COUNT(*) AS n FROM recharges`).get() as { n: number })
          .n,
      ).toBe(0);
      expect(
        (
          db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as {
            n: number;
          }
        ).n,
      ).toBe(0);
    },
  );
});
